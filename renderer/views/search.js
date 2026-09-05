// Search view: live full-text search across all pages, plus tag browsing —
// `#tag` queries (or a click on the tag cloud) list matching tasks across
// every project in the current universe.

import { getState, setState, allTasks } from '../store.js';
import { esc, relativeTime } from '../ui/components.js';

export function renderPanel(panelEl) {
  const { searchQuery } = getState();
  const tags = tagIndex();
  panelEl.innerHTML = `
    <div class="panel-header"><span>Search</span></div>
    <div class="panel-body">
      <input type="text" id="search-input" class="search-input" placeholder="Search all pages…  #tag for tasks"
             value="${esc(searchQuery)}" style="width:100%">
      <div class="search-hint" style="margin-top:8px; font-size:11px; color:var(--fg-dim)">
        Titles rank first; content matches show an excerpt.
      </div>
      ${tags.length ? `
        <div class="tag-cloud">
          ${tags.map(([tag, n]) => `<button class="tag-cloud-item" data-tag="${esc(tag)}">#${esc(tag)} <span>${n}</span></button>`).join('')}
        </div>` : ''}
    </div>`;

  const input = panelEl.querySelector('#search-input');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      setState({ searchQuery: input.value });
      await runSearch(input.value);
    }, 200);
  });
  panelEl.querySelectorAll('.tag-cloud-item').forEach(btn => {
    btn.onclick = () => {
      input.value = `#${btn.dataset.tag}`;
      input.dispatchEvent(new Event('input'));
    };
  });
  if (searchQuery) input.dispatchEvent(new Event('input'));
  else input.focus();
}

export function renderMain(mainEl) {
  mainEl.innerHTML = `
    <div class="search-main">
      <div class="empty" style="height:100%">
        <div class="empty-icon">⌕</div>
        <b style="color:var(--fg)">Search your notes</b>
        <span>Type in the sidebar — results appear here. <kbd>#tag</kbd> finds tagged tasks.</span>
      </div>
    </div>`;
}

async function runSearch(q) {
  const mainEl = document.getElementById('main');
  const trimmed = (q || '').trim();
  if (!trimmed) { renderMain(mainEl); return; }
  if (trimmed.startsWith('#')) { renderTagResults(mainEl, trimmed.slice(1).trim().toLowerCase(), trimmed); return; }
  const results = await window.api.search(trimmed);
  renderResults(mainEl, results, trimmed);
}

// Every tag across the universe's tasks, with use counts, most-used first.
function tagIndex() {
  const counts = new Map();
  for (const { task } of allTasks()) {
    for (const tag of task.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderTagResults(mainEl, tag, rawQuery) {
  const hits = tag
    ? allTasks().filter(({ task }) => (task.tags || []).includes(tag))
    : [];
  mainEl.innerHTML = `
    <div class="search-main">
      <div class="search-results-header">${hits.length} tagged ${hits.length === 1 ? 'task' : 'tasks'} for “${esc(rawQuery)}”</div>
      ${hits.map(({ task, project, section }) => `
        <button class="search-result" data-project="${project.id}">
          <div class="sr-title">${task.status === 'done' ? '✓ ' : task.status === 'scrapped' ? '✕ ' : ''}${esc(task.title)}</div>
          <div class="sr-excerpt">${(task.tags || []).map(t2 => `<span class="ql-tag">#${esc(t2)}</span>`).join(' ')}</div>
          <div class="sr-path">${esc(project.name)}${section ? ` / ${esc(section.name)}` : ' / unfiled'} · written ${relativeTime(task.createdAt)}</div>
        </button>`).join('') || `
      <div class="empty"><div class="empty-icon">⌕</div>No tasks tagged “${esc(rawQuery)}”.</div>`}
    </div>`;
  mainEl.querySelectorAll('.search-result').forEach(el => {
    el.onclick = () => window.__index.goto('projects', { currentProjectId: el.dataset.project });
  });
}

function renderResults(mainEl, results, q) {
  mainEl.innerHTML = `
    <div class="search-main">
      <div class="search-results-header">${results.length} ${results.length === 1 ? 'result' : 'results'} for “${esc(q)}”</div>
      ${results.length ? results.map(r => `
        <button class="search-result" data-page="${r.pageId}">
          <div class="sr-title">${esc(r.title)}</div>
          <div class="sr-excerpt">${esc(r.excerpt)}</div>
          <div class="sr-path">${esc(r.path)} · ${relativeTime(r.updatedAt)}</div>
        </button>`).join('') : `
        <div class="empty"><div class="empty-icon">⌕</div>Nothing found for “${esc(q)}”.</div>`}
    </div>`;
  mainEl.querySelectorAll('.search-result').forEach(el => {
    el.onclick = () => window.__index.openPage(el.dataset.page);
  });
}