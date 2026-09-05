'use strict';
// Data-loss protection: JSON integrity checks with auto-restore, rolling zip
// snapshots of data/, and catch-up copies to a user-chosen destination (e.g.
// a folder inside iCloud Drive — macOS's file provider does the actual
// upload, so this all works offline and catches up when the network returns).
//
//   data/backups/index-YYYY-MM-DD-HHMMSS.zip   one per day on launch
//   data/backups/state.json                          sync bookkeeping
//
// Retention: newest zip per day for 30 days, then newest per week for 10
// more weeks. Everything else is deleted. backups/ itself is never zipped.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const store = require('./store');

const BACKUPS_DIR = path.join(store.DATA_DIR, 'backups');
const STATE_FILE = path.join(BACKUPS_DIR, 'state.json');
const KEEP_DAILY_DAYS = 30;   // newest-per-day, days 0..29
const KEEP_WEEKLY = 10;       // then newest-per-week, 10 more weeks

// ---- helpers ------------------------------------------------------------

function zipName(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `index-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`;
}

// 'index-YYYY-MM-DD-HHMMSS.zip' -> { name, ts } | null
function parseZipName(name) {
  const m = /^index-(\d{4}-\d{2}-\d{2})-(\d{6})\.zip$/.exec(name);
  if (!m) return null;
  const iso = `${m[1]}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}`;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? { name, ts } : null;
}

async function listZips() {
  const names = await fsp.readdir(BACKUPS_DIR).catch(() => []);
  return names.map(parseZipName).filter(Boolean)
    .sort((a, b) => b.ts - a.ts); // newest first
}

// Local calendar day + Monday-week keys, matching the app's day-key convention.
function dayKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weekKeyOf(ts) {
  const d = new Date(ts);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return dayKeyOf(d.getTime());
}

async function loadState() {
  try { return JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')); } catch { return {}; }
}

async function saveState(state) {
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tmp, STATE_FILE);
}

// Atomic write for restored data files (mirrors store.writeJsonAtomic, which
// isn't exported; restored files go through JSON.stringify the same way).
async function writeRestored(filePath, json) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(json, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, maxBuffer: 512 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

// ---- integrity check + auto-restore -------------------------------------

// Every JSON data file must parse. Corrupt ones are restored from the newest
// backup zip that carries a good copy; if none has one, the quarantined
// original (renamed .corrupt-<ts> by store.readJson) is left for inspection.
async function verifyData() {
  const corrupt = [];
  const restored = [];

  const check = async (filePath, fallbackParse /* see below */) => {
    let raw;
    try { raw = await fsp.readFile(filePath, 'utf8'); } catch { return; } // absent = fine
    try { JSON.parse(raw); } catch { corrupt.push(filePath); }
  };

  await check(store.NOTEBOOKS_FILE);
  await check(store.PROJECTS_FILE);
  await check(store.SETTINGS_FILE);
  const pageIds = await store.listPageIds();
  for (const pid of pageIds) {
    await check(path.join(store.PAGES_DIR, `${pid}.json`));
  }

  for (const filePath of corrupt) {
    const rel = path.relative(store.DATA_DIR, filePath);
    const good = await restoreFile(rel);
    if (good) {
      restored.push(rel);
    } else {
      // Nothing recoverable — quarantine so no consumer ever reads the bad bytes.
      const aside = `${filePath}.corrupt-${Date.now()}`;
      await fsp.rename(filePath, aside).catch(() => {});
      console.error(`[backup] ${rel} is corrupt and no backup holds a good copy; quarantined as ${path.basename(aside)}`);
    }
  }
  return { corrupt: corrupt.length, restored };
}

// Find the newest backup zip whose copy of relPath parses as JSON; write it
// back to the live path. Returns true if the live file was replaced.
async function restoreFile(relPath) {
  const zips = await listZips();
  for (const { name, ts } of zips) {
    const zipPath = path.join(BACKUPS_DIR, name);
    const list = await run('unzip', ['-Z1', zipPath]);
    if (list.err) continue;
    const entry = list.stdout.split('\n')
      .map(l => l.replace(/^\.\//, '').trim())
      .find(l => l === relPath);
    if (!entry) continue;
    const out = await run('unzip', ['-p', zipPath, entry]);
    if (out.err) continue;
    try {
      const json = JSON.parse(out.stdout.toString('utf8'));
      await writeRestored(path.join(store.DATA_DIR, relPath), json);
      console.log(`[backup] restored ${relPath} from ${name} (${new Date(ts).toLocaleString()})`);
      await store.appendActivity({
        type: 'app.restore',
        summary: `Restored ${relPath} from backup ${name}`,
      });
      return true;
    } catch { /* that copy is bad too — keep walking back */ }
  }
  return false;
}

// ---- zip snapshot --------------------------------------------------------

// One zip per local day on launch (skip if today already has one); force =
// manual "back up now" always writes a fresh zip.
async function createBackup(force = false) {
  const zips = await listZips();
  if (!force && zips[0] && dayKeyOf(zips[0].ts) === dayKeyOf(Date.now())) {
    return null; // today's snapshot already exists
  }
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
  const out = path.join(BACKUPS_DIR, zipName(Date.now()));
  // Run from inside data/ so entry paths are relative to it; never zip the
  // backups folder, temp files, or quarantined corrupt copies.
  const { err, stderr } = await run('zip', [
    '-r', '-X', '-q', out, '.',
    '-x', 'backups/*', '*.tmp', '*.corrupt-*', '.*.tmp',
  ], { cwd: store.DATA_DIR });
  if (err) {
    console.error('[backup] zip failed:', err.message, stderr || '');
    await fsp.rm(out, { force: true });
    return null;
  }
  await store.appendActivity({ type: 'app.backup', summary: `Snapshot taken: ${path.basename(out)}` });
  const pruned = await pruneBackups();
  return { file: path.basename(out), pruned };
}

async function pruneBackups() {
  const zips = await listZips();
  const keep = new Set();
  const days = new Set();
  const weeks = new Set();
  for (const { name, ts } of zips) {
    const day = dayKeyOf(ts);
    if (days.has(day)) continue;           // not the newest of that day
    if (days.size < KEEP_DAILY_DAYS) {     // 30 newest day-buckets
      days.add(day); keep.add(name); continue;
    }
    const week = weekKeyOf(ts);
    if (!weeks.has(week) && weeks.size < KEEP_WEEKLY) {
      weeks.add(week); keep.add(name);     // 10 older week-buckets
    }
  }
  let removed = 0;
  for (const { name } of zips) {
    if (keep.has(name)) continue;
    await fsp.rm(path.join(BACKUPS_DIR, name), { force: true });
    removed++;
  }
  return removed;
}

// ---- off-machine catch-up ------------------------------------------------

// Copy every zip the destination is missing (by filename). The destination is
// whatever folder the user picked — commonly inside iCloud Drive; the OS
// uploads it whenever the network allows, so nothing here needs to be online.
async function syncOffMachine() {
  const settings = await store.loadSettings();
  const dest = settings.backupDest;
  if (!dest) return { skipped: 'no destination set' };
  if (path.resolve(dest).startsWith(path.resolve(store.DATA_DIR))) {
    return { skipped: 'destination is inside data/' };
  }
  await fsp.mkdir(dest, { recursive: true }).catch(() => {});

  const zips = await listZips();
  let copied = 0;
  let latest = null;
  for (const { name, ts } of zips) {
    const from = path.join(BACKUPS_DIR, name);
    const to = path.join(dest, name);
    try {
      const [srcStat, dstStat] = await Promise.all([fsp.stat(from), fsp.stat(to).catch(() => null)]);
      if (dstStat && dstStat.size === srcStat.size) {
        if (!latest || ts > latest) latest = ts;
        continue; // already there
      }
      await fsp.copyFile(from, to);
      copied++;
      if (!latest || ts > latest) latest = ts;
    } catch (e) {
      console.error(`[backup] copy ${name} failed:`, e.message);
    }
  }
  const state = await loadState();
  if (latest && (!state.lastOffMachineTs || latest > state.lastOffMachineTs)) {
    state.lastOffMachineTs = latest;
  }
  state.lastSyncAt = Date.now();
  await saveState(state);
  return { copied, lastOffMachineTs: state.lastOffMachineTs };
}

// ---- status for the UI ---------------------------------------------------

async function status() {
  const zips = await listZips();
  const state = await loadState();
  const settings = await store.loadSettings();
  return {
    count: zips.length,
    lastBackup: zips[0] ? { name: zips[0].name, ts: zips[0].ts } : null,
    dest: settings.backupDest || null,
    lastOffMachineTs: state.lastOffMachineTs || null,
    lastSyncAt: state.lastSyncAt || null,
  };
}

// Launch path: verify/restore, snapshot, prune, then catch up to the
// off-machine destination (every launch, not just when a zip was written —
// the network may have been down for past attempts). Never throws — a failed
// backup must never block the app from starting.
async function runStartupChecks() {
  try {
    await fsp.mkdir(BACKUPS_DIR, { recursive: true });
    const integrity = await verifyData();
    const snap = await createBackup(false);
    const synced = await syncOffMachine().catch((e) => {
      console.error('[backup] off-machine sync failed:', e.message);
      return null;
    });
    if (integrity.corrupt || snap || (synced && synced.copied)) {
      console.log('[backup] startup:', JSON.stringify({
        integrity, snap: snap ? snap.file : 'today already covered', synced,
      }));
    }
  } catch (e) {
    console.error('[backup] startup checks failed:', e.message);
  }
}

module.exports = {
  BACKUPS_DIR, KEEP_DAILY_DAYS, KEEP_WEEKLY,
  runStartupChecks, createBackup, pruneBackups, verifyData, restoreFile,
  syncOffMachine, status,
};