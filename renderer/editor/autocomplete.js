// Shared popup for the / block menu and the @ page-link menu.

let popupEl = null;
let activeIndex = 0;
let allItems = [];
let currentItems = [];
let onPick = null;

export function openMenu({ x, y, items, pick }) {
  closeMenu();
  allItems = items;
  currentItems = items;
  onPick = pick;
  activeIndex = 0;
  popupEl = document.createElement('div');
  popupEl.className = 'ac-menu';
  render();
  document.getElementById('overlays').appendChild(popupEl);
  position(x, y);
}

function render() {
  popupEl.innerHTML = currentItems.map((it, i) => `
    <button class="ac-item ${i === activeIndex ? 'sel' : ''}" data-i="${i}">
      <span class="ac-icon">${it.icon || '·'}</span>
      <span class="ac-label">${it.label}</span>
      <span class="ac-hint">${it.hint || ''}</span>
    </button>`).join('');
  popupEl.querySelectorAll('.ac-item').forEach(btn => {
    btn.onmousedown = (e) => { e.preventDefault(); pickIndex(Number(btn.dataset.i)); };
  });
}

function position(x, y) {
  const rect = popupEl.getBoundingClientRect();
  let top = y + 24;
  if (top + rect.height > innerHeight - 8) top = y - rect.height - 12;
  popupEl.style.left = `${Math.min(x, innerWidth - rect.width - 12)}px`;
  popupEl.style.top = `${Math.max(8, top)}px`;
}

export function filterMenu(query) {
  const q = (query || '').toLowerCase();
  currentItems = q
    ? allItems.filter(it => it.label.toLowerCase().includes(q) || (it.search || '').toLowerCase().includes(q))
    : allItems;
  activeIndex = 0;
  render();
}

export function moveMenu(dir) {
  activeIndex = (activeIndex + dir + currentItems.length) % Math.max(1, currentItems.length);
  render();
}

export function pickActive() { pickIndex(activeIndex); }

function pickIndex(i) {
  const item = currentItems[i];
  const pick = onPick; // closeMenu() nulls onPick — capture before it runs
  closeMenu();
  if (item && pick) pick(item);
}

export function closeMenu() {
  if (popupEl) { popupEl.remove(); popupEl = null; }
  allItems = [];
  currentItems = [];
  onPick = null;
}

export function isMenuOpen() { return !!popupEl; }

// ---- Caret utilities for contenteditable blocks ----

// Plain-text caret offset within an element (null if selection is elsewhere).
export function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

// HTML fragments before and after the caret within el.
export function splitAtCaret(el) {
  const sel = getSelection();
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const post = range.cloneRange();
  post.selectNodeContents(el);
  post.setStart(range.endContainer, range.endOffset);
  const toHtml = (r) => {
    const div = document.createElement('div');
    div.appendChild(r.cloneContents());
    return div.innerHTML;
  };
  return { left: toHtml(pre), right: toHtml(post) };
}

export function setCaret(el, offset) {
  el.focus();
  const sel = getSelection();
  const range = document.createRange();
  let remaining = offset;
  let placed = false;
  const walk = (node) => {
    if (placed) return;
    if (node.nodeType === 3) {
      if (remaining <= node.length) {
        range.setStart(node, remaining);
        placed = true;
        return;
      }
      remaining -= node.length;
    } else {
      for (const child of [...node.childNodes]) {
        walk(child);
        if (placed) return;
        if (child.nodeType === 1 && child.tagName === 'BR') remaining -= 1;
      }
    }
  };
  walk(el);
  if (!placed) range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function caretRect() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width || rect.height || rect.top) return rect;
  return null;
}