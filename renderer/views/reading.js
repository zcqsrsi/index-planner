// Reading view: all notes of a scope (a project, a project group, or
// everything) compiled into one continuous scroll — question by question,
// sub-objective by sub-objective — with each sub-objective's tasks shown
// small and greyed beside the prose. Linked projects read together: a group
// scope compiles every member.

import { getState, setState, allProjects, allGroups } from '../store.js';
import { esc } from '../ui/components.js';
import { renderVersionBlock } from './page.js';

// Compile one project into reading HTML.
async function projectHtml(p) {
  const sectionsOf = (objectiveId) => p.sections.filter(s => s.objectiveId === objectiveId);
  const subHtml = async (s) => {
    const tasks = (s.tasks || []).filter(t => t.status !== 'scrapped');
    const pages = s.pages.length
      ? (await Promise.all(s.pages.map(pageHtml))).join('')
      : '<div class="rv-empty">No notes in this sub-objective.</div>';
    return `
      <section class="rv-sub" data-section="${s.id}">
        <h3 class="rv-sub-head">▤ ${esc(s.name)}</h3>
        ${tasks.length ? `
        <div class="rv-tasks">
          ${tasks.map(t => `
            <span class="rv-task ${t.status === 'done' ? 'is-done' : ''}">
              <span class="rv-task-glyph">${t.status === 'done' ? '✓' : '○'}</span>${esc(t.title)}
            </span>`).join('')}
        </div>` : ''}
        ${pages}
      </section>`;
  };
  const objectives = p.objectives || [];
  const objBlocks = [];
  for (const o of objectives) {
    const subs = sectionsOf(o.id);
    objBlocks.push(`
      <h3 class="rv-obj-head">◇ ${esc(o.name)}</h3>
      ${subs.length ? (await Promise.all(subs.map(subHtml))).join('') : '<div class="rv-empty">No sub-objectives.</div>'}`);
  }
  const general = sectionsOf(null);
  if (general.length) {
    objBlocks.push(`<h3 class="rv-obj-head">◇ General</h3>${(await Promise.all(general.map(subHtml))).join('')}`);
  }
  const afloat = p.floatingTasks || [];
  if (afloat.length) {
    objBlocks.push(`
      <h3 class="rv-obj-head rv-afloat-head">≈ Afloat</h3>
      <div class="rv-tasks">
        ${afloat.map(t => `<span class="rv-task"><span class="rv-task-glyph">○</span>${esc(t.title)}</span>`).join('')}
      </div>`);
  }
  return `
    <article class="rv-project" data-project="${p.id}">
      <h2 class="rv-project-head">${esc(p.name)}</h2>
      ${objBlocks.join('')}
    </article>`;
}

const pageCache = new Map(); // pageId -> blocks (one compile session)

async function pageHtml(pg) {
  let blocks = pageCache.get(pg.id);
  if (!blocks) {
    const page = await window.api.loadPage(pg.id);
    blocks = (page && page.blocks) || [];
    pageCache.set(pg.id, blocks);
  }
  return `
    <div class="rv-page" data-page="${pg.id}">
      <div class="rv-page-title">${esc(pg.title)}</div>
      ${blocks.map(b => renderVersionBlock(b)).join('') || '<div class="rv-empty">An empty page.</div>'}
    </div>`;
}

// Build the scope picker: every group (with its members), every project,
// and "everything". Returns [{ id, label }] where id is
// 'all' | 'grp:<id>' | 'prj:<id>'.
function scopes() {
  const out = [{ id: 'all', label: 'Everything' }];
  const projects = allProjects();
  const groups = allGroups();
  for (const g of groups) {
    const members = projects.filter(p => p.groupId === g.id);
    if (members.length) out.push({ id: `grp:${g.id}`, label: `◫ ${g.name}` });
  }
  for (const p of projects) out.push({ id: `prj:${p.id}`, label: `❖ ${p.name}` });
  return out;
}

function resolveScope(id) {
  const projects = allProjects();
  if (id?.startsWith('grp:')) {
    const gid = id.slice(4);
    return projects.filter(p => p.groupId === gid);
  }
  if (id?.startsWith('prj:')) {
    const p = projects.find(x => x.id === id.slice(4));
    return p ? [p] : [];
  }
  return projects;
}

export async function renderReading(mainEl, scopeId) {
  const list = scopes();
  const current = scopeId && list.some(s => s.id === scopeId) ? scopeId : (list[1]?.id || list[0].id);
  const targets = resolveScope(current);

  mainEl.innerHTML = `
    <div class="rv-wrap">
      <div class="rv-toolbar">
        <span class="rv-title">Reading</span>
        <select class="rv-scope" id="rv-scope">
          ${list.map(s => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </div>
      <div class="rv-body" id="rv-body"><div class="rv-loading">Compiling…</div></div>
    </div>`;

  mainEl.querySelector('#rv-scope').onchange = (e) => {
    setState({ readingScope: e.target.value });
    renderReading(mainEl, e.target.value);
  };

  pageCache.clear();
  const body = mainEl.querySelector('#rv-body');
  const html = targets.length
    ? (await Promise.all(targets.map(projectHtml))).join('')
    : '<div class="rv-empty">Nothing in this scope yet.</div>';
  if (!body.isConnected) return; // user switched away mid-compile
  body.innerHTML = html;
  body.querySelectorAll('[data-page]').forEach(el => {
    el.onclick = () => window.__index.openPage(el.dataset.page);
  });
}