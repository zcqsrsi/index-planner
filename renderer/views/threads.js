// Threads: the timeline view. A year of activity on one scrubber; pick a day,
// see what moved, and read any page exactly as it stood at end of that day.

import { esc, constellationGlyph } from '../ui/components.js';
import { getState } from '../store.js';
import { folds, wireFold } from './projects.js';
import { renderSky } from './threads-sky.js';

const DAY = 86400000;
const WINDOW_DAYS = 365;

// Same glyph vocabulary as the dashboard feed.
const EVENT_ICONS = {
  'page.save': '✎', 'page.create': '＋', 'page.delete': '🗑', 'page.rename': '✎', 'page.restore': '⏱', 'page.move': '→',
  'notebook.create': '▤', 'notebook.rename': '▤', 'notebook.delete': '🗑',
  'section.create': '▦', 'section.rename': '▦', 'section.delete': '🗑',
  'project.create': '❖', 'project.save': '❖', 'project.delete': '🗑',
  'objective.create': '◇', 'objective.save': '◇', 'objective.delete': '🗑',
  'task.add': '＋', 'task.status': '☑', 'app.seed': '◎', 'app.migrate': '⏱', 'question.set': '?', 'bigpicture.set': '◇',
  'inbox.capture': '⎍',
};

let selectedDay = null; // 'YYYY-MM-DD' while inspecting a day
let preview = null;     // { pageId, versionId } while reading a page as-of a day

export function renderPanel(panelEl) {
  // The left panel folds like the Map's overview — its own paneFold key,
  // so the sky can take the full width and the fold is remembered.
  if (folds().threads) {
    panelEl.classList.add('folded');
    panelEl.innerHTML = `
      <div class="panel-fold-strip">
        <span class="panel-fold-label">Threads</span>
        <button class="icon-btn fold-unfold" data-fold="threads" title="Unfold">»</button>
      </div>`;
    wireFold(panelEl);
    return;
  }
  panelEl.classList.remove('folded');
  panelEl.innerHTML = `
    <div class="panel-header threads-panel-header">
      <button class="pane-fold-btn" data-fold="threads" title="Fold pane">«</button>
    </div>
    <div class="panel-body">
      <div class="dash-nav">
        <button id="tl-debrief">∎ Weekly debrief</button>
      </div>
      <div class="dash-tip">
        Every edit, snapshot, and task move, laid out on one line.<br><br>
        Pick a day on the band above to revisit it — pages open exactly as
        they stood at that point, snapshot permitting.<br><br>
        The <b>sky</b> toggle shows every thread in this universe as a
        constellation instead — pages and open tasks as stars, brightness
        fading as a thing goes untended.
      </div>
    </div>`;
  wireFold(panelEl);
  panelEl.querySelector('#tl-debrief').onclick = () => {
    const detail = document.getElementById('tl-detail');
    if (detail) renderDebrief(detail);
  };
}

export async function renderMain(mainEl) {
  // The question index reads the tree once per visit — never across visits,
  // or wording changes made while the app sat on another view go unseen.
  qIndex = null;
  // Threads reads two ways: the day-by-day timeline, or the sky — every
  // thread in this universe as a constellation, brightness = recency.
  const layout = getState().settings?.threadsLayout === 'sky' ? 'sky' : 'days';
  if (layout === 'sky') { await renderSkyMain(mainEl); return; }
  mainEl.innerHTML = `<div class="threads-main"><div class="empty"><div class="empty-icon">${constellationGlyph(26)}</div>Weaving the timeline…</div></div>`;

  const { since, days } = await window.api.threadsTimeline(WINDOW_DAYS);
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const start = new Date(Math.max(since, today.getTime() - (WINDOW_DAYS - 1) * DAY));
  start.setHours(0, 0, 0, 0);

  // One column per calendar day, oldest → newest. Keys are local dates —
  // they must match the main process's dayKey, which uses the wall clock.
  const localKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const columns = [];
  for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
    const d = new Date(t);
    const key = localKey(d);
    columns.push({ key, date: d, data: days[key] || null });
  }

  mainEl.innerHTML = `
    <div class="threads-main">
      <div class="threads-hero">
        <div>
          <div class="dash-date-sub">${fmtDate(start)} — ${fmtDate(today)}</div>
        </div>
        <div class="threads-hero-tools">
          <input type="text" class="threads-filter" placeholder="filter events…" spellcheck="false">
          <div class="ring-toggle" id="sky-toggle">
            <button data-layout="days" class="on">days</button>
            <button data-layout="sky">sky</button>
          </div>
        </div>
      </div>

      <div class="tl-band-wrap">
        <div class="tl-band" id="tl-band">
          ${columns.map(col => {
            const vol = col.data ? col.data.edits + col.data.snapshots + col.data.tasks + (col.data.other || 0) : 0;
            const h = vol ? Math.min(56, 8 + Math.log2(vol + 1) * 10) : 2;
            const monthStart = col.date.getDate() === 1;
            return `
              <div class="tl-col ${vol ? 'has' : ''} ${col.key === selectedDay ? 'sel' : ''}"
                   data-day="${col.key}" data-h="${h}px"
                   title="${fmtDate(col.date)} — ${vol ? `${vol} event${vol === 1 ? '' : 's'}` : 'quiet'}">
                <span class="tl-bar" ${col.data && col.data.edits ? 'data-edits="1"' : ''}></span>
                ${monthStart ? `<span class="tl-month">${col.date.toLocaleDateString(undefined, { month: 'short' })}</span>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="tl-detail" id="tl-detail"></div>
    </div>`;

  const band = mainEl.querySelector('#tl-band');
  const detail = mainEl.querySelector('#tl-detail');
  // The CSP swallows style attributes whole — each column's height rides
  // its data and the CSSOM instead, which the policy does not police.
  band.querySelectorAll('.tl-col[data-h]').forEach(c =>
    c.style.setProperty('--h', c.dataset.h));

  // Open on the most recent day that actually has something on it.
  if (!selectedDay || !days[selectedDay]) {
    const latest = [...columns].reverse().find(c => c.data);
    selectedDay = (latest || columns[columns.length - 1]).key;
    band.querySelector(`[data-day="${selectedDay}"]`)?.classList.add('sel');
  }
  renderDay(detail, days[selectedDay] || null, selectedDay);

  // Newest days sit at the right edge — open the view looking at "now".
  const wrap = mainEl.querySelector('.tl-band-wrap');
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });

  band.querySelectorAll('.tl-col').forEach(col => {
    col.onclick = () => {
      selectedDay = col.dataset.day;
      preview = null;
      band.querySelectorAll('.tl-col').forEach(c => c.classList.remove('sel'));
      col.classList.add('sel');
      renderDay(detail, days[selectedDay], selectedDay);
    };
  });

  const filter = mainEl.querySelector('.threads-filter');
  filter.oninput = () => {
    if (selectedDay) {
      const b = days[selectedDay];
      renderDay(detail, b, selectedDay, filter.value.trim().toLowerCase());
    }
  };

  wireSkyToggle(mainEl);
}

// days ↔ sky. Like the Map's list/ring: the setting persists, the view
// repaints in the chosen reading.
function wireSkyToggle(mainEl) {
  mainEl.querySelectorAll('#sky-toggle button').forEach(btn => {
    btn.onclick = async () => {
      getState().settings = await window.api.setSetting('threadsLayout', btn.dataset.layout);
      window.__index.goto('threads');
    };
  });
}

// The sky's question toggle — top left, where the view's name used to sit.
// It only lifts the question plates out of (or back into) the already-drawn
// sky — the setting persists, but the constellations are never redrawn, so
// their draw-in and kindle animations don't replay.
function wireSkyQuestions(mainEl) {
  mainEl.querySelectorAll('#sky-q-toggle button').forEach(btn => {
    btn.onclick = async () => {
      const on = btn.dataset.q === 'on';
      if ((getState().settings?.skyQuestions !== false) === on) return;
      getState().settings = await window.api.setSetting('skyQuestions', on);
      mainEl.querySelector('#sky-svg')?.classList.toggle('q-off', !on);
      mainEl.querySelectorAll('#sky-q-toggle button').forEach(b =>
        b.classList.toggle('on', (b.dataset.q === 'on') === on));
    };
  });
}

// ---- Sky: every thread in this universe as a constellation ----

async function renderSkyMain(mainEl) {
  mainEl.innerHTML = `
    <div class="threads-main threads-sky-main">
      <div class="threads-hero">
        <div class="sky-q-toggle-wrap">
          <span class="sky-q-cap">questions</span>
          <div class="ring-toggle" id="sky-q-toggle">
            <button data-q="on" class="${getState().settings?.skyQuestions !== false ? 'on' : ''}">on</button>
            <button data-q="off" class="${getState().settings?.skyQuestions === false ? 'on' : ''}">off</button>
          </div>
        </div>
        <div class="ring-toggle" id="sky-toggle">
          <button data-layout="days">days</button>
          <button data-layout="sky" class="on">sky</button>
        </div>
      </div>
      <div class="tl-sky ${getState().settings?.skyDrift === false ? 'sky-drift-off' : ''}" id="tl-sky"><div class="history-loading">Gathering the stars…</div></div>
    </div>`;
  wireSkyToggle(mainEl);
  wireSkyQuestions(mainEl);
  const qi = await loadQuestionIndex();
  const host = mainEl.querySelector('#tl-sky');
  if (!host) return;
  await renderSky(host, qi, questionAsOf);
}

// ---- Day detail: what moved, and the pages as they stood ----

function renderDay(el, bucket, dayKey, query = '') {
  if (!bucket) {
    el.innerHTML = `<div class="tl-day-head">${fmtDay(dayKey)}</div>
                    <div class="tl-quiet">Nothing was written this day. Some days the ring is silent.</div>
                    <div class="tl-stamps" id="tl-stamps" data-day="${dayKey}"></div>
                    <div class="tl-feed" id="tl-feed"></div>`;
    // Questions still show on a quiet day — with nothing under them.
    loadFeed(el.querySelector('#tl-feed'), dayKey, '');
    return;
  }

  const touches = Object.values(bucket.pages)
    .filter(t => !query || `${t.title} ${t.path}`.toLowerCase().includes(query))
    .sort((a, b) => b.ts - a.ts);

  const n = bucket.edits + bucket.snapshots + bucket.tasks + (bucket.other || 0);
  el.innerHTML = `
    <div class="tl-day-head">
      <span class="tl-day-title">${fmtDay(dayKey)}</span>
      <span class="tl-day-count">${n} move${n === 1 ? '' : 's'} · ${bucket.edits} edit${bucket.edits === 1 ? '' : 's'} · ${bucket.snapshots} snapshot${bucket.snapshots === 1 ? '' : 's'} · ${bucket.tasks} task${bucket.tasks === 1 ? '' : 's'}</span>
    </div>
    <div class="tl-stamps" id="tl-stamps" data-day="${dayKey}"></div>
    ${touches.length ? `
      <div class="tl-pages">
        ${touches.map(t => `
          <button class="tl-page" data-page="${t.pageId}" data-day="${dayKey}">
            <span class="tl-page-name">${esc(t.title || 'Untitled')}</span>
            <span class="tl-page-path">${esc(t.path)}</span>
            <span class="tl-page-when">${t.versionId ? 'read as of this day' : 'no snapshot this day'}</span>
            <span class="tl-page-arrow">→</span>
          </button>`).join('')}
      </div>` : '<div class="tl-quiet">Pages moved, but none carry snapshots for this day.</div>'}
    <div class="tl-feed" id="tl-feed"></div>`;

  el.querySelectorAll('.tl-page').forEach(btn => {
    btn.onclick = () => { preview = { pageId: btn.dataset.page, day: btn.dataset.day }; renderPreview(el); };
  });

  loadFeed(el.querySelector('#tl-feed'), dayKey, query);
  loadStamps(el.querySelector('#tl-stamps'), dayKey);
}

// The day's stamps — spirits / energy / weather — read-only beside the head.
async function loadStamps(el, dayKey) {
  if (!el) return;
  const doc = await window.api.stampGet();
  // The user may have picked another day while the doc loaded.
  if (!el.isConnected || el.dataset.day !== dayKey) return;
  const s = doc[dayKey] || {};
  const cells = [
    ['spirits', s.spirits], ['energy', s.energy], ['weather', s.weather],
  ].filter(([, v]) => v);
  el.innerHTML = cells.length
    ? `<span class="tl-stamps-label">stamped</span>` + cells.map(([k, v]) =>
        `<span class="tl-stamp"><span class="tls-k">${k}</span> ${esc(v)}</span>`).join('')
    : '';
}

// Day feed from the activity log (summaries for everything, incl. tasks),
// grouped under the big question each entry answered to on that day.
async function loadFeed(el, dayKey, query) {
  // The activity IPC is limit/offset-based; walk back until we leave the day.
  const entries = [];
  const want = new Date(`${dayKey}T00:00:00`).getTime();
  const end = want + DAY;
  for (let offset = 0; offset < 4000; offset += 200) {
    const batch = await window.api.listActivity(200, offset);
    if (!batch.length) break;
    let reachedPast = false;
    for (const a of batch) {
      if (a.ts >= end) continue;
      if (a.ts < want) { reachedPast = true; break; }
      entries.push(a);
    }
    if (reachedPast) break;
  }
  const shown = entries
    .filter(a => !query || a.summary.toLowerCase().includes(query))
    .sort((a, b) => b.ts - a.ts);

  // Consecutive identical actions collapse into one row — ten edits of the
  // same page inside two minutes read as one line with a count and a span,
  // not ten lines. (shown is newest-first; the run's span runs newest→oldest.)
  const runs = [];
  for (const a of shown) {
    const last = runs[runs.length - 1];
    if (last && last.type === a.type && last.entityId === a.entityId && last.summary === a.summary) {
      last.count++;
      last.from = a.ts;
    } else {
      runs.push({ ...a, count: 1, from: a.ts });
    }
  }

  el.innerHTML = shown.length ? '<div class="history-loading">Weaving…</div>' : '';
  const qi = await loadQuestionIndex();
  if (!el.isConnected) return;

  // Group the day's entries under their project's question, as the wording
  // stood on this day — earlier days replay older wordings.
  const groups = [];
  const byQuestion = new Map();
  for (const a of runs) {
    const nb = qi.entityToNb.get(a.entityId || '') || null;
    const q = (nb && nb.kind !== 'log') ? questionAsOf(qi, nb, dayKey) : { text: null, prev: null };
    const key = q.text || '';
    let g = byQuestion.get(key);
    if (!g) {
      g = { question: q.text, prev: q.prev, entries: [] };
      byQuestion.set(key, g);
      groups.push(g);
    }
    g.entries.push(a);
  }
  // Questioned groups lead (busiest first); the questionless tail comes last.
  // Every question that stood on this day shows even when nothing moved
  // under it — a question exists from the day it was written.
  const answered = new Set(groups.filter(g => g.question).map(g => g.question));
  for (const owner of qi.owners) {
    const q = questionAsOf(qi, owner, dayKey);
    if (!q.text || answered.has(q.text)) continue;
    answered.add(q.text);
    groups.push({ question: q.text, prev: q.prev, entries: [] });
  }
  groups.sort((x, y) => (y.question ? 1 : 0) - (x.question ? 1 : 0) || y.entries.length - x.entries.length);

  const row = (a) => {
    const t = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
    <div class="activity-row">
      <span class="act-icon">${EVENT_ICONS[a.type] || '·'}</span>
      <span class="act-summary">${esc(a.summary)}</span>
      ${a.count > 1 ? `<span class="act-count" title="The same move, ${a.count} times in a row">×${a.count}</span>` : ''}
      <span class="act-time">${a.count > 1 ? `${t(a.ts)}–${t(a.from)}` : t(a.ts)}</span>
    </div>`;
  };
  // Settings → Threads: the halo on question heads, and how loud they read.
  const st = getState().settings || {};
  el.classList.toggle('qglow-off', st.questionGlow === false);
  el.classList.remove('q-sm', 'q-lg');
  if (st.questionSize === 'small') el.classList.add('q-sm');
  if (st.questionSize === 'large') el.classList.add('q-lg');
  el.innerHTML = groups.map(g => {
    const toggleable = g.question && g.entries.length > 0;
    const open = toggleable && openQuestions.has(g.question);
    return `
    <section class="tq-group ${g.question ? '' : 'tq-none'} ${open ? 'tq-open' : ''}">
      ${g.question ? `
        <div class="tq-head" ${toggleable ? 'data-toggle="1" title="Show what moved under this question"' : ''}>
          <span class="tq-mark">◇</span>
          <span class="tq-text">${esc(g.question)}</span>
          ${toggleable ? `<span class="tq-tw">${open ? '▾' : '▸'}</span>` : ''}
        </div>
        ${g.prev ? `
          <div class="tq-prev">
            <span class="tq-node"></span>
            <span class="tq-prev-text">threaded from “${esc(g.prev)}”</span>
          </div>` : ''}`
      : `
        <div class="tq-head tq-head-none">
          <span class="tq-mark">·</span>
          <span class="tq-text">no question set</span>
        </div>`}
      <div class="tq-entries" ${toggleable && !openQuestions.has(g.question) ? 'hidden' : ''}>${g.entries.map(row).join('')}</div>
      ${g.question && !g.entries.length ? '<div class="tq-quiet">No activity today.</div>' : ''}
    </section>`;
  }).join('');

  // Question heads fold their day's activity away — click to open or close.
  el.querySelectorAll('.tq-head[data-toggle]').forEach(head => {
    head.onclick = () => {
      const section = head.closest('.tq-group');
      const text = head.querySelector('.tq-text').textContent;
      const entries = section.querySelector('.tq-entries');
      const open = !entries.hidden;
      entries.hidden = open;
      if (open) openQuestions.delete(text); else openQuestions.add(text);
      section.classList.toggle('tq-open', !open);
      const tw = head.querySelector('.tq-tw');
      if (tw) tw.textContent = open ? '▸' : '▾';
    };
  });
}

// ---- Big questions ----
// bigPicture lives on the group when a project is grouped (members share
// one), else on the project. bigPictureHistory records replaced wordings as
// {text, until} — newest first — where `until` is the day the NEXT wording
// took over. So chronologically each wording starts at its predecessor's
// `until`, and the current statement starts at its own `asOf`.

let qIndex = null;

// Question groups fold their activity away by default; the set of questions
// the user has opened survives day switches within the session.
const openQuestions = new Set();

async function loadQuestionIndex() {
  if (qIndex) return qIndex;
  const tree = (await window.api.bootstrap()).notebooks;
  const groupById = new Map((tree.groups || []).map(g => [g.id, g]));
  const owners = []; // group or project that carries a big picture, deduped
  const seenOwners = new Set();
  const entityToNb = new Map(); // page, task, and aim ids → their project
  for (const nb of tree.notebooks) {
    for (const sec of nb.sections || []) {
      for (const pg of sec.pages || []) entityToNb.set(pg.id, nb);
      for (const t of sec.tasks || []) entityToNb.set(t.id, nb);
    }
    for (const t of nb.floatingTasks || []) entityToNb.set(t.id, nb);
    for (const o of nb.objectives || []) entityToNb.set(o.id, nb);
  }
  const ownerOf = (nb) => (nb.groupId && groupById.get(nb.groupId)) || nb;
  const wordings = new Map(); // owner id → [{text, start|null}] oldest → newest
  for (const nb of tree.notebooks) {
    const owner = ownerOf(nb);
    if (!seenOwners.has(owner.id)) { seenOwners.add(owner.id); owners.push(owner); }
  }
  for (const nb of tree.notebooks) {
    const owner = ownerOf(nb);
    if (wordings.has(owner.id)) continue;
    const list = [];
    const hist = [...(owner.bigPictureHistory || [])].reverse(); // oldest first
    hist.forEach((h, i) => {
      list.push({ text: h.text, start: i === 0 ? null : (hist[i - 1].until || null) });
    });
    if (owner.bigPicture && owner.bigPicture.text) {
      list.push({ text: owner.bigPicture.text, start: owner.bigPicture.asOf || null });
    }
    wordings.set(owner.id, list);
  }
  qIndex = { entityToNb, ownerOf, wordings, owners };
  return qIndex;
}

// The question a project answered to on dayKey — plus the wording it
// replaced, so the day can show the thread between them.
function questionAsOf(qi, nb, dayKey) {
  const list = qi.wordings.get(qi.ownerOf(nb).id) || [];
  let active = null, prev = null;
  for (const w of list) {
    if (w.start && w.start > dayKey) break;
    prev = active;
    active = w;
  }
  return { text: active ? active.text : null, prev: prev ? prev.text : null };
}

// ---- Read-only page as it stood at end of a chosen day ----

async function renderPreview(el) {
  const { pageId, day } = preview;
  const endOfDay = new Date(`${day}T00:00:00`).getTime() + DAY;
  const versions = await window.api.pageVersions(pageId); // newest first
  const asOf = versions.find(v => v.ts < endOfDay);
  const meta = { title: '' };

  el.innerHTML = `
    <div class="tl-preview-head">
      <button class="link-btn" id="tl-back">← back to the day</button>
      <span class="tl-preview-note">${asOf
        ? `${esc(asOf.title || '')} — snapshot from ${fmtWhen(asOf.ts)}`
        : 'No snapshot exists from on or before this day (snapshots rotate; the oldest surviving one is shown next).'}</span>
    </div>
    <div class="tl-preview" id="tl-preview"><div class="history-loading">Loading…</div></div>`;

  el.querySelector('#tl-back').onclick = () => {
    preview = null;
    const band = document.querySelector('#tl-band');
    const col = band?.querySelector(`[data-day="${day}"]`);
    if (col) col.click();
  };

  let blocks = null;
  if (asOf) {
    const v = await window.api.loadVersion(pageId, asOf.id);
    if (v) { blocks = v.blocks; meta.title = v.title || ''; }
  }
  if (!blocks) {
    // Snapshot for that moment has rotated away — fall back to the oldest
    // surviving snapshot and say so.
    const oldest = versions[versions.length - 1];
    if (oldest) {
      const v = await window.api.loadVersion(pageId, oldest.id);
      if (v) { blocks = v.blocks; meta.title = v.title || ''; }
    }
  }
  const host = el.querySelector('#tl-preview');
  if (!host) return;
  host.innerHTML = blocks
    ? blocks.map(renderVersionBlock).join('')
    : '<div class="tl-quiet">This page has no snapshots at all — nothing to replay yet.</div>';
}

// Reused by the history drawer; kept as a local copy so the threads view
// stays independent of page.js internals.
function renderVersionBlock(b) {
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

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDay(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtWhen(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- Weekly debrief: the week in review, from the activity log ----

async function renderDebrief(el) {
  el.innerHTML = `
    <div class="tl-debrief">
      <div class="tl-day-head">
        <span class="tl-day-title">Weekly debrief</span>
        <span class="tl-day-count">the last seven days, on the record</span>
      </div>
      <div class="tl-quiet">Reading the week…</div>
    </div>`;

  const d = await window.api.debrief(7);
  const t = d.totals;
  const maxDay = Math.max(1, ...Object.values(d.perDay));

  // Seven columns, oldest → newest, keyed on local calendar days.
  const dayKeys = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    dayKeys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
  }

  const pageNames = new Map((await window.api.listPages()).map(p => [p.id, p]));
  const host = el.querySelector('.tl-debrief');
  if (!host) return;
  host.innerHTML = `
    <div class="tl-day-head">
      <span class="tl-day-title">Weekly debrief</span>
      <span class="tl-day-count">the last ${d.days} days, on the record</span>
    </div>
    <div class="debrief-totals">
      ${[
        ['moves', t.moves], ['edits', t.edits], ['snapshots', t.snapshots],
        ['threads opened', t.opened], ['threads closed', t.closed], ['threads scrapped', t.scrapped],
      ].map(([k, v]) => `<span class="debrief-total"><b>${v}</b> ${k}</span>`).join('')}
    </div>
    <div class="debrief-week">
      ${dayKeys.map(k => {
        const v = d.perDay[k] || 0;
        const dt = new Date(`${k}T12:00:00`);
        return `<div class="debrief-day" title="${fmtDay(k)} — ${v} move${v === 1 ? '' : 's'}">
          <span class="deb-bar" style="--h:${Math.round((v / maxDay) * 44)}px" ${v ? '' : 'data-quiet="1"'}></span>
          <span class="deb-label">${dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="debrief-cols">
      <div>
        <div class="dash-section-title">Most-worked pages</div>
        ${d.pages.length ? d.pages.map(([id, n]) => `
          <button class="debrief-row" data-page="${id}">
            <span class="deb-name">${esc(pageNames.get(id)?.title || 'removed page')}</span>
            <span class="deb-n">${n}</span>
          </button>`).join('') : '<div class="tl-quiet">No pages touched.</div>'}
      </div>
      <div>
        <div class="dash-section-title">Busiest projects</div>
        ${d.projects.length ? d.projects.map(([name, n]) => `
          <div class="debrief-row"><span class="deb-name">${esc(name)}</span><span class="deb-n">${n}</span></div>`).join('')
          : '<div class="tl-quiet">No project moves.</div>'}
      </div>
    </div>`;

  host.querySelectorAll('.debrief-row[data-page]').forEach(btn => {
    btn.onclick = () => window.__index.openPage(btn.dataset.page);
  });
}