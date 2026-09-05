// The block editor. One block = one DOM node; only .block-content spans are
// contenteditable. Structural undo is block-level (Cmd+Z); typing relies on
// native undo within a block.

import { renderBlock, readBlockDOM, newBlock, renumberLists, BLOCK_MENU, isTextBlock } from './blocks.js';
import { sanitizeHtml } from './sanitize.js';
import { convertOneNoteHtml } from '../onenote/convert.js';
import { splitIntoDayRows } from '../onenote/journal.js';
import {
  openMenu, closeMenu, isMenuOpen, moveMenu, pickActive, filterMenu,
  caretOffset, splitAtCaret, setCaret, caretRect,
} from './autocomplete.js';
import { contextMenu, uid, esc } from '../ui/components.js';
import { openImageViewer } from '../ui/imgview.js';

const UNDO_CAP = 100;

// OneNote marks its clipboard HTML with a ProgId meta tag — the signature
// that routes a paste through the OneNote converter. Everything else keeps
// the plain inline paste.
function isOneNoteHtml(html) {
  return /progid[^>]*onenote|onenote\.file/i.test(html.slice(0, 800));
}

// Strip clipboard html to plain text: cells separate with tabs, rows and
// blocks with newlines, so a copied table reads as rows rather than one
// glued line. Used when the clipboard carries no text/plain flavor.
function htmlToPlain(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.push(child.textContent); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === 'BR') { out.push('\n'); continue; }
      if (tag === 'TD' || tag === 'TH') { walk(child); out.push('\t'); continue; }
      walk(child);
      if (/^(TR|P|DIV|H[1-6]|LI|BLOCKQUOTE|TABLE|UL|OL|PRE)$/.test(tag)) out.push('\n');
    }
  };
  walk(doc.body);
  return out.join('').replace(/\t\n/g, '\n').replace(/[ \t]+(\n|$)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

export class Editor {
  constructor(container, { onChange, onOpenPage } = {}) {
    this.container = container;
    this.onChange = onChange || (() => {});
    this.onOpenPage = onOpenPage || (() => {});
    this.blocks = [];
    this.undoStack = [];
    this.redoStack = [];
    this.menuBlockId = null; // block the @/slash menu was opened for
    this.bindEvents();
  }

  // ---- Model <-> DOM ----

  load(blocks) {
    this.blocks = (blocks && blocks.length) ? blocks.map(b => ({ ...b })) : [newBlock({ type: 'paragraph' })];
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    for (const block of this.blocks) this.container.appendChild(renderBlock(block));
    renumberLists(this.container);
  }

  getBlocks() {
    const out = [];
    for (const el of this.container.children) {
      const b = readBlockDOM(el);
      if (b.html !== undefined) b.html = sanitizeHtml(b.html);
      out.push(b);
    }
    return out;
  }

  blockEl(id) { return this.container.querySelector(`.block[data-id="${id}"]`); }

  indexOfEl(el) { return [...this.container.children].indexOf(el); }

  contentOf(el) { return el.querySelector('.block-content'); }

  focusBlock(id, offset = null) {
    const el = this.blockEl(id);
    if (!el) return;
    const content = this.contentOf(el) || el.querySelector('.image-caption');
    if (content) setCaret(content, offset === null ? content.textContent.length : offset);
  }

  focusTable(id) {
    const el = this.blockEl(id);
    const cell = el?.querySelector('th[contenteditable], td[contenteditable]');
    if (cell) setCaret(cell, 0);
  }

  // ---- Structural mutation (with undo snapshot) ----

  _snapshot() {
    this.undoStack.push(JSON.stringify(this.getBlocks()));
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.getBlocks()));
    const snap = this.undoStack.pop();
    this._restore(snap);
    this.onChange();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.getBlocks()));
    const snap = this.redoStack.pop();
    this._restore(snap);
    this.onChange();
  }

  _restore(snap) {
    this.blocks = JSON.parse(snap);
    this.render();
  }

  // ---- Events ----

  bindEvents() {
    const c = this.container;

    c.addEventListener('input', (e) => this.onInput(e));
    c.addEventListener('keydown', (e) => this.onKeydown(e));
    c.addEventListener('paste', (e) => this.onPaste(e));
    c.addEventListener('dragover', (e) => this.onDragOver(e));
    c.addEventListener('drop', (e) => this.onDrop(e));
    c.addEventListener('click', (e) => this.onClick(e));
    c.addEventListener('contextmenu', (e) => this.onContextClick(e));

    // Double-click an image → fullscreen viewer.
    c.addEventListener('dblclick', (e) => {
      const img = e.target.closest('.image-fig img');
      if (!img) return;
      const caption = img.closest('.image-fig')?.querySelector('.image-caption')?.textContent || '';
      openImageViewer(img.getAttribute('src'), caption);
    });

    // Block reorder via the drag handle.
    c.addEventListener('dragstart', (e) => {
      const handle = e.target.closest('.handle-drag');
      if (handle) {
        this.dragId = handle.closest('.block').dataset.id;
        e.dataTransfer.setData('text/plain', 'block');
        e.dataTransfer.effectAllowed = 'move';
      } else if (e.target.closest('.image-fig') || e.target.closest('.file-chip')) {
        // let file drops from Finder work; native image drag is disabled
        e.preventDefault();
      }
    });

    c.addEventListener('mousedown', (e) => {
      const addBtn = e.target.closest('.handle-add');
      if (addBtn) {
        e.preventDefault();
        const el = addBtn.closest('.block');
        this._snapshot();
        const i = this.indexOfEl(el);
        const nb = newBlock({ type: 'paragraph' });
        this.container.insertBefore(renderBlock(nb), el.nextSibling);
        renumberLists(this.container);
        this.onChange();
        this.focusBlock(nb.id, 0);
      }
    });

    // Floating inline-format toolbar on selection.
    c.addEventListener('mouseup', () => this.maybeShowFormatBar());
    document.addEventListener('selectionchange', () => this.maybeShowFormatBar());
  }

  onInput(e) {
    const content = e.target.closest('.block-content');
    if (!content) { this.onChange(); return; }
    const el = content.closest('.block');
    const text = content.textContent;

    // Menus already open: keep filtering.
    if (isMenuOpen() && this.menuBlockId === el.dataset.id) {
      const trigger = this.menuTrigger || '';
      const tail = text.slice(this.menuStartIdx);
      if (!tail.startsWith(this.menuChar) || (this.menuChar === '/' && tail.includes(' '))) {
        closeMenu();
      } else {
        filterMenu(tail.slice(1));
      }
      return;
    }

    // Markdown shortcuts: caret at end, prefix typed.
    const caret = caretOffset(content);
    if (caret === text.length) {
      const rules = [
        { re: /^### $/, make: { type: 'heading', level: 3 } },
        { re: /^## $/,  make: { type: 'heading', level: 2 } },
        { re: /^# $/,   make: { type: 'heading', level: 1 } },
        { re: /^(\[\]|\[ \]) $/, make: { type: 'todo' } },
        { re: /^[-*] $/, make: { type: 'list-item', ordered: false } },
        { re: /^1\. $/,  make: { type: 'list-item', ordered: true } },
        { re: /^> $/,    make: { type: 'quote' } },
        { re: /^\| $/,   make: { type: 'table' } },
        { re: /^``` $/,  make: { type: 'code' } },
      ];
      for (const rule of rules) {
        if (rule.re.test(text)) {
          this._snapshot();
          const i = this.indexOfEl(el);
          const block = newBlock(rule.make);
          this.container.replaceChild(renderBlock(block), el);
          renumberLists(this.container);
          this.onChange();
          this.focusBlock(block.id, 0);
          return;
        }
      }
      if (/^--- $/.test(text)) {
        this._snapshot();
        const block = newBlock({ type: 'divider' });
        this.container.replaceChild(renderBlock(block), el);
        const after = newBlock({ type: 'paragraph' });
        this.container.insertBefore(renderBlock(after), this.blockEl(block.id).nextSibling);
        renumberLists(this.container);
        this.onChange();
        this.focusBlock(after.id, 0);
        return;
      }
    }

    // Open slash menu.
    if (text.endsWith('/') && el.dataset.type === 'paragraph') {
      this.menuBlockId = el.dataset.id;
      this.menuChar = '/';
      this.menuStartIdx = text.length - 1;
      this.menuTrigger = '/';
      const rect = caretRect() || content.getBoundingClientRect();
      openMenu({
        x: rect.left, y: rect.bottom,
        items: BLOCK_MENU,
        pick: (item) => this.applyBlockMenu(item, el),
      });
      return;
    }

    // Open @-page menu.
    if (text.endsWith('@') && isTextBlock({ type: el.dataset.type }) && el.dataset.type !== 'quote') {
      this.menuBlockId = el.dataset.id;
      this.menuChar = '@';
      this.menuStartIdx = text.length - 1;
      this.menuTrigger = '@';
      const rect = caretRect() || content.getBoundingClientRect();
      window.api.listPages().then((pages) => {
        openMenu({
          x: rect.left, y: rect.bottom,
          items: pages.map(p => ({ id: p.id, label: p.title, hint: p.path, icon: '📄', search: p.path })),
          pick: (item) => this.applyPageLink(item, el),
        });
      });
      return;
    }

    this.onChange();
  }

  applyBlockMenu(item, el) {
    this._snapshot();
    const content = this.contentOf(el);
    // Strip the "/query" trigger text that opened the menu.
    const remainder = content ? content.textContent.slice(0, this.menuStartIdx) : '';
    const block = newBlock(item.type === 'heading' ? { type: 'heading', level: item.level } : item);
    if (item.type === 'list-item') block.ordered = !!item.ordered;
    if (remainder.trim() === '') {
      this.container.replaceChild(renderBlock(block), el);
      renumberLists(this.container);
      this.onChange();
    } else {
      content.textContent = remainder;
      this.container.insertBefore(renderBlock(block), el.nextSibling);
      renumberLists(this.container);
      this.onChange();
    }
    this.menuBlockId = null;
    this.menuTrigger = '';
    this.menuStartIdx = 0;
    if (this.contentOf(this.blockEl(block.id))) this.focusBlock(block.id, 0);
    else if (block.type === 'table') this.focusTable(block.id);
  }

  applyPageLink(item, el) {
    this._snapshot();
    const content = this.contentOf(el);
    // Strip the "@query" trigger text that opened the menu.
    const remainder = content ? content.textContent.slice(0, this.menuStartIdx) : '';
    const block = newBlock({ type: 'page-link', pageId: item.id, title: item.label });
    if (remainder.trim() === '') {
      this.container.replaceChild(renderBlock(block), el);
    } else {
      content.textContent = remainder;
      this.container.insertBefore(renderBlock(block), el.nextSibling);
    }
    renumberLists(this.container);
    this.onChange();
    this.menuBlockId = null;
    this.menuTrigger = '';
    this.menuStartIdx = 0;
    const after = this.blockEl(block.id).nextSibling;
    if (!after) {
      const nb = newBlock({ type: 'paragraph' });
      this.container.appendChild(renderBlock(nb));
      this.onChange();
      this.focusBlock(nb.id, 0);
    } else if (this.contentOf(after)) {
      this.focusBlock(after.dataset.id, 0);
    }
  }

  onKeydown(e) {
    const meta = e.metaKey || e.ctrlKey;

    if (isMenuOpen()) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMenu(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveMenu(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); pickActive(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    }

    // Structural undo only when the stack has something; an empty stack
    // falls through to the browser's native (per-block typing) undo —
    // unconditionally preventDefault-ing here used to kill it entirely,
    // which is why ⌘Z "did nothing".
    if (meta && e.key === 'z' && !e.shiftKey) {
      if (this.undoStack.length) { e.preventDefault(); this.undo(); }
      return;
    }
    if (meta && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
      if (this.redoStack.length) { e.preventDefault(); this.redo(); }
      return;
    }

    // Inline formatting works on any text block.
    const content = e.target.closest('.block-content');
    if (content && meta && !e.shiftKey && 'biu'.includes(e.key)) {
      e.preventDefault();
      const cmd = { b: 'bold', i: 'italic', u: 'underline' }[e.key];
      document.execCommand(cmd);
      this.onChange();
      return;
    }

    if (meta && e.key === 'Enter' && content?.closest('.block')?.dataset.type === 'todo') {
      e.preventDefault();
      const check = content.closest('.block').querySelector('.todo-check');
      check.checked = !check.checked;
      content.classList.toggle('done', check.checked);
      this.onChange();
      return;
    }

    // Code blocks are just textareas.
    if (e.target.classList?.contains('code-text')) {
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        this._snapshot();
        const el = e.target.closest('.block');
        const nb = newBlock({ type: 'paragraph' });
        this.container.insertBefore(renderBlock(nb), el.nextSibling);
        this.onChange();
        this.focusBlock(nb.id, 0);
      }
      return; // everything else native
    }

    // Table cells are their own contenteditable surface (not .block-content).
    const cell = e.target.closest?.('.block-table th, .block-table td');
    if (cell) {
      this.onTableKeydown(e, cell);
      return;
    }

    if (!content) return;
    const el = content.closest('.block');
    const type = el.dataset.type;
    const offset = caretOffset(content);
    const text = content.textContent;
    const last = this.indexOfEl(el) === this.container.children.length - 1;

    // ---- Tab / Shift+Tab ----
    if (e.key === 'Tab' && type === 'list-item') {
      e.preventDefault();
      const indent = Number(el.dataset.indent) || 0;
      el.dataset.indent = e.shiftKey ? Math.max(0, indent - 1) : Math.min(4, indent + 1);
      el.style.marginLeft = `${el.dataset.indent * 26}px`;
      renumberLists(this.container);
      this.onChange();
      return;
    }

    // ---- Enter ----
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Empty todo/list/quote/heading → fall out to paragraph.
      if ((type === 'todo' || type === 'list-item' || type === 'quote' || type === 'heading') && text.trim() === '') {
        this._snapshot();
        const nb = newBlock({ type: 'paragraph' });
        this.container.replaceChild(renderBlock(nb), el);
        renumberLists(this.container);
        this.onChange();
        this.focusBlock(nb.id, 0);
        return;
      }
      this._snapshot();
      const { left, right } = splitAtCaret(content);
      // Continue lists/todos with the same type; everything else falls to paragraph.
      const contType = (type === 'todo') ? 'todo' : (type === 'list-item') ? 'list-item' : 'paragraph';
      const nb = newBlock(contType === 'list-item' ? { type: 'list-item', ordered: el.dataset.ordered === '1' } : { type: contType });
      if (contType === 'list-item') nb.indent = Number(el.dataset.indent) || 0;
      nb.html = right;
      content.innerHTML = left;
      this.container.insertBefore(renderBlock(nb), el.nextSibling);
      renumberLists(this.container);
      this.onChange();
      this.focusBlock(nb.id, 0);
      return;
    }

    // ---- Backspace at block start ----
    if (e.key === 'Backspace' && offset === 0 && text !== '') {
      if (type === 'list-item' && (Number(el.dataset.indent) || 0) > 0) {
        e.preventDefault();
        el.dataset.indent = Math.max(0, (Number(el.dataset.indent) || 0) - 1);
        el.style.marginLeft = `${el.dataset.indent * 26}px`;
        renumberLists(this.container);
        this.onChange();
        return;
      }
      // Demote styled block to paragraph on first backspace.
      if (type !== 'paragraph') {
        e.preventDefault();
        this._snapshot();
        const prev = el.previousElementSibling;
        const nb = newBlock({ type: 'paragraph' });
        nb.html = content.innerHTML;
        this.container.replaceChild(renderBlock(nb), el);
        renumberLists(this.container);
        this.onChange();
        this.focusBlock(nb.id, 0);
        return;
      }
      // Paragraph with text: merge into previous text block.
      const prev = el.previousElementSibling;
      if (prev && this.contentOf(prev)) {
        e.preventDefault();
        this._snapshot();
        const prevContent = this.contentOf(prev);
        const joinAt = prevContent.textContent.length;
        prevContent.innerHTML = prevContent.innerHTML + content.innerHTML;
        el.remove();
        renumberLists(this.container);
        this.onChange();
        this.focusBlock(prev.dataset.id, joinAt);
      }
      return;
    }

    if (e.key === 'Backspace' && offset === 0 && text === '') {
      // Empty block: delete and merge focus.
      e.preventDefault();
      if (type === 'paragraph' && this.container.children.length > 1) {
        this._snapshot();
        const prev = el.previousElementSibling;
        el.remove();
        renumberLists(this.container);
        this.onChange();
        if (prev && this.contentOf(prev)) this.focusBlock(prev.dataset.id, null);
      } else if (type !== 'paragraph') {
        this._snapshot();
        const nb = newBlock({ type: 'paragraph' });
        this.container.replaceChild(renderBlock(nb), el);
        this.onChange();
        this.focusBlock(nb.id, 0);
      }
      return;
    }

    // ---- Arrow keys across blocks ----
    if (e.key === 'ArrowUp' && offset === 0) {
      let prev = el.previousElementSibling;
      while (prev && !this.contentOf(prev)) prev = prev.previousElementSibling;
      if (prev) { e.preventDefault(); this.focusBlock(prev.dataset.id, null); }
      return;
    }
    if (e.key === 'ArrowDown' && offset === text.length) {
      let next = el.nextElementSibling;
      while (next && !this.contentOf(next)) next = next.nextElementSibling;
      if (next) { e.preventDefault(); this.focusBlock(next.dataset.id, 0); }
      return;
    }
  }

  // ---- Tables ----
  // Cells are plain-text contenteditable th/td, not .block-content.
  // Structural operations manipulate the DOM directly (readBlockDOM
  // serializes from DOM order), each wrapped in an undo snapshot.

  tableCells(table) {
    return [...table.querySelectorAll('th[contenteditable], td[contenteditable]')];
  }

  onTableKeydown(e, cell) {
    const table = cell.closest('.block-table');

    if (e.key === 'Tab') {
      e.preventDefault();
      const cells = this.tableCells(table);
      const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      if (next) {
        setCaret(next, 0);
      } else if (!e.shiftKey) {
        const tr = this.addTableRowDOM(table);
        setCaret(tr.querySelector('td[contenteditable]'), 0);
        this.onChange();
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        // Exit the table: paragraph after it.
        this._snapshot();
        const el = cell.closest('.block');
        const nb = newBlock({ type: 'paragraph' });
        this.container.insertBefore(renderBlock(nb), el.nextSibling);
        this.onChange();
        this.focusBlock(nb.id, 0);
        return;
      }
      // Down one row; a trailing row is created at the bottom.
      const tr = cell.closest('tr');
      const target = (cell.tagName === 'TH' ? table.tBodies[0]?.rows[0] : tr.nextElementSibling)
        || this.addTableRowDOM(table);
      this.onChange();
      const below = target.querySelector(`td[data-col="${cell.dataset.col}"]`);
      if (below) setCaret(below, 0);
      return;
    }

    // Vertical arrow movement across rows when at the cell's edge.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const atEdge = e.key === 'ArrowUp'
        ? caretOffset(cell) === 0
        : caretOffset(cell) === cell.textContent.length;
      if (!atEdge) return;
      const tr = cell.closest('tr');
      const targetTr = e.key === 'ArrowUp'
        ? (tr.previousElementSibling || (cell.tagName === 'TD' && table.tHead ? table.tHead.rows[0] : null))
        : (tr.nextElementSibling || (cell.tagName === 'TH' && table.tBodies[0] ? table.tBodies[0].rows[0] : null));
      if (!targetTr) return;
      e.preventDefault();
      const target = targetTr.querySelector(`[data-col="${cell.dataset.col}"]`);
      if (target) setCaret(target, e.key === 'ArrowUp' ? target.textContent.length : 0);
    }
  }

  addTableRowDOM(table, afterTr = null) {
    this._snapshot();
    const cols = [...table.querySelectorAll('thead th[data-col]')].map(th => th.dataset.col);
    const tr = document.createElement('tr');
    tr.dataset.row = uid();
    tr.innerHTML = `<td class="table-gutter"><button class="table-row-menu" title="Row actions">⌄</button></td>`
      + cols.map(c => `<td contenteditable="true" data-col="${esc(c)}"></td>`).join('');
    if (afterTr) afterTr.after(tr);
    else table.tBodies[0].appendChild(tr);
    return tr;
  }

  addTableColDOM(table, afterTh = null) {
    this._snapshot();
    const colId = uid();
    const th = document.createElement('th');
    th.contentEditable = 'true';
    th.dataset.col = colId;
    th.dataset.placeholder = 'Column…';
    if (afterTh) afterTh.after(th);
    else table.tHead?.rows[0].appendChild(th);
    for (const tr of table.tBodies[0].rows) {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.dataset.col = colId;
      tr.appendChild(td);
    }
  }

  deleteTableColDOM(table, colId) {
    if (table.querySelectorAll('th[data-col]').length <= 1) return; // keep one column
    this._snapshot();
    table.querySelector(`th[data-col="${colId}"]`)?.remove();
    table.querySelectorAll(`tbody td[data-col="${colId}"]`).forEach(td => td.remove());
  }

  deleteTableRowDOM(table, tr) {
    if (table.tBodies[0].rows.length <= 1) return; // keep one row
    this._snapshot();
    tr.remove();
  }

  // ---- Paste ----

  async onPaste(e) {
    const dt = e.clipboardData;
    const targetContent = e.target.closest('.block-content');
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');

    // OneNote puts BOTH a rendered PNG and the structured HTML on the
    // clipboard — the HTML must win, or a copied table lands as a picture
    // of the table. Some OneNote builds drop the ProgId signature, so any
    // clipboard that carries an image alongside table-shaped HTML gets the
    // converter attempt too; if it parses, blocks beat the bitmap.
    if (targetContent && html && (isOneNoteHtml(html) || (dt.files && dt.files.length && /<table/i.test(html)))) {
      let blocks = null;
      try { blocks = convertOneNoteHtml(html).blocks; } catch { /* fall through to the image */ }
      if (blocks && blocks.length) {
        e.preventDefault();
        await this.pasteOneNote(html, targetContent?.closest('.block'));
        return;
      }
    }

    if (dt.files && dt.files.length) {
      e.preventDefault();
      await this.insertFiles([...dt.files], targetContent?.closest('.block'));
      return;
    }

    // (OneNote HTML that failed conversion falls through to the generic
    // html paste below — sanitized inline HTML beats pasting nothing.)
    if (targetContent && html) {
      e.preventDefault();
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      this.onChange();
      return;
    }
    if (targetContent && text) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
      this.onChange();
      return;
    }
    // Empty-handed paste: macOS screenshots often bypass clipboardData —
    // read the system clipboard image in the main process.
    if (!html && !text) {
      e.preventDefault();
      await this.pasteSystemImage();
    }
  }

  // Copy a page (or any selection) in OneNote, paste here: the clipboard
  // HTML converts into real blocks — headings, lists, tables, and images
  // saved to the local attachments store. No cloud import involved.
  async pasteOneNote(html, afterBlockEl) {
    let blocks;
    try {
      blocks = convertOneNoteHtml(html).blocks;
    } catch { return; } // not actually parseable — fall through, nothing lost
    let index = afterBlockEl ? this.indexOfEl(afterBlockEl) + 1 : this.container.children.length;
    for (const b of blocks) {
      if (b.type === 'image' && b.dataUri) {
        const m = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/i.exec(b.dataUri);
        if (!m) continue;
        const ext = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
        const att = await window.api.addAttachmentData(bytes, ext, `onenote-${index}.${ext}`);
        if (!att) continue;
        Object.assign(b, { url: att.url, name: att.name || b.name });
        delete b.dataUri;
      }
      this.insertBlock(b, index++);
    }
  }

  async pasteSystemImage() {
    const att = await window.api.pasteImage();
    if (!att) return;
    this.insertBlockAtFocus(newBlock({ type: 'image', ...att }));
  }

  async insertFiles(files, afterBlockEl) {
    for (const file of files) {
      const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const att = await window.api.addAttachmentData(bytes, ext, file.name);
      const isImage = att.isImage ?? file.type.startsWith('image/');
      const block = newBlock({ type: isImage ? 'image' : 'file', ...att });
      this.insertBlock(block, afterBlockEl ? this.indexOfEl(afterBlockEl) + 1 : this.container.children.length);
    }
  }

  insertBlock(block, index) {
    this._snapshot();
    const el = renderBlock(block);
    if (index >= this.container.children.length) this.container.appendChild(el);
    else this.container.insertBefore(el, this.container.children[index]);
    renumberLists(this.container);
    this.onChange();
  }

  // Insert relative to the block containing the caret (or the last block).
  insertBlockAtFocus(block) {
    const sel = getSelection();
    let el = null;
    if (sel.rangeCount && this.container.contains(sel.getRangeAt(0).startContainer)) {
      el = sel.getRangeAt(0).startContainer.parentElement?.closest('.block');
    }
    const index = el ? this.indexOfEl(el) + 1 : this.container.children.length;
    this.insertBlock(block, index);
  }

  // ---- Drag reorder / file drop ----

  onDragOver(e) {
    if (this.dragId || (e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = this.dragId ? 'move' : 'copy';
      this.container.querySelectorAll('.block').forEach(b => b.classList.remove('drop-above', 'drop-below'));
      const blockEl = e.target.closest('.block');
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        blockEl.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
      }
    }
  }

  async onDrop(e) {
    const blockEl = e.target.closest('.block');
    this.container.querySelectorAll('.block').forEach(b => b.classList.remove('drop-above', 'drop-below'));

    // File drop from Finder.
    if (e.dataTransfer.files && e.dataTransfer.files.length && !this.dragId) {
      e.preventDefault();
      await this.insertFiles([...e.dataTransfer.files], blockEl);
      return;
    }

    // Block reorder.
    if (this.dragId && blockEl && blockEl.dataset.id !== this.dragId) {
      e.preventDefault();
      this._snapshot();
      const from = this.blockEl(this.dragId);
      const before = e.clientY < blockEl.getBoundingClientRect().top + blockEl.getBoundingClientRect().height / 2;
      this.container.removeChild(from);
      this.container.insertBefore(from, before ? blockEl : blockEl.nextSibling);
      renumberLists(this.container);
      this.onChange();
    }
    this.dragId = null;
  }

  // ---- Clicks: checkboxes, chips, handles ----

  onClick(e) {
    const check = e.target.closest('.todo-check');
    if (check) {
      check.closest('.block').querySelector('.block-content').classList.toggle('done', check.checked);
      this.onChange();
      return;
    }
    const chip = e.target.closest('.page-link-chip');
    if (chip) { this.onOpenPage(chip.dataset.page); return; }
    const fileChip = e.target.closest('.file-chip');
    if (fileChip) { window.api.revealAttachment(fileChip.closest('.block').dataset.attachmentId); return; }
    const img = e.target.closest('.image-fig img');
    if (img) { return; }
    const addCol = e.target.closest('.table-add-col');
    if (addCol) {
      this.addTableColDOM(addCol.closest('.block-table'));
      this.onChange();
      return;
    }
    const addRow = e.target.closest('.table-add-row');
    if (addRow) {
      const table = addRow.closest('.block-table');
      this.addTableRowDOM(table);
      this.onChange();
      const lastCell = table.querySelector('tbody tr:last-child td[contenteditable]');
      if (lastCell) setCaret(lastCell, 0);
      return;
    }
    const rowMenu = e.target.closest('.table-row-menu');
    if (rowMenu) {
      const table = rowMenu.closest('.block-table');
      const tr = rowMenu.closest('tr');
      const rect = rowMenu.getBoundingClientRect();
      contextMenu(rect.left, rect.bottom + 4, [
        { label: 'Insert above', onClick: () => { this.addTableRowDOM(table, tr.previousElementSibling || null); this.onChange(); } },
        { label: 'Insert below', onClick: () => { this.addTableRowDOM(table, tr); this.onChange(); } },
        '-',
        { label: 'Delete row', danger: true, onClick: () => { this.deleteTableRowDOM(table, tr); this.onChange(); } },
      ]);
      return;
    }
    const dragHandle = e.target.closest('.handle-drag');
    if (dragHandle) {
      e.preventDefault();
      this.openBlockMenu(dragHandle.closest('.block'));
    }
  }

  // Right-click: column actions on tables; everywhere else (and below the
  // table actions) the clipboard menu — paste as text or as image, plus the
  // everyday cut/copy/select-all.
  onContextClick(e) {
    e.preventDefault();
    const table = e.target.closest('.block-table');
    const target = e.target.closest('.block-content');
    const items = [];
    if (table) {
      const th = e.target.closest('.block-table thead th');
      items.push(
        // A pasted OneNote day table (Tasks | Notes | Files) → day rows on a
        // sub-objective of the current project, dates read from the first column.
        { label: 'Split into day rows…', onClick: () => this.splitTableIntoDays(table) },
        '-',
      );
      if (th) {
        items.push(
          { label: 'Insert left', onClick: () => { this.addTableColDOM(table, th.previousElementSibling); this.onChange(); } },
          { label: 'Insert right', onClick: () => { this.addTableColDOM(table, th); this.onChange(); } },
          '-',
          { label: 'Delete column', danger: true, onClick: () => { this.deleteTableColDOM(table, th.dataset.col); this.onChange(); } },
          '-',
        );
      }
    }
    const sel = getSelection();
    const hasSel = sel.rangeCount && !sel.isCollapsed && this.container.contains(sel.anchorNode);
    if (hasSel) {
      items.push(
        { label: 'Cut', onClick: () => { document.execCommand('cut'); this.onChange(); } },
        { label: 'Copy', onClick: () => document.execCommand('copy') },
      );
    }
    items.push(
      { label: 'Paste', onClick: () => { target?.focus(); this.pasteFromSystemClipboard(target?.closest('.block')); } },
      { label: 'Paste as text', onClick: () => { target?.focus(); this.pasteClipboardAsText(); } },
      { label: 'Paste as image', onClick: () => this.pasteSystemImage() },
      '-',
      { label: 'Select all', onClick: () => document.execCommand('selectAll') },
    );
    contextMenu(e.clientX, e.clientY, items);
  }

  // Right-click → Paste: same priority as the keyboard paste, but read from
  // the system clipboard over IPC — there's no clipboardData event to ride on.
  async pasteFromSystemClipboard(afterBlockEl) {
    const html = (await window.api.readClipboardHtml()) || '';
    const text = (await window.api.readClipboardText()) || '';
    if (html && (isOneNoteHtml(html) || /<table/i.test(html))) {
      let blocks = null;
      try { blocks = convertOneNoteHtml(html).blocks; } catch { /* fall through */ }
      if (blocks && blocks.length) {
        await this.pasteOneNote(html, afterBlockEl);
        return;
      }
    }
    if (html) {
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      this.onChange();
      return;
    }
    if (text) {
      document.execCommand('insertText', false, text);
      this.onChange();
      return;
    }
    await this.pasteSystemImage();
  }

  // Right-click → Paste as text: the plain-text flavor if the clipboard has
  // one, else its html stripped to text (line breaks kept). This is the
  // escape hatch when a OneNote table refuses to convert — you always get
  // the words, never the picture.
  async pasteClipboardAsText() {
    let text = (await window.api.readClipboardText()) || '';
    if (!text) {
      const html = (await window.api.readClipboardHtml()) || '';
      if (html) text = htmlToPlain(html);
    }
    if (!text) {
      await this.pasteSystemImage();
      return;
    }
    document.execCommand('insertText', false, text);
    this.onChange();
  }

  splitTableIntoDays(tableEl) {
    const blockEl = tableEl.closest('.block');
    const block = blockEl ? readBlockDOM(blockEl) : null;
    if (!block) return;
    this._snapshot();
    splitIntoDayRows(block);
  }

  openBlockMenu(el) {
    const rect = el.querySelector('.block-handles').getBoundingClientRect();
    const i = this.indexOfEl(el);
    const isText = !!this.contentOf(el);
    const turnInto = (make) => {
      this._snapshot();
      const block = newBlock(make);
      if (block.type === 'table') {
        // Fresh empty grid; text content is dropped.
      } else if (isText && this.contentOf(el)) {
        block.html = this.contentOf(el).innerHTML;
        if (block.type === 'heading') block.level = make.level;
      } else if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'todo' || block.type === 'list-item') {
        block.html = '';
      }
      this.container.replaceChild(renderBlock(block), el);
      renumberLists(this.container);
      this.onChange();
      if (this.contentOf(this.blockEl(block.id))) this.focusBlock(block.id, 0);
      else if (block.type === 'table') this.focusTable(block.id);
    };
    contextMenu(rect.right + 6, rect.top, [
      { label: 'Text', onClick: () => turnInto({ type: 'paragraph' }) },
      { label: 'Heading 1', onClick: () => turnInto({ type: 'heading', level: 1 }) },
      { label: 'Heading 2', onClick: () => turnInto({ type: 'heading', level: 2 }) },
      { label: 'Heading 3', onClick: () => turnInto({ type: 'heading', level: 3 }) },
      { label: 'To-do', onClick: () => turnInto({ type: 'todo' }) },
      { label: 'Quote', onClick: () => turnInto({ type: 'quote' }) },
      { label: 'Table', onClick: () => turnInto({ type: 'table' }) },
      '-',
      {
        label: 'Duplicate', onClick: () => {
          this._snapshot();
          const copy = { ...readBlockDOM(el), id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
          this.container.insertBefore(renderBlock(copy), el.nextSibling);
          this.onChange();
        },
      },
      {
        label: 'Delete', danger: true, onClick: () => {
          if (this.container.children.length <= 1) return;
          this._snapshot();
          el.remove();
          renumberLists(this.container);
          this.onChange();
        },
      },
    ]);
  }

  // ---- Floating format bar ----

  maybeShowFormatBar() {
    const sel = getSelection();
    const existing = document.getElementById('format-bar');
    if (!sel.isCollapsed && sel.rangeCount && this.container.contains(sel.anchorNode)) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      let bar = existing;
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'format-bar';
        bar.innerHTML = `
          <button data-cmd="bold" title="Bold (⌘B)"><b>B</b></button>
          <button data-cmd="italic" title="Italic (⌘I)"><i>I</i></button>
          <button data-cmd="underline" title="Underline (⌘U)"><u>U</u></button>
          <button data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
          <button data-cmd="code" title="Code">‹›</button>
          <button data-cmd="link" title="Link">🔗</button>`;
        bar.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const cmd = e.target.closest('button').dataset.cmd;
          if (cmd === 'link') {
            const url = prompt('Link URL:');
            if (url) { document.execCommand('createLink', false, url); this.onChange(); }
          } else if (cmd === 'code') {
            this.toggleInlineCode();
          } else {
            document.execCommand(cmd);
            this.onChange();
          }
          this.hideFormatBar();
        });
        document.getElementById('overlays').appendChild(bar);
      }
      bar.style.left = `${Math.max(8, rect.left + rect.width / 2 - bar.offsetWidth / 2)}px`;
      bar.style.top = `${rect.top - 38}px`;
    } else {
      this.hideFormatBar();
    }
  }

  hideFormatBar() {
    document.getElementById('format-bar')?.remove();
  }

  // Wrap/unwrap the selection in <code>.
  toggleInlineCode() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const codeEl = range.startContainer.parentElement?.closest('code');
    if (codeEl && this.container.contains(codeEl)) {
      // Unwrap.
      const parent = codeEl.parentNode;
      while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
      parent.removeChild(codeEl);
    } else {
      const code = document.createElement('code');
      code.appendChild(range.extractContents());
      range.insertNode(code);
      sel.removeAllRanges();
    }
    this.onChange();
  }

  // Public: append a file-picker attachment (used by page toolbar).
  async attachFromPicker() {
    const filePath = await window.api.openFileDialog();
    if (!filePath) return;
    const att = await window.api.addAttachmentFile({ filePath });
    const block = newBlock({ type: att.isImage ? 'image' : 'file', ...att });
    this.insertBlockAtFocus(block);
  }
}