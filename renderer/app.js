// Boot + shell: activity rail, panel/main routing, global shortcuts.

import { getState, setState, subscribe, findPageMeta, universes, currentUniverseId } from './store.js';
import { applyTheme } from './themes.js';
import { closeMenus, contextMenu, esc, toast, openModal, closeModal, promptModal } from './ui/components.js';
import { logoById, logoPngDataUrl, DEFAULT_LOGO } from './ui/logo.js';
import { constellationGlyph, scrollGlyph } from './ui/components.js';
import * as dashboard from './views/dashboard.js';
import * as help from './views/help.js';
import * as log from './views/log.js';
import * as pageView from './views/page.js';
import * as projects from './views/projects.js';
import * as search from './views/search.js';
import * as settings from './views/settings.js';
import * as threads from './views/threads.js';

const VIEWS = {
  dashboard: { icon: '◎', label: 'Map', module: dashboard },
  projects:  { icon: '❖', label: 'Projects',  module: projects },
  // Threads wears the constellation — its sky view is the mark's home.
  threads:   { icon: constellationGlyph(), label: 'Threads', module: threads },
  // The Log wears the unfurled scroll, and sits to Threads' right.
  log:       { icon: scrollGlyph(), label: 'Log', module: log },
  search:    { icon: '⌕', label: 'Search',    module: search },
  settings:  { icon: '⚙', label: 'Settings',  module: settings },
  help:      { icon: '?', label: 'Help',      module: help },
};

const navEl = document.getElementById('topnav');
const panelEl = document.getElementById('panel');
const mainEl = document.getElementById('main');

export async function goto(view, params = {}) {
  closeMenus();
  // The dashboard feed should always reflect what just happened elsewhere.
  if (view === 'dashboard') {
    const [activity] = await Promise.all([window.api.listActivity(80)]);
    setState({ activity });
  }
  setState({ view, ...params });
  render();
}

// Open a page in the editor (used from dashboard, search, quick-open, page
// links). The editor lives in the Projects view's notes pane, so select
// the owning project + sub-objective on the way there.
export function openPage(pageId) {
  const meta = findPageMeta(pageId);
  // The editor lives in the notes pane, so unfold it on the way in.
  const paneFold = { ...(getState().settings.paneFold || {}), notes: false };
  setState({
    view: 'projects',
    currentPageId: pageId,
    settings: { ...getState().settings, paneFold },
    ...(meta ? { currentProjectId: meta.notebook.id, currentSectionId: meta.section.id } : {}),
  });
  window.api.setSetting('paneFold', paneFold);
  render();
}

function renderNav() {
  const { view } = getState();
  navEl.innerHTML = '';
  renderUniverseSwitcher();
  for (const [id, v] of Object.entries(VIEWS)) {
    if (v.hidden) continue;
    const btn = document.createElement('button');
    btn.className = `nav-btn ${view === id ? 'active' : ''}`;
    btn.innerHTML = `<span class="nav-icon">${v.icon}</span><span>${v.label}</span>`;
    btn.onclick = () => goto(id);
    navEl.appendChild(btn);
  }
}

// The universe switcher: OneNote-style — everything below the nav belongs
// to the chosen universe. Switching clears the selected project (it lives
// in the old universe) and repaints the current view.
function renderUniverseSwitcher() {
  const list = universes();
  if (!list.length) return;
  const cur = currentUniverseId();
  const uni = list.find(u => u.id === cur);
  const btn = document.createElement('button');
  btn.className = 'nav-btn nav-universe';
  btn.innerHTML = `<span class="nav-icon">◈</span><span>${esc(uni ? uni.name : list[0].name)}</span><span class="nav-chev">▾</span>`;
  btn.onclick = (e) => {
    const r = btn.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 6, [
      ...list.map(u => ({
        label: `${u.id === cur ? '● ' : '○ '}${u.name}`,
        onClick: () => switchUniverse(u.id),
      })),
      '-',
      { label: 'New universe…', onClick: newUniverse },
      { label: 'Rename this universe…', onClick: () => renameUniverse(uni) },
      ...(list.length > 1
        ? [
          { label: `Close “${uni ? uni.name : ''}”…`, onClick: () => deleteUniverse(uni) },
          { label: `Delete “${uni ? uni.name : ''}”…`, danger: true, onClick: () => purgeUniverse(uni) },
        ]
        : []),
    ]);
  };
  navEl.appendChild(btn);
}

async function switchUniverse(id) {
  setState({
    settings: { ...getState().settings, currentUniverse: id },
    currentProjectId: null,
    currentSectionId: null,
    currentPageId: null,
  });
  await window.api.setSetting('currentUniverse', id);
  render();
}

function newUniverse() {
  promptModal({
    title: 'New universe',
    label: 'Name',
    confirmLabel: 'Open',
    onConfirm: async (name) => {
      if (!name.trim()) return;
      await window.api.createUniverse(name.trim());
      const boot = await window.api.bootstrap();
      setState({ notebooks: boot.notebooks });
      await switchUniverse(boot.notebooks.universes[boot.notebooks.universes.length - 1].id);
    },
  });
}

function renameUniverse(uni) {
  if (!uni) return;
  promptModal({
    title: 'Rename universe',
    label: 'Name',
    value: uni.name,
    confirmLabel: 'Rename',
    onConfirm: async (name) => {
      if (!name.trim() || name === uni.name) return;
      await window.api.renameUniverse(uni.id, name.trim());
      const boot = await window.api.bootstrap();
      setState({ notebooks: boot.notebooks });
      render();
    },
  });
}

function deleteUniverse(uni) {
  if (!uni) return;
  openModal({
    title: `Close “${uni.name}”?`,
    body: 'Its projects and groups move to the first remaining universe. Nothing is deleted.',
    actions: [{ label: 'Cancel', onClick: closeModal }, {
      label: 'Close universe',
      onClick: async () => {
        closeModal();
        await window.api.deleteUniverse(uni.id);
        const boot = await window.api.bootstrap();
        setState({ notebooks: boot.notebooks, settings: { ...getState().settings, currentUniverse: currentUniverseId() } });
        await window.api.setSetting('currentUniverse', currentUniverseId());
        render();
      },
    }],
  });
}

// Delete, not close: the universe and everything in it goes, for good.
// The modal spells out the gentler option before the irreversible one.
function purgeUniverse(uni) {
  if (!uni) return;
  openModal({
    title: `Delete “${uni.name}”?`,
    body: 'Deleting a universe removes it and everything in it — every project, page and task — permanently. ' +
      'If you only want it out of the way, close it instead: its projects move to another universe and nothing is lost.',
    danger: true,
    actions: [
      { label: 'Cancel', onClick: closeModal },
      // Hands over to the close flow — return true so this modal isn't
      // closed on top of the one it just opened.
      { label: 'Close it instead', onClick: () => { deleteUniverse(uni); return true; } },
      { label: 'Delete everything', style: 'danger', onClick: async () => {
        await window.api.purgeUniverse(uni.id);
        const boot = await window.api.bootstrap();
        setState({ notebooks: boot.notebooks, settings: { ...getState().settings, currentUniverse: currentUniverseId() } });
        await window.api.setSetting('currentUniverse', currentUniverseId());
        render();
      } },
    ],
  });
}

function render() {
  const state = getState();
  applyTheme(state.settings.theme);
  renderNav();
  const mod = VIEWS[state.view].module;
  panelEl.innerHTML = '';
  mainEl.innerHTML = '';
  mod.renderPanel(panelEl);
  mod.renderMain(mainEl);
}

// The CSP (style-src 'self') silently blocks every inline style="" attribute,
// and the app's templates use them throughout — project dots, progress fills,
// the threads bars. So mirror each blocked attribute through CSSOM, which the
// CSP allows. Runs once over the initial DOM and on every childList change.
function paintBlockedStyles(root) {
  root.querySelectorAll('[style]').forEach(el => {
    const css = el.getAttribute('style');
    el.removeAttribute('style');
    if (!css) return;
    for (const decl of css.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  });
}
// Painting only *removes* style attributes — an attribute mutation the
// observer doesn't watch — so this can't loop with itself.
new MutationObserver(() => paintBlockedStyles(document.body))
  .observe(document.body, { childList: true, subtree: true });
paintBlockedStyles(document.body);

// ---- Global shortcuts ----

document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 'p') { e.preventDefault(); quickOpen(); }
  if (meta && e.key === 'k') { e.preventDefault(); dashboard.quickAdd(); }
  if (meta && e.key === 'd') { e.preventDefault(); window.__index.goto('log'); }
  if (meta && e.key === 'j') { e.preventDefault(); log.captureModal(); }
  if (meta && e.key === 'n' && !e.shiftKey) { e.preventDefault(); newPageInFirstSection(); }
  if (meta && e.key === 'h') { e.preventDefault(); const s = getState(); if (s.currentPageId) pageView.toggleHistory(s.currentPageId); }
  if (meta && e.key === 's') { e.preventDefault(); pageView.forceSave(); }
  if (meta && e.key === ',') { e.preventDefault(); goto('settings'); }
  if (meta && e.key === 'l' && !e.shiftKey) { e.preventDefault(); dashboard.sweepLooseEnds(); }
  if (e.key === 'Escape') {
    closeMenus();
    const drawer = document.getElementById('history-drawer');
    if (drawer && !drawer.hidden) drawer.hidden = true;
  }
});

async function newPageInFirstSection() {
  const state = getState();
  const nb = state.notebooks.notebooks[0];
  if (!nb || !nb.sections[0]) { toast('Create a notebook section first'); return; }
  const { pageMeta } = await window.api.createPage(nb.sections[0].id, 'Untitled');
  await refreshTree();
  openPage(pageMeta.id);
  setTimeout(() => {
    const titleInput = document.querySelector('.page-title-input');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
  }, 60);
}

export async function refreshTree() {
  // Reload the merged tree + recent activity from disk via a fresh bootstrap.
  const boot = await window.api.bootstrap();
  setState({ notebooks: boot.notebooks, activity: boot.activity, settings: { ...getState().settings, ...boot.settings } });
  return boot;
}

async function quickOpen() {
  const pages = await window.api.listPages();
  const el = openModal({
    title: 'Quick open',
    body: `<input type="text" class="quick-open-input" placeholder="Jump to page…" style="width:100%">
           <div class="quick-open-list"></div>`,
    actions: [],
  });
  const input = el.querySelector('.quick-open-input');
  const list = el.querySelector('.quick-open-list');
  const renderList = (q) => {
    const matches = pages
      .filter(p => !q || p.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 12);
    list.innerHTML = matches.map((p, i) => `
      <div class="quick-open-item ${i === 0 ? 'sel' : ''}" data-id="${p.id}">
        <span class="qo-title">${esc(p.title)}</span>
        <span class="qo-path">${esc(p.path)}</span>
      </div>`).join('') || `<div class="quick-open-empty">No pages found</div>`;
  };
  renderList('');
  input.oninput = () => renderList(input.value.trim());
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      const sel = list.querySelector('.sel') || list.querySelector('.quick-open-item');
      if (sel) { closeModal(); openPage(sel.dataset.id); }
    } else if (ev.key === 'Escape') {
      closeModal();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const items = [...list.querySelectorAll('.quick-open-item')];
      const idx = items.findIndex(i => i.classList.contains('sel'));
      items.forEach(i => i.classList.remove('sel'));
      const next = ev.key === 'ArrowDown'
        ? items[Math.min(items.length - 1, idx + 1)]
        : items[Math.max(0, idx - 1)];
      if (next) next.classList.add('sel');
    }
  };
  list.onclick = (ev) => {
    const item = ev.target.closest('.quick-open-item');
    if (item) { closeModal(); openPage(item.dataset.id); }
  };
  input.focus();
}

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.ctx-menu')) closeMenus();
});

// ---- Boot ----

(async () => {
  const boot = await window.api.bootstrap();
  setState({
    notebooks: boot.notebooks,
    activity: boot.activity,
    settings: boot.settings,
    view: 'dashboard',
  });
  subscribe((s) => { /* views call render() themselves via goto() */ });
  render();
  applyFontSettings(boot.settings);
  applyLogoSetting(boot.settings);
  // Expose for views that need programmatic navigation.
  window.__index = { goto, openPage, refreshTree };
})();

// Font options (Settings → Fonts) ride the CSS custom properties, so every
// rule already using --font-ui / --font-mono picks them up on re-render.
function applyFontSettings(settings) {
  const root = document.documentElement;
  if (settings.uiFont) root.style.setProperty('--font-ui', settings.uiFont);
  // Interface data text (counts, meta, labels) follows the interface font;
  // unset falls back to the mono stack.
  if (settings.uiFont) root.style.setProperty('--font-data', settings.uiFont);
  else root.style.removeProperty('--font-data');
  if (settings.editorFont) root.style.setProperty('--font-editor', settings.editorFont);
  // The project page's dresses read in serif by default (--font-serif); the
  // page font choice overrides it there too, so the page font really does
  // set the page — the editor and the Projects reading text alike.
  if (settings.editorFont) root.style.setProperty('--font-serif', settings.editorFont);
  if (settings.editorFontSize) root.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
  const scale = parseFloat(settings.uiScale);
  if (scale > 0) root.style.setProperty('--ui-scale', String(scale));
}

// Settings → Logo: repaint the Dock with the saved finish once the renderer
// is up (the bundled .icns covers the moments before that). The default
// Array finish never paints over the tile on purpose: the .icns already
// carries that exact art, and a mark set through NSImage loses the sheen
// the Dock gives tiles it serves from the bundle.
function applyLogoSetting(settings) {
  if (!settings.logo || settings.logo === DEFAULT_LOGO.id) return;
  try {
    window.api.setDockIcon(logoPngDataUrl(logoById(settings.logo)));
  } catch { /* non-macOS or dock unavailable — the .icns stands */ }
}