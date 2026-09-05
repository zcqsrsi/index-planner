// Projects view — the merged case file. Three panes, left→right:
// Projects (the sidebar panel: groups + projects) | Tasks (Big picture,
// aims → sub-objectives → tasks, floating threads) | Notes (the
// pages this project produces, in the real editor). Every pane folds to a
// slim strip; the fold state is remembered in settings.

import { getState, setState, allProjects, allGroups, findProject, findGroup, findPageMeta, projectColor, currentUniverseId } from '../store.js';
import { esc, contextMenu, promptModal, openModal, closeModal, shortDate, isOverdue, ageDays, todayStr } from '../ui/components.js';
import { newProject, newObjective, newTask, newGroup, iterTasks, progressOf, isStale, PRIORITIES, QUEST_STATUSES, QUEST_STATUS_LABELS, TASK_STATUS_LABELS, PROJECT_COLORS } from '../quest/model.js';
import { sectionToMarkdown, projectToMarkdown } from '../export/exporters.js';
import { dressId } from '../ui/dresses.js';
import { parseDate } from '../onenote/journal.js';
import * as pageView from './page.js';

const staleDays = () => getState().settings.staleDays ?? 3;

// The day pulse: a 7px dot in today's date header that fills as the day
// does. Off in Settings (dayPulse === false) means the span never renders
// and the timer never starts.
let dayPulseTimer = null;

function startDayPulse(mainEl) {
  clearInterval(dayPulseTimer);
  const dots = mainEl.querySelectorAll('.day-pulse');
  if (!dots.length) return;
  const paint = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const frac = Math.min(1, Math.max(0, (now - start) / 86400000));
    const pct = Math.round(frac * 100);
    dots.forEach(d => {
      d.style.setProperty('--frac', frac.toFixed(4));
      d.title = `${pct}% of the day gone`;
    });
  };
  paint();
  dayPulseTimer = setInterval(paint, 1000);
}

const OPEN_STATUSES = new Set(['todo', 'in-progress']);
const CYCLE = ['todo', 'in-progress', 'done'];

// Dates written inline in names ("submit by 12 Sep", "interviews w/c 2026-09-14")
// colour themselves by how close they are: hot when here or overdue, warm
// within a week, cold within a month, plain beyond. parseDate (the journal
// table's reader) is the arbiter — only real month names survive it.
const DATE_SCAN = /(\d{4}-\d{1,2}-\d{1,2})|(\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{2,4})?)|(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{2,4})?)/gi;

function dateHeat(raw) {
  const iso = parseDate(raw.replace(/(\d)(st|nd|rd|th)\b/gi, '$1'));
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((then - today) / 86400000);
  if (days <= 2) return 'date-hot';   // due or nearly — including overdue
  if (days <= 7) return 'date-warm';  // this week
  if (days <= 31) return 'date-cold'; // on the horizon
  return null;                        // far off — reads as plain text
}

function markDates(text) {
  const s = String(text || '');
  if (!s) return '';
  let out = '', last = 0, m, found = false;
  DATE_SCAN.lastIndex = 0;
  while ((m = DATE_SCAN.exec(s))) {
    const heat = dateHeat(m[0]);
    if (!heat) continue;
    found = true;
    out += esc(s.slice(last, m.index)) + `<span class="${heat}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return found ? out + esc(s.slice(last)) : esc(s);
}

// Which panes are folded — remembered in settings so it survives relaunch.
// Tasks default open; notes defaults FOLDED — it opens only when asked for,
// to focus on writing (the planner keeps the full width otherwise).
export const folds = () => getState().settings.paneFold || {};
async function setFold(key, val) {
  const next = { ...folds(), [key]: val };
  setState({ settings: { ...getState().settings, paneFold: next } });
  await window.api.setSetting('paneFold', next);
}
// The left panel fold is shared by every view that renders #panel (Projects
// sidebar, Map overview, …) — return to whichever view the click came from.
export async function toggleFold(key, backTo = 'projects') {
  const cur = key === 'notes' ? folds().notes !== false : !!folds()[key];
  await setFold(key, !cur);
  window.__index.goto(backTo);
}

async function refresh() {
  await window.__index.refreshTree();
  window.__index.goto('projects');
}

// Whole calendar days a task has been open — still used for stale badges.
const selectedProject = () => allProjects().find(p => p.id === getState().currentProjectId)
  || allProjects().find(p => p.status === 'active')
  || allProjects()[0]
  || null;

// ---- Pane 1: Projects (groups + project spines) ----

export function renderPanel(panelEl) {
  const state = getState();
  if (folds().projects) {
    panelEl.classList.add('folded');
    panelEl.innerHTML = `
      <div class="panel-fold-strip">
        <span class="panel-fold-label">Projects</span>
        <button class="icon-btn fold-unfold" data-fold="projects" title="Unfold">»</button>
      </div>`;
    wireFold(panelEl);
    return;
  }
  panelEl.classList.remove('folded');

  const projects = allProjects();
  const shelved = projects.filter(p => p.shelved);
  const groups = allGroups();
  const topGroups = groups.filter(g => !g.parentId);
  const grouped = new Map(); // groupId -> projects
  const ungrouped = [];
  for (const p of projects) {
    if (p.shelved) continue; // shelved projects live in the Shelf section
    if (p.groupId && groups.some(g => g.id === p.groupId)) {
      grouped.set(p.groupId, [...(grouped.get(p.groupId) || []), p]);
    } else {
      ungrouped.push(p);
    }
  }

  const projectRow = (p) => {
    const prog = progressOf(iterTasks(p).map(x => x.task));
    const stale = iterTasks(p).filter(({ task }) => isStale(task, staleDays())).length;
    return `
      <div class="project-row ${p.id === state.currentProjectId ? 'sel' : ''}" data-id="${p.id}">
        <span class="project-dot" data-color="${projectColor(p)}"></span>
        <span class="project-name">${esc(p.name)}</span>
        ${stale ? `<span class="ql-stale-badge" title="${stale} stale thread${stale === 1 ? '' : 's'}">${stale}</span>` : ''}
        <span class="project-count">${prog.total ? `${prog.done}/${prog.total}` : ''}</span>
      </div>`;
  };

  const groupBlock = (g, depth = 0) => {
    const members = grouped.get(g.id) || [];
    const children = groups.filter(x => x.parentId === g.id);
    const count = members.length + children.length;
    const folded = foldedGroups.has(g.id);
    return `
      <div class="proj-group" data-group="${g.id}">
        <div class="proj-group-row ${depth ? 'is-nested' : ''}" data-group="${g.id}" title="${folded ? 'Unfold' : 'Fold'} this group">
          <span class="proj-group-tw">${folded ? '▸' : '▾'}</span>
          <span class="proj-group-dot" data-color="${g.color || 'var(--accent)'}"></span>
          <span class="proj-group-name">${esc(g.name)}</span>
          <span class="proj-group-count">${count || ''}</span>
        </div>
        ${folded ? '' : `
          ${children.map(c => groupBlock(c, depth + 1)).join('')}
          ${members.map(projectRow).join('')}`}
      </div>`;
  };

  panelEl.innerHTML = `
    <div class="panel-header">
      <span>Projects</span>
      <span>
        <button class="icon-btn" id="add-group" title="New project group">◫</button>
        <button class="icon-btn" id="add-project" title="New project">＋</button>
      </span>
    </div>
    <div class="panel-body">
      ${topGroups.map(g => groupBlock(g)).join('')}
      ${ungrouped.map(projectRow).join('')}
      ${!projects.length ? `<div class="empty" style="padding:24px 8px">No projects yet.<br>Create one ↑</div>` : ''}
      ${shelved.length ? `
        <div class="shelf-section">
          <div class="shelf-head" title="Shelved projects — parked, quiet on the map, out of the counts">Shelf</div>
          ${shelved.map(projectRow).join('')}
        </div>` : ''}
    </div>
    <button class="pane-fold-btn" data-fold="projects" title="Fold pane">«</button>`;

  // CSP blocks inline styles; paint the color dots via CSSOM.
  panelEl.querySelectorAll('[data-color]').forEach(el => {
    el.style.setProperty('background', el.dataset.color);
  });

  panelEl.querySelector('#add-project').onclick = () => createProject();
  panelEl.querySelector('#add-group').onclick = () => createGroup();
  wireFold(panelEl);

  panelEl.querySelectorAll('.project-row').forEach(row => {
    row.onclick = () => { setState({ currentProjectId: row.dataset.id }); window.__index.goto('projects'); };
    row.oncontextmenu = (e) => { e.preventDefault(); projectMenu(e, findProject(row.dataset.id)); };
  });
  panelEl.querySelectorAll('.proj-group-row').forEach(row => {
    const g = findGroup(row.dataset.group);
    if (!g) return;
    row.onclick = () => cycleGroupFold(g.id);
    row.oncontextmenu = (e) => { e.preventDefault(); groupMenu(e, g); };
  });
}

export function wireFold(scope) {
  scope.querySelectorAll('[data-fold]').forEach(btn => {
    btn.onclick = () => toggleFold(btn.dataset.fold, getState().view);
  });
}

// ---- Pane 2 + 3 ----

export function renderMain(mainEl) {
  const state = getState();
  const p = selectedProject();
  const foldTasks = !!folds().tasks;
  const foldNotes = folds().notes !== false;
  // The dress is a class on the tasks pane — one DOM, seven sets of clothes.
  const dress = `dress-${dressId(state.settings)}`;

  mainEl.innerHTML = `
    <div class="fp-main ${foldTasks ? 'fold-tasks' : ''} ${foldNotes ? 'fold-notes' : ''}">
      ${foldTasks ? `
        <button class="fp-fold-strip" data-fold="tasks" title="Unfold tasks">
          <span class="fp-fold-label">Tasks</span><span>»</span>
        </button>` : `
        <section class="fp-tasks ${dress}">${p ? tasksPane(p, state) : tasksEmpty()}</section>
        <button class="pane-fold-btn fp-fold-edge" data-fold="tasks" title="Fold tasks pane">«</button>`}
      ${foldNotes ? `
        <button class="fp-fold-strip" data-fold="notes" title="Unfold notes">
          <span class="fp-fold-label">Notes</span><span>»</span>
        </button>` : `
        <section class="fp-notes" id="fp-notes">${p ? notesPane(p, state) : ''}</section>
        <button class="pane-fold-btn fp-fold-edge" data-fold="notes" title="Fold notes pane">«</button>`}
    </div>`;

  wireFold(mainEl);
  if (!p) return;
  if (!foldTasks) wireTasks(mainEl, p);
  if (!foldNotes) wireNotes(mainEl, p);

  // Deep-link from the dashboard briefing: flash the task row.
  if (state.focusTaskId) {
    const rowEl = mainEl.querySelector(`.ql-task[data-task="${state.focusTaskId}"]`);
    if (rowEl) {
      requestAnimationFrame(() => {
        rowEl.classList.add('is-flash');
        rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => rowEl.classList.remove('is-flash'), 2200);
      });
    }
    setState({ focusTaskId: null });
  }
}

function tasksEmpty() {
  return `
    <div class="empty" style="padding:48px 0">
      <div class="empty-icon">❖</div>
      <b style="color:var(--fg)">Welcome to Index</b>
      <button class="btn" id="fp-first-project">＋ New project</button>
    </div>`;
}

// ---- Pane 2: the task journal ----

// The progress mark in the project head. The plain bar is the default;
// the variants are drawn in the accent colour — thin strokes, soft glow.
const PROGRESS_NODE_CAP = 14;
function progressGlyph(prog, p) {
  const style = getState().settings.progressStyle ?? 'pulse';
  if (style === 'bar' || !prog.total) {
    return `<span class="pm-progress"><span class="pm-progress-fill" data-w="${prog.pct}%" data-color="${projectColor(p)}"></span></span>`;
  }
  if (style === 'comet') {
    return `<span class="pg-comet" title="${prog.done} of ${prog.total} done"></span>`;
  }
  if (style === 'filament') {
    return `<span class="pg-filament" title="${prog.done} of ${prog.total} done">` +
      `<span class="pg-fill" data-w="${prog.pct}%"></span>` +
      `<span class="pg-head" data-w="${prog.pct}%" data-prop="left"></span></span>`;
  }
  // Nodes and pulse: one mark per task, capped — past the cap the fill
  // is proportional so the shape stays honest at a glance.
  const shown = Math.min(prog.total, PROGRESS_NODE_CAP);
  const doneShown = Math.round((prog.done / prog.total) * shown);
  const marks = [];
  for (let i = 0; i < shown; i++) {
    const cls = i < doneShown ? 'done' : (style === 'pulse' && i === doneShown ? 'now' : '');
    marks.push(`<span class="${style === 'pulse' ? 'pg-pdot' : 'pg-node'} ${cls}"></span>`);
  }
  return `<span class="${style === 'pulse' ? 'pg-pulse' : 'pg-nodes'}" title="${prog.done} of ${prog.total} done">${marks.join('')}</span>`;
}

function tasksPane(p, state) {
  // Big picture lives on the group when the project is grouped — members
  // share one statement; an ungrouped project carries its own.
  const bpOwner = p.groupId ? findGroup(p.groupId) : p;
  const bp = bpOwner?.bigPicture || null;
  const bpRes = bpOwner?.bigPictureResolution?.text ? bpOwner.bigPictureResolution : null;
  const bpHist = bpOwner?.bigPictureHistory || [];
  const prog = progressOf(iterTasks(p).map(x => x.task));
  const stale = iterTasks(p).filter(({ task }) => isStale(task, staleDays())).length;
  const floating = p.floatingTasks || [];
  const objectives = p.objectives || []; // the aim tier (JSON field keeps the old name)
  // Project-level sections (no aim) render under an implicit General.
  const sectionsOf = (objectiveId) => p.sections.filter(s => s.objectiveId === objectiveId);
  const generalSections = sectionsOf(null);
  const scrapped = p.status === 'scrapped';

  return `
    <div class="fp-tasks-inner">
      <div class="ql-question" id="ql-question">
        <div class="ql-question-top">
          <span class="ql-question-label">Big picture${bp ? `, as of <b class="bp-date">${shortDate(bp.asOf)}</b>` : ''}${p.groupId && bpOwner ? ` <span class="bp-shared">· shared by ${esc(bpOwner.name)}</span>` : ''}</span>
          <span class="ql-question-actions">
            ${bpHist.length ? '<button class="link-btn" id="bq-history">past</button>' : ''}
            ${bp ? '<button class="link-btn" id="bq-resolve">resolve</button>' : ''}
            <button class="link-btn" id="bq-edit">${bp ? 'edit' : 'set the big picture'}</button>
          </span>
        </div>
        <p class="ql-question-text ${bp ? '' : 'unset'}" title="Double-click to edit">${bp ? esc(bp.text) : 'No big picture set yet.'}</p>
        ${bpRes ? `
        <div class="ql-res-tie"></div>
        <div class="ql-resolution">
          <span class="ql-res-label">Resolved · as of <b class="bp-date">${shortDate(bpRes.asOf)}</b></span>
          <p class="ql-res-text" title="Double-click to rewrite">${esc(bpRes.text)}</p>
        </div>` : ''}
      </div>

      <header class="ql-project-head">
        <span class="project-dot big" data-color="${projectColor(p)}"></span>
        <span class="ql-project-name" title="Double-click to rename">${esc(p.name)}</span>
        <span class="ql-project-count">${prog.total ? `${prog.done}/${prog.total}` : 'no tasks'}${prog.scrapped ? ` · ${prog.scrapped} scrapped` : ''}</span>
        ${stale ? `<span class="ql-stale-badge" title="${stale} stale thread${stale === 1 ? '' : 's'}">${stale} stale</span>` : ''}
        ${progressGlyph(prog, p)}
        <button class="icon-btn ql-project-menu">⋯</button>
      </header>
      ${scrapped && p.scrappedReason ? `<div class="ql-task-reason" style="margin:2px 0 0 34px">${esc(p.scrappedReason)}</div>` : ''}

      <div class="ql-objectives">
        ${objectives.length ? objectives.map(o => objectiveArticle(p, o, sectionsOf(o.id))).join('') : ''}
        ${generalSections.length || !objectives.length ? generalArticle(p, generalSections) : ''}
        <button class="ql-objective-add" data-project="${p.id}">＋ Aim</button>
      </div>

      ${floating.length || true ? floatingBlock(p, floating) : ''}
    </div>`;
}

// Unfiled tasks sit below the aims, styled as today's row — they
// ride along with today's work until filed into a sub-objective.
// The box tucks itself away (settings.afloatOpen, default closed): a click
// on the header opens it, the count in the header keeps it findable.
function floatingBlock(p, floating) {
  const today = todayStr();
  const open = !!getState().settings.afloatOpen;
  const head = `
    <header class="ql-obj-head afloat-head" id="afloat-head" title="${open ? 'Tuck the unfiled box away' : 'Open the unfiled box'}">
      <span class="ql-obj-marker">≈</span>
      <span class="ql-obj-name-static">Unfiled</span>
      <span class="ql-obj-meta">${floating.length ? `${floating.length} adrift — ` : ''}${open ? 'no sub-objective yet — file them from the ⋯ menu' : 'click to open'}</span>
    </header>`;
  if (!open) {
    return `<article class="ql-objective fp-afloat is-folded" data-objective="">${head}</article>`;
  }
  return `
    <article class="ql-objective fp-afloat" data-objective="">
      ${head}
      <div class="ql-day is-today">
        <div class="ql-day-cols">
          <ul class="ql-day-tasks">
            ${floating.length ? floating.map(t => taskRow(p, null, t, { carried: t.day && t.day < today })).join('') : '<li class="ql-task-empty">Nothing adrift.</li>'}
            <li class="ql-task-add"><input type="text" class="ql-add-title" placeholder="Add an unfiled task…" data-project="${p.id}"></li>
          </ul>
          <div class="ql-day-side"></div>
        </div>
      </div>
    </article>`;
}

// The implicit General block: project-level sub-objectives and their tasks.
function generalArticle(p, sections) {
  if (!sections.length) return '';
  return `
    <article class="ql-objective fp-general">
      <header class="ql-obj-head">
        <span class="ql-obj-marker">◇</span>
        <span class="ql-obj-name-static">General</span>
        <span class="ql-obj-meta">project-level, outside any aim</span>
      </header>
      ${sections.map(s => subObjectiveArticle(p, s)).join('')}
    </article>`;
}

function objectiveArticle(p, o, sections) {
  const scrapped = o.status === 'scrapped';
  const tasks = sections.flatMap(s => s.tasks || []);
  const prog = progressOf(tasks);
  const oldestOpen = tasks
    .filter(t => OPEN_STATUSES.has(t.status))
    .reduce((max, t) => Math.max(max, ageDays(t.createdAt)), 0);
  // An aim holds no tasks itself, only the sub-objectives answering it.
  return `
    <article class="ql-objective ${scrapped ? 'is-scrapped' : ''}" data-objective="${o.id}">
      <header class="ql-obj-head">
        <span class="ql-obj-marker">◇</span>
        <span class="ql-obj-name" title="Double-click to rename">${markDates(o.name)}</span>
        <span class="ql-obj-meta">${prog.total ? `${prog.done}/${prog.total}` : 'no tasks yet'}${oldestOpen ? ` · oldest thread ${oldestOpen} day${oldestOpen === 1 ? '' : 's'}` : ''}</span>
        ${(o.importance && o.importance !== 'normal') ? `<span class="ql-imp-pill ${o.importance}">${o.importance}</span>` : ''}
        <button class="icon-btn ql-obj-menu">⋯</button>
      </header>
      ${scrapped && o.scrappedReason ? `<div class="ql-task-reason" style="margin:0 0 4px 26px">${esc(o.scrappedReason)}</div>` : ''}
      ${sections.length ? sections.map(s => subObjectiveArticle(p, s)).join('')
        : '<div class="ql-task-empty">No sub-objectives yet — add one below.</div>'}
      <button class="ql-sub-add" data-project="${p.id}" data-objective="${o.id}">＋ Sub-objective</button>
    </article>`;
}

// The planner: sub-objectives are day rows, like the original OneNote
// table — one row per day, tasks on the left, the day's note and files on
// the right. Tasks are written ON a day (t.day) and float forward into
// today's row while open; notes and files stay anchored to their day.
function dayHeaderLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(2)}`;
}

function subObjectiveArticle(p, s) {
  const tasks = s.tasks || [];
  const prog = progressOf(tasks);
  const pages = s.pages.length;
  const today = todayStr();

  // Every day this sub-objective knows about: task days + diary days,
  // newest first. A fresh sub-objective starts with today's row.
  const dates = new Set(tasks.map(t => t.day).filter(Boolean));
  for (const k of Object.keys(s.days || {})) dates.add(k);
  if (!dates.size) dates.add(today);
  const sorted = [...dates].sort().reverse();

  // Open tasks written before today reappear in today's row until done.
  const carried = tasks.filter(t => OPEN_STATUSES.has(t.status) && t.day && t.day < today);

  const dayRow = (date) => {
    const isToday = date === today;
    const diary = (s.days || {})[date] || { note: '', files: [] };
    let rowTasks = tasks.filter(t => t.day === date);
    if (isToday) {
      const home = new Set(rowTasks.map(t => t.id));
      rowTasks = [...rowTasks, ...carried.filter(t => !home.has(t.id))];
    }
    // Today's note box is gone — a day's writing lives in its page now
    // ("New page" in the notes pane). Past days still show whatever the
    // journal-table conversion or earlier days left behind, read-only.
    const side = isToday ? '' : (diary.note || diary.files.length
      ? `<div class="ql-day-side">
          ${diary.note ? `<div class="ql-day-note-ro">${esc(diary.note)}</div>` : ''}
          ${diary.files.length ? `<div class="ql-day-files">${diary.files.map(f => `<button class="ql-day-file" data-att="${f.id}" title="Open ${esc(f.name)}">${esc(f.name)}</button>`).join('')}</div>` : ''}
        </div>` : '');
    return `
      <div class="ql-day ${isToday ? 'is-today' : ''}" data-day="${date}">
        <div class="ql-day-head"><span class="ql-day-date">${isToday && getState().settings.dayPulse !== false ? '<span class="day-pulse"></span>' : ''}${dayHeaderLabel(date)}</span></div>
        <div class="ql-day-cols">
          <ul class="ql-day-tasks">
            ${rowTasks.length ? rowTasks.map(t => taskRow(p, s, t, { carried: isToday && t.day !== date, pastOpen: !isToday && OPEN_STATUSES.has(t.status) })).join('') : '<li class="ql-task-empty">No tasks written this day.</li>'}
            ${isToday ? `<li class="ql-task-add"><input type="text" class="ql-add-title" placeholder="Add a task for today…" data-project="${p.id}" data-section="${s.id}"></li>` : ''}
          </ul>
          ${side}
        </div>
      </div>`;
  };

  return `
    <div class="fp-sub" data-section="${s.id}">
      <header class="fp-sub-head">
        <span class="fp-sub-marker">▤</span>
        <span class="fp-sub-name" title="Double-click to rename">${esc(s.name)}</span>
        <span class="fp-sub-meta">${prog.total ? `${prog.done}/${prog.total}` : ''}</span>
        <button class="fp-sub-notes ${getState().currentSectionId === s.id ? 'on' : ''}" data-section="${s.id}" title="Show its notes">
          notes${pages ? ` · ${pages}` : ''}
        </button>
        <button class="icon-btn fp-sub-menu">⋯</button>
      </header>
      <div class="ql-days">${sorted.map(dayRow).join('')}</div>
    </div>`;
}

function taskRow(p, section, t, opts = {}) {
  const stale = isStale(t, staleDays());
  const overdue = isOverdue(t.dueDate) && OPEN_STATUSES.has(t.status);
  const scrapped = t.status === 'scrapped';
  const done = t.status === 'done';
  const open = OPEN_STATUSES.has(t.status);
  // Done and scrapped read like the quest log: struck through, no glyph —
  // the tick button only exists while there is something to cycle.
  return `
    <li class="ql-task ${done ? 'is-done' : ''} ${scrapped ? 'is-scrapped' : ''} ${stale ? 'is-stale' : ''}" data-task="${t.id}" data-section="${section ? section.id : ''}">
      <span class="ql-task-drag" draggable="true" title="Drag to rearrange">⋮⋮</span>
      ${open ? `<button class="ql-tick ${t.status}" title="${TASK_STATUS_LABELS[t.status]} — click to cycle"></button>` : `<span class="ql-tick-spacer ${t.status}"></span>`}
      <div class="ql-task-body">
        <span class="ql-task-text">${markDates(t.title)}</span>
        ${(t.tags || []).length ? `<span class="ql-task-tags">${t.tags.map(tag => `<span class="ql-tag" title="Tagged #${esc(tag)}">#${esc(tag)}</span>`).join('')}</span>` : ''}
      </div>
      ${opts.carried ? `<span class="ql-task-carried" title="Written ${shortDate(t.day)} — still open">from ${shortDate(t.day)}</span>` : ''}
      ${opts.pastOpen ? `<span class="ql-task-open-hint">still open</span>` : ''}
      ${t.dueDate ? `<span class="ql-task-due-pill ${overdue ? 'is-overdue' : ''}" title="Deadline ${shortDate(t.dueDate)}">due ${shortDate(t.dueDate)}</span>` : ''}
      ${overdue ? `<span class="ql-task-overdue">loose end</span>` : ''}
      <button class="icon-btn ql-task-menu">⋯</button>
      ${scrapped && t.scrappedReason ? `<div class="ql-task-reason">${esc(t.scrappedReason)}</div>` : ''}
    </li>`;
}

// ---- Pane 2 wiring ----

function wireTasks(mainEl, p) {
  // Double-click a task title to rename — works in day rows and in the
  // unfiled box alike (rows carry their section id in data-section).
  mainEl.addEventListener('dblclick', (e) => {
    const textEl = e.target.closest('.ql-task-text');
    if (!textEl) return;
    const rowEl = textEl.closest('.ql-task');
    if (!rowEl) return;
    const secId = rowEl.dataset.section || null;
    const section = secId ? p.sections.find(s => s.id === secId) : null;
    const t = section
      ? (section.tasks || []).find(x => x.id === rowEl.dataset.task)
      : (p.floatingTasks || []).find(x => x.id === rowEl.dataset.task);
    if (t) renameTask(p, section, t);
  });
  // CSP-painted dots + progress fills.
  mainEl.querySelectorAll('[data-color]:not(.pm-progress-fill):not(.fp-sub-notes)').forEach(el => {
    el.style.setProperty('background', el.dataset.color);
  });
  mainEl.querySelectorAll('.pm-progress-fill').forEach(el => {
    el.style.setProperty('width', el.dataset.w);
    el.style.setProperty('background', el.dataset.color);
  });
  mainEl.querySelectorAll('.pg-filament [data-w]').forEach(el => {
    el.style.setProperty(el.dataset.prop || 'width', el.dataset.w);
  });

  // Drag a task by its handle to rearrange: within its day row, across
  // days of the pane (the drop row's day becomes the task's day), into
  // another sub-objective, or into the unfiled box. One IPC does the
  // move + day + order in a single save.
  let dragTask = null;
  let dropMark = null;
  const clearMark = () => { if (dropMark) { dropMark.classList.remove('drop-above', 'drop-below'); dropMark = null; } };
  mainEl.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.ql-task-drag');
    if (!handle) return;
    const row = handle.closest('.ql-task');
    dragTask = { id: row.dataset.task, fromSection: row.dataset.section || null };
    e.dataTransfer.setData('text/plain', 'task');
    e.dataTransfer.effectAllowed = 'move';
  });
  mainEl.addEventListener('dragover', (e) => {
    if (!dragTask) return;
    const row = e.target.closest('.ql-task');
    const day = e.target.closest('.ql-day[data-day]');
    const afloat = e.target.closest('.fp-afloat');
    if (!row && !day && !afloat) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMark();
    if (row && !row.classList.contains('ql-task-add')) {
      const r = row.getBoundingClientRect();
      dropMark = row;
      row.classList.add((e.clientY - r.top) < r.height / 2 ? 'drop-above' : 'drop-below');
    } else if (day) {
      dropMark = day;
      day.classList.add('drop-below');
    }
  });
  mainEl.addEventListener('dragleave', (e) => {
    if (e.target === dropMark || e.target.closest?.('.ql-task') === dropMark) clearMark();
  });
  mainEl.addEventListener('drop', async (e) => {
    if (!dragTask) return;
    e.preventDefault();
    clearMark();
    const row = e.target.closest('.ql-task:not(.ql-task-add)');
    const dayEl = e.target.closest('.ql-day[data-day]');
    const afloat = e.target.closest('.fp-afloat');
    // Target: the sub-objective under the pointer, or the unfiled box.
    const subEl = e.target.closest('.fp-sub[data-section]');
    const toSection = afloat ? null : (subEl ? subEl.dataset.section : dragTask.fromSection);
    const day = afloat ? null : (dayEl ? dayEl.dataset.day : null);
    // The IPC inserts BEFORE a given task id. Dropping below a row aims
    // at the task following the drop row (none → append at the end).
    let beforeTaskId = null;
    if (row && row.dataset.task !== dragTask.id) {
      if (!row.classList.contains('drop-below')) {
        beforeTaskId = row.dataset.task;
      } else {
        const bucket = toSection
          ? (p.sections.find(s => s.id === toSection)?.tasks || [])
          : (p.floatingTasks || []);
        const idx = bucket.findIndex(t => t.id === row.dataset.task);
        beforeTaskId = bucket[idx + 1]?.id || null;
      }
    }
    const moved = toSection !== dragTask.fromSection
      || (day && row?.dataset.task !== dragTask.id)
      || beforeTaskId !== null;
    const movedTask = dragTask;
    dragTask = null;
    if (!moved && !(day && dayEl)) return;
    try {
      await window.api.taskDrop({
        notebookId: p.id,
        fromSectionId: movedTask.fromSection,
        taskId: movedTask.id,
        toSectionId: toSection,
        day,
        beforeTaskId,
      });
      await refresh();
    } catch (err) {
      toast(`Couldn't move the task — ${err.message || err}`);
    }
  });

  // Big picture banner — the statement lives on the group when the
  // project is grouped (members share one), else on the project itself.
  const bpOwner = p.groupId ? findGroup(p.groupId) : p;
  const openBpModal = () => bigPictureModal(p, bpOwner);
  const openBpResolve = () => resolutionModal(p, bpOwner);
  mainEl.querySelector('#bq-edit')?.addEventListener('click', openBpModal);
  mainEl.querySelector('#bq-resolve')?.addEventListener('click', openBpResolve);
  // Same treatment as the other names: double-click the text to edit it.
  mainEl.querySelector('.ql-question-text')?.addEventListener('dblclick', openBpModal);
  mainEl.querySelector('.ql-res-text')?.addEventListener('dblclick', openBpResolve);
  mainEl.querySelector('#bq-history')?.addEventListener('click', () => {
    const hist = bpOwner?.bigPictureHistory || [];
    openModal({
      title: 'Past big pictures',
      body: hist.length ? `
        <div class="bq-history">
          ${hist.map(h => `<div class="bq-history-item"><span>${esc(h.text)}${h.resolution ? `<span class="bq-res">resolved: ${esc(h.resolution)}</span>` : ''}</span><span class="bq-until">until ${shortDate(h.until)}</span></div>`).join('')}
        </div>` : '<p class="bq-until">Nothing archived yet.</p>',
      actions: [{ label: 'Close', style: 'secondary' }],
    });
  });

  mainEl.querySelector('#fp-first-project')?.addEventListener('click', () => createProject());

  // Project head — names edit on double-click.
  mainEl.querySelector('.ql-project-name').addEventListener('dblclick', (e) => {
    inlineEditName(e.target, p.name, async (v) => {
      await window.api.renameNotebook(p.id, v);
      await refresh();
    });
  });
  // The fate select is gone from the header — status lives in the ⋯ menu.
  mainEl.querySelector('.ql-project-menu').onclick = (e) => projectMenu(e, p);

  // Aim tier.
  mainEl.querySelectorAll('.ql-objective[data-objective]:not([data-objective=""])').forEach(objEl => {
    const o = (p.objectives || []).find(x => x.id === objEl.dataset.objective);
    if (!o) return;
    objEl.querySelector('.ql-obj-name').addEventListener('dblclick', (e) => {
      inlineEditName(e.target, o.name, async (v) => {
        await window.api.saveObjective(p.id, { ...o, name: v });
        await refresh();
      });
    });
    objEl.querySelector('.ql-obj-menu').onclick = (e) => {
      contextMenu(e.clientX, e.clientY, [
        ...PRIORITIES.map(pr => ({
          label: `${(o.importance || 'normal') === pr ? '•' : '·'} importance: ${pr}`,
          onClick: async () => {
            await window.api.saveObjective(p.id, { ...o, importance: pr });
            await refresh();
          },
        })),
        '-',
        { label: o.status === 'scrapped' ? 'Reopen' : 'Scrapped…', onClick: () => scrapObjective(p, o) },
        { label: 'Delete', danger: true, onClick: () => deleteObjective(p, o) },
      ]);
    };
    objEl.querySelector('.ql-sub-add').onclick = () => createSubObjective(p, o.id);
  });
  mainEl.querySelector('.ql-objective-add').onclick = () => createObjective(p);

  // Sub-objectives (delegated across General too).
  mainEl.querySelectorAll('.fp-sub').forEach(subEl => {
    const s = p.sections.find(x => x.id === subEl.dataset.section);
    if (!s) return;
    subEl.querySelector('.fp-sub-name').addEventListener('dblclick', (e) => {
      inlineEditName(e.target, s.name, async (v) => {
        await window.api.renameSection(s.id, v);
        await refresh();
      });
    });
    subEl.querySelector('.fp-sub-notes').onclick = async (e) => {
      e.stopPropagation();
      // Asking for a sub-objective's notes IS asking for the notes pane.
      await setFold('notes', false);
      setState({ currentSectionId: s.id, currentPageId: s.pages[0]?.id || null });
      window.__index.goto('projects');
    };
    subEl.querySelector('.fp-sub-menu').onclick = (e) => subMenu(e, p, s);

    // The quick-add input lives in today's row — a sub-objective with no
    // activity today has no today row, so it may not have rendered.
    const titleInput = subEl.querySelector('.ql-add-title');
    if (titleInput) {
      const addTask = async () => {
        const title = titleInput.value.trim();
        if (!title) return;
        // Written today — that's what t.day records; deadlines come later,
        // from the task's ⋯ menu.
        await window.api.saveTask(p.id, { ...newTask(title) }, s.id);
        await refresh();
      };
      titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
    }

    // Day rows: tick cycling, task menus, file chips, add-file buttons —
    // one delegated listener per sub-objective.
    subEl.querySelector('.ql-days').addEventListener('click', async (e) => {
      const fileBtn = e.target.closest('.ql-day-file');
      if (fileBtn?.dataset.att) {
        await window.api.openAttachment({ attachmentId: fileBtn.dataset.att });
        return;
      }
      const tick = e.target.closest('.ql-tick');
      if (tick) {
        const rowEl = tick.closest('.ql-task');
        const t = (s.tasks || []).find(x => x.id === rowEl.dataset.task);
        const next = CYCLE[(CYCLE.indexOf(t.status) + 1) % CYCLE.length] || 'todo';
        await window.api.saveTask(p.id, { ...t, status: next }, s.id);
        await refresh();
        return;
      }
      const menuBtn = e.target.closest('.ql-task-menu');
      if (menuBtn) {
        const rowEl = menuBtn.closest('.ql-task');
        const t = (s.tasks || []).find(x => x.id === rowEl.dataset.task);
        taskMenu(e, p, s, t);
      }
    });

    // Today's note box is gone — nothing autosaves here anymore.
  });

  // Drag a sub-objective by its header to reorder it. Live DOM moves, then
  // one reorderSections call persists the whole visible order. Drops are
  // same-container only — crossing into another aim would just snap back
  // on re-render, since ownership lives on the section, not the drag.
  let dragSecId = null;
  let dragParent = null;
  const subEls = [...mainEl.querySelectorAll('.fp-sub')];
  const clearDropMarks = () => subEls.forEach(el => el.classList.remove('drop-above', 'drop-below'));
  for (const subEl of subEls) {
    const head = subEl.querySelector('.fp-sub-head');
    head.draggable = true;
    head.addEventListener('dragstart', (e) => {
      dragSecId = subEl.dataset.section;
      dragParent = subEl.parentElement;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSecId);
      subEl.classList.add('is-dragging');
    });
    subEl.addEventListener('dragend', () => {
      dragSecId = null;
      dragParent = null;
      subEls.forEach(el => el.classList.remove('is-dragging'));
      clearDropMarks();
    });
    subEl.addEventListener('dragover', (e) => {
      if (!dragSecId || dragSecId === subEl.dataset.section) return;
      if (subEl.parentElement !== dragParent) return; // same aim only
      e.preventDefault(); // allow the drop
      const rect = subEl.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      clearDropMarks();
      subEl.classList.add(above ? 'drop-above' : 'drop-below');
    });
    subEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragSecId || dragSecId === subEl.dataset.section) return;
      const dragged = mainEl.querySelector(`.fp-sub[data-section="${dragSecId}"]`);
      clearDropMarks();
      if (!dragged || dragged.parentElement !== subEl.parentElement) return;
      const above = subEl.classList.contains('drop-above');
      subEl.parentElement.insertBefore(dragged, above ? subEl : subEl.nextSibling);
      const order = [...mainEl.querySelectorAll('.fp-sub')].map(el => el.dataset.section);
      dragSecId = null;
      await window.api.reorderSections(order);
      await refresh();
    });
  }

  // Floating (unfiled) tasks. The header toggles the box; only the open
  // box carries the add input and the task rows.
  const afloatEl = mainEl.querySelector('.fp-afloat');
  if (afloatEl) {
    const afloatHead = afloatEl.querySelector('#afloat-head');
    if (afloatHead) afloatHead.onclick = async (e) => {
      if (e.target.closest('.ql-task')) return; // rows handle their own clicks
      getState().settings = await window.api.setSetting('afloatOpen', !getState().settings.afloatOpen);
      window.__index.goto('projects');
    };
    const addInput = afloatEl.querySelector('.ql-add-title');
    if (addInput) addInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const title = addInput.value.trim();
      if (!title) return;
      await window.api.saveTask(p.id, { ...newTask(title) }, null);
      await refresh();
    });
    afloatEl.addEventListener('click', async (e) => {
      const tick = e.target.closest('.ql-tick');
      if (tick) {
        const rowEl = tick.closest('.ql-task');
        const t = (p.floatingTasks || []).find(x => x.id === rowEl.dataset.task);
        const next = CYCLE[(CYCLE.indexOf(t.status) + 1) % CYCLE.length] || 'todo';
        await window.api.saveTask(p.id, { ...t, status: next }, null);
        await refresh();
        return;
      }
      const menuBtn = e.target.closest('.ql-task-menu');
      if (menuBtn) {
        const rowEl = menuBtn.closest('.ql-task');
        const t = (p.floatingTasks || []).find(x => x.id === rowEl.dataset.task);
        taskMenu(e, p, null, t);
      }
    });
  }

  startDayPulse(mainEl);
}

// ---- Task editing ----

// A big box, not a one-line prompt: long titles read whole, and the box
// grows with the text instead of scrolling it out of sight.
// Big picture gets the same editing surface as the other names — a wide,
// growing textarea, not a one-line prompt (a statement can run long).
// Enter saves, Shift+Enter is a newline, Escape cancels. The statement
// lives on the group when the project is grouped; the IPC resolves that.
function bigPictureModal(p, bpOwner) {
  const current = bpOwner?.bigPicture?.text || '';
  const el = openModal({
    title: 'Big picture',
    body: `<textarea class="modal-input task-rename-box" rows="3" spellcheck="false" placeholder="What this journal is written under">${esc(current)}</textarea>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      {
        label: 'Set',
        onClick: (m) => {
          const v = m.querySelector('.task-rename-box').value.trim();
          if (v === current) return;
          window.api.setBigPicture(p.id, v).then(() => refresh());
        },
      },
    ],
  });
  const ta = el.querySelector('.task-rename-box');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  grow();
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.querySelector('.modal-actions .btn:last-child').click();
    }
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// The outcome of the question — the answer so far, not a verdict. Rewriting
// it re-dates it; clearing (empty text) lifts it off the question. Same
// surface as the statement it answers.
function resolutionModal(p, bpOwner) {
  const current = bpOwner?.bigPictureResolution?.text || '';
  const el = openModal({
    title: 'Resolution',
    body: `<textarea class="modal-input task-rename-box" rows="3" spellcheck="false" placeholder="The answer, so far">${esc(current)}</textarea>`,
    actions: [
      ...(current ? [{ label: 'Clear', style: 'secondary', onClick: () => { window.api.resolveBigPicture(p.id, '').then(() => refresh()); } }] : []),
      { label: 'Cancel', style: 'secondary' },
      {
        label: 'Resolve',
        onClick: (m) => {
          const v = m.querySelector('.task-rename-box').value.trim();
          if (v === current) return;
          window.api.resolveBigPicture(p.id, v).then(() => refresh());
        },
      },
    ],
  });
  const ta = el.querySelector('.task-rename-box');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  grow();
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.querySelector('.modal-actions .btn:last-child').click();
    }
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function renameTask(p, section, t) {
  const el = openModal({
    title: 'Rename task',
    body: `<textarea class="modal-input task-rename-box" rows="3" spellcheck="false">${esc(t.title)}</textarea>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      {
        label: 'Rename',
        onClick: (m) => {
          const v = m.querySelector('.task-rename-box').value.trim();
          if (!v || v === t.title) return;
          window.api.saveTask(p.id, { ...t, title: v }, section?.id || null).then(() => refresh());
        },
      },
    ],
  });
  const ta = el.querySelector('.task-rename-box');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  grow();
  ta.addEventListener('input', grow);
  // Enter saves, Shift+Enter is a newline, Escape cancels (the modal's own
  // Escape handler would also fire — but this closes first either way).
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.querySelector('.modal-actions .btn:last-child').click();
    }
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// Double-click a name to edit it in place — the span swaps for an input
// until Enter/blur commits or Escape backs out. The name is the span, so
// long titles clip with an ellipsis in the row and edit in full here.
function inlineEditName(spanEl, current, save) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `${spanEl.className} is-editing`;
  input.value = current;
  input.spellcheck = false;
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const finish = (commit) => {
    if (closed) return;
    closed = true;
    const v = input.value.trim();
    if (commit && v && v !== current) save(v); // the save's refresh re-renders the span
    else window.__index.goto(getState().view); // back out — restore the span
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function taskMenu(e, p, section, t) {
  const subObjectives = [
    { label: '·', header: 'File into:' },
    ...p.sections.map(s => ({
      label: `${s.id === section?.id ? '•' : '·'} ${s.name}`,
      onClick: async () => {
        await window.api.moveTask(p.id, t.id, s.id);
        await refresh();
      },
    })),
  ];
  contextMenu(e.clientX, e.clientY, [
    { label: 'Rename…', onClick: () => renameTask(p, section, t) },
    { label: OPEN_STATUSES.has(t.status) ? 'Scrapped…' : 'Reopen', onClick: () => scrapTask(p, section, t) },
    { label: t.dueDate ? 'Change deadline…' : 'Set deadline…', onClick: () => deadlineModal(p, section, t) },
    ...(t.dueDate ? [{ label: 'Clear deadline', onClick: async () => {
      await window.api.saveTask(p.id, { ...t, dueDate: null }, section?.id || null);
      await refresh();
    } }] : []),
    '-',
    ...PRIORITIES.map(pr => ({
      label: `${pr === t.priority ? '•' : ''} priority: ${pr}`,
      onClick: async () => {
        await window.api.saveTask(p.id, { ...t, priority: pr }, section?.id || null);
        await refresh();
      },
    })),
    '-',
    { label: 'Add tag…', onClick: () => addTagModal(p, section, t) },
    ...(t.tags || []).map(tag => ({
      label: `remove #${tag}`,
      onClick: async () => {
        await window.api.saveTask(p.id, { ...t, tags: (t.tags || []).filter(x => x !== tag) }, section?.id || null);
        await refresh();
      },
    })),
    '-',
    ...(section ? [] : subObjectives),
    { label: 'Delete', danger: true, onClick: async () => {
        await window.api.deleteTask(p.id, t.id);
        await refresh();
      } },
  ]);
}

function addTagModal(p, section, t) {
  promptModal({
    title: 'Tag this task', label: 'Tag (one word or a few)', confirmLabel: 'Add',
    onConfirm: async (raw) => {
      const tags = [...new Set([...(t.tags || []), ...raw.split(/[,\s]+/).map(s => s.replace(/^#/, '').trim().toLowerCase()).filter(Boolean)])];
      await window.api.saveTask(p.id, { ...t, tags }, section?.id || null);
      await refresh();
    },
  });
}

function subMenu(e, p, s) {
  contextMenu(e.clientX, e.clientY, [
    { label: 'New page here', onClick: async () => {
        const { pageMeta } = await window.api.createPage(s.id, 'Untitled');
        await window.__index.refreshTree();
        setState({ currentSectionId: s.id, currentPageId: pageMeta.id });
        window.__index.goto('projects');
      } },
    { label: 'Export Markdown…', onClick: () => exportSection(p, s) },
    { label: 'Delete sub-objective', danger: true, onClick: () => deleteSection(p, s) },
  ]);
}

async function exportSection(p, s) {
  // Pull the section fresh so the diary is current, not the last render.
  const tree = (await window.api.bootstrap()).notebooks;
  const nb = tree.notebooks.find(n => n.id === p.id);
  const sec = nb && nb.sections.find(x => x.id === s.id);
  if (!sec) return;
  const dest = await window.api.exportMarkdown(`${p.name} — ${s.name}`, sectionToMarkdown(nb, sec));
  if (dest) toast(`Markdown saved — ${dest.split('/').pop()}`);
}

// ---- Pane 3: Notes ----

function notesPane(p, state) {
  // The editor hosts a page of THIS project; anything else open (a Log day
  // file, a page of another project) falls back to the project's index.
  const meta = state.currentPageId ? findPageMeta(state.currentPageId) : null;
  if (meta && meta.notebook.id === p.id) {
    // No crumb here — the aim and sub-objective names already head the
    // middle pane; repeating them read like a second set of titles.
    return `
      <div class="fp-notes-inner">
        <div class="fp-notes-toolbar">
          <button class="link-btn" id="fp-notes-index">◂ all notes</button>
        </div>
        <div class="fp-notes-host" id="fp-notes-host"></div>
      </div>`;
  }
  return notesIndex(p);
}

function notesIndex(p) {
  const sectionsOf = (objectiveId) => p.sections.filter(s => s.objectiveId === objectiveId);
  const sectionList = (s) => `
    <div class="fp-notes-sec">
      <div class="fp-notes-sec-head" data-section="${s.id}">
        <span class="fp-notes-sec-name">${esc(s.name)}</span>
        <span class="fp-notes-sec-count">${s.pages.length} page${s.pages.length === 1 ? '' : 's'}</span>
      </div>
      ${s.pages.length ? s.pages.map(pg => `
        <button class="fp-notes-page ${pg.id === getState().currentPageId ? 'sel' : ''}" data-page="${pg.id}">
          <span class="tree-page-dot"></span>
          <span class="fp-notes-page-title">${esc(pg.title)}</span>
        </button>`).join('') : '<div class="fp-notes-empty">No pages yet.</div>'}
    </div>`;

  return `
    <div class="fp-notes-inner">
      <div class="fp-notes-toolbar">
        <span class="fp-notes-title">Notes — everything “${esc(p.name)}” writes</span>
        <button class="btn" id="fp-new-page">＋ New page</button>
      </div>
      <div class="fp-notes-index">
        ${(p.objectives || []).map(o => sectionsOf(o.id).length
          ? `<div class="fp-notes-aim">${sectionsOf(o.id).map(sectionList).join('')}</div>` : '').join('')}
        ${sectionsOf(null).length ? `<div class="fp-notes-aim">${sectionsOf(null).map(sectionList).join('')}</div>` : ''}
        ${!p.sections.length ? `<div class="empty" style="padding:32px 8px"><div class="empty-icon">▤</div>No notes yet — a new page creates the General sub-objective.</div>` : ''}
      </div>
    </div>`;
}

function wireNotes(mainEl, p) {
  const host = mainEl.querySelector('#fp-notes-host');
  if (host) {
    pageView.renderMain(host).then(() => {
      // CSP paints the backlinks strip inside the page view already; nothing
      // else to do here.
    });
    mainEl.querySelector('#fp-notes-index').onclick = () => {
      setState({ currentPageId: null });
      window.__index.goto('projects');
    };
    return;
  }
  mainEl.querySelector('#fp-new-page')?.addEventListener('click', () => newPage(p));
  mainEl.querySelectorAll('.fp-notes-page').forEach(btn => {
    btn.onclick = () => { setState({ currentPageId: btn.dataset.page }); window.__index.goto('projects'); };
    btn.oncontextmenu = (e) => { e.preventDefault(); pageMenu(e, p, btn.dataset.page); };
  });
  mainEl.querySelectorAll('.fp-notes-sec-head').forEach(head => {
    head.onclick = () => { setState({ currentSectionId: head.dataset.section }); window.__index.goto('projects'); };
  });
}

// The implicit General: a new page with no sub-objective selected creates
// the "General" section first.
async function newPage(p, sectionId) {
  let target = sectionId || getState().currentSectionId;
  if (!target) {
    const existing = p.sections.find(s => s.objectiveId === null && s.name === 'General');
    if (existing) {
      target = existing.id;
    } else {
      const { section } = await window.api.createSection(p.id, 'General', null);
      target = section.id;
    }
  }
  const { pageMeta } = await window.api.createPage(target, 'Untitled');
  await window.__index.refreshTree();
  setState({ currentSectionId: target, currentPageId: pageMeta.id });
  window.__index.goto('projects');
  setTimeout(() => {
    const titleInput = document.querySelector('.page-title-input');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
  }, 60);
}

// ---- Menus + flows ----

// Right-click a page in the notes index — deletion lives here, with a
// confirm, since pages have no other delete affordance yet.
function pageMenu(e, p, pageId) {
  const sec = p.sections.find(s => s.pages.some(pg => pg.id === pageId));
  const page = sec?.pages.find(pg => pg.id === pageId);
  if (!page) return;
  contextMenu(e.clientX, e.clientY, [
    { label: 'Delete', danger: true, onClick: () => deletePage(p, page) },
  ]);
}

function deletePage(p, page) {
  openModal({
    title: 'Delete page?', danger: true,
    body: `Deletes <b>${esc(page.title)}</b> and its file on disk. This cannot be undone.`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Delete', style: 'danger', onClick: async () => {
          await window.api.deletePage(page.id);
          const s = getState();
          if (s.currentPageId === page.id) setState({ currentPageId: null });
          await refresh();
        } },
    ],
  });
}

function projectMenu(e, p) {
  contextMenu(e.clientX, e.clientY, [
    { label: 'Rename…', onClick: () => renameProject(p) },
    { label: 'New aim…', onClick: () => createObjective(p) },
    '-',
    ...QUEST_STATUSES.map(s => ({
      label: `${p.status === s ? '•' : ''} ${QUEST_STATUS_LABELS[s]}`,
      onClick: async () => {
        if (s === 'scrapped') { scrapProject(p); return; }
        await window.api.saveHunt(p.id, { status: s });
        await refresh();
      },
    })),
    '-',
    { label: p.groupId ? 'Move to group…' : 'Put in a group…', onClick: () => chooseGroup(p) },
    ...(p.groupId ? [{ label: 'Remove from group', onClick: async () => {
      await window.api.saveHunt(p.id, { groupId: null });
      await refresh();
    } }] : []),
    '-',
    { label: 'Recolor…', onClick: () => recolor(p) },
    {
      label: p.shelved ? 'Unshelve' : 'Shelve',
      title: p.shelved ? 'Put it back with the active projects' : 'Park it on the shelf — quiet on the map, out of the counts and the briefing',
      onClick: async () => {
        await window.api.saveHunt(p.id, { shelved: !p.shelved });
        await refresh();
      },
    },
    { label: 'Export Markdown…', onClick: () => exportProject(p) },
    { label: p.status === 'scrapped' ? 'Reopen' : 'Scrapped…', onClick: () => scrapProject(p) },
    '-',
    { label: 'Delete', danger: true, onClick: () => deleteProject(p) },
  ]);
}

async function exportProject(p) {
  const tree = (await window.api.bootstrap()).notebooks;
  const nb = tree.notebooks.find(n => n.id === p.id);
  if (!nb) return;
  const dest = await window.api.exportMarkdown(p.name, projectToMarkdown(nb));
  if (dest) toast(`Markdown saved — ${dest.split('/').pop()}`);
}

function groupMenu(e, g) {
  contextMenu(e.clientX, e.clientY, [
    { label: 'Rename…', onClick: () => renameGroup(g) },
    { label: 'Recolor…', onClick: () => recolorGroup(g) },
    '-',
    { label: 'New project here…', onClick: () => createProject(g.id) },
    { label: 'New nested group…', onClick: () => createGroup(g.id) },
    '-',
    { label: 'Delete group', danger: true, onClick: () => deleteGroup(g) },
  ]);
}

function chooseGroup(p) {
  const groups = allGroups();
  openModal({
    title: `Group “${esc(p.name)}”`,
    body: `
      <label class="field"><span>Member projects render in the group's colour and sit together.</span>
      <select class="modal-input grp-select">
        <option value="">— no group</option>
        ${groups.map(g => `<option value="${g.id}" ${p.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select></label>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Set', onClick: async (m) => {
          await window.api.saveHunt(p.id, { groupId: m.querySelector('.grp-select').value || null });
          await refresh();
        } },
    ],
  });
}

function recolor(p) {
  const el = openModal({
    title: `Colour for “${esc(p.name)}”`,
    body: `<div class="color-row">${PROJECT_COLORS.map(c =>
      `<button class="color-swatch" data-c="${c}" style="background:${c}"></button>`).join('')}</div>`,
    actions: [{ label: 'Cancel', style: 'secondary' }],
  });
  el.querySelectorAll('.color-swatch').forEach(btn => {
    btn.onclick = async () => {
      await window.api.saveHunt(p.id, { color: btn.dataset.c });
      closeModal();
      await refresh();
    };
  });
}

function recolorGroup(g) {
  const el = openModal({
    title: `Colour for group “${esc(g.name)}”`,
    body: `<div class="color-row">${PROJECT_COLORS.map(c =>
      `<button class="color-swatch" data-c="${c}" style="background:${c}"></button>`).join('')}</div>`,
    actions: [{ label: 'Cancel', style: 'secondary' }],
  });
  el.querySelectorAll('.color-swatch').forEach(btn => {
    btn.onclick = async () => {
      await window.api.saveGroup({ ...g, color: btn.dataset.c });
      closeModal();
      await refresh();
    };
  });
}

async function createProject(groupId = null) {
  promptModal({
    title: 'New project', label: 'Project name', value: 'New project', confirmLabel: 'Create',
    onConfirm: async (name) => {
      const p = newProject(name);
      if (groupId) p.groupId = groupId;
      const { notebook } = await window.api.createNotebook(p.name, currentUniverseId());
      // createNotebook makes a bare notebook; the hunt fields ride separately.
      await window.api.saveHunt(notebook.id, { color: p.color, groupId });
      await window.__index.refreshTree();
      setState({ currentProjectId: notebook.id, currentPageId: null, currentSectionId: null });
      window.__index.goto('projects');
    },
  });
}

function renameProject(p) {
  promptModal({
    title: 'Rename project', label: 'Name', value: p.name, confirmLabel: 'Rename',
    onConfirm: async (n) => { await window.api.renameNotebook(p.id, n); await refresh(); },
  });
}

function renameGroup(g) {
  promptModal({
    title: 'Rename group', label: 'Name', value: g.name, confirmLabel: 'Rename',
    onConfirm: async (n) => { await window.api.saveGroup({ ...g, name: n }); await refresh(); },
  });
}

async function createGroup(parentId = null) {
  promptModal({
    title: parentId ? 'New nested group' : 'New project group', label: 'Group name', value: '', confirmLabel: 'Create',
    onConfirm: async (name) => {
      const g = newGroup(name);
      if (parentId) g.parentId = parentId;
      g.universeId = currentUniverseId();
      await window.api.saveGroup(g);
      await window.__index.refreshTree();
      window.__index.goto('projects');
    },
  });
}

function deleteGroup(g) {
  const members = allProjects().filter(p => p.groupId === g.id).length;
  const nested = allGroups().filter(x => x.parentId === g.id).length;
  openModal({
    title: 'Delete group?', danger: true,
    body: `Deletes the group <b>${esc(g.name)}</b>${members ? ` and unparents its ${members} project${members === 1 ? '' : 's'}` : ''}${nested ? ` and ${nested} nested group${nested === 1 ? '' : 's'}` : ''}. No project or page is deleted.`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Delete', style: 'danger', onClick: async () => {
          await window.api.deleteGroup(g.id);
          await refresh();
        } },
    ],
  });
}

// Group fold state (open/closed in the sidebar) — session-only.
const foldedGroups = new Set();
function cycleGroupFold(id) {
  if (foldedGroups.has(id)) foldedGroups.delete(id); else foldedGroups.add(id);
  window.__index.goto('projects');
}

// Scrap flows: one shared modal, reason optional. Scrapping keeps the entry
// visible — struck through, with the reason on record.
function scrapModal({ title, onConfirm }) {
  const el = openModal({
    title,
    body: `<label class="field"><span>Reason (kept on record, optional)</span><input type="text" class="modal-input"></label>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Scrap', style: 'danger', onClick: (m) => onConfirm(m.querySelector('.modal-input').value.trim()) },
    ],
  });
  el.querySelector('.modal-input').focus();
}

function scrapTask(p, section, t) {
  if (!OPEN_STATUSES.has(t.status)) {
    window.api.saveTask(p.id, { ...t, status: 'todo', scrappedReason: '' }, section?.id || null).then(refresh);
    return;
  }
  scrapModal({
    title: `Scrap “${t.title}”?`,
    onConfirm: async (reason) => {
      await window.api.saveTask(p.id, { ...t, status: 'scrapped', scrappedReason: reason }, section?.id || null);
      await refresh();
    },
  });
}

function deadlineModal(p, section, t) {
  const el = openModal({
    title: `Deadline for “${esc(t.title)}”`,
    body: `<label class="field"><span>Due date — overdue tasks surface as loose ends</span>
      <input type="date" class="modal-input dl-input" value="${t.dueDate || ''}"></label>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Set', onClick: async (m) => {
          await window.api.saveTask(p.id, { ...t, dueDate: m.querySelector('.dl-input').value || null }, section?.id || null);
          await refresh();
        } },
    ],
  });
  el.querySelector('.dl-input').focus();
}

function scrapObjective(p, o) {
  if (o.status === 'scrapped') {
    window.api.saveObjective(p.id, { ...o, status: 'active', scrappedReason: null }).then(refresh);
    return;
  }
  scrapModal({
    title: `Scrap aim “${o.name}”?`,
    onConfirm: async (reason) => {
      await window.api.saveObjective(p.id, { ...o, status: 'scrapped', scrappedReason: reason });
      await refresh();
    },
  });
}

function scrapProject(p) {
  if (p.status === 'scrapped') {
    window.api.saveHunt(p.id, { status: 'active', scrappedReason: null }).then(refresh);
    return;
  }
  scrapModal({
    title: `Scrap “${p.name}”?`,
    onConfirm: async (reason) => {
      await window.api.saveHunt(p.id, { status: 'scrapped', scrappedReason: reason });
      await refresh();
    },
  });
}

function deleteProject(p) {
  openModal({
    title: 'Delete project?', danger: true,
    body: `Deletes <b>${esc(p.name)}</b> — its aims, tasks, pages and files on disk. This cannot be undone.`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Delete', style: 'danger', onClick: async () => {
          await window.api.deleteNotebook(p.id);
          const s = getState();
          setState({
            currentProjectId: s.currentProjectId === p.id ? null : s.currentProjectId,
            currentPageId: (s.currentPageId && p.sections.some(sec => sec.pages.some(pg => pg.id === s.currentPageId))) ? null : s.currentPageId,
          });
          await refresh();
        } },
    ],
  });
}

function deleteObjective(p, o) {
  const sections = p.sections.filter(s => s.objectiveId === o.id);
  const n = sections.reduce((n, s) => n + (s.tasks || []).length, 0);
  openModal({
    title: 'Delete aim?', danger: true,
    body: n
      ? `Deletes “${esc(o.name)}”. Its ${sections.length} sub-objective${sections.length === 1 ? '' : 's'} drop${sections.length === 1 ? 's' : ''} to project level (General), tasks and notes intact.`
      : `Deletes the empty aim “${esc(o.name)}”.`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Delete', style: 'danger', onClick: async () => {
          await window.api.deleteObjective(p.id, o.id);
          await refresh();
        } },
    ],
  });
}

function deleteSection(p, s) {
  const n = (s.tasks || []).length;
  openModal({
    title: 'Delete sub-objective?', danger: true,
    body: `Deletes <b>${esc(s.name)}</b> — its ${s.pages.length} page${s.pages.length === 1 ? '' : 's'}${n ? ` and ${n} task${n === 1 ? '' : 's'}` : ''} with it. This cannot be undone.`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Delete', style: 'danger', onClick: async () => {
          await window.api.deleteSection(s.id);
          const st = getState();
          if (st.currentSectionId === s.id) setState({ currentSectionId: null, currentPageId: null });
          await refresh();
        } },
    ],
  });
}

async function createObjective(p) {
  promptModal({
    title: 'New aim', label: 'Aim', value: '', confirmLabel: 'Add',
    onConfirm: async (name) => {
      const o = newObjective(name);
      await window.api.saveObjective(p.id, o);
      // An aim starts with its first sub-objective ready — named as an
      // invitation to write a real one, not a copy of the aim.
      await window.api.createSection(p.id, 'Write a tangible sub-objective for today here', o.id);
      await window.__index.refreshTree();
      window.__index.goto('projects');
    },
  });
}

async function createSubObjective(p, objectiveId) {
  promptModal({
    title: 'New sub-objective', label: 'Sub-objective', value: '', confirmLabel: 'Add',
    onConfirm: async (name) => {
      await window.api.createSection(p.id, name, objectiveId);
      await window.__index.refreshTree();
      window.__index.goto('projects');
    },
  });
}