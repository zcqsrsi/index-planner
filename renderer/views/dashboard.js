// Dashboard: the start page — the map room. Date and status counts in a
// hideable overview bar (settings.overviewHidden, for a wider view), the
// projects ring, the thread briefing, the Upcoming inbox, recent changes
// feed, recently edited notes, quick-add.

import { getState, allProjects, allTasks, setState } from '../store.js';
import { esc, shortDate, isOverdue, isToday, relativeTime, dayLabel, openModal, closeModal, toast, ageDays } from '../ui/components.js';
import { iterTasks, progressOf, makeId } from '../quest/model.js';
import { buildBriefing } from '../quest/briefing.js';
import { folds, wireFold } from './projects.js';
import { todayStr } from '../ui/components.js';

// Fate of a project, for the ring: its open threads' worst condition wins.
function projectFate(p, staleDays) {
  const open = iterTasks(p).map(x => x.task)
    .filter(t => t.status !== 'done' && t.status !== 'scrapped');
  const overdue = open.filter(t => isOverdue(t.dueDate));
  const stale = open.filter(t => !t.dueDate && ageDays(t.createdAt) >= staleDays);
  if (overdue.length) return { fate: 'overdue', open, loose: overdue, stale };
  if (stale.length) return { fate: 'stale', open, loose: [], stale };
  return { fate: 'healthy', open, loose: [], stale: [] };
}

const ACTIVITY_ICONS = {
  'page.save': '✎', 'page.create': '＋', 'page.delete': '🗑', 'page.rename': '✎', 'page.restore': '⏱', 'page.move': '→',
  'notebook.create': '❖', 'notebook.rename': '❖', 'notebook.delete': '🗑',
  'section.create': '▤', 'section.rename': '▤', 'section.delete': '🗑',
  'hunt.save': '❖', 'project.status': '❖',
  'objective.create': '◇', 'objective.save': '◇', 'objective.delete': '🗑',
  'group.create': '◫', 'group.save': '◫', 'group.delete': '🗑',
  'task.add': '＋', 'task.status': '☑', 'app.seed': '◎', 'app.migrate': '⏱', 'app.merge': '❖', 'question.set': '?', 'bigpicture.set': '◇',
  'inbox.capture': '⎍',
};

// Bare-number chips: calm → warm → hot as the count climbs. Mixed from
// theme tokens so every theme (light + dark) reads correctly.
// One banding for every bare number — chips and the ring's center alike.
function bandFor(n) {
  if (n >= 13) return 'hot';
  if (n >= 6) return 'warm';
  return 'calm';
}
function chipClass(n) { return `chip-${bandFor(n)}`; }

export function renderPanel(panelEl) {
  // The left panel folds like the Projects sidebar — same paneFold.projects
  // key, so the fold follows you between views and can always be undone here.
  if (folds().projects) {
    panelEl.classList.add('folded');
    panelEl.innerHTML = `
      <div class="panel-fold-strip">
        <span class="panel-fold-label">Overview</span>
        <button class="icon-btn fold-unfold" data-fold="projects" title="Unfold">»</button>
      </div>`;
    wireFold(panelEl);
    return;
  }
  panelEl.classList.remove('folded');
  panelEl.innerHTML = `
    <div class="panel-header">
      <span>Overview</span>
      <button class="pane-fold-btn" data-fold="projects" title="Fold pane">«</button>
    </div>
    <div class="panel-body">
      <div class="dash-tip">
        <b>Tip</b><br>
        <kbd>⌘K</kbd> quick-add task<br>
        <kbd>⌘P</kbd> quick-open page<br>
        <kbd>⌘N</kbd> new page<br>
        <kbd>⌘D</kbd> today's file<br>
        <kbd>⌘J</kbd> capture a thought
      </div>
    </div>`;
  wireFold(panelEl);
}

export function renderMain(mainEl) {
  const state = getState();
  // Shelved projects live on the shelf in the sidebar — out of the counts,
  // the briefing, and the Upcoming inbox. The ring keeps them, plates quiet.
  const projects = allProjects().filter(p => p.status !== 'archived' && !p.shelved);
  const activeProjects = projects.filter(p => p.status === 'active');
  const ringProjects = activeProjects.concat(
    allProjects().filter(p => p.status !== 'archived' && p.shelved));
  const tasks = allTasks().filter(({ task, project }) =>
    !project.shelved && task.status !== 'done' && task.status !== 'scrapped');

  const today = new Date();
  const dueToday = tasks.filter(({ task }) => isToday(task.dueDate));
  const overdue = tasks.filter(({ task }) => isOverdue(task.dueDate));
  // The Upcoming inbox: approaching due dates + floating threads.
  const upcoming = tasks
    .filter(({ task }) => task.dueDate && !isToday(task.dueDate) && !isOverdue(task.dueDate))
    .sort((a, b) => a.task.dueDate < b.task.dueDate ? -1 : 1)
    .slice(0, 8);
  const floating = tasks.filter(({ section }) => !section);

  // Recently edited pages, from the tree metadata.
  const recentPages = [];
  for (const nb of state.notebooks.notebooks) {
    for (const sec of nb.sections) {
      for (const p of sec.pages) {
        recentPages.push({ page: p, notebook: nb, section: sec });
      }
    }
  }
  recentPages.sort((a, b) => b.page.updatedAt - a.page.updatedAt);
  const topPages = recentPages.slice(0, 7);

  const grouped = groupActivityByDay(state.activity.slice(0, 30));

  const briefing = buildBriefing(projects, state.settings);
  const layout = state.settings.dashboardLayout === 'ring' ? 'ring' : 'list';

  mainEl.innerHTML = `
    <div class="dashboard">
      ${state.settings.overviewHidden ? '' : `
      <div class="dash-hero">
        <div class="dash-date">
          <span class="dash-date-big">${today.toLocaleDateString(undefined, { weekday: 'long' })}</span>
          <span class="dash-date-sub">${today.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div class="dash-counts">
          ${overdue.length ? `<button class="dash-count chip-overdue" id="chip-overdue" title="${overdue.length} loose end${overdue.length === 1 ? '' : 's'}"><b>${overdue.length}</b></button>` : ''}
          ${dueToday.length ? `<button class="dash-count chip-today" id="chip-today" title="${dueToday.length} due today"><b>${dueToday.length}</b></button>` : ''}
          <button class="dash-count ${chipClass(tasks.length)}" id="chip-tasks" title="${tasks.length} open task${tasks.length === 1 ? '' : 's'}"><b>${tasks.length}</b></button>
          <button class="dash-count ${chipClass(activeProjects.length)}" id="chip-projects" title="${activeProjects.length} active project${activeProjects.length === 1 ? '' : 's'}"><b>${activeProjects.length}</b></button>
          <button class="dash-count chip-log" id="chip-log" title="Today's file"><svg class="chip-log-ico" viewBox="0 0 24 14" width="17" height="10" aria-hidden="true"><rect x="1.4" y="0.6" width="3" height="12.8" fill="currentColor"/><rect x="19.6" y="0.6" width="3" height="12.8" fill="currentColor"/><rect x="4.4" y="3.4" width="15.2" height="7.2" fill="none" stroke="currentColor" stroke-width="2.2"/></svg> today's file</button>
          <button class="btn" id="dash-quickadd">＋ Quick add <kbd style="margin-left:6px">⌘K</kbd></button>
        </div>
      </div>
      `}

      <div class="dash-section-head">
        <div class="ring-toggle" id="ring-toggle">
          <button data-layout="list" class="${layout === 'ring' ? '' : 'on'}">list</button>
          <button data-layout="ring" class="${layout === 'ring' ? 'on' : ''}">ring</button>
        </div>
        <button class="link-btn" id="overview-toggle" title="${state.settings.overviewHidden ? 'Show the overview bar' : 'Hide the overview bar for a wider view'}">${state.settings.overviewHidden ? '⌃ overview' : '⌄ overview'}</button>
      </div>
      ${layout === 'ring'
        ? renderRing(ringProjects, state.settings)
        : `
      <div class="dash-projects">
        ${activeProjects.length ? activeProjects.map(p => {
          const ptasks = iterTasks(p).map(x => x.task);
          const prog = progressOf(ptasks);
          const done = prog.done;
          const pct = prog.pct;
          const next = ptasks
            .filter(t => t.status !== 'done' && t.status !== 'scrapped')
            .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1)
            .slice(0, 3);
          return `
          <button class="project-card" data-project="${p.id}">
            <div class="pc-head">
              <span class="project-dot" style="background:${p.color || 'var(--accent)'}"></span>
              <span class="pc-name">${esc(p.name)}</span>
              ${p.dueDate ? `<span class="pc-due ${isOverdue(p.dueDate) ? 'pc-overdue' : ''}">${shortDate(p.dueDate)}</span>` : ''}
            </div>
            <div class="pc-progress"><span style="width:${pct}%; background:${p.color || 'var(--accent)'}"></span></div>
            <div class="pc-meta">${done}/${prog.total} done${prog.scrapped ? ` · ${prog.scrapped} scrapped` : ''}${pct ? ` · ${pct}%` : ''}</div>
            <div class="pc-next">
              ${next.map(t => `<div class="pc-task ${isOverdue(t.dueDate) ? 'pc-overdue-task' : ''}">☐ ${esc(t.title)}${t.dueDate ? ` <span class="pc-task-date">${shortDate(t.dueDate)}</span>` : ''}</div>`).join('') || '<div class="pc-task pc-none">No open tasks</div>'}
            </div>
          </button>`;
        }).join('') : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">✓</div>No active projects — create one in the Projects view.</div>`}
      </div>`}

      <div class="brief">
        ${briefing.staleCount ? `<button class="brief-stale-note" id="brief-sweep" title="Sweep the loose ends (⌘L)">${briefing.staleCount} thread${briefing.staleCount === 1 ? '' : 's'} going stale — sweep</button>` : ''}
        ${briefing.items.length ? `
          <div class="brief-list">
            ${briefing.items.map(({ task, section, project }) => {
              const stale = !task.dueDate && ageDays(task.createdAt) >= (state.settings.staleDays ?? 3);
              const days = ageDays(task.createdAt);
              return `
                <button class="brief-item ${stale ? 'is-stale' : ''} ${isOverdue(task.dueDate) ? 'is-overdue' : ''}" data-project="${project.id}" data-task="${task.id}">
                  <span class="brief-title">${esc(task.title)}</span>
                  <span class="brief-meta">${isOverdue(task.dueDate)
                    ? `loose end · was due ${shortDate(task.dueDate)}`
                    : isToday(task.dueDate) ? 'due today'
                    : section
                      ? `open ${days} day${days === 1 ? '' : 's'}, on ${esc(section.name)}`
                      : `open ${days} day${days === 1 ? '' : 's'}, afloat`}</span>
                  <span class="brief-project" style="color:${project.color || 'var(--accent)'}">${esc(project.name)}</span>
                </button>`;
            }).join('')}
          </div>
          ${briefing.remaining > 0 ? `<div class="brief-tail">…and ${briefing.remaining} younger thread${briefing.remaining === 1 ? '' : 's'}</div>` : ''}
        ` : `${briefing.openCount ? '' : '<div class="brief-tail">Nothing is adrift. The day is yours.</div>'}`}
      </div>

      ${(overdue.length || dueToday.length) ? `
      <div class="dash-strip">
        ${overdue.map(({ task, project }) => `
          <button class="dash-task chip-overdue" data-project="${project.id}">
            <span class="dt-title">${esc(task.title)}</span>
            <span class="dt-meta">${shortDate(task.dueDate)} · ${esc(project.name)}</span>
          </button>`).join('')}
        ${dueToday.map(({ task, project }) => `
          <button class="dash-task chip-today" data-project="${project.id}">
            <span class="dt-title">${esc(task.title)}</span>
            <span class="dt-meta">today · ${esc(project.name)}</span>
          </button>`).join('')}
      </div>` : ''}

      ${(upcoming.length || floating.length) ? `
      <div class="dash-upcoming">
        <div class="dash-section-title">Upcoming</div>
        <div class="upcoming-list">
          ${upcoming.map(({ task, project }) => `
            <button class="upcoming-item" data-project="${project.id}">
              <span class="up-date">${shortDate(task.dueDate)}</span>
              <span class="up-title">${esc(task.title)}</span>
              <span class="up-project" style="color:${project.color || 'var(--accent)'}">${esc(project.name)}</span>
            </button>`).join('')}
          ${floating.slice(0, 8).map(({ task, project }) => `
            <button class="upcoming-item is-afloat" data-project="${project.id}">
              <span class="up-date">≈</span>
              <span class="up-title">${esc(task.title)}</span>
              <span class="up-project" style="color:${project.color || 'var(--accent)'}">${esc(project.name)}</span>
            </button>`).join('')}
        </div>
      </div>` : ''}

      <div class="dash-onthisday" id="on-this-day"></div>

      <div class="dash-columns">
        <div class="dash-activity">
          <div class="dash-section-title">Recent changes</div>
          ${grouped.length ? grouped.map(([day, entries]) => `
            <div class="activity-day">${day}</div>
            ${entries.map(a => `
              <div class="activity-row" data-page="${a.entityId?.startsWith('pg_') ? a.entityId : ''}">
                <span class="act-icon">${ACTIVITY_ICONS[a.type] || '·'}</span>
                <span class="act-summary">${esc(a.summary)}</span>
                <span class="act-time">${relativeTime(a.ts)}</span>
              </div>`).join('')}
          `).join('') : '<div class="empty" style="padding:16px">Nothing yet — start writing.</div>'}
        </div>
        <div class="dash-recent-pages">
          <div class="dash-section-title">Recent notes</div>
          ${topPages.length ? topPages.map(({ page, notebook, section }) => `
            <button class="recent-page" data-page="${page.id}">
              <span class="rp-title">${esc(page.title)}</span>
              <span class="rp-path">${esc(notebook.name)} / ${esc(section.name)} · ${relativeTime(page.updatedAt)}</span>
            </button>`).join('') : '<div class="empty" style="padding:16px">No pages yet.</div>'}
        </div>
      </div>
    </div>`;

  // ---- wiring ----
  // CSP blocks inline style attributes; paint the legend dots via CSSOM.
  mainEl.querySelectorAll('.ring-dot').forEach(dot => {
    dot.style.setProperty('background', dot.dataset.color);
  });
  mainEl.querySelectorAll('#ring-toggle button').forEach(btn => {
    btn.onclick = async () => {
      getState().settings = await window.api.setSetting('dashboardLayout', btn.dataset.layout);
      window.__index.goto('dashboard');
    };
  });
  mainEl.querySelector('#overview-toggle').onclick = async () => {
    getState().settings = await window.api.setSetting('overviewHidden', !getState().settings.overviewHidden);
    window.__index.goto('dashboard');
  };
  mainEl.querySelectorAll('.ring-plate-g, .ring-tick, .ring-legend-item').forEach(el => {
    el.onclick = () => {
      setState({ currentProjectId: el.dataset.project, focusTaskId: el.dataset.task || undefined });
      window.__index.goto('projects');
    };
  });
  // Hovering a plate borrows the ring's center to name its project + thread.
  // The number re-bands to that project's count; leaving restores the total.
  // The plate also lifts — slides a little outward along its own mid-angle
  // and thickens — unless Settings → Ring hover lift is off.
  const centerNum = mainEl.querySelector('.ring-center-num');
  const centerLabel = mainEl.querySelector('.ring-center-label');
  const liftOn = getState().settings.ringHoverLift !== false;
  const LIFT_PX = RING.LIFT_PX;
  // The centre number can be switched off (Settings → Projects); the label
  // alone still carries the hover naming, re-banding only if the number's
  // there to band.
  if (centerLabel) {
    const totalOpen = Number(centerNum?.textContent) || 0;
    mainEl.querySelectorAll('.ring-plate-g').forEach(el => {
      const vis = el.querySelector('.ring-plate');
      el.addEventListener('mouseenter', () => {
        const n = Number(el.dataset.open) || 0;
        if (centerNum) {
          centerNum.textContent = n;
          centerNum.setAttribute('class', `ring-center-num ring-${bandFor(n)}`);
        }
        centerLabel.textContent = `${el.dataset.name}${Number(el.dataset.loose) ? ` · ${el.dataset.loose} loose` : ''}`;
        if (liftOn) {
          vis.style.setProperty('transform', `translate(${el.dataset.mx * LIFT_PX}px, ${el.dataset.my * LIFT_PX}px)`);
          vis.style.setProperty('stroke-width', Number(vis.getAttribute('stroke-width')) + 3);
        }
      });
      el.addEventListener('mouseleave', () => {
        if (centerNum) {
          centerNum.textContent = totalOpen;
          centerNum.setAttribute('class', `ring-center-num ring-${bandFor(totalOpen)}`);
        }
        centerLabel.textContent = '';
        if (liftOn) {
          vis.style.removeProperty('transform');
          vis.style.removeProperty('stroke-width');
        }
      });
    });
  }
  // The overview bar carries these controls; when it's folded away they're
  // simply absent, so wire only what rendered.
  const quickBtn = mainEl.querySelector('#dash-quickadd');
  if (quickBtn) quickBtn.onclick = quickAdd;
  mainEl.querySelectorAll('.dash-task, .project-card, .upcoming-item, #chip-overdue, #chip-today, #chip-projects')
    .forEach(el => {
      el.onclick = () => {
        if (el.dataset.project) { setState({ currentProjectId: el.dataset.project }); }
        window.__index.goto('projects');
      };
    });
  const chipTasks = mainEl.querySelector('#chip-tasks');
  if (chipTasks) chipTasks.onclick = () => window.__index.goto('projects');
  const chipLog = mainEl.querySelector('#chip-log');
  if (chipLog) chipLog.onclick = () => window.__index.goto('log');
  const briefSweep = mainEl.querySelector('#brief-sweep');
  if (briefSweep) briefSweep.onclick = () => sweepLooseEnds();
  fillOnThisDay(mainEl.querySelector('#on-this-day'));
  mainEl.querySelectorAll('.brief-item').forEach(el => {
    el.onclick = () => {
      setState({ currentProjectId: el.dataset.project, focusTaskId: el.dataset.task });
      window.__index.goto('projects');
    };
  });
  mainEl.querySelectorAll('.recent-page, .activity-row[data-page]')
    .forEach(el => {
      el.onclick = () => { if (el.dataset.page) window.__index.openPage(el.dataset.page); };
    });
}

// ---- The ring ----
// The dashboard as a control-room hologram: one ring segment per active
// project, its surface built of PLATES — one plate per open thread, so the
// ring is countable. A loose end's plate burns in the warning color with a
// radial tick; a project's finished work is a thin inner arc eating into
// its span.

const RING = {
  CX: 180, CY: 180, R: 140,
  GAP: 5,        // degrees between ring segments
  MIN_ARC: 8,    // an idle segment stays visible
  STROKE: 18,    // plate thickness
  PLATE_GAP: 3,  // degrees between plates
  MAX_PLATES: 24, // cap: beyond this the plates fuse into a band
  LIFT_PX: 6,    // hover: how far a plate detaches from the ring
};

function renderRing(ringProjects, settings) {
  const staleDays = settings.staleDays ?? 3;
  // Shelved projects ride the ring too, but quiet: dim plates, no fate
  // colors, no ticks, out of the center count.
  const fated = ringProjects.map(p => ({ p, ...projectFate(p, staleDays), shelved: !!p.shelved }));
  const totalOpen = fated.filter(f => !f.shelved).reduce((n, f) => n + f.open.length, 0);

  if (!ringProjects.length) {
    return `<div class="empty ring-empty"><div class="empty-icon">◯</div>No active projects — the ring is empty. Create one in the Projects view.</div>`;
  }

  const { CX, CY, R, GAP, MIN_ARC, STROKE, PLATE_GAP, MAX_PLATES } = RING;
  const usable = 360 - GAP * fated.length;

  // Segment spans: proportional to each project's open threads when ring
  // scaling is on (Settings → Projects), equal otherwise. Either way every
  // project keeps a visible sliver: the above-minimum arcs shrink by their
  // share of any overflow.
  // Shelved segments get weight 1 — a visible sliver that never dominates.
  const weightSum = fated.reduce((n, f) => n + (f.shelved ? 1 : f.open.length), 0) || 1;
  let spans = settings.ringScale !== false
    ? fated.map(f => ((f.shelved ? 1 : f.open.length) / weightSum) * usable)
    : fated.map(() => usable / fated.length);
  spans = spans.map(s => Math.max(s, MIN_ARC));
  const excess = spans.reduce((a, b) => a + b, 0) - usable;
  if (excess > 0) {
    const slack = spans.map(s => s - MIN_ARC);
    const slackSum = slack.reduce((a, b) => a + b, 0) || 1;
    spans = spans.map((s, i) => s - (slack[i] / slackSum) * excess);
  }

  const FATE_COLOR = { overdue: 'var(--keyword)', stale: 'var(--func)', healthy: 'var(--accent)' };

  // The ring stands alone: plates, glow, the bare center number. No
  // compass points, no calibration marks, no floor geometry — nothing
  // between the light and the dark.
  const dressing = '';

  let angle = -90; // start at 12 o'clock
  let plates = '';
  let ticks = '';
  fated.forEach((f, i) => {
    const start = angle + GAP / 2;
    const span = spans[i] - GAP;
    const end = start + span;
    angle += spans[i];
    const color = f.shelved ? 'var(--fg-dim)' : FATE_COLOR[f.fate];
    const looseIds = f.shelved ? new Set() : new Set(f.loose.map(t => t.id));

    // Segment plates: one per open thread (up to the cap), then a fused band.
    const n = Math.min(f.open.length, MAX_PLATES);
    if (n === 0) {
      // Alive but no open threads — a single dormant plate.
      plates += plate(start, end, color, f.shelved ? 0.3 : 0.35, f, null);
    } else {
      const pg = Math.min(PLATE_GAP, span / (n * 4));
      const pw = (span - pg * (n - 1)) / n;
      f.open.slice(0, n).forEach((t, j) => {
        const s0 = start + j * (pw + pg);
        const loose = looseIds.has(t.id);
        plates += plate(s0, s0 + pw, loose ? 'var(--keyword)' : color,
          f.shelved ? 0.3 : (loose ? 1 : (f.fate === 'healthy' ? 0.75 : 0.9)), f, t, loose);
      });
    }

    // Done work: a thin inner arc eating into the project's span.
    // Shelved segments stay bare — quiet means quiet.
    const prog = progressOf(iterTasks(f.p).map(x => x.task));
    if (!f.shelved && prog.total > 0 && prog.done > 0) {
      const frac = prog.done / prog.total;
      plates += `
      <path class="ring-done" d="${arcPath(CX, CY, R - STROKE / 2 - 6, start, start + span * frac)}"
            fill="none" stroke="var(--fg-dim)" stroke-opacity="0.45" stroke-width="2.5">
        <title>${esc(f.p.name)} — ${prog.done}/${prog.total} resolved</title>
      </path>`;
    }

    // Loose-end ticks, riding their plates — never on a shelved segment.
    if (!f.shelved) f.loose.forEach((t, j) => {
      const a = f.loose.length === 1 ? (start + end) / 2
        : start + (span * (j + 0.5)) / f.loose.length;
      const c = Math.cos(rad(a)), s = Math.sin(rad(a));
      ticks += `
      <line class="ring-tick" data-project="${f.p.id}" data-task="${t.id}"
            x1="${CX + c * (R - STROKE / 2 - 4)}" y1="${CY + s * (R - STROKE / 2 - 4)}"
            x2="${CX + c * (R + STROKE / 2 + 4)}" y2="${CY + s * (R + STROKE / 2 + 4)}"
            stroke="var(--keyword)" stroke-width="2.5">
        <title>${esc(t.title)}${t.dueDate ? ` — was due ${esc(shortDate(t.dueDate))}` : ''}</title>
      </line>`;
    });
  });

  // plate: one hoverable segment; title carries the thread when there is one.
  function plate(a0, a1, color, opacity, f, task, isLoose) {
    const label = task
      ? `${esc(f.p.name)} — ${esc(task.title)}`
      : `${esc(f.p.name)} — dormant`;
    // Outward unit vector at the plate's mid-angle — the hover lift
    // translates the plate along it (set through CSSOM; CSP forbids
    // inline style attributes).
    const mid = rad((a0 + a1) / 2);
    const d = arcPath(CX, CY, R, a0, a1);
    // The hover target is an invisible STATIC hit path sitting a little
    // wider than the plate; the visible plate transforms inside it. If
    // hover bound to the plate itself, the lift at the plate's edge would
    // slide it out from under the cursor — leave, restore, enter — and
    // the plate would flicker between sizes.
    return `
      <g class="ring-plate-g" data-project="${f.p.id}" data-open="${f.open.length}"
         data-name="${esc(f.p.name)}" data-loose="${f.loose.length}"
         data-mx="${Math.cos(mid).toFixed(3)}" data-my="${Math.sin(mid).toFixed(3)}">
        <path class="ring-plate-hit" d="${d}" fill="none" stroke="transparent"
              stroke-width="${STROKE + 10}" pointer-events="stroke"></path>
        <path class="ring-plate" ${isLoose ? `data-task="${task.id}"` : ''}
              d="${d}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${STROKE}"></path>
        <title>${label}</title>
      </g>`;
  }

  const legend = fated.map(f => `
    <button class="ring-legend-item" data-project="${f.p.id}">
      <span class="ring-dot" data-color="${f.shelved ? 'var(--fg-dim)' : FATE_COLOR[f.fate]}"></span>
      <span class="ring-name">${esc(f.p.name)}</span>
      <span class="ring-meta">${f.shelved ? 'on the shelf' : `${f.open.length} open${f.loose.length ? ` · ${f.loose.length} loose` : ''}`}</span>
    </button>`).join('');

  return `
    <div class="ring-wrap">
      <div class="ring-stage">
        <svg class="ring" viewBox="0 0 360 360" role="img" aria-label="Projects ring">
          ${dressing}
          <g class="ring-rotor">${plates}${ticks}</g>
          ${getState().settings.ringCount !== false
            ? `<text class="ring-center-num ring-${bandFor(totalOpen)}" x="${CX}" y="${CY}" text-anchor="middle">${totalOpen}</text>`
            : ''}
          <text class="ring-center-label" x="${CX}" y="${CY + 34}" text-anchor="middle"></text>
        </svg>
      </div>
      <div class="ring-legend">${legend}</div>
    </div>`;
}

const rad = (deg) => (deg * Math.PI) / 180;

// Stroke-arc path from startDeg to endDeg (0° = 3 o'clock, angles clockwise).
function arcPath(cx, cy, r, startDeg, endDeg) {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const x1 = cx + Math.cos(rad(startDeg)) * r, y1 = cy + Math.sin(rad(startDeg)) * r;
  const x2 = cx + Math.cos(rad(endDeg)) * r, y2 = cy + Math.sin(rad(endDeg)) * r;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// ---- On this day: same date, earlier years, from the activity log ----

const OTD_ICONS = ACTIVITY_ICONS;

async function fillOnThisDay(el) {
  if (!el) return;
  const years = await window.api.onThisDay();
  if (!years.length) return; // first year — nothing to look back on yet
  if (!el.isConnected) return;
  el.innerHTML = `
    <div class="dash-section-title">On this day</div>
    <div class="otd-grid">
      ${years.map(({ year, entries }) => `
        <div class="otd-year">
          <span class="otd-year-label">${year}</span>
          ${entries.slice(0, 3).map(a => `
            <div class="activity-row" data-page="${a.entityId?.startsWith('pg_') ? a.entityId : ''}">
              <span class="act-icon">${OTD_ICONS[a.type] || '·'}</span>
              <span class="act-summary">${esc(a.summary)}</span>
              <span class="act-time">${new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>`).join('')}
          ${entries.length > 3 ? `<div class="otd-more">…and ${entries.length - 3} more</div>` : ''}
        </div>`).join('')}
    </div>`;
  el.querySelectorAll('.activity-row[data-page]').forEach(row => {
    row.onclick = () => { if (row.dataset.page) window.__index.openPage(row.dataset.page); };
  });
}

function groupActivityByDay(entries) {
  const groups = [];
  let currentDay = null;
  let bucket = null;
  for (const a of entries) {
    const day = dayLabel(a.ts);
    if (day !== currentDay) {
      bucket = [];
      groups.push([day, bucket]);
      currentDay = day;
    }
    bucket.push(a);
  }
  return groups;
}

// ---- Quick add (Cmd+K) ----

// The loose-end sweep: one dialog for every stale thread — a task with no
// deadline, open longer than staleDays. Give each a date, file it into a
// sub-objective, scrap it, or keep it adrift; ⌘L from anywhere.
export function sweepLooseEnds() {
  const state = getState();
  const stale = state.settings.staleDays ?? 3;
  const items = allTasks().filter(({ task, project }) =>
    project.status !== 'archived'
    && !project.shelved
    && task.status !== 'done' && task.status !== 'scrapped'
    && !task.dueDate
    && ageDays(task.createdAt) >= stale);
  if (!items.length) {
    toast('No stale loose ends — nothing to sweep');
    return;
  }
  const el = openModal({
    title: `Loose-end sweep — ${items.length} stale thread${items.length === 1 ? '' : 's'}`,
    body: `
      <p class="settings-sub" style="margin-bottom:8px">Open ${stale}+ days with no deadline. Give each a date, file it, scrap it — or keep it adrift.</p>
      <div class="sweep-list">
        ${items.map(({ task, section, project }) => `
        <div class="sweep-row" data-task="${task.id}" data-project="${project.id}" data-section="${section ? section.id : ''}">
          <div class="sweep-title">${esc(task.title)}</div>
          <div class="sweep-meta">${esc(project.name)}${section ? ` · ${esc(section.name)}` : ' · unfiled'} · ${ageDays(task.createdAt)} days open</div>
          <div class="sweep-actions">
            <input type="date" class="sweep-due" value="${todayStr()}">
            <button class="btn secondary sweep-due-btn">Due</button>
            ${(project.sections || []).length ? `
              <select class="sweep-file">${project.sections.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
              <button class="btn secondary sweep-file-btn">File</button>` : ''}
            <button class="btn danger sweep-scrap-btn">Scrap</button>
            <button class="btn secondary sweep-keep-btn">Keep</button>
          </div>
        </div>`).join('')}
      </div>`,
    actions: [{ label: 'Done' }],
  });
  const resolveRow = (row) => {
    row.remove();
    const list = el.querySelector('.sweep-list');
    if (list && !list.children.length) list.innerHTML = '<div class="settings-sub">All swept — nothing left adrift.</div>';
  };
  el.querySelectorAll('.sweep-row').forEach(row => {
    const project = allProjects().find(x => x.id === row.dataset.project);
    const fileSel = row.querySelector('.sweep-file');
    // Due and Scrap keep the task where it is — only File uses the dropdown.
    const ownSectionId = () => row.dataset.section || null;
    const findTask = () => project && iterTasks(project).map(x => x.task).find(t => t.id === row.dataset.task);
    row.querySelector('.sweep-due-btn').onclick = async () => {
      const t = findTask();
      const due = row.querySelector('.sweep-due').value;
      if (!t || !due) return;
      await window.api.saveTask(project.id, { ...t, dueDate: due }, ownSectionId());
      await refreshTreeQuiet();
      resolveRow(row);
    };
    const fileBtn = row.querySelector('.sweep-file-btn');
    if (fileBtn) fileBtn.onclick = async () => {
      const t = findTask();
      const section = project?.sections.find(s => s.id === fileSel?.value);
      if (!t || !section) return;
      await window.api.moveTask(project.id, t.id, section.id);
      await refreshTreeQuiet();
      resolveRow(row);
    };
    row.querySelector('.sweep-scrap-btn').onclick = async () => {
      const t = findTask();
      if (!t) return;
      await window.api.saveTask(project.id, { ...t, status: 'scrapped' }, ownSectionId());
      await refreshTreeQuiet();
      resolveRow(row);
    };
    row.querySelector('.sweep-keep-btn').onclick = () => resolveRow(row);
  });
}

// Sweep actions change the tree; repaint quietly (stay in the current view).
async function refreshTreeQuiet() {
  await window.__index.refreshTree();
  window.__index.goto(getState().view);
}

export function quickAdd() {
  const projects = allProjects().filter(p => p.status !== 'archived' && !p.shelved);
  if (!projects.length) {
    toast('Create a project first (Projects view, ＋)');
    return;
  }
  const sectionsOf = (projectId) => {
    const p = projects.find(x => x.id === projectId);
    return (p && p.sections) || [];
  };
  const el = openModal({
    title: 'Quick add task',
    body: `
      <input type="text" class="qa-title" placeholder="Task title…" style="width:100%; margin-bottom:8px">
      <div class="qa-row">
        <select class="qa-project">
          ${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <select class="qa-section"></select>
        <input type="date" class="qa-due">
        <select class="qa-priority">
          <option value="low">low</option><option value="normal" selected>normal</option>
          <option value="high">high</option><option value="urgent">urgent</option>
        </select>
      </div>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      {
        label: 'Add task', onClick: async (modalEl) => {
          const title = modalEl.querySelector('.qa-title').value.trim();
          if (!title) return true; // keep open
          const projectId = modalEl.querySelector('.qa-project').value;
          const sectionId = modalEl.querySelector('.qa-section').value || null;
          await window.api.saveTask(projectId, {
            id: makeId('t'),
            title,
            status: 'todo',
            priority: modalEl.querySelector('.qa-priority').value,
            dueDate: modalEl.querySelector('.qa-due').value || null,
          }, sectionId);
          await window.__index.refreshTree();
          toast('Task added');
          if (getState().view === 'dashboard') window.__index.goto('dashboard');
        },
      },
    ],
  });
  // Keep the sub-objective dropdown in sync with the chosen project.
  // The empty option is afloat — a loose thread, no sub-objective yet.
  const projectSel = el.querySelector('.qa-project');
  const sectionSel = el.querySelector('.qa-section');
  const fillSections = () => {
    const secs = sectionsOf(projectSel.value);
    sectionSel.innerHTML =
      `<option value="">— afloat —</option>` +
      secs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  };
  projectSel.onchange = fillSections;
  fillSections();
  el.querySelector('.qa-title').focus();
}