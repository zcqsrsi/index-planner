// Client-side state + pub/sub. Views render from this and subscribe to changes.

const state = {
  view: 'dashboard',        // dashboard | projects | log | threads | search | settings
  notebooks: { notebooks: [], groups: [] }, // the merged tree: projects ARE notebooks
  activity: [],
  settings: { theme: 'index-dawn' },
  currentPageId: null,
  currentProjectId: null,
  currentSectionId: null,    // selected sub-objective (notes pane)
  searchQuery: '',
  focusTaskId: null,
  reading: false,         // Log view: the compiled reading view, not today's file
  readingScope: null,
};

const listeners = new Set();

export function getState() { return state; }

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Flatten helpers used across views ------------------------------------

export function allSections() {
  const out = [];
  for (const nb of state.notebooks.notebooks) {
    for (const sec of nb.sections) out.push({ section: sec, notebook: nb });
  }
  return out;
}

export function findPageMeta(pageId) {
  for (const nb of state.notebooks.notebooks) {
    for (const sec of nb.sections) {
      const page = sec.pages.find(p => p.id === pageId);
      if (page) return { notebook: nb, section: sec, page };
    }
  }
  return null;
}

// Universes (v3): the level above projects. The whole app — tree, map,
// threads, search — narrows to the current one; switching universes is a
// top-nav concern (renderNav), not a per-view one.
export function universes() { return state.notebooks.universes || []; }

export function currentUniverseId() {
  const list = universes();
  if (!list.length) return null; // pre-migration data: no filtering
  const cur = state.settings.currentUniverse;
  return list.some(u => u.id === cur) ? cur : list[0].id;
}

// Projects = notebooks, minus the journal (the Log notebook).
export function allProjects() {
  const uni = currentUniverseId();
  return state.notebooks.notebooks.filter(nb => nb.kind !== 'log' && (!uni || nb.universeId === uni));
}
export function allGroups() {
  const uni = currentUniverseId();
  return (state.notebooks.groups || []).filter(g => !uni || g.universeId === uni);
}
export function allUniverses() { return universes(); }
export function findProject(id) { return allProjects().find(nb => nb.id === id); }

// Group lookup stays universe-agnostic — projects reference their group by
// id and both always live in the same universe anyway.
export function findGroup(id) { return (state.notebooks.groups || []).find(g => g.id === id); }

// A project's effective color: its group's color when it belongs to one
// (the group paints its members), otherwise its own.
export function projectColor(p) {
  const g = p.groupId && findGroup(p.groupId);
  return (g && g.color) || p.color || 'var(--accent)';
}

// All tasks flattened with their sub-objective (section) and project
// attached. Floating tasks carry section: null — they're the loose ends.
export function allTasks() {
  const out = [];
  for (const p of allProjects()) {
    for (const sec of p.sections) {
      for (const t of sec.tasks || []) out.push({ task: t, section: sec, project: p });
    }
    for (const t of p.floatingTasks || []) out.push({ task: t, section: null, project: p });
  }
  return out;
}