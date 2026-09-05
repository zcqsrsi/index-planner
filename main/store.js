'use strict';
// Data backbone: atomic JSON persistence + append-only activity log.
// All data lives in one portable data/ folder. From source that's the
// repo's own data/; packaged, the app bundle is read-only and disposable,
// so data moves to ~/Library/Application Support/Index/data — still plain
// files, still one folder to back up.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const DATA_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : path.join(__dirname, '..', 'data');
const PAGES_DIR = path.join(DATA_DIR, 'pages');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');
const NOTEBOOKS_FILE = path.join(DATA_DIR, 'notebooks.json');
// The Dock mark the user picked, parked as a PNG so the next launch can
// repaint the Dock before the renderer is up.
const DOCK_ICON_FILE = path.join(DATA_DIR, 'dock-icon.png');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.jsonl');
const DAYLOG_FILE = path.join(DATA_DIR, 'daylog.json');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 13).replace(/-/g, '')}`;
}

// Local YYYY-MM-DD (lexical-compare safe), matching the renderer's todayStr().
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ensureDirs() {
  for (const dir of [DATA_DIR, PAGES_DIR, ATTACHMENTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Atomic write: temp file + rename. A crash can never leave a half-written file.
async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // Corrupt file: rename it aside so we never lose the bytes, return fallback.
    try { await fsp.rename(filePath, `${filePath}.corrupt-${Date.now()}`); } catch {}
    return fallback;
  }
}

async function loadNotebooks() {
  return normalizeTree(await readJson(NOTEBOOKS_FILE, { notebooks: [] }));
}

// Unnormalized on-disk tree — lets app:bootstrap run the one-time fold
// before any default-stamping would hide an unmerged file.
async function loadNotebooksRaw() {
  return readJson(NOTEBOOKS_FILE, null);
}

async function saveNotebooks(tree) {
  await writeJsonAtomic(NOTEBOOKS_FILE, normalizeTree(tree));
}

// Every read/write passes through here, so consumers never see a shape
// they don't expect — same defensive-defaults approach as normalizeTask.
function normalizeSection(sec) {
  if (!Array.isArray(sec.pages)) sec.pages = [];
  if (!Array.isArray(sec.tasks)) sec.tasks = [];
  sec.tasks = sec.tasks.map(normalizeTask);
  // The day diary: one entry per day the sub-objective was touched —
  // quick note text plus attached files, anchored to their day forever.
  if (!sec.days || typeof sec.days !== 'object' || Array.isArray(sec.days)) sec.days = {};
  for (const key of Object.keys(sec.days)) {
    const day = sec.days[key];
    if (typeof day.note !== 'string') day.note = '';
    if (!Array.isArray(day.files)) day.files = [];
  }
  if (sec.objectiveId === undefined) sec.objectiveId = null;
  if (sec.createdAt === undefined) sec.createdAt = Date.now();
  return sec;
}

function normalizeNotebook(nb) {
  if (!['project', 'log'].includes(nb.kind)) nb.kind = 'project';
  if (!PROJECT_STATUSES.includes(nb.status)) nb.status = 'active';
  if (nb.dueDate === undefined) nb.dueDate = null;
  if (nb.description === undefined) nb.description = '';
  if (nb.groupId === undefined) nb.groupId = null;
  if (nb.universeId === undefined) nb.universeId = null;
  if (nb.scrappedReason === undefined) nb.scrappedReason = null;
  // Big picture (v4): the statement a journal is written under. Grouped
  // projects share their group's — ungrouped ones carry their own.
  if (nb.bigPicture === undefined || nb.bigPicture === null || typeof nb.bigPicture !== 'object') nb.bigPicture = null;
  else if (typeof nb.bigPicture.text !== 'string') nb.bigPicture.text = '';
  if (!Array.isArray(nb.bigPictureHistory)) nb.bigPictureHistory = [];
  // The answer, so far: a resolution never closes its question — revising
  // the question archives it with the old wording (bigpicture:set).
  if (nb.bigPictureResolution === undefined || nb.bigPictureResolution === null || typeof nb.bigPictureResolution !== 'object') nb.bigPictureResolution = null;
  else if (typeof nb.bigPictureResolution.text !== 'string') nb.bigPictureResolution.text = '';
  nb.objectives = (Array.isArray(nb.objectives) ? nb.objectives : []).map(o => {
    if (!OBJECTIVE_STATUSES.includes(o.status)) o.status = 'active';
    if (o.createdAt === undefined) o.createdAt = Date.now();
    if (o.scrappedReason === undefined) o.scrappedReason = null;
    return o;
  });
  if (!Array.isArray(nb.floatingTasks)) nb.floatingTasks = [];
  nb.floatingTasks = nb.floatingTasks.map(normalizeTask);
  if (!Array.isArray(nb.sections)) nb.sections = [];
  for (const sec of nb.sections) normalizeSection(sec);
  return nb;
}

function normalizeTree(tree) {
  // Universes (v3): the level above projects. Every notebook and group
  // belongs to one; a tree with none gets the default.
  if (!Array.isArray(tree.universes)) tree.universes = [];
  tree.universes = tree.universes.map(u => {
    if (!u.id) u.id = id('u');
    if (u.createdAt === undefined) u.createdAt = Date.now();
    if (u.name === undefined || u.name === '') u.name = 'Universe';
    return u;
  });
  // A tree that somehow reaches normalize with no universes at all (fresh
  // install, a hand-edited file) still gets the default — the switcher and
  // fallback stamping both key off this list.
  if (!tree.universes.length) {
    tree.universes = [{ id: id('u'), name: 'Personal', createdAt: Date.now() }];
  }
  const fallbackUniverse = tree.universes[0] ? tree.universes[0].id : null;
  if (!Array.isArray(tree.notebooks)) tree.notebooks = [];
  for (const nb of tree.notebooks) {
    normalizeNotebook(nb);
    if (!nb.universeId) nb.universeId = fallbackUniverse;
  }
  tree.groups = (Array.isArray(tree.groups) ? tree.groups : []).map(g => {
    if (g.color === undefined) g.color = null;
    if (g.parentId === undefined) g.parentId = null;
    if (g.universeId === undefined) g.universeId = fallbackUniverse;
    if (g.createdAt === undefined) g.createdAt = Date.now();
    // Big picture lives on the group so its members share one statement.
    if (g.bigPicture === undefined || g.bigPicture === null || typeof g.bigPicture !== 'object') g.bigPicture = null;
    else if (typeof g.bigPicture.text !== 'string') g.bigPicture.text = '';
    if (!Array.isArray(g.bigPictureHistory)) g.bigPictureHistory = [];
    if (g.bigPictureResolution === undefined || g.bigPictureResolution === null || typeof g.bigPictureResolution !== 'object') g.bigPictureResolution = null;
    else if (typeof g.bigPictureResolution.text !== 'string') g.bigPictureResolution.text = '';
    return g;
  });
  if (tree.mergeVersion === undefined) tree.mergeVersion = TREE_MERGE_VERSION;
  return tree;
}

// ---- One-time merge of the old projects.json into the tree ------------
// Takes the RAW (unnormalized) tree — normalization stamps mergeVersion,
// which would hide an unmerged file from the guard. Idempotent: guarded
// by the on-disk mergeVersion flag.

async function mergeProjectsIntoTree(rawTree, rawProjects) {
  if (!rawTree) rawTree = { notebooks: [] };
  // The fold only ever brings a file up to the merge schema (v1); day-row
  // migration (migrateDayRows) is what takes it to the current version.
  if (rawTree.mergeVersion !== undefined && rawTree.mergeVersion >= 1) return false;
  const tree = rawTree;
  const projects = (rawProjects && Array.isArray(rawProjects.projects)) ? rawProjects.projects : [];
  let folded = 0;
  for (const p of projects) {
    // The linked notebook (or a same-named one) becomes the project.
    let nb = tree.notebooks.find(n => n.id === p.notebookId)
      || tree.notebooks.find(n => n.name === p.name && n.kind === 'project');
    if (!nb) {
      nb = { id: p.id, name: p.name, color: p.color || null, icon: null, createdAt: p.createdAt || Date.now(), sections: [] };
      tree.notebooks.push(nb);
    }
    nb.kind = 'project';
    nb.status = PROJECT_STATUSES.includes(p.status) ? p.status : 'active';
    nb.dueDate = p.dueDate ?? null;
    nb.description = p.description || '';
    nb.scrappedReason = p.scrappedReason || null;
    if (p.color && !nb.color) nb.color = p.color;
    nb.objectives = Array.isArray(nb.objectives) ? nb.objectives : [];

    // Each old objective becomes an objective tier entry plus one
    // sub-objective (section) named after it, holding that objective's
    // tasks — the default sub-objective existing tasks migrate into.
    for (const o of p.objectives || []) {
      if (!nb.objectives.some(x => x.id === o.id)) {
        nb.objectives.push({ id: o.id, name: o.name, status: o.status || 'active', createdAt: o.createdAt || Date.now(), scrappedReason: null });
      }
      if (!nb.sections.some(s => s.id === o.id)) {
        nb.sections.push({
          id: o.id, name: o.name, createdAt: o.createdAt || Date.now(),
          objectiveId: o.id, pages: [], tasks: (o.tasks || []).map(normalizeTask),
        });
      }
    }
    folded++;
  }
  // The Log notebook is journal side, not a project.
  const log = tree.notebooks.find(n => n.name === 'Log');
  if (log) log.kind = 'log';
  tree.mergeVersion = 1;
  return folded > 0;
}

// ---- One-time migration to day rows (v2) -------------------------------
// The planner model: every task is written ON a day (t.day, derived from
// createdAt), and every sub-objective keeps a per-day diary (sec.days).
// Takes the RAW tree — normalization would stamp the missing fields and
// hide an unmigrated file from the guard. Idempotent via mergeVersion.
function migrateDayRows(rawTree) {
  if (!rawTree) return false;
  if (rawTree.mergeVersion !== undefined && rawTree.mergeVersion >= TREE_MERGE_VERSION) return false;
  let stamped = 0;
  for (const nb of rawTree.notebooks || []) {
    for (const t of nb.floatingTasks || []) {
      if (t.day === undefined) { t.day = dayKey(t.createdAt || t.updatedAt || Date.now()); stamped++; }
    }
    for (const sec of nb.sections || []) {
      if (!sec.days || typeof sec.days !== 'object' || Array.isArray(sec.days)) sec.days = {};
      for (const t of sec.tasks || []) {
        if (t.day === undefined) { t.day = dayKey(t.createdAt || t.updatedAt || Date.now()); stamped++; }
      }
    }
  }
  rawTree.mergeVersion = TREE_MERGE_VERSION;
  return stamped > 0;
}

// ---- One-time migration to universes (v3) -------------------------------
// Notebook-as-universe: a level above projects — each universe holds its
// own projects and groups, switchable OneNote-style. Existing data lands
// in one default universe ("Personal"), so nothing moves visibly. Takes
// the RAW tree; idempotent via mergeVersion.
function migrateUniverses(rawTree) {
  if (!rawTree) return false;
  if (rawTree.mergeVersion !== undefined && rawTree.mergeVersion >= TREE_MERGE_VERSION) return false;
  if (!Array.isArray(rawTree.universes) || !rawTree.universes.length) {
    rawTree.universes = [{ id: id('u'), name: 'Personal', createdAt: Date.now() }];
  }
  const fallback = rawTree.universes[0].id;
  let stamped = 0;
  for (const nb of rawTree.notebooks || []) {
    if (!nb.universeId) { nb.universeId = fallback; stamped++; }
  }
  for (const g of rawTree.groups || []) {
    if (!g.universeId) { g.universeId = fallback; stamped++; }
  }
  rawTree.mergeVersion = TREE_MERGE_VERSION;
  return true;
}

// ---- One-time migration to dedupe titles (v4) ---------------------------
// Repeated journal splits and imports could leave two aims sharing a
// name, or two sub-objectives sharing a name under the same aim (or both
// project-level). The pane showed the pair; the data merges instead.
// The FIRST of each duplicate pair is kept and the rest fold into it —
// tasks and pages keep their ids, day diaries merge per date (first
// written wins) — then the emptied duplicates are dropped. Scoped to one
// notebook; sub-objectives also scoped to their aim, so same-named
// sub-objectives under DIFFERENT aims are legitimate and survive.
// Takes the RAW tree; idempotent via mergeVersion.
function migrateDedupeTitles(rawTree) {
  if (!rawTree) return 0;
  if (rawTree.mergeVersion !== undefined && rawTree.mergeVersion >= TREE_MERGE_VERSION) return 0;
  const merged = dedupeTree(rawTree);
  rawTree.mergeVersion = TREE_MERGE_VERSION;
  return merged;
}

// The dedupe pass proper — no version guard. migrateDedupeTitles wraps it
// for the one-time version bump; app:bootstrap also runs it on EVERY boot
// so duplicates never linger, however they arrived (an older packaged
// build wrote them after this version shipped, a hand-edited file, …).
function dedupeTree(tree) {
  if (!tree) return 0;
  let merged = 0;
  const key = (s) => String(s || '').trim().toLowerCase();
  for (const nb of tree.notebooks || []) {
    // Aims: same name → the later ones fold into the first.
    const objectives = nb.objectives || [];
    const keptObj = new Map();
    const dropObj = new Map(); // duplicate id → kept id
    for (const o of objectives) {
      const k = key(o.name);
      if (keptObj.has(k)) dropObj.set(o.id, keptObj.get(k).id);
      else keptObj.set(k, o);
    }
    if (dropObj.size) {
      nb.objectives = objectives.filter(o => !dropObj.has(o.id));
      for (const sec of nb.sections || []) {
        if (dropObj.has(sec.objectiveId)) sec.objectiveId = dropObj.get(sec.objectiveId);
      }
      merged += dropObj.size;
    }
    // Sub-objectives: same name under the same aim (null = General).
    const keptSec = new Map(); // `${aimId}|${name}` → kept section
    const dropSec = new Map(); // duplicate id → kept section
    for (const s of nb.sections || []) {
      const k = `${s.objectiveId || ''}|${key(s.name)}`;
      if (keptSec.has(k)) dropSec.set(s.id, keptSec.get(k));
      else keptSec.set(k, s);
    }
    for (const [dupId, keep] of dropSec) {
      const dup = (nb.sections || []).find(s => s.id === dupId);
      if (!dup) continue;
      const seen = new Set((keep.tasks || []).map(t => t.id));
      for (const t of dup.tasks || []) {
        if (!seen.has(t.id)) { keep.tasks.push(t); seen.add(t.id); }
      }
      const pageIds = new Set((keep.pages || []).map(pg => pg.id));
      for (const pg of dup.pages || []) {
        if (!pageIds.has(pg.id)) { keep.pages.push(pg); pageIds.add(pg.id); }
      }
      for (const [d, day] of Object.entries(dup.days || {})) {
        const has = keep.days[d] && (keep.days[d].note || (keep.days[d].files || []).length);
        if (!has) keep.days[d] = day;
      }
      merged++;
    }
    if (dropSec.size) nb.sections = nb.sections.filter(s => !dropSec.has(s.id));
  }
  return merged;
}

// ---- Big picture migration --------------------------------------------
// The big question used to be ONE global statement in settings.json. Now
// each group carries one (shared by its member projects) and each
// ungrouped project carries its own. Key-guarded, not version-guarded:
// it runs exactly while the legacy settings key exists, copies the old
// global statement onto every group and ungrouped project (continuity —
// every project still sees what it saw before), and the key is then
// cleared in settings.json by the caller. Once gone it never runs again,
// so it never collides with the mergeVersion-stamping migrations above.
function migrateBigPicture(rawTree, legacy) {
  if (!rawTree || !legacy || !legacy.bigQuestion) return false;
  const bp = legacy.bigQuestion;
  const hist = Array.isArray(legacy.bigQuestionHistory) ? legacy.bigQuestionHistory : [];
  let stamped = 0;
  for (const g of rawTree.groups || []) {
    if (!g.bigPicture) { g.bigPicture = { ...bp }; g.bigPictureHistory = hist.map(h => ({ ...h })); stamped++; }
  }
  for (const nb of rawTree.notebooks || []) {
    if (nb.groupId) continue; // grouped members read the group's statement
    if (!nb.bigPicture) { nb.bigPicture = { ...bp }; nb.bigPictureHistory = hist.map(h => ({ ...h })); stamped++; }
  }
  return stamped > 0;
}

// ---- Merged tree schema -----------------------------------------------
// Phase 9 (the merge): projects and notebooks are ONE concept. The tree in
// notebooks.json is the only store:
//   project = notebook → objective → sub-objective (section) → task
// Hunt fields (status/dueDate/…) live on the notebook; tasks live on
// sections (sub-objectives) or float on the notebook itself; named,
// colored, nestable groups sit at the tree root. Reading always
// normalizes; the one-time fold of the old projects.json happens in
// app:bootstrap (mergeProjectsIntoTree). v2 adds the planner: tasks carry
// the day they were written (t.day) and sub-objectives keep a per-day
// diary (sec.days) — migrateDayRows backfills both, guarded by
// mergeVersion like the fold. v4 merges duplicate aims and duplicate
// same-named sub-objectives (repeated journal splits could leave both) —
// migrateDedupeTitles folds each duplicate into its first occurrence.

const TREE_MERGE_VERSION = 4;
const TASK_STATUSES = ['todo', 'in-progress', 'done', 'scrapped'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PROJECT_STATUSES = ['active', 'paused', 'done', 'scrapped', 'archived'];
const OBJECTIVE_STATUSES = ['active', 'done', 'scrapped'];

// The pre-merge projects.json schema (still read once, by the fold):
// v1: project.tasks[] flat. v2: project.objectives[] each holding tasks.
const PROJECTS_SCHEMA_VERSION = 2;

function normalizeTask(t) {
  if (!TASK_STATUSES.includes(t.status)) t.status = 'todo';
  if (!PRIORITIES.includes(t.priority)) t.priority = 'normal';
  if (t.createdAt === undefined) t.createdAt = t.updatedAt || Date.now();
  // The day the task was written — fixed at creation, never edited. Tasks
  // float forward in the planner while open, but their home day doesn't move.
  if (t.day === undefined) t.day = dayKey(t.createdAt);
  if (t.dueDate === undefined) t.dueDate = null;
  if (!Array.isArray(t.tags)) t.tags = [];
  if (t.scrappedReason === undefined) t.scrappedReason = '';
  if (t.flavorText === undefined) t.flavorText = null;
  if (t.flavorCustom === undefined) t.flavorCustom = false;
  if (t.flavorSeed === undefined) t.flavorSeed = 0;
  // resolvedAt: stamped when a task reaches done/scrapped, cleared when it
  // reopens. Legacy done rows derive it from updatedAt rather than faking
  // a 0-day span with "now".
  const resolved = t.status === 'done' || t.status === 'scrapped';
  if (t.resolvedAt === undefined) {
    t.resolvedAt = resolved ? (t.updatedAt || Date.now()) : null;
  } else if (!resolved) {
    t.resolvedAt = null;
  }
  return t;
}

function normalizeProject(p) {
  if (!Array.isArray(p.objectives) || p.objectives.length === 0) {
    // Defensive: a v2 project that lost its objectives still keeps its tasks.
    p.objectives = [{
      id: id('obj'), name: 'Objectives', status: 'active',
      createdAt: p.createdAt || Date.now(), scrappedReason: null,
      tasks: Array.isArray(p.tasks) ? p.tasks : [],
    }];
  }
  delete p.tasks;
  if (!['active', 'paused', 'done', 'scrapped', 'archived'].includes(p.status)) p.status = 'active';
  for (const o of p.objectives) {
    if (!['active', 'done', 'scrapped'].includes(o.status)) o.status = 'active';
    if (o.scrappedReason === undefined) o.scrappedReason = null;
    o.tasks = (Array.isArray(o.tasks) ? o.tasks : []).map(normalizeTask);
  }
  return p;
}

// Idempotent: v2+ data passes through with only defensive normalization.
function migrateProjects(raw) {
  if (!raw || !Array.isArray(raw.projects)) raw = { schemaVersion: 0, projects: [] };
  for (const p of raw.projects) normalizeProject(p);
  raw.schemaVersion = PROJECTS_SCHEMA_VERSION;
  return raw;
}

async function loadProjects() {
  return migrateProjects(await readJson(PROJECTS_FILE, { schemaVersion: PROJECTS_SCHEMA_VERSION, projects: [] }));
}

// Unmigrated on-disk data (or null if absent) — lets app:bootstrap detect
// a v1 file and back it up before the one-time migration write.
async function loadProjectsRaw() {
  return readJson(PROJECTS_FILE, null);
}

async function saveProjects(data) {
  await writeJsonAtomic(PROJECTS_FILE, data);
}

async function loadSettings() {
  return readJson(SETTINGS_FILE, { theme: 'index-dawn' });
}

async function saveSettings(settings) {
  await writeJsonAtomic(SETTINGS_FILE, settings);
}

// Day log sidecar: per-day structured stamps (spirits/energy/weather) that
// ride beside the day page instead of living inside its blocks.
async function loadDaylog() {
  return readJson(DAYLOG_FILE, {});
}

async function saveDaylog(doc) {
  await writeJsonAtomic(DAYLOG_FILE, doc);
}

async function loadPage(pageId) {
  return readJson(path.join(PAGES_DIR, `${pageId}.json`), null);
}

async function savePage(page) {
  await writeJsonAtomic(path.join(PAGES_DIR, `${page.id}.json`), page);
}

async function deletePageFile(pageId) {
  await fsp.rm(path.join(PAGES_DIR, `${pageId}.json`), { force: true });
}

async function listPageIds() {
  const names = await fsp.readdir(PAGES_DIR).catch(() => []);
  return names.filter(n => n.endsWith('.json') && !n.includes('.tmp'))
              .map(n => n.slice(0, -5));
}

// ---- Activity log (append-only JSONL, crash-safe by construction) ----

async function appendActivity(entry) {
  const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
  await fsp.appendFile(ACTIVITY_FILE, line, 'utf8');
}

// Read the most recent `limit` entries, newest first.
// A crash mid-append can leave a truncated last line — skip lines that don't parse.
async function readActivity(limit = 100, offset = 0) {
  let raw;
  try {
    raw = await fsp.readFile(ACTIVITY_FILE, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(l => l.trim());
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  return entries.slice(-limit - offset, entries.length - offset).reverse();
}

// ---- Attachments ----

function attachmentPath(attachmentId) {
  return path.join(ATTACHMENTS_DIR, attachmentId);
}

module.exports = {
  DATA_DIR, PAGES_DIR, ATTACHMENTS_DIR, PROJECTS_FILE,
  NOTEBOOKS_FILE, SETTINGS_FILE, DOCK_ICON_FILE,
  TREE_MERGE_VERSION,
  id, ensureDirs,
  normalizeProject, normalizeTask,
  normalizeSection, normalizeNotebook, normalizeTree, mergeProjectsIntoTree,
  migrateDayRows, migrateUniverses, migrateDedupeTitles, dedupeTree, migrateBigPicture, dayKey,
  loadNotebooks, loadNotebooksRaw, saveNotebooks,
  loadProjects, loadProjectsRaw, saveProjects,
  loadSettings, saveSettings, loadDaylog, saveDaylog,
  loadPage, savePage, deletePageFile, listPageIds,
  appendActivity, readActivity,
  attachmentPath,
};