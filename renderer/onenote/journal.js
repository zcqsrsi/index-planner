// OneNote journal tables → Index threads.
//
// The original OneNote journal is one table per sub-objective: a row per
// day, columns Tasks | Notes | Files. After import those arrive as pages
// holding a `table` block. This module detects such pages, parses them into
// day rows (tasks day-stamped, notes into the day diary), and — only after
// an explicit preview/confirm in the UI — applies them to a sub-objective.

import { openModal, closeModal, toast, esc } from '../ui/components.js';
import { getState, allProjects, findPageMeta } from '../store.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Normalise a header cell: OneNote headers arrive with stray whitespace and
// non-breaking spaces, and real tables carry columns beyond the classic
// Tasks|Notes|Files trio (the user's has an "Other" next to Files).
function normHeader(name) {
  return String(name || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/:$/, '');
}

// Column roles, matched loosely on the header text. The date column is the
// header called day/date, or — when headers are unnamed — the column whose
// values parse as dates for most rows. Anything with no role ("Other",
// custom names) is kept and folded into the day note, never dropped.
function columnRoles(b) {
  const headers = b.cols.map(c => normHeader(c.name));
  const col = (re) => b.cols.find((c, i) => re.test(headers[i] || ''))?.id;
  const dateHeader = col(/^(days?|dates?)$/);
  let dateCol = dateHeader;
  // A header match still has to earn it: if none of its values read as
  // dates, look for whichever column actually parses.
  if (dateCol && !b.rows.some(r => parseDate(cellText(r, dateCol)))) dateCol = null;
  if (!dateCol) dateCol = firstDateColumn(b, headers);
  return {
    headers,
    dateHeader,
    dateCol,
    taskCol: col(/task|to-?do|done|work/),
    noteCol: col(/note|journal|log/),
    fileCol: col(/file|attach/),
    extraCols: b.cols
      .filter(c => ![dateCol, col(/task|to-?do|done|work/), col(/note|journal|log/), col(/file|attach/)].includes(c.id))
      .map(c => ({ id: c.id, name: normHeader(c.name) || 'other' })),
  };
}

function firstDateColumn(b) {
  let best = null, bestCount = 0;
  for (const c of b.cols) {
    const count = b.rows.filter(r => parseDate(cellText(r, c.id))).length;
    if (count > bestCount) { best = c.id; bestCount = count; }
  }
  return bestCount >= Math.max(1, Math.ceil(b.rows.length / 2)) ? best : null;
}

// A table is a day table when it has a date column; content columns are
// recognised by name, but any table with dates can be split — the preview
// + confirm is the safety net. When no rows parse, the result still reports
// what it saw (date column? headers? sample values?) so the failure can be
// honest instead of a blanket "no date column".
export function parseJournalBlock(b) {
  if (!b || b.type !== 'table' || !Array.isArray(b.cols) || !Array.isArray(b.rows)) return null;
  const roles = columnRoles(b);
  const rows = roles.dateCol ? parseRows(b, roles) : [];
  if (!rows.length) {
    const probe = roles.dateCol || roles.dateHeader;
    return {
      rows: [],
      dateCol: roles.dateCol,
      dateHeader: roles.dateHeader,
      headers: b.cols.map(c => normHeader(c.name)).filter(Boolean),
      samples: probe ? b.rows.slice(0, 3).map(r => cellText(r, probe)).filter(Boolean) : [],
    };
  }
  return { rows };
}

export function findDayTable(page) {
  if (!page || !Array.isArray(page.blocks)) return null;
  for (const b of page.blocks) {
    const parsed = parseJournalBlock(b);
    if (parsed && parsed.rows.length) return { block: b, rows: parsed.rows };
  }
  return null;
}

// Row values may carry '\n'-separated lines (see convert.js cellLines).
// Rows arrive flat from OneNote conversion ({ c0: '…' }) and nested under
// `cells` when they round-trip through the editor (readBlockDOM) — read both.
function cellText(row, id) {
  return (row.cells ? row.cells[id] : row[id]) ?? '';
}

function parseRows(block, roles) {
  const { dateCol, taskCol, noteCol, fileCol, extraCols } = roles;
  const out = [];
  for (const row of block.rows) {
    const date = parseDate(dateCol && cellText(row, dateCol));
    if (!date) continue;
    const tasks = parseTasks(cellText(row, taskCol));
    const files = lines(cellText(row, fileCol)).map(stripBullet).filter(Boolean);
    let notes = lines(cellText(row, noteCol)).join('\n');
    // Columns with no known role ("Other", custom headers) fold into the
    // day note under their header, so the split drops nothing.
    for (const ex of extraCols) {
      const text = lines(cellText(row, ex.id)).filter(Boolean).join('\n');
      if (text) notes = (notes ? notes + '\n' : '') + `${ex.name}: ${text}`;
    }
    // Files can't be re-attached as blobs from a table cell — keep their
    // names in the day diary so nothing silently disappears.
    if (files.length) notes = (notes ? notes + '\n' : '') + 'Files: ' + files.join(', ');
    out.push({ date, tasks, notes });
  }
  return out;
}

function lines(v) {
  return String(v || '').split('\n').map(s => s.trim());
}

// The task cell is a numbered list — "1. … 2. …" — with sub-bullets tucked
// under some items. Each NUMBER is one task; the lines under it belong to
// that task, folded into its title. Any numbering at all switches the cell
// into grouped mode (the journal always numbers); a cell with no numbers
// still reads as one task per line. Lines before the first number (a stray
// heading, say) stand as their own tasks.
const NUMBERED = /^\(?\d{1,2}[.)]\s*/;

function parseTasks(raw) {
  const ls = lines(raw).map(stripBullet).filter(Boolean);
  if (!ls.length || !ls.some(l => NUMBERED.test(l))) return ls;
  const out = [];
  for (const l of ls) {
    if (NUMBERED.test(l)) {
      out.push(l.replace(NUMBERED, ''));
    } else if (out.length) {
      out[out.length - 1] += ' — ' + l;
    } else {
      out.push(l);
    }
  }
  return out;
}

function stripBullet(s) {
  return s.replace(/^(?:[-•*·◦○●]|o\s(?=\S))\s*/, '').trim();
}

// Dates the journal used — and anything close: 2024-09-03, 3 Sep, 3 Sep 24,
// Sep 3, 1 September 2025, 1st Sept, Mon 3 Sept, 1/9/25, 01.09.2025.
export function parseDate(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  // Ordinals and a leading weekday name are decoration — strip them.
  s = s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  s = s.replace(/^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|weds?|thur?s?|fri|sat|sun)\b[,.]?\s*/i, '');
  s = s.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m) return fromParts(Number(m[3]), MONTHS[Number(m[2]) - 1], m[1]);
  // Numeric day/month/year — the UK reading (the journal's own format).
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/.exec(s);
  if (m) return fromParts(Number(m[1]), MONTHS[Number(m[2]) - 1], m[3]);
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{2,4}))?/i.exec(s);
  if (m) return fromParts(Number(m[1]), m[2], m[3]);
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s+(\d{2,4}))?/i.exec(s);
  if (m) return fromParts(Number(m[2]), m[1], m[3]);
  return null;
}

function fromParts(day, mon, yr) {
  const mi = MONTHS.indexOf(mon.toLowerCase().slice(0, 3));
  if (mi < 0 || day < 1 || day > 31) return null;
  let year = yr === undefined ? new Date().getFullYear() : Number(yr);
  if (year < 100) year += 2000;
  const d = new Date(year, mi, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Scan the whole tree for imported pages that carry a journal table.
export async function scanForJournalPages() {
  const pages = await window.api.listPages();
  const hits = [];
  for (const meta of pages) {
    try {
      const page = await window.api.loadPage(meta.id);
      const found = findDayTable(page);
      if (found) {
        const taskCount = found.rows.reduce((n, r) => n + r.tasks.length, 0);
        hits.push({ meta, rows: found.rows, dayCount: found.rows.length, taskCount });
      }
    } catch { /* unreadable page — skip */ }
  }
  return hits;
}

// Apply a parsed journal to a (new) sub-objective. Everything rides the
// normal IPC layer: create the section, backfill its day diary, then write
// each task with its original day.
export async function applyJournal({ notebookId, sectionName, rows, baseSectionId = null }) {
  let sectionId = baseSectionId;
  if (!sectionId) {
    const { section } = await window.api.createSection(notebookId, sectionName);
    sectionId = section.id;
  }
  const days = {};
  for (const r of rows) {
    if (r.notes) days[r.date] = { note: r.notes, files: [] };
  }
  if (Object.keys(days).length) {
    await window.api.saveSection(sectionId, { days });
  }
  let applied = 0;
  for (const r of rows) {
    for (const title of r.tasks) {
      const ts = Date.parse(r.date) || Date.now();
      await window.api.saveTask(notebookId, {
        title, status: 'todo', priority: 'normal', createdAt: ts, day: r.date,
      }, sectionId);
      applied++;
    }
  }
  return { sectionId, tasks: applied, days: Object.keys(days).length };
}

// Right-click a pasted journal table → split it into day rows on a
// sub-objective of the current project. Preview first, apply on confirm.
// Note: the confirm handler must stay SYNCHRONOUS — openModal keeps the
// modal open only on a literal `true`, and an async handler's validation
// `return true` comes back wrapped in a Promise (never === true).
export function splitIntoDayRows(block) {
  const state = getState();
  // The table lives in a page — the page's own section names the project,
  // whatever pane the tree happens to have selected. Fall back to the
  // selected project for blocks that aren't in a page yet.
  const meta = state.currentPageId ? findPageMeta(state.currentPageId) : null;
  const project = meta?.notebook || allProjects().find(p => p.id === state.currentProjectId);
  if (!project) {
    toast("Couldn't tell which project this page belongs to — open it from the tree and try again.");
    return;
  }
  const parsed = parseJournalBlock(block);
  if (!parsed || !parsed.rows.length) {
    const headers = (parsed?.headers || []).join(', ');
    const samples = (parsed?.samples || []).map(s => `“${String(s).slice(0, 24)}”`).join(', ');
    if (parsed && parsed.dateCol) {
      toast(`Found the date column but couldn't read its values as dates. Saw: ${samples || '(empty)'}`);
    } else if (parsed && parsed.dateHeader) {
      toast(`The date column's values didn't read as dates, so there's nothing to split. Saw: ${samples || '(empty)'}`);
    } else {
      toast(`This table has no date column, so there's nothing to split into days. Columns seen: ${headers || '(no headers)'}`);
    }
    return;
  }
  const rows = parsed.rows;
  const taskCount = rows.reduce((n, r) => n + r.tasks.length, 0);

  // The page's own section is the sensible default filing target.
  const defaultSectionId = meta?.section?.id || state.currentSectionId;
  const secs = (project.sections || []);
  const options = secs.map(s => `<option value="${esc(s.id)}"${s.id === defaultSectionId ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('') + `<option value="__new">New sub-objective…</option>`;
  const sample = rows.slice(0, 4).map(r => `
    <div class="journal-preview-day">
      <span class="journal-preview-date">${esc(r.date)}</span>
      <span>${r.tasks.length ? esc(r.tasks.join(' · ')) : '<i>no tasks</i>'}</span>
      ${r.notes ? `<div class="journal-preview-note">${esc(r.notes.slice(0, 140))}${r.notes.length > 140 ? '…' : ''}</div>` : ''}
    </div>`).join('');

  const el = openModal({
    title: 'Split into day rows',
    body: `
      <p class="backup-dim">${rows.length} day row${rows.length === 1 ? '' : 's'}, ${taskCount} task${taskCount === 1 ? '' : 's'} — tasks day-stamped, notes into each day's diary.</p>
      <label class="field"><span>File under</span>
        <select class="modal-input" id="jr-target">
          ${options}
        </select>
      </label>
      <label class="field" id="jr-new-row" hidden><span>Sub-objective name</span>
        <input type="text" class="modal-input" id="jr-new-name" placeholder="e.g. ${esc(rows[0]?.date || 'Journal')}">
      </label>
      <div class="journal-preview">
        ${sample}
        ${rows.length > 4 ? `<div class="backup-dim">…and ${rows.length - 4} more day${rows.length - 4 === 1 ? '' : 's'}</div>` : ''}
      </div>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      {
        label: `Split ${rows.length} day${rows.length === 1 ? '' : 's'}`,
        onClick: (el) => {
          const pick = el.querySelector('#jr-target').value;
          let baseSectionId = null;
          let sectionName = 'Journal';
          if (pick === '__new') {
            sectionName = (el.querySelector('#jr-new-name').value || '').trim();
            if (!sectionName) {
              el.querySelector('#jr-new-name').focus();
              return true; // stay open until a name exists
            }
            // A name this project already has files under it — a second
            // split into "Journal" shouldn't mint a second "Journal".
            const existing = secs.find(s => s.name.trim().toLowerCase() === sectionName.toLowerCase());
            if (existing) { baseSectionId = existing.id; sectionName = existing.name; }
          } else {
            baseSectionId = pick;
          }
          applyJournal({ notebookId: project.id, sectionName, rows, baseSectionId })
            .then(res => {
              const nDays = new Set(rows.map(r => r.date)).size;
              toast(`Split — ${res.tasks} task${res.tasks === 1 ? '' : 's'} across ${nDays} day${nDays === 1 ? '' : 's'}`);
              window.__index?.refreshTree?.();
            })
            .catch(e => toast(`Split failed — ${e.message}`));
        },
      },
    ],
  });

  const target = el.querySelector('#jr-target');
  const newRow = el.querySelector('#jr-new-row');
  target.addEventListener('change', () => { newRow.hidden = target.value !== '__new'; });
}