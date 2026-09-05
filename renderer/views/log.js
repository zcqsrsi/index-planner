// Log: the journal. Today's case file is a real page under the "Log"
// notebook (one section per year), auto-created and seeded with what moved.
// The view delegates page rendering to the page editor so day files get
// editing, history, search, and Threads replay for free. Beside the title
// sits the day stamp — spirits / energy / weather — kept in a sidecar doc
// (daylog.json), never inside the page blocks.

import { getState, setState } from '../store.js';
import * as pageView from './page.js';
import * as reading from './reading.js';
import { folds, wireFold } from './projects.js';
import { esc, toast, openModal } from '../ui/components.js';

const STAMPS = {
  spirits: ['black', 'bleak', 'low', 'steady', 'good', 'bright'],
  energy: ['spent', 'drained', 'okay', 'rested', 'wired'],
  weather: ['—', 'rain', 'snow', 'wind', 'grey', 'cold', 'mild', 'hot', 'clear'],
};

let stampCache = null;

export function renderPanel(panelEl) {
  const tree = getState().notebooks.notebooks;
  const logNb = tree.find(nb => nb.name === 'Log');
  const years = (logNb?.sections || []).filter(s => /^\d{4}$/.test(s.name));
  const inbox = (logNb?.sections || []).find(s => s.name === 'Inbox');
  const inboxPages = inbox?.pages || [];

  // The left panel folds like the others — its own paneFold key.
  if (folds().log) {
    panelEl.classList.add('folded');
    panelEl.innerHTML = `
      <div class="panel-fold-strip">
        <span class="panel-fold-label">Log</span>
        <button class="icon-btn fold-unfold" data-fold="log" title="Unfold">»</button>
      </div>`;
    wireFold(panelEl);
    return;
  }
  panelEl.classList.remove('folded');
  panelEl.innerHTML = `
    <div class="panel-header">
      <span>Log</span>
      <span class="panel-header-tools">
        <button class="icon-btn" id="log-capture" title="Capture a thought to the inbox (⌘J)">＋</button>
        <button class="pane-fold-btn" data-fold="log" title="Fold pane">«</button>
      </span>
    </div>
    <div class="panel-body">
      <div class="dash-nav">
        <button data-open="today" class="${getState().reading ? '' : 'on'}">❏ Today's file</button>
        <button data-open="reading" class="${getState().reading ? 'on' : ''}">📖 Reading</button>
        <button data-open="${inbox ? inbox.pages[0]?.id || '' : ''}" ${inbox ? '' : 'hidden'}>⎍ Inbox</button>
      </div>
      ${years.length ? `
        <div class="log-years">
          ${years.slice().reverse().map(y => `
            <div class="log-year-label">${y.name}</div>
            ${y.pages.slice().reverse().slice(0, 14).map(p => `
              <button class="log-day-link ${/^\d{4}-\d{2}-\d{2}$/.test(p.title) ? '' : 'log-odd'}" data-page="${p.id}">
                <span class="ldl-date">${fmtDayCell(p.title)}</span>
              </button>`).join('') || '<div class="log-empty-year">no days yet</div>'}
          `).join('')}
        </div>` : ''}
    </div>`;

  panelEl.querySelector('#log-capture').onclick = () => captureModal();
  panelEl.querySelectorAll('.dash-nav button[data-open]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.open === 'reading') {
        setState({ reading: true });
        window.__index.goto('log');
        return;
      }
      if (btn.dataset.open === 'today') {
        setState({ reading: false });
        window.__index.goto('log');
        return;
      }
      if (!btn.dataset.open) { captureFirst(); return; }
      openDay(btn.dataset.open);
    };
  });
  panelEl.querySelectorAll('.log-day-link').forEach(btn => {
    btn.onclick = () => openDay(btn.dataset.page);
  });
}

export async function renderMain(mainEl) {
  const state = getState();
  // Reading mode: the compiled notes of a project/group, tasks greyed.
  if (state.reading) {
    await reading.renderReading(mainEl, state.readingScope);
    return;
  }
  const res = await window.api.logToday();
  // A day page opened from the panel stays open; otherwise today's file.
  const inLog = res.notebooks.notebooks.some(nb => nb.name === 'Log' &&
    nb.sections.some(s => s.pages.some(p => p.id === state.currentPageId)));
  setState({ notebooks: res.notebooks, currentPageId: inLog ? state.currentPageId : res.pageMeta.id });

  // Stamp bar + host; the editor renders beneath it via the page view.
  mainEl.innerHTML = `
    <div class="log-main">
      <div class="log-stampbar" id="log-stampbar"></div>
      <div class="log-host" id="log-host"></div>
    </div>`;

  stampCache = await window.api.stampGet();
  renderStamps(mainEl.querySelector('#log-stampbar'));
  await pageView.renderMain(mainEl.querySelector('#log-host'));

  // First run of the day: log:today just created the Log notebook/section,
  // so the panel (rendered from the older tree) is missing the year list.
  if (res.created) renderPanel(document.getElementById('panel'));
}

export function forceSave() { pageView.forceSave(); }
export function toggleHistory(pageId) { return pageView.toggleHistory(pageId); }

// ---- Day stamps ----

function stampValue(date, key) {
  return (stampCache?.[date]?.[key]) || '';
}

function renderStamps(el) {
  const key = todayStr();
  const s = stampValue(key, 'spirits');
  const e = stampValue(key, 'energy');
  const w = stampValue(key, 'weather');
  el.innerHTML = `
    <button class="stamp-cell" data-stamp="spirits"><span class="stamp-k">spirits</span><span class="stamp-v ${s ? '' : 'unset'}">${esc(s || '—')}</span></button>
    <span class="stamp-sep">·</span>
    <button class="stamp-cell" data-stamp="energy"><span class="stamp-k">energy</span><span class="stamp-v ${e ? '' : 'unset'}">${esc(e || '—')}</span></button>
    <span class="stamp-sep">·</span>
    <button class="stamp-cell" data-stamp="weather"><span class="stamp-k">weather</span><span class="stamp-v ${w ? '' : 'unset'}">${esc(w || '—')}</span></button>`;
  el.querySelectorAll('.stamp-cell').forEach(cell => {
    cell.onclick = () => stampModal(cell.dataset.stamp);
  });
}

function stampModal(kind) {
  const key = todayStr();
  const options = STAMPS[kind] || [];
  const current = stampValue(key, kind);
  const el = openModal({
    title: `${kind[0].toUpperCase()}${kind.slice(1)} — ${key}`,
    body: `
      <div class="stamp-choices">
        ${options.map(o => `<button class="stamp-choice ${o === current ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}
      </div>
      <input type="text" class="stamp-custom modal-input" placeholder="or write your own" value="${esc(current)}" spellcheck="false">`,
    actions: [
      { label: 'Clear', style: 'secondary', onClick: async () => { await setStamp(kind, ''); } },
      { label: 'Cancel', style: 'secondary' },
      { label: 'Set', onClick: async (m) => {
          const v = m.querySelector('.stamp-custom').value.trim() ||
            m.querySelector('.stamp-choice.on')?.dataset.v || '';
          await setStamp(kind, v);
        } },
    ],
  });
  el.querySelectorAll('.stamp-choice').forEach(btn => {
    btn.onclick = () => {
      el.querySelectorAll('.stamp-choice').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      el.querySelector('.stamp-custom').value = btn.dataset.v === '—' ? '' : btn.dataset.v;
    };
  });
  el.querySelector('.stamp-custom').focus();
}

async function setStamp(kind, value) {
  const key = todayStr();
  const updated = await window.api.stampSet(key, { [kind]: value });
  stampCache = { ...(stampCache || {}), [key]: { ...(stampCache?.[key] || {}), ...updated } };
  renderStamps(document.getElementById('log-stampbar'));
  toast(value ? `${kind}: ${value}` : `${kind} cleared`);
}

// ---- Inbox capture (⌘J) ----

export function captureModal() {
  const el = openModal({
    title: 'Capture',
    body: `<textarea class="capture-text modal-input" rows="4" placeholder="Capture to the inbox…" spellcheck="false"></textarea>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      { label: 'Capture', onClick: async (m) => {
          const text = m.querySelector('.capture-text').value.trim();
          if (!text) return true;
          await window.api.inboxCapture(text);
          await window.__index.refreshTree();
          toast('Captured to the Inbox');
        } },
    ],
  });
  el.querySelector('.capture-text').focus();
}

// First capture when no inbox exists yet — create it implicitly.
function captureFirst() {
  captureModal();
}

function openDay(pageId) {
  setState({ currentPageId: pageId });
  window.__index.goto('log');
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDayCell(title) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(title)) {
    const [, m, d] = title.split('-');
    return `${d}.${m}`;
  }
  return title;
}