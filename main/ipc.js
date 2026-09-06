'use strict';
// All ipcMain.handle registrations — the complete IPC contract.
// Every mutating handler also appends to the activity log so the
// dashboard feed stays consistent with what actually happened.

const { ipcMain, clipboard, dialog, shell, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const store = require('./store');
const backup = require('./backup');

const VERSION_CAP = 150;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// The pending Dock re-assert timer (see setDockIconAndAssert below).
let dockIconTimer = null;

// The logo finish baked into the bundled .icns (scripts/make-icon.py draws
// the Array plate). A mark set through NSImage at runtime renders duller
// than the tile the Dock serves from the bundle, so this finish is the one
// that must NEVER be re-asserted — see the startup block in registerIpc.
const BUNDLE_LOGO_ID = 'gunmetal-ice';

// ---- Tree helpers ----

function findSection(tree, sectionId) {
  for (const nb of tree.notebooks) {
    for (const sec of nb.sections) {
      if (sec.id === sectionId) return { notebook: nb, section: sec };
    }
  }
  return null;
}

function findPageMeta(tree, pageId) {
  for (const nb of tree.notebooks) {
    for (const sec of nb.sections) {
      const page = sec.pages.find(p => p.id === pageId);
      if (page) return { notebook: nb, section: sec, page };
    }
  }
  return null;
}

function pagePathLabel(tree, pageId) {
  const hit = findPageMeta(tree, pageId);
  return hit ? `${hit.notebook.name}/${hit.section.name}` : '';
}

function flattenPages(tree) {
  const out = [];
  for (const nb of tree.notebooks) {
    for (const sec of nb.sections) {
      for (const p of sec.pages) {
        out.push({ page: p, notebook: nb, section: sec });
      }
    }
  }
  return out;
}

// ---- Version snapshot policy ----

function structureKey(blocks) {
  const types = blocks.map(b => b.type).sort();
  return `${blocks.length}:${types.join(',')}`;
}

function maybeSnapshot(page, incomingBlocks, reason) {
  const versions = page.versions || [];
  const last = versions[versions.length - 1];
  const structureChanged = !last || structureKey(last.blocks) !== structureKey(incomingBlocks);
  const stale = !last || (Date.now() - last.ts) > SNAPSHOT_INTERVAL_MS;

  if (reason === 'manual' || structureChanged || stale) {
    versions.push({
      id: store.id('v'),
      ts: Date.now(),
      reason: reason === 'manual' ? 'manual' : (structureChanged ? 'structure change' : 'autosave'),
      title: page.title,
      blocks: incomingBlocks,
    });
    if (versions.length > VERSION_CAP) versions.splice(0, versions.length - VERSION_CAP);
    return true;
  }
  return false;
}

// ---- Search ----

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pagePlainText(page) {
  const parts = [page.title];
  for (const b of page.blocks || []) {
    if (b.html) parts.push(stripHtml(b.html));
    else if (b.text) parts.push(b.text);
    else if (b.type === 'page-link' && b.title) parts.push(b.title);
    else if (b.type === 'file' && b.name) parts.push(b.name);
    else if (b.type === 'table') {
      parts.push(...(b.cols || []).map(c => c.name));
      parts.push(...(b.rows || []).flatMap(r => Object.values(r.cells || {})));
    }
  }
  return parts.join(' \n ');
}

function excerptAround(text, q, width = 90) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, width) + (text.length > width ? '…' : '');
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + width - 30);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// ---- Attachments ----

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'ico']);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

async function saveAttachmentBuffer(bytes, ext, base = 'att') {
  const attachmentId = `${store.id(base)}.${ext}`;
  await fsp.writeFile(store.attachmentPath(attachmentId), bytes);
  return attachmentId;
}

// ---- First-run seed ----

async function seedIfEmpty() {
  const tree = await store.loadNotebooks();
  if (tree.notebooks.length > 0) return;

  const now = Date.now();
  const pageId = store.id('pg');
  tree.notebooks.push({
    id: store.id('nb'),
    name: 'Personal',
    color: '#8abec0',
    icon: null,
    createdAt: now,
    sections: [{
      id: store.id('sec'),
      name: 'Notes',
      createdAt: now,
      pages: [{ id: pageId, title: 'Welcome to Index', icon: null, tags: [], createdAt: now, updatedAt: now, versionCount: 0 }],
    }],
  });
  await store.saveNotebooks(tree);

  await store.savePage({
    id: pageId,
    title: 'Welcome to Index',
    createdAt: now,
    updatedAt: now,
    blocks: [
      { id: store.id('b'), type: 'heading', level: 1, html: 'Welcome to Index' },
      { id: store.id('b'), type: 'paragraph', html: 'A notebook, a planner, and a change tracker in one. Everything you write is saved as plain files in the app’s <code>data/</code> folder.' },
      { id: store.id('b'), type: 'heading', level: 2, html: 'Writing with blocks' },
      { id: store.id('b'), type: 'paragraph', html: 'Type <code>/</code> on an empty line for the block menu, or start a line with a shortcut:' },
      { id: store.id('b'), type: 'list-item', ordered: false, indent: 0, html: '<code># </code>, <code>## </code>, <code>### </code> — headings' },
      { id: store.id('b'), type: 'list-item', ordered: false, indent: 0, html: '<code>[] </code>— a checkbox to-do' },
      { id: store.id('b'), type: 'list-item', ordered: false, indent: 0, html: '<code>- </code>or <code>1. </code>— lists (Tab indents)' },
      { id: store.id('b'), type: 'list-item', ordered: false, indent: 0, html: '<code>&gt; </code>— a quote, <code>```</code>— a code block' },
      { id: store.id('b'), type: 'list-item', ordered: false, indent: 0, html: 'Select text for <b>bold</b>, <i>italic</i>, <code>code</code>, or a link' },
      { id: store.id('b'), type: 'paragraph', html: 'Type <code>@</code> to link another page and <code>#</code> before a word to tag it.' },
      { id: store.id('b'), type: 'heading', level: 2, html: 'The rest of the app' },
      { id: store.id('b'), type: 'todo', checked: true, html: 'Open the <b>Projects</b> view and create a project' },
      { id: store.id('b'), type: 'todo', checked: false, html: 'Add a task with a due date' },
      { id: store.id('b'), type: 'todo', checked: false, html: 'Check the Dashboard — it tracks everything you touch' },
      { id: store.id('b'), type: 'paragraph', html: 'Press <code>Cmd+H</code> in any page to see its version history, and pick a theme in Settings. Enjoy.' },
    ],
    versions: [],
  });
  await store.appendActivity({ type: 'app.seed', entityId: pageId, summary: 'Welcome to Index — take a look around' });
}

// ---- Registration ----

// Local YYYY-MM-DD (lexical-compare safe), matching the renderer's todayStr().
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function registerIpc() {
  require('./export').registerExportIpc();

  ipcMain.handle('app:bootstrap', async () => {
    store.ensureDirs();
    await seedIfEmpty();

    // One-time migrations, each guarded by the tree's mergeVersion flag:
    //   → v1: the old projects.json folds into the tree (phase 9).
    //   → v2: day rows — every task gets the day it was written, every
    //     sub-objective gets its day diary.
    //   → v3: universes — a level above projects; everything lands in
    //     one default "Personal" universe. Backed up before each runs.
    //   → v4: duplicate aims and same-named sub-objectives (repeated
    //     journal splits) merge into their first copy.
    const rawTree = await store.loadNotebooksRaw();
    if (!rawTree || rawTree.mergeVersion !== store.TREE_MERGE_VERSION) {
      if (rawTree && (rawTree.mergeVersion === undefined || rawTree.mergeVersion < 1)) {
        await fsp.copyFile(store.NOTEBOOKS_FILE, `${store.NOTEBOOKS_FILE}.pre-merge`).catch(() => {});
        await fsp.copyFile(store.PROJECTS_FILE, `${store.PROJECTS_FILE}.pre-merge`).catch(() => {});
      } else if (rawTree && rawTree.mergeVersion === 1) {
        await fsp.copyFile(store.NOTEBOOKS_FILE, `${store.NOTEBOOKS_FILE}.pre-daymerge`).catch(() => {});
      } else if (rawTree && rawTree.mergeVersion === 3) {
        await fsp.copyFile(store.NOTEBOOKS_FILE, `${store.NOTEBOOKS_FILE}.pre-dedupe`).catch(() => {});
      } else if (rawTree) {
        await fsp.copyFile(store.NOTEBOOKS_FILE, `${store.NOTEBOOKS_FILE}.pre-universe`).catch(() => {});
      }
      const rawProjects = await store.loadProjects();
      const working = rawTree || { notebooks: [] };
      const folded = await store.mergeProjectsIntoTree(working, rawProjects);
      const dayMigrated = store.migrateDayRows(working);
      const uniMigrated = store.migrateUniverses(working);
      const deduped = store.migrateDedupeTitles(working);
      const tree = store.normalizeTree(working);
      await store.saveNotebooks(tree);
      if (folded) {
        const n = rawProjects.projects.length;
        await store.appendActivity({
          type: 'app.merge',
          summary: `Projects and notebooks became one — ${n} project${n === 1 ? '' : 's'} folded in`,
        });
      }
      if (dayMigrated) {
        await store.appendActivity({
          type: 'app.merge',
          summary: `The planner arrived — every task pinned to the day it was written`,
        });
      }
      if (uniMigrated) {
        await store.appendActivity({
          type: 'app.merge',
          summary: `A new level opens — every project gathered into one universe`,
        });
      }
      if (deduped) {
        await store.appendActivity({
          type: 'app.merge',
          summary: `Housekeeping — ${deduped} duplicate aim${deduped === 1 ? '' : 's / sub-objective'}${deduped === 1 ? '' : 's'} merged into their first copy`,
        });
      }
    }

    // Duplicates never linger: the v4 migration cleared what older
    // versions had already written; this catches anything made since.
    // Silent unless it actually merges something.
    const liveTree = await store.loadNotebooks();
    const dedupeLate = store.dedupeTree(liveTree);
    if (dedupeLate) {
      await store.saveNotebooks(liveTree);
      await store.appendActivity({
        type: 'app.merge',
        summary: `Housekeeping — ${dedupeLate} duplicate aim${dedupeLate === 1 ? '' : 's / sub-objective'}${dedupeLate === 1 ? '' : 's'} merged into their first copy`,
      });
    }

    // One-time Big picture migration: the statement moves from one global
    // settings key onto every group and every ungrouped project (grouped
    // projects read their group's). Key-guarded, not version-guarded —
    // once the legacy key is cleared below it never runs again.
    const preSettings = await store.loadSettings();
    if (preSettings.bigQuestion) {
      await fsp.copyFile(store.NOTEBOOKS_FILE, `${store.NOTEBOOKS_FILE}.pre-bigpicture`).catch(() => {});
      await fsp.copyFile(store.SETTINGS_FILE, `${store.SETTINGS_FILE}.pre-bigquestion`).catch(() => {});
      const bpTree = store.normalizeTree(await store.loadNotebooksRaw() || { notebooks: [] });
      if (store.migrateBigPicture(bpTree, preSettings)) {
        await store.saveNotebooks(bpTree);
        await store.appendActivity({
          type: 'app.merge',
          summary: `The question became the Big picture — one statement per group and project`,
        });
      }
      delete preSettings.bigQuestion;
      delete preSettings.bigQuestionHistory;
      await store.saveSettings(preSettings);
    }

    const [settings, notebooks, activity] = await Promise.all([
      store.loadSettings(),
      store.loadNotebooks(),
      store.readActivity(80),
    ]);

    return { settings, notebooks, activity };
  });

  ipcMain.handle('settings:set', async (_e, { key, value }) => {
    const settings = await store.loadSettings();
    settings[key] = value;
    await store.saveSettings(settings);
    return settings;
  });

  // Settings → Logo: the renderer draws its chosen mark and hands it over
  // as a PNG data URL; the Dock repaints live and the PNG is parked on
  // disk (DOCK_ICON_FILE) so the next launch repaints before the renderer
  // is even up. The bundled .icns is the fallback when none was ever chosen.
  ipcMain.handle('dock:set-icon', async (_e, { dataUrl }) => {
    if (process.platform === 'darwin' && app.dock && typeof dataUrl === 'string'
        && dataUrl.startsWith('data:image/png')) {
      const img = nativeImage.createFromDataURL(dataUrl);
      setDockIconAndAssert(img);
      await fsp.writeFile(store.DOCK_ICON_FILE, img.toPNG()).catch(() => {});
    }
    return true;
  });

  // Startup: the saved Dock mark, back on the tile before the renderer boots.
  // The Dock re-asserts the bundle icon as the tile registers during launch,
  // so the icon is set again once it has settled. The default Array finish
  // is skipped on purpose — the .icns carries that exact art, and a mark
  // pushed through NSImage dulls the sheen the bundled tile keeps.
  store.loadSettings().then((settings) => {
    if (!settings.logo || settings.logo === BUNDLE_LOGO_ID) return;
    fs.readFile(store.DOCK_ICON_FILE, (err, buf) => {
      if (!err) setDockIconAndAssert(nativeImage.createFromBuffer(buf));
    });
  });

  // The Big picture drifts over time; the archive of past wordings is the
  // record. The statement lives on the group when the project is grouped
  // (members share one), else on the project itself. History is maintained
  // here (not via hunt:save) so a renderer bug can never erase it.
  ipcMain.handle('bigpicture:set', async (_e, { projectId, text }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === projectId);
    if (!nb) return { notebooks: tree };
    const owner = (nb.groupId && tree.groups.find(g => g.id === nb.groupId)) || nb;
    const next = String(text || '').trim();
    const current = owner.bigPicture && owner.bigPicture.text;
    if (next && next !== current) {
      if (current) {
        // The outcome answered the OLD wording — it archives alongside it
        // and never trails after the new question unattached.
        const res = owner.bigPictureResolution?.text;
        owner.bigPictureHistory = [
          { text: current, until: todayStr(), ...(res ? { resolution: res } : {}) },
          ...(owner.bigPictureHistory || []),
        ].slice(0, 50);
        owner.bigPictureResolution = null;
      }
      owner.bigPicture = { text: next, asOf: todayStr() };
      await store.saveNotebooks(tree);
      await store.appendActivity({ type: 'bigpicture.set', summary: `Big picture, as of ${todayStr()}: “${next}”` });
    } else if (!next && owner.bigPicture) {
      // Clearing archives the statement and leaves none set — its outcome,
      // if any, goes into the archive with it.
      const res = owner.bigPictureResolution?.text;
      owner.bigPictureHistory = [
        { text: owner.bigPicture.text, until: todayStr(), ...(res ? { resolution: res } : {}) },
        ...(owner.bigPictureHistory || []),
      ].slice(0, 50);
      owner.bigPicture = null;
      owner.bigPictureResolution = null;
      await store.saveNotebooks(tree);
    }
    return { notebooks: tree };
  });

  // The resolution is the answer, so far — it lands beside its question
  // without closing it, and it can be re-written as the evidence moves. An
  // empty text clears it. The owner is the group when grouped, like the
  // statement it answers.
  ipcMain.handle('bigpicture:resolve', async (_e, { projectId, text }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === projectId);
    if (!nb) return { notebooks: tree };
    const owner = (nb.groupId && tree.groups.find(g => g.id === nb.groupId)) || nb;
    const next = String(text || '').trim();
    if (next) {
      owner.bigPictureResolution = { text: next, asOf: todayStr() };
      await store.saveNotebooks(tree);
      await store.appendActivity({ type: 'bigpicture.resolve', summary: `Big picture resolved, as of ${todayStr()}: “${next}”` });
    } else if (owner.bigPictureResolution) {
      owner.bigPictureResolution = null;
      await store.saveNotebooks(tree);
    }
    return { notebooks: tree };
  });

  // A big-picture question rides whatever owns the project — the family
  // when grouped, else the project itself. When a project changes hands,
  // the question has to travel with it or the plate stays stuck over the
  // place it left. If the destination already has a live wording, the
  // carried one folds into its history rather than being dropped.
  function moveBigPicture(src, dst, context) {
    const has = (o) => o && (o.bigPicture || o.bigPictureResolution || (o.bigPictureHistory || []).length);
    if (src === dst || !has(src)) return null;
    const q = src.bigPicture, r = src.bigPictureResolution, hist = src.bigPictureHistory || [];
    src.bigPicture = null; src.bigPictureResolution = null; src.bigPictureHistory = [];
    const oldHist = dst.bigPictureHistory || [];
    if (dst.bigPicture) {
      dst.bigPictureHistory = [
        ...(q ? [{ text: q.text, until: todayStr(), ...(r ? { resolution: r.text } : {}) }] : []),
        ...hist, ...oldHist,
      ].slice(0, 50);
      return `${context} — the big picture folded into ${dst.name}'s history`;
    }
    dst.bigPicture = q;
    dst.bigPictureResolution = r;
    dst.bigPictureHistory = [...hist, ...oldHist].slice(0, 50);
    return `${context} — the big picture moved with ${dst.name}`;
  }

  // ---- Notebooks / sections ----

  ipcMain.handle('notebook:create', async (_e, { name, universeId }) => {
    const tree = await store.loadNotebooks();
    const nb = {
      id: store.id('nb'), name, color: null, icon: null, createdAt: Date.now(), sections: [],
      universeId: universeId || (tree.universes[0] && tree.universes[0].id) || null,
    };
    tree.notebooks.push(nb);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'notebook.create', entityId: nb.id, summary: `Created notebook “${name}”` });
    return { notebook: nb, notebooks: tree };
  });

  // ---- Universes (v3) ----

  ipcMain.handle('universe:create', async (_e, { name }) => {
    const tree = await store.loadNotebooks();
    const uni = { id: store.id('u'), name, createdAt: Date.now() };
    tree.universes.push(uni);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'universe.create', entityId: uni.id, summary: `A new universe opens: “${name}”` });
    return { universe: uni, notebooks: tree };
  });

  ipcMain.handle('universe:rename', async (_e, { id, name }) => {
    const tree = await store.loadNotebooks();
    const uni = tree.universes.find(u => u.id === id);
    if (!uni) throw new Error('Universe not found');
    uni.name = name;
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'universe.rename', entityId: id, summary: `Renamed universe to “${name}”` });
    return tree;
  });

  ipcMain.handle('universe:delete', async (_e, { id }) => {
    const tree = await store.loadNotebooks();
    if (tree.universes.length <= 1) throw new Error('The last universe cannot be closed');
    const uni = tree.universes.find(u => u.id === id);
    if (!uni) return tree;
    // Everything it held moves to the first remaining universe — nothing is lost.
    const survivor = tree.universes.find(u => u.id !== id);
    let moved = 0;
    for (const nb of tree.notebooks) if (nb.universeId === id) { nb.universeId = survivor.id; moved++; }
    for (const g of tree.groups) if (g.universeId === id) { g.universeId = survivor.id; moved++; }
    tree.universes = tree.universes.filter(u => u.id !== id);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'universe.delete', entityId: id, summary: `Closed universe “${uni.name}” — ${moved} item${moved === 1 ? '' : 's'} moved to “${survivor.name}”` });
    return tree;
  });

  // Delete for real. Unlike close, nothing survives: the universe, its
  // projects, their pages and files all go. The renderer confirms hard
  // (spelling out the close-it-instead option) before this runs.
  ipcMain.handle('universe:purge', async (_e, { id }) => {
    const tree = await store.loadNotebooks();
    if (tree.universes.length <= 1) throw new Error('The last universe cannot be deleted');
    const uni = tree.universes.find(u => u.id === id);
    if (!uni) return tree;
    let projects = 0, pages = 0;
    for (const nb of tree.notebooks) {
      if (nb.universeId !== id) continue;
      projects++;
      for (const sec of nb.sections || []) {
        for (const p of sec.pages || []) { await store.deletePageFile(p.id); pages++; }
      }
    }
    tree.notebooks = tree.notebooks.filter(nb => nb.universeId !== id);
    tree.groups = tree.groups.filter(g => g.universeId !== id);
    tree.universes = tree.universes.filter(u => u.id !== id);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'universe.purge', entityId: id,
      summary: `Deleted universe “${uni.name}” — ${projects} project${projects === 1 ? '' : 's'}, ${pages} page${pages === 1 ? '' : 's'} removed` });
    return tree;
  });

  ipcMain.handle('notebook:rename', async (_e, { id, name }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === id);
    if (!nb) throw new Error('Notebook not found');
    nb.name = name;
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'notebook.rename', entityId: id, summary: `Renamed notebook to “${name}”` });
    return tree;
  });

  ipcMain.handle('notebook:delete', async (_e, { id }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === id);
    if (!nb) return tree;
    // Remove page files along with the notebook.
    for (const sec of nb.sections) {
      for (const p of sec.pages) await store.deletePageFile(p.id);
    }
    tree.notebooks = tree.notebooks.filter(n => n.id !== id);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'notebook.delete', entityId: id, summary: `Deleted notebook “${nb.name}”` });
    return tree;
  });

  ipcMain.handle('section:create', async (_e, { notebookId, name, objectiveId }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) throw new Error('Notebook not found');
    const sec = { id: store.id('sec'), name, createdAt: Date.now(), pages: [], objectiveId: objectiveId || null, tasks: [] };
    nb.sections.push(sec);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'section.create', entityId: sec.id, summary: `Created sub-objective “${name}” in ${nb.name}` });
    return { section: sec, notebooks: tree };
  });

  ipcMain.handle('section:rename', async (_e, { id, name }) => {
    const tree = await store.loadNotebooks();
    for (const nb of tree.notebooks) {
      const sec = nb.sections.find(s => s.id === id);
      if (sec) {
        sec.name = name;
        await store.saveNotebooks(tree);
        await store.appendActivity({ type: 'section.rename', entityId: id, summary: `Renamed section to “${name}”` });
        return tree;
      }
    }
    throw new Error('Section not found');
  });

  // Persist a drag-reorder: `order` is every section id in the order the
  // tasks pane showed them. Each notebook keeps its own sections, re-sorted
  // by where they sat in that order (unlisted ones trail, stably).
  ipcMain.handle('section:reorder', async (_e, { order }) => {
    const tree = await store.loadNotebooks();
    const rank = new Map((order || []).map((id, i) => [id, i]));
    let changed = false;
    for (const nb of tree.notebooks) {
      if (!nb.sections.some(s => rank.has(s.id))) continue;
      const next = nb.sections.slice().sort((a, b) =>
        (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
      if (next.some((s, i) => s.id !== nb.sections[i].id)) changed = true;
      nb.sections = next;
    }
    if (changed) {
      await store.saveNotebooks(tree);
      await store.appendActivity({ type: 'section.reorder', summary: `Reordered ${order.length} sub-objectives` });
    }
    return tree;
  });

  // Quiet save for sub-objective fields (flavor voice state, day diary) —
  // no activity line. `days` patches merge per date, so saving today's note
  // never clobbers the rest of the diary.
  ipcMain.handle('section:save', async (_e, { id, patch }) => {
    const tree = await store.loadNotebooks();
    for (const nb of tree.notebooks) {
      const sec = nb.sections.find(s => s.id === id);
      if (sec) {
        for (const k of ['name', 'flavorSeed', 'flavorText', 'flavorCustom']) {
          if (patch[k] !== undefined) sec[k] = patch[k];
        }
        if (patch.days && typeof patch.days === 'object') {
          sec.days = { ...(sec.days || {}), ...patch.days };
        }
        await store.saveNotebooks(tree);
        return tree;
      }
    }
    throw new Error('Section not found');
  });

  ipcMain.handle('section:delete', async (_e, { id }) => {
    const tree = await store.loadNotebooks();
    for (const nb of tree.notebooks) {
      const sec = nb.sections.find(s => s.id === id);
      if (sec) {
        for (const p of sec.pages) await store.deletePageFile(p.id);
        nb.sections = nb.sections.filter(s => s.id !== id);
        await store.saveNotebooks(tree);
        await store.appendActivity({ type: 'section.delete', entityId: id, summary: `Deleted sub-objective “${sec.name}”${sec.tasks.length ? ` and its ${sec.tasks.length} task${sec.tasks.length === 1 ? '' : 's'}` : ''}` });
        return tree;
      }
    }
    throw new Error('Section not found');
  });

  // ---- Pages ----

  ipcMain.handle('page:create', async (_e, { sectionId, title }) => {
    const tree = await store.loadNotebooks();
    const hit = findSection(tree, sectionId);
    if (!hit) throw new Error('Section not found');
    const now = Date.now();
    const meta = { id: store.id('pg'), title: title || 'Untitled', icon: null, tags: [], createdAt: now, updatedAt: now, versionCount: 0 };
    hit.section.pages.push(meta);
    await store.saveNotebooks(tree);
    await store.savePage({ id: meta.id, title: meta.title, createdAt: now, updatedAt: now, blocks: [], versions: [] });
    await store.appendActivity({ type: 'page.create', entityId: meta.id, summary: `Created page “${meta.title}” in ${hit.notebook.name}/${hit.section.name}` });
    return { pageMeta: meta, notebooks: tree };
  });

  ipcMain.handle('page:delete', async (_e, { id }) => {
    const tree = await store.loadNotebooks();
    const hit = findPageMeta(tree, id);
    if (!hit) return tree;
    hit.section.pages = hit.section.pages.filter(p => p.id !== id);
    await store.saveNotebooks(tree);
    await store.deletePageFile(id);
    await store.appendActivity({ type: 'page.delete', entityId: id, summary: `Deleted page “${hit.page.title}”` });
    return tree;
  });

  ipcMain.handle('page:move', async (_e, { id, toSectionId }) => {
    const tree = await store.loadNotebooks();
    const hit = findPageMeta(tree, id);
    const target = findSection(tree, toSectionId);
    if (!hit || !target) throw new Error('Page or section not found');
    hit.section.pages = hit.section.pages.filter(p => p.id !== id);
    target.section.pages.push(hit.page);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'page.move', entityId: id, summary: `Moved “${hit.page.title}” to ${target.notebook.name}/${target.section.name}` });
    return tree;
  });

  ipcMain.handle('page:load', async (_e, { id }) => {
    return store.loadPage(id);
  });

  ipcMain.handle('page:save', async (_e, { id, title, blocks, tags, reason }) => {
    const tree = await store.loadNotebooks();
    const hit = findPageMeta(tree, id);
    const page = await store.loadPage(id);
    if (!page) throw new Error('Page not found');

    const titleChanged = title !== undefined && title !== page.title;
    page.title = title !== undefined ? title : page.title;
    page.blocks = blocks !== undefined ? blocks : page.blocks;
    if (tags !== undefined) page.tags = tags;
    page.updatedAt = Date.now();

    const snapshotted = maybeSnapshot(page, page.blocks, reason || 'autosave');
    await store.savePage(page);

    // Keep tree metadata in sync.
    if (hit) {
      hit.page.title = page.title;
      hit.page.updatedAt = page.updatedAt;
      hit.page.versionCount = page.versions.length;
      hit.page.tags = page.tags || hit.page.tags || [];
      await store.saveNotebooks(tree);
    }

    if (titleChanged && hit) {
      await store.appendActivity({ type: 'page.rename', entityId: id, summary: `Renamed page to “${page.title}”` });
    } else if (hit && reason !== 'quiet') {
      await store.appendActivity({ type: 'page.save', entityId: id, summary: `Edited “${page.title}” in ${hit.notebook.name}/${hit.section.name}` });
    }
    return { page };
  });

  ipcMain.handle('page:versions', async (_e, { id }) => {
    const page = await store.loadPage(id);
    if (!page) return [];
    return (page.versions || []).slice().reverse()
      .map(v => ({ id: v.id, ts: v.ts, reason: v.reason, title: v.title }));
  });

  ipcMain.handle('page:version:load', async (_e, { id, versionId }) => {
    const page = await store.loadPage(id);
    const v = page && (page.versions || []).find(x => x.id === versionId);
    return v ? { title: v.title, blocks: v.blocks } : null;
  });

  ipcMain.handle('page:version:restore', async (_e, { id, versionId }) => {
    const page = await store.loadPage(id);
    if (!page) throw new Error('Page not found');
    const v = (page.versions || []).find(x => x.id === versionId);
    if (!v) throw new Error('Version not found');
    const tree = await store.loadNotebooks();
    const hit = findPageMeta(tree, id);

    // Snapshot current state first so "restore" is itself undoable.
    maybeSnapshot(page, page.blocks, 'manual');
    page.title = v.title;
    page.blocks = v.blocks;
    page.updatedAt = Date.now();
    await store.savePage(page);
    if (hit) {
      hit.page.title = page.title;
      hit.page.updatedAt = page.updatedAt;
      hit.page.versionCount = page.versions.length;
      await store.saveNotebooks(tree);
    }
    const when = new Date(v.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    await store.appendActivity({ type: 'page.restore', entityId: id, summary: `Restored “${page.title}” to its ${when} version` });
    return { page };
  });

  // ---- Projects (the hunt fields on a notebook) ----

  ipcMain.handle('hunt:save', async (_e, { notebookId, patch }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) throw new Error('Project not found');
    const allowed = ['status', 'dueDate', 'color', 'groupId', 'description', 'scrappedReason', 'shelved'];
    const statusChanged = patch.status && patch.status !== nb.status;
    const oldGroupId = nb.groupId;
    for (const k of allowed) {
      if (k in patch) nb[k] = patch[k] === undefined ? null : patch[k];
    }
    // Moving to a different family (or out on its own) carries the big
    // picture along — from the old owner to the new one.
    let movedBigPicture = null;
    if ('groupId' in patch && patch.groupId !== oldGroupId) {
      const src = (oldGroupId && tree.groups.find(g => g.id === oldGroupId)) || nb;
      const dst = (nb.groupId && tree.groups.find(g => g.id === nb.groupId)) || nb;
      movedBigPicture = moveBigPicture(src, dst, nb.name);
    }
    await store.saveNotebooks(tree);
    if (movedBigPicture) {
      await store.appendActivity({ type: 'bigpicture.move', entityId: nb.id, summary: movedBigPicture });
    }
    if (statusChanged) {
      await store.appendActivity({
        type: 'project.status', entityId: nb.id,
        summary: `${nb.name} → ${nb.status}`,
      });
    }
    return { notebook: nb, notebooks: tree };
  });

  // ---- Aims (the tier between project and sub-objective; the
  // JSON field keeps the historic "objectives" name) ----

  ipcMain.handle('objective:save', async (_e, { notebookId, objective }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) throw new Error('Project not found');
    let o = (nb.objectives || []).find(x => x.id === objective.id);
    let isNew = false;
    if (!o) {
      // An aim always has an id — mint one if a caller sent a bare object,
      // else the CSS/data-objective wiring can't find it again.
      if (!objective.id) objective.id = store.id('obj');
      objective.createdAt = Date.now();
      objective.scrappedReason = objective.scrappedReason ?? null;
      nb.objectives.push(objective);
      o = objective;
      isNew = true;
    } else {
      Object.assign(o, objective);
    }
    await store.saveNotebooks(tree);
    await store.appendActivity({
      type: isNew ? 'objective.create' : 'objective.save',
      entityId: o.id,
      summary: isNew ? `Added aim “${o.name}” to ${nb.name}` : `Updated aim “${o.name}” (${nb.name})`,
    });
    return { objective: o, notebooks: tree };
  });

  // Deleting an aim keeps its sub-objectives (and their tasks) — they
  // drop to project level instead of dying with it.
  ipcMain.handle('objective:delete', async (_e, { notebookId, objectiveId }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) return tree;
    const idx = (nb.objectives || []).findIndex(o => o.id === objectiveId);
    if (idx === -1) return tree;
    const [removed] = nb.objectives.splice(idx, 1);
    for (const sec of nb.sections) {
      if (sec.objectiveId === objectiveId) sec.objectiveId = null;
    }
    await store.saveNotebooks(tree);
    await store.appendActivity({
      type: 'objective.delete', entityId: objectiveId,
      summary: `Removed objective “${removed.name}” from ${nb.name}`,
    });
    return tree;
  });

  // ---- Project groups (named, colored, nestable) ----

  ipcMain.handle('group:save', async (_e, { group }) => {
    const tree = await store.loadNotebooks();
    let g = tree.groups.find(x => x.id === group.id);
    let isNew = false;
    if (!g) {
      group.color = group.color ?? null;
      group.parentId = group.parentId ?? null;
      group.universeId = group.universeId || (tree.universes[0] && tree.universes[0].id) || null;
      group.createdAt = Date.now();
      tree.groups.push(group);
      g = group;
      isNew = true;
    } else {
      Object.assign(g, group);
    }
    await store.saveNotebooks(tree);
    await store.appendActivity({
      type: isNew ? 'group.create' : 'group.save',
      entityId: g.id,
      summary: isNew ? `Created project group “${g.name}”` : `Updated project group “${g.name}”`,
    });
    return { group: g, notebooks: tree };
  });

  ipcMain.handle('group:delete', async (_e, { id }) => {
    const tree = await store.loadNotebooks();
    const g = tree.groups.find(x => x.id === id);
    tree.groups = tree.groups.filter(x => x.id !== id);
    // Members and nested groups don't die — they unparent.
    const members = tree.notebooks.filter(nb => nb.groupId === id);
    for (const nb of members) nb.groupId = null;
    for (const other of tree.groups) if (other.parentId === id) other.parentId = null;
    // The group's big picture rides its first member out — otherwise it
    // would die with the group.
    const movedBigPicture = g && members[0]
      ? moveBigPicture(g, members[0], `Group “${g.name}” deleted`)
      : null;
    await store.saveNotebooks(tree);
    if (g) await store.appendActivity({ type: 'group.delete', entityId: id, summary: `Deleted project group “${g.name}”` });
    if (movedBigPicture) await store.appendActivity({ type: 'bigpicture.move', entityId: members[0].id, summary: movedBigPicture });
    return tree;
  });

  // ---- Tasks (live on a sub-objective section, or float on the project) ----

  function taskBucket(nb, sectionId) {
    if (sectionId) {
      const sec = nb.sections.find(s => s.id === sectionId);
      if (!sec) throw new Error('Sub-objective not found');
      return { tasks: sec.tasks, label: `${sec.name} (${nb.name})` };
    }
    return { tasks: nb.floatingTasks, label: `${nb.name} (afloat)` };
  }

  ipcMain.handle('task:save', async (_e, { notebookId, sectionId, task }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) throw new Error('Project not found');
    const { tasks, label } = taskBucket(nb, sectionId);
    // An id-less payload (quick-add paths, imports) is always a NEW task —
    // mint an id so it can never collide with an existing id-less row.
    if (!task.id) task.id = store.id('task');
    let t = tasks.find(x => x.id === task.id);
    if (!t) {
      task.createdAt = task.createdAt || Date.now();
      tasks.push(store.normalizeTask(task));
      t = task;
      await store.appendActivity({
        type: 'task.add', entityId: t.id,
        summary: `Added task “${t.title}” to ${label}${t.dueDate ? ` (due ${t.dueDate})` : ''}`,
      });
    } else {
      const statusChanged = task.status !== t.status;
      Object.assign(t, task);
      store.normalizeTask(t);
      if (statusChanged) {
        const st = t.status === 'scrapped' ? 'scrapped' : t.status.replace('-', ' ');
        await store.appendActivity({
          type: 'task.status', entityId: t.id,
          summary: `“${t.title}” → ${st} (${nb.name})`,
        });
      }
    }
    t.updatedAt = Date.now();
    await store.saveNotebooks(tree);
    return { task: t, notebooks: tree };
  });

  // Persist a task drag: the task moves between buckets (sub-objective →
  // sub-objective, or to/from the unfiled float), lands on the dropped
  // day, and slots into the order the pane showed (before/at the task it
  // was dropped on, or at the end). One call covers rearranging within a
  // day row, dragging across days, and dragging into another
  // sub-objective or the unfiled box.
  ipcMain.handle('task:drop', async (_e, { notebookId, fromSectionId, taskId, toSectionId, day, beforeTaskId }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) throw new Error('Project not found');
    const bucketOf = (sid) => {
      if (sid) {
        const sec = nb.sections.find(s => s.id === sid);
        if (!sec) throw new Error('Sub-objective not found');
        return sec.tasks;
      }
      return nb.floatingTasks;
    };
    const from = bucketOf(fromSectionId);
    const i = from.findIndex(t => t.id === taskId);
    if (i === -1) throw new Error('Task not found');
    const [t] = from.splice(i, 1);
    if (day) t.day = day;
    t.updatedAt = Date.now();
    const to = bucketOf(toSectionId);
    const j = beforeTaskId ? to.findIndex(x => x.id === beforeTaskId) : -1;
    if (j >= 0) to.splice(j, 0, t);
    else to.push(t);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'task.move', entityId: t.id, summary: `“${t.title}” moved${day ? ` to ${day}` : ''}` });
    return tree;
  });

  ipcMain.handle('task:delete', async (_e, { notebookId, taskId }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) return tree;
    nb.floatingTasks = nb.floatingTasks.filter(t => t.id !== taskId);
    for (const sec of nb.sections) {
      sec.tasks = sec.tasks.filter(t => t.id !== taskId);
    }
    await store.saveNotebooks(tree);
    return tree;
  });

  // Move a task between sub-objectives, or out to float / in from float
  // (toSectionId null = afloat).
  ipcMain.handle('task:move', async (_e, { notebookId, taskId, toSectionId }) => {
    const tree = await store.loadNotebooks();
    const nb = tree.notebooks.find(n => n.id === notebookId);
    if (!nb) return tree;
    let task = nb.floatingTasks.find(t => t.id === taskId);
    if (task) nb.floatingTasks = nb.floatingTasks.filter(t => t.id !== taskId);
    else {
      for (const sec of nb.sections) {
        const found = sec.tasks.find(t => t.id === taskId);
        if (found) { task = found; sec.tasks = sec.tasks.filter(t => t.id !== taskId); break; }
      }
    }
    if (!task) return tree;
    if (toSectionId) {
      const target = nb.sections.find(s => s.id === toSectionId);
      if (!target) throw new Error('Sub-objective not found');
      target.tasks.push(task);
    } else {
      nb.floatingTasks.push(task);
    }
    task.updatedAt = Date.now();
    await store.saveNotebooks(tree);
    return tree;
  });

  // ---- Day log + inbox ----
  // The journal side: one page per day (the case file) and a capture inbox
  // that takes thoughts without asking where they belong. Day pages are real
  // pages under the "Log" notebook — one section per year — so they get the
  // editor, search, history, and Threads replay for free.

  const LOG_NOTEBOOK = 'Log';

  // Find-or-create a notebook/section pair by exact names (idempotent).
  async function ensureLogSection(tree, sectionName, notebookName = LOG_NOTEBOOK) {
    let nb = tree.notebooks.find(n => n.name === notebookName);
    if (!nb) {
      nb = { id: store.id('nb'), name: notebookName, sections: [], createdAt: Date.now() };
      tree.notebooks.push(nb);
      await store.appendActivity({ type: 'notebook.create', entityId: nb.id, summary: `Created notebook “${notebookName}”` });
    }
    let sec = nb.sections.find(s => s.name === sectionName);
    if (!sec) {
      sec = { id: store.id('sec'), name: sectionName, pages: [], createdAt: Date.now() };
      nb.sections.push(sec);
      await store.appendActivity({ type: 'section.create', entityId: sec.id, summary: `Created section “${sectionName}” in ${nb.name}` });
    }
    return { nb, sec };
  }

  function block(type, extra = {}) {
    return { id: store.id('blk'), type, ...extra };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  ipcMain.handle('log:today', async () => {
    const tree = await store.loadNotebooks();
    const now = new Date();
    const key = todayStr();
    const { nb, sec } = await ensureLogSection(tree, String(now.getFullYear()));
    let meta = sec.pages.find(p => p.title === key);
    if (!meta) {
      const created = Date.now();
      meta = { id: store.id('pg'), title: key, icon: null, tags: ['log'], createdAt: created, updatedAt: created, versionCount: 0 };
      sec.pages.push(meta);

      // Seed nothing but yesterday's file when one exists — a fresh day is a
      // blank page (the trail itself lives in Threads).
      const yesterday = sec.pages
        .filter(p => p.title < key)
        .sort((a, b) => a.title < b.title ? 1 : -1)[0];

      const blocks = [];
      if (yesterday) {
        blocks.push(block('page-link', { pageId: yesterday.id, title: yesterday.title, icon: '📄' }));
      }

      await store.savePage({ id: meta.id, title: meta.title, createdAt: created, updatedAt: created, blocks, versions: [] });
      await store.appendActivity({ type: 'page.create', entityId: meta.id, summary: `Opened the day file for ${key}` });
      await store.saveNotebooks(tree);
      return { pageMeta: meta, notebooks: tree, created: true };
    }
    return { pageMeta: meta, notebooks: tree, created: false };
  });

  ipcMain.handle('log:stamp:get', () => store.loadDaylog());

  ipcMain.handle('log:stamp:set', async (_e, { date, patch }) => {
    const doc = await store.loadDaylog();
    doc[date] = { ...(doc[date] || {}), ...patch };
    await store.saveDaylog(doc);
    return doc[date];
  });

  ipcMain.handle('inbox:capture', async (_e, { text }) => {
    const body = String(text || '').trim();
    if (!body) throw new Error('Nothing to capture');
    const tree = await store.loadNotebooks();
    const { sec } = await ensureLogSection(tree, 'Inbox');
    let meta = sec.pages.find(p => p.title === 'Inbox');
    if (!meta) {
      const created = Date.now();
      meta = { id: store.id('pg'), title: 'Inbox', icon: null, tags: ['inbox'], createdAt: created, updatedAt: created, versionCount: 0 };
      sec.pages.push(meta);
    }
    const page = (await store.loadPage(meta.id)) || { id: meta.id, title: 'Inbox', createdAt: Date.now(), updatedAt: Date.now(), blocks: [], versions: [] };
    const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    page.blocks.push(block('paragraph', { html: `<strong>${when}</strong> — ${escapeHtml(body).replace(/\n/g, '<br>')}` }));
    page.updatedAt = Date.now();
    await store.savePage(page);
    await store.saveNotebooks(tree);
    await store.appendActivity({ type: 'inbox.capture', entityId: meta.id, summary: 'Captured a thought to the inbox' });
    return { pageMeta: meta, notebooks: tree };
  });

  // ---- Backlinks: which pages point here (page-link blocks) ----

  ipcMain.handle('pages:backlinks', async (_e, { pageId }) => {
    const out = [];
    for (const id of await store.listPageIds()) {
      if (id === pageId) continue;
      const page = await store.loadPage(id);
      if (!page || !Array.isArray(page.blocks)) continue;
      const count = page.blocks.filter(b => b.type === 'page-link' && b.pageId === pageId).length;
      if (count) out.push({ id, title: page.title, count, updatedAt: page.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  });

  // ---- On this day + weekly debrief ----

  ipcMain.handle('activity:onThisDay', async () => {
    const now = new Date();
    const byYear = {};
    for (const a of await store.readActivity(20000)) {
      const d = new Date(a.ts);
      if (d.getFullYear() >= now.getFullYear()) continue;
      if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) continue;
      (byYear[d.getFullYear()] = byYear[d.getFullYear()] || []).push(a);
    }
    return Object.keys(byYear).map(Number).sort((a, b) => b - a)
      .slice(0, 3)
      .map(year => ({ year, entries: byYear[year].slice(0, 5) }));
  });

  ipcMain.handle('activity:debrief', async (_e, { days = 7 }) => {
    const span = (days || 7) * 86400000;
    const since = Date.now() - span;
    const week = (await store.readActivity(20000)).filter(a => a.ts >= since).reverse(); // oldest first
    const localDay = (ts) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const perDay = {};
    const pages = new Map();
    const projects = new Map();
    let opened = 0, closed = 0, scrapped = 0, edits = 0, snapshots = 0;
    for (const a of week) {
      perDay[localDay(a.ts)] = (perDay[localDay(a.ts)] || 0) + 1;
      if (a.type === 'page.save' || a.type === 'page.create') edits++;
      if (a.type === 'page.save' && /snapshot/i.test(a.summary)) snapshots++;
      if (a.entityId && a.entityId.startsWith('pg_')) pages.set(a.entityId, (pages.get(a.entityId) || 0) + 1);
      const m = /\(([^()]+)\)$/.exec(a.summary || '');
      if ((a.type === 'task.add' || a.type === 'task.status') && m) projects.set(m[1], (projects.get(m[1]) || 0) + 1);
      if (a.type === 'task.add') opened++;
      if (a.type === 'task.status') {
        if (/→ done/.test(a.summary)) closed++;
        else if (/→ scrapped/.test(a.summary)) scrapped++;
      }
    }
    return {
      days: days || 7,
      totals: { moves: week.length, edits, snapshots, opened, closed, scrapped },
      perDay,
      pages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      projects: [...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  });

  // ---- Activity ----

  ipcMain.handle('activity:list', async (_e, { limit, offset }) => {
    return store.readActivity(limit || 50, offset || 0);
  });

  // ---- Search ----

  ipcMain.handle('search:query', async (_e, { q }) => {
    const query = (q || '').trim().toLowerCase();
    if (!query) return [];
    const tree = await store.loadNotebooks();
    const results = [];
    for (const pageId of await store.listPageIds()) {
      const page = await store.loadPage(pageId);
      if (!page) continue;
      const hit = findPageMeta(tree, pageId);
      const plain = pagePlainText(page);
      const idx = plain.toLowerCase().indexOf(query);
      const titleHit = page.title.toLowerCase().includes(query);
      if (idx === -1 && !titleHit) continue;
      results.push({
        pageId,
        title: page.title,
        path: hit ? `${hit.notebook.name} / ${hit.section.name}` : '',
        excerpt: excerptAround(plain, q),
        score: (titleHit ? 100 : 0) + (idx === 0 ? 10 : 0),
        updatedAt: page.updatedAt,
      });
    }
    results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    return results.slice(0, 50);
  });

  // ---- Attachments & clipboard ----
  // Electron 44 replaced the sync clipboard flavors with the async
  // ClipboardItem API — readImage()/readHTML() are gone, and read()
  // resolves to ClipboardItems whose types arrive macOS-flavored, so the
  // flavor is matched loosely. readText() alone survives unchanged.
  const clipboardFlavor = async (match) => {
    // Electron 44 quirk: a matching flavor can hand back an EMPTY blob —
    // image/png does on macOS — while the osclipboard twin of the same
    // flavor ("Apple PNG pasteboard type") carries the real bytes. Try
    // every match and skip zero-byte reads instead of trusting the first.
    for (const item of await clipboard.read()) {
      for (const type of (item.types || []).filter(t => match.test(t))) {
        try {
          const buf = Buffer.from(await (await item.getType(type)).arrayBuffer());
          if (buf.length) return buf;
        } catch { /* flavor lied about being readable — try the next */ }
      }
    }
    return null;
  };

  ipcMain.handle('clipboard:readImage', async () => {
    // "png pasteboard" catches Electron 44's osclipboard twin flavor
    // ("Apple PNG pasteboard type") — the plain image/png flavor reads
    // back empty on macOS.
    const png = await clipboardFlavor(/image\/png|public\.png|png pasteboard/i);
    if (!png) return null;
    const attachmentId = await saveAttachmentBuffer(png, 'png', 'img');
    return { attachmentId, url: `note://attachments/${attachmentId}`, name: 'Pasted image', size: png.length };
  });

  // For the right-click paste menu: the raw clipboard flavors, so the
  // renderer can offer "paste as text / as html" instead of trusting the
  // app-chosen default.
  ipcMain.handle('clipboard:readText', () => clipboard.readText());
  ipcMain.handle('clipboard:readHtml', async () => (await clipboardFlavor(/html/i))?.toString('utf8') || '');

  ipcMain.handle('attachment:addData', async (_e, { bytes, ext, name }) => {
    const attachmentId = await saveAttachmentBuffer(bytes, ext, 'att');
    return {
      attachmentId, url: `note://attachments/${attachmentId}`,
      name: name || attachmentId, size: bytes.length,
    };
  });

  ipcMain.handle('attachment:addFile', async (_e, { filePath }) => {
    const buf = await fsp.readFile(filePath);
    const ext = extOf(filePath);
    const attachmentId = await saveAttachmentBuffer(buf, ext, 'att');
    return {
      attachmentId, url: `note://attachments/${attachmentId}`,
      name: path.basename(filePath), size: buf.length,
      isImage: IMAGE_EXTS.has(ext),
    };
  });

  ipcMain.handle('attachment:reveal', (_e, { attachmentId }) => {
    shell.showItemInFolder(store.attachmentPath(attachmentId));
  });

  ipcMain.handle('attachment:open', (_e, { attachmentId }) => {
    shell.openPath(store.attachmentPath(attachmentId));
  });

  ipcMain.handle('dialog:open', async (_e, { filters }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Directory picker for the off-machine backup destination.
  ipcMain.handle('dialog:openDir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ---- Backups ----

  ipcMain.handle('backup:status', () => backup.status());

  ipcMain.handle('backup:now', async () => {
    const snap = await backup.createBackup(true);
    const synced = await backup.syncOffMachine().catch(() => null);
    return snap ? { ...snap, synced } : null;
  });

  ipcMain.handle('backup:setDest', async (_e, { dest }) => {
    const settings = await store.loadSettings();
    settings.backupDest = dest || null;
    await store.saveSettings(settings);
    return settings;
  });

  ipcMain.handle('backup:sync', () => backup.syncOffMachine());

  // ---- OneNote import ----
  // Real note content flows Microsoft -> this Mac only; handlers here return
  // metadata, HTML (to the renderer's converter, in-process), or local
  // attachment ids — never log or persist note text anywhere else.

  // Quick-open + @-autocomplete both need the flat page list.
  ipcMain.handle('pages:list', async () => {
    const tree = await store.loadNotebooks();
    return flattenPages(tree).map(({ page, notebook, section }) => ({
      id: page.id, title: page.title, path: `${notebook.name} / ${section.name}`, updatedAt: page.updatedAt,
    }));
  });

  // ---- Threads timeline ----
  // Per-day aggregates over the activity log + page-snapshot metadata, so the
  // timeline can draw a year of history without loading a single block. The
  // activity log is append-only and unbounded, so days stay accurate even
  // where snapshots have rotated past VERSION_CAP.
  ipcMain.handle('threads:timeline', async (_e, { days = 365 } = {}) => {
    const since = Date.now() - days * 86400000;
    const tree = await store.loadNotebooks();
    const meta = {};
    for (const { page, notebook, section } of flattenPages(tree)) {
      meta[page.id] = { title: page.title, path: `${notebook.name} / ${section.name}` };
    }

    // Local calendar days, not UTC — the timeline must agree with the wall clock.
    const dayKey = (ts) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const buckets = {}; // 'YYYY-MM-DD' -> { edits, snapshots, tasks, pages: {pageId -> touch} }

    const bucket = (ts) => {
      const k = dayKey(ts);
      if (!buckets[k]) buckets[k] = { edits: 0, snapshots: 0, tasks: 0, other: 0, pages: {} };
      return buckets[k];
    };

    for (const a of await store.readActivity(0) /* all entries, newest first */) {
      if (a.ts < since) break;
      const b = bucket(a.ts);
      if (a.type?.startsWith('task.')) b.tasks++;
      else if (a.type?.startsWith('page.')) b.edits++;
      else b.other++;
      if ((a.type === 'page.save' || a.type === 'page.create') && a.entityId && meta[a.entityId]) {
        const touch = b.pages[a.entityId] || (b.pages[a.entityId] = { ...meta[a.entityId], pageId: a.entityId, ts: a.ts, versionId: null, events: 0 });
        touch.ts = Math.max(touch.ts, a.ts);
        touch.events++;
      }
    }

    // Snapshot metadata straight from the page files (title lives on the version).
    for (const pageId of await store.listPageIds()) {
      const page = await store.loadPage(pageId);
      if (!page) continue;
      for (const v of page.versions || []) {
        if (v.ts < since) continue;
        const b = bucket(v.ts);
        b.snapshots++;
        const touch = b.pages[pageId] || (b.pages[pageId] = { pageId, title: v.title, path: meta[pageId]?.path || '', ts: v.ts, versionId: null, events: 0 });
        // Versions are stored oldest-first; the last one we see is the newest
        // snapshot of the day — that's the "as of then" version to offer.
        touch.versionId = v.id;
        touch.ts = Math.max(touch.ts, v.ts);
      }
    }

    return { since, days: buckets };
  });
}

// Set the Dock icon, then set it once more after the tile has settled —
// during launch the Dock can re-assert the bundle icon right over a mark
// applied too early, which is what made the choice look non-persistent.
function setDockIconAndAssert(img) {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setIcon(img);
  clearTimeout(dockIconTimer);
  dockIconTimer = setTimeout(() => app.dock.setIcon(img), 1200);
}

module.exports = { registerIpc, pagePathLabel, stripHtml };