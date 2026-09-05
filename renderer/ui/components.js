// Small UI toolkit: escape, modal, context menu, toast, date helpers.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function uid() {
  return `b${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// ---- Modal ----

let overlayEl = null;

export function openModal({ title, body, actions = [], danger = false, locked = false }) {
  closeModal();
  overlayEl = document.createElement('div');
  overlayEl.className = 'overlay';
  overlayEl.innerHTML = `
    <div class="modal ${danger ? 'danger' : ''}" role="dialog">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions"></div>
    </div>`;
  const actionsEl = overlayEl.querySelector('.modal-actions');
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = `btn ${a.style || 'secondary'}`;
    btn.textContent = a.label;
    btn.onclick = () => {
      // Only an explicit `true` keeps the modal open. (Async handlers return
      // a Promise — always truthy — so truthiness would leave every confirmed
      // action's modal stuck on screen.)
      const keep = a.onClick ? a.onClick(overlayEl) === true : false;
      if (!keep) closeModal();
    };
    actionsEl.appendChild(btn);
  }
  // A locked modal (progress dialogs) can't be dismissed by a stray click
  // or Escape — it leaves only through its own buttons.
  overlayEl.addEventListener('mousedown', e => { if (!locked && e.target === overlayEl) closeModal(); });
  // Enter accepts (the last action, from a single-line input — never on a
  // danger dialog, where a slip of the key shouldn't confirm a delete);
  // Escape cancels.
  overlayEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (!locked) closeModal(); return; }
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.altKey || e.isComposing || danger) return;
    if (!e.target.matches('input[type="text"], input:not([type])')) return;
    const confirm = actions[actions.length - 1];
    if (!confirm) return;
    e.preventDefault();
    const keep = confirm.onClick ? confirm.onClick(overlayEl) === true : false;
    if (!keep) closeModal();
  });
  document.getElementById('overlays').appendChild(overlayEl);
  const firstInput = overlayEl.querySelector('input, textarea');
  if (firstInput) { firstInput.focus(); firstInput.select && firstInput.select(); }
  return overlayEl;
}

export function closeModal() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
}

export function promptModal({ title, label, value = '', confirmLabel = 'OK', danger = false, onConfirm }) {
  openModal({
    title,
    danger,
    body: `<label class="field"><span>${label}</span><input type="text" class="modal-input" value="${esc(value)}"></label>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      {
        label: confirmLabel, style: danger ? 'danger' : '',
        onClick: (el) => {
          const v = el.querySelector('.modal-input').value.trim();
          if (!v) return true; // keep open on empty
          onConfirm(v);
        },
      },
    ],
  });
}

// ---- Context menu ----

export function contextMenu(x, y, items) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  for (const item of items) {
    if (item === '-') { menu.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    const btn = document.createElement('button');
    btn.className = `ctx-item ${item.danger ? 'danger' : ''}`;
    btn.textContent = item.label;
    if (item.title) btn.title = item.title;
    btn.onclick = () => { closeMenus(); item.onClick(); };
    menu.appendChild(btn);
  }
  document.getElementById('overlays').appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
}

export function closeMenus() {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
}

// ---- Toast ----

export function toast(message, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.getElementById('overlays').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---- Dates ----

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(dueDate) {
  return !!dueDate && dueDate < todayStr();
}

export function isToday(dueDate) {
  return dueDate === todayStr();
}

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = (today - that) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function shortDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Whole calendar days a task has been (or was) afloat — created 23:59
// yesterday reads as 1 day, not 0.
export function ageDays(createdAtMs) {
  if (!createdAtMs) return 0;
  const created = new Date(createdAtMs); created.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - created) / 86400000));
}

export function durationLabel(days) {
  if (days <= 0) return 'afloat today';
  return `afloat ${days} day${days === 1 ? '' : 's'}`;
}
// The constellation glyph — Threads' mark: three stars and their lines,
// drawn as SVG so it themes (currentColor) and never falls back to tofu.
export function constellationGlyph(size = 14) {
  // Three stars: a central node with two distal companions — the smallest
  // constellation that still makes a figure.
  return `<svg class="constellation-glyph" viewBox="0 0 16 16" width="${size}" height="${size}"
    aria-hidden="true"><line x1="9.6" y1="11.4" x2="4" y2="4.6"/>
    <line x1="9.6" y1="11.4" x2="12.9" y2="3.8"/>
    <circle cx="9.6" cy="11.4" r="1.8"/><circle cx="4" cy="4.6" r="1.1"/>
    <circle cx="12.9" cy="3.8" r="1.1"/></svg>`;
}

export function scrollGlyph(size = 16) {
  // The Log: a handscroll unrolling horizontally — two solid rollers poking
  // above and below the blank sheet between them (mockup variant E).
  return `<svg class="scroll-glyph" viewBox="0 0 24 14" width="${size}" height="${size * 14 / 24}"
    aria-hidden="true"><rect x="1.4" y="0.6" width="3" height="12.8" fill="currentColor"/><rect x="19.6" y="0.6" width="3" height="12.8" fill="currentColor"/><rect x="4.4" y="3.4" width="15.2" height="7.2" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
}
