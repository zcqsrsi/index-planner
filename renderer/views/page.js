// Page view: title, toolbar, editor host, debounced autosave, history drawer.

import { getState, setState, findPageMeta } from '../store.js';
import { Editor } from '../editor/editor.js';
import { extractTags } from '../editor/sanitize.js';
import { esc, relativeTime, toast, contextMenu } from '../ui/components.js';
import { pageToMarkdown, pageToPdfHtml } from '../export/exporters.js';

let editor = null;
let saveTimer = null;
let currentTitle = '';
let saveStatusEl = null;

export async function renderMain(mainEl) {
  const { currentPageId } = getState();
  const page = await window.api.loadPage(currentPageId);
  if (!page) {
    mainEl.innerHTML = `<div class="empty"><div class="empty-icon">∅</div>Page not found.</div>`;
    return;
  }
  const meta = findPageMeta(currentPageId);
  currentTitle = page.title;
  const backlinks = await window.api.backlinks(currentPageId);

  mainEl.innerHTML = `
    <div class="page-wrap">
      <div class="page-toolbar">
        <div class="page-breadcrumb">${meta ? `${esc(meta.notebook.name)} / ${esc(meta.section.name)}` : ''}</div>
        <div class="page-actions">
          <span class="save-status" id="save-status"></span>
          <button class="icon-btn" id="btn-attach" title="Attach file">⎋ Attach</button>
          <button class="icon-btn" id="btn-export" title="Export this page">⇪ Export</button>
          <button class="icon-btn" id="btn-history" title="History (⌘H)">⏱ History</button>
        </div>
      </div>
      <input class="page-title-input" value="${esc(page.title)}" placeholder="Untitled" spellcheck="false">
      ${backlinks.length ? `
      <div class="backlinks">
        <span class="bl-label">linked from</span>
        ${backlinks.map(b => `<button class="bl-item" data-id="${b.id}">${esc(b.title)}${b.count > 1 ? ` <span class="bl-count">×${b.count}</span>` : ''}</button>`).join('')}
      </div>` : ''}
      <div class="editor-host" id="editor-host"></div>
    </div>
    <div class="history-drawer" id="history-drawer" hidden></div>`;

  mainEl.querySelectorAll('.bl-item').forEach(btn => {
    btn.onclick = () => window.__index.openPage(btn.dataset.id);
  });

  saveStatusEl = mainEl.querySelector('#save-status');
  setSaveStatus(`Edited ${relativeTime(page.updatedAt)}`);

  editor = new Editor(mainEl.querySelector('#editor-host'), {
    onChange: scheduleSave,
    onOpenPage: (pageId) => window.__index.openPage(pageId),
  });
  editor.load(page.blocks);

  // Title editing.
  const titleInput = mainEl.querySelector('.page-title-input');
  titleInput.addEventListener('input', () => {
    currentTitle = titleInput.value;
    scheduleSave();
  });

  mainEl.querySelector('#btn-attach').onclick = () => editor.attachFromPicker();
  mainEl.querySelector('#btn-export').onclick = (e) => {
    const btn = mainEl.querySelector('#btn-export');
    const r = btn.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [
      { label: 'Markdown…', onClick: () => exportCurrent('markdown') },
      { label: 'PDF…', onClick: () => exportCurrent('pdf') },
    ]);
  };
  mainEl.querySelector('#btn-history').onclick = () => toggleHistory(currentPageId);
}

async function exportCurrent(kind) {
  // Save first — export what's on screen, not the last autosave.
  await doSave('manual');
  const { currentPageId } = getState();
  const page = await window.api.loadPage(currentPageId);
  const meta = findPageMeta(currentPageId);
  const name = page.title || 'Untitled';
  if (kind === 'markdown') {
    const dest = await window.api.exportMarkdown(name, pageToMarkdown(page, meta));
    if (dest) toast(`Markdown saved — ${dest.split('/').pop()}`);
  } else {
    const dest = await window.api.exportPdf(name, pageToPdfHtml(page, meta));
    if (dest) toast(`PDF saved — ${dest.split('/').pop()}`);
  }
}

export function forceSave() {
  if (!editor) return;
  clearTimeout(saveTimer);
  doSave('manual').then(() => toast('Saved — snapshot taken'));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveStatus('Editing…');
  saveTimer = setTimeout(() => doSave('autosave'), 1200);
}

async function doSave(reason) {
  if (!editor) return;
  const { currentPageId } = getState();
  const blocks = editor.getBlocks();
  const tags = extractTags(blocks);
  const { page } = await window.api.savePage(currentPageId, { title: currentTitle, blocks, tags, reason });

  // Keep the tree + activity in app state in sync without a refetch.
  const state = getState();
  const meta = findPageMeta(currentPageId);
  if (meta) {
    meta.page.title = page.title;
    meta.page.updatedAt = page.updatedAt;
    meta.page.versionCount = page.versions.length;
    meta.page.tags = tags;
  }
  const entry = {
    ts: page.updatedAt, type: 'page.save', entityId: currentPageId,
    summary: `Edited “${page.title}”${meta ? ` in ${meta.notebook.name}/${meta.section.name}` : ''}`,
  };
  setState({ activity: [entry, ...state.activity].slice(0, 80) });
  setSaveStatus(`Saved · ${new Date(page.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
}

function setSaveStatus(text) {
  if (saveStatusEl) saveStatusEl.textContent = text;
}

// ---- History drawer ----

export async function toggleHistory(pageId) {
  const drawer = document.getElementById('history-drawer');
  if (!drawer) return;
  if (!drawer.hidden) { drawer.hidden = true; return; }
  drawer.hidden = false;
  drawer.innerHTML = '<div class="history-loading">Loading…</div>';

  const versions = await window.api.pageVersions(pageId);
  if (!versions.length) {
    drawer.innerHTML = `
      <div class="history-header">Version history</div>
      <div class="empty"><div class="empty-icon">⏱</div>No snapshots yet.<br>They appear as you edit (every 5 minutes of changes or on structural change).</div>`;
    return;
  }

  drawer.innerHTML = `
    <div class="history-header">
      <span>Version history</span>
      <button class="icon-btn" id="history-close">✕</button>
    </div>
    <div class="history-list">
      ${versions.map(v => `
        <button class="history-item" data-vid="${v.id}">
          <span class="hi-when">${formatWhen(v.ts)}</span>
          <span class="hi-reason">${esc(v.reason)}</span>
        </button>`).join('')}
    </div>
    <div class="history-preview" id="history-preview"><div class="hp-hint">Select a version to preview it.</div></div>`;

  // Close is delegated on the drawer itself — it works no matter how the
  // inner markup is rebuilt, and Escape closes too (global keymap in app.js).
  drawer.onclick = (e) => {
    if (e.target.closest('#history-close')) drawer.hidden = true;
  };
  drawer.querySelectorAll('.history-item').forEach(btn => {
    btn.onclick = async () => {
      drawer.querySelectorAll('.history-item').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      const version = await window.api.loadVersion(pageId, btn.dataset.vid);
      const preview = drawer.querySelector('#history-preview');
      preview.innerHTML = `
        <button class="btn restore-btn" id="history-restore">Restore this version</button>
        <div class="history-blocks">${version.blocks.map(renderVersionBlock).join('')}</div>`;
      preview.querySelector('#history-restore').onclick = async () => {
        await window.api.restoreVersion(pageId, btn.dataset.vid);
        drawer.hidden = true;
        await renderMain(document.getElementById('main'));
        toast('Version restored');
        window.__index.refreshTree();
      };
    };
  });
}

function formatWhen(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Read-only rendering of a snapshot's blocks for the preview — also used by
// the Log reading view to compile many pages into one scroll.
export function renderVersionBlock(b) {
  const content = b.html !== undefined ? b.html : '';
  switch (b.type) {
    case 'heading': return `<div class="pv-heading pv-h${b.level || 2}">${content}</div>`;
    case 'todo': return `<div class="pv-todo"><span>${b.checked ? '☑' : '☐'}</span><span class="${b.checked ? 'pv-done' : ''}">${content}</span></div>`;
    case 'list-item': return `<div class="pv-list" style="margin-left:${(b.indent || 0) * 20}px">${b.ordered ? '1.' : '•'} ${content}</div>`;
    case 'code': return `<pre class="pv-code">${esc(b.text)}</pre>`;
    case 'quote': return `<blockquote class="pv-quote">${content}</blockquote>`;
    case 'divider': return `<hr class="pv-divider">`;
    case 'image': return `<img class="pv-image" src="${esc(b.url)}">`;
    case 'file': return `<div class="pv-file">⎋ ${esc(b.name)}</div>`;
    case 'page-link': return `<div class="pv-pagelink">📄 ${esc(b.title)}</div>`;
    case 'table': {
      const cols = b.cols || [];
      const head = cols.map(c => `<th>${esc(c.name)}</th>`).join('');
      const rows = (b.rows || []).map(r =>
        `<tr>${cols.map(c => `<td>${esc(r.cells?.[c.id])}</td>`).join('')}</tr>`).join('');
      return `<table class="pv-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    default: return `<div class="pv-para">${content}</div>`;
  }
}