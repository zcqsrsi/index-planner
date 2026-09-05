// Block types: factories, DOM rendering, and serialization.
// One block = one DOM node (.block[data-id]); only .block-content is contenteditable.

import { esc, uid } from '../ui/components.js';

export const BLOCK_MENU = [
  { type: 'paragraph', label: 'Text', icon: '¶', hint: 'Plain text' },
  { type: 'heading', level: 1, label: 'Heading 1', icon: 'H1', hint: 'Big section title' },
  { type: 'heading', level: 2, label: 'Heading 2', icon: 'H2', hint: 'Medium heading' },
  { type: 'heading', level: 3, label: 'Heading 3', icon: 'H3', hint: 'Small heading' },
  { type: 'todo', label: 'To-do', icon: '☑', hint: 'Checkbox item' },
  { type: 'list-item', label: 'Bullet', icon: '•', hint: 'Bulleted list' },
  { type: 'list-item', ordered: true, label: 'Number', icon: '1.', hint: 'Numbered list' },
  { type: 'quote', label: 'Quote', icon: '❝', hint: 'Callout or citation' },
  { type: 'code', label: 'Code', icon: '{}', hint: 'Monospace block' },
  { type: 'table', label: 'Table', icon: '▦', hint: 'Editable grid' },
  { type: 'divider', label: 'Divider', icon: '—', hint: 'Horizontal rule' },
  { type: 'image', label: 'Image', icon: '▣', hint: 'Upload or paste' },
  { type: 'file', label: 'File', icon: '⎋', hint: 'Attach a file' },
  { type: 'page-link', label: 'Link to page', icon: '↗', hint: 'Link another page' },
];

export function newBlock(partial) {
  const base = { id: uid() };
  switch (partial.type) {
    case 'heading': return { ...base, type: 'heading', level: partial.level || 2, html: '' };
    case 'todo': return { ...base, type: 'todo', checked: false, html: '' };
    case 'list-item': return { ...base, type: 'list-item', ordered: !!partial.ordered, indent: 0, html: '' };
    case 'code': return { ...base, type: 'code', lang: partial.lang || '', text: '' };
    case 'table': {
      // Empty 2×2 grid; cells are keyed by column id so column operations
      // never reindex.
      const cols = [
        { id: uid(), name: 'Column A', width: null },
        { id: uid(), name: 'Column B', width: null },
      ];
      const row = () => ({ id: uid(), cells: Object.fromEntries(cols.map(c => [c.id, ''])) });
      return { ...base, type: 'table', headerRow: true, cols, rows: [row(), row()] };
    }
    case 'divider': return { ...base, type: 'divider' };
    case 'image': return { ...base, type: 'image', attachmentId: '', url: '', caption: '', ...partial };
    case 'file': return { ...base, type: 'file', attachmentId: '', name: '', size: 0, ...partial };
    case 'page-link': return { ...base, type: 'page-link', pageId: partial.pageId || '', title: partial.title || '', icon: '📄' };
    default: return { ...base, type: 'paragraph', html: '' };
  }
}

const TEXT_TYPES = new Set(['paragraph', 'heading', 'todo', 'list-item', 'quote']);
export const isTextBlock = (b) => TEXT_TYPES.has(b.type);

// Render one block to a DOM element.
export function renderBlock(block) {
  const el = document.createElement('div');
  el.className = `block block-${block.type}`;
  el.dataset.id = block.id;
  el.dataset.type = block.type;

  const handles = document.createElement('div');
  handles.className = 'block-handles';
  handles.innerHTML = `<button class="handle-add" title="Insert below">+</button>
                       <button class="handle-drag" title="Drag to reorder" draggable="true">⋮⋮</button>`;
  el.appendChild(handles);

  switch (block.type) {
    case 'heading': {
      el.insertAdjacentHTML('beforeend',
        `<div class="block-content heading-${block.level}" contenteditable="true">${block.html || ''}</div>`);
      el.dataset.level = block.level;
      break;
    }
    case 'todo': {
      el.insertAdjacentHTML('beforeend',
        `<input type="checkbox" class="todo-check" ${block.checked ? 'checked' : ''}>
         <div class="block-content ${block.checked ? 'done' : ''}" contenteditable="true">${block.html || ''}</div>`);
      break;
    }
    case 'list-item': {
      el.dataset.ordered = block.ordered ? '1' : '0';
      el.dataset.indent = block.indent || 0;
      el.style.marginLeft = `${(block.indent || 0) * 26}px`;
      // The ordinal is filled in by renumberLists() after attach.
      el.insertAdjacentHTML('beforeend',
        `<span class="list-bullet">${block.ordered ? '1.' : '•'}</span>
         <div class="block-content" contenteditable="true">${block.html || ''}</div>`);
      break;
    }
    case 'code': {
      el.insertAdjacentHTML('beforeend',
        `<input class="code-lang" placeholder="language" value="${esc(block.lang || '')}">
         <textarea class="code-text" spellcheck="false" placeholder="Code…"></textarea>`);
      el.querySelector('.code-text').value = block.text || '';
      break;
    }
    case 'divider': {
      el.insertAdjacentHTML('beforeend', `<div class="divider-line"></div>`);
      break;
    }
    case 'table': {
      // Cells are plain text stored by column id. th/td carry contenteditable
      // themselves — the editor's key handlers give them Tab/Enter semantics.
      const cols = block.cols || [];
      const rows = block.rows || [];
      const cellHtml = (text) => esc(text ?? '');
      // OneNote-converted rows are flat ({ c0: '…' }); editor rows nest their
      // values under `cells`. Both read, so pasted tables land populated.
      const cellText = (r, c) => (r.cells ? r.cells[c.id] : r[c.id]) ?? '';
      const headCells = cols.map(c =>
        `<th contenteditable="true" data-col="${esc(c.id)}" data-placeholder="Column…">${cellHtml(c.name)}</th>`).join('');
      const bodyRows = rows.map(r =>
        `<tr data-row="${esc(r.id)}"><td class="table-gutter"><button class="table-row-menu" title="Row actions">⌄</button></td>` +
        cols.map(c => `<td contenteditable="true" data-col="${esc(c.id)}">${cellHtml(cellText(r, c))}</td>`).join('') +
        `</tr>`).join('');
      el.insertAdjacentHTML('beforeend',
        `<div class="block-table-wrap">
           <table class="block-table">
             ${block.headerRow !== false ? `<thead><tr><td class="table-gutter table-corner"></td>${headCells}</tr></thead>` : ''}
             <tbody>${bodyRows}</tbody>
           </table>
           <div class="table-actions">
             <button class="table-add-col" title="Add column">＋ column</button>
             <button class="table-add-row" title="Add row">＋ row</button>
           </div>
         </div>`);
      break;
    }
    case 'image': {
      el.dataset.attachmentId = block.attachmentId || '';
      el.insertAdjacentHTML('beforeend',
        `<figure class="image-fig">
           <img src="${esc(block.url)}" alt="${esc(block.caption || '')}" draggable="false">
           <figcaption class="image-caption" contenteditable="true" data-placeholder="Caption…">${esc(block.caption || '')}</figcaption>
         </figure>`);
      break;
    }
    case 'file': {
      el.dataset.attachmentId = block.attachmentId || '';
      el.dataset.size = block.size || 0;
      const kb = block.size ? `${Math.max(1, Math.round(block.size / 1024))} KB` : '';
      el.insertAdjacentHTML('beforeend',
        `<div class="file-chip" title="Reveal in Finder">
           <span class="file-icon">⎋</span>
           <span class="file-name">${esc(block.name)}</span>
           <span class="file-size">${kb}</span>
         </div>`);
      break;
    }
    case 'page-link': {
      el.insertAdjacentHTML('beforeend',
        `<a class="page-link-chip" data-page="${esc(block.pageId)}">
           <span class="page-link-icon">${esc(block.icon || '📄')}</span>
           <span class="page-link-title">${esc(block.title || 'Untitled')}</span>
         </a>`);
      break;
    }
    default: {
      el.insertAdjacentHTML('beforeend',
        `<div class="block-content" contenteditable="true" data-placeholder="Type / for blocks…">${block.html || ''}</div>`);
    }
  }
  return el;
}

// Re-serialize a block DOM element back into the data model.
export function readBlockDOM(el) {
  const type = el.dataset.type;
  const id = el.dataset.id;
  switch (type) {
    case 'heading':
      return { id, type, level: Number(el.dataset.level) || 2, html: el.querySelector('.block-content').innerHTML };
    case 'todo':
      return { id, type, checked: el.querySelector('.todo-check').checked, html: el.querySelector('.block-content').innerHTML };
    case 'list-item':
      return {
        id, type, ordered: el.dataset.ordered === '1',
        indent: Number(el.dataset.indent) || 0,
        html: el.querySelector('.block-content').innerHTML,
      };
    case 'code':
      return { id, type, lang: el.querySelector('.code-lang').value, text: el.querySelector('.code-text').value };
    case 'divider':
      return { id, type };
    case 'table': {
      const cols = [...el.querySelectorAll('thead th[data-col]')].map(th => ({
        id: th.dataset.col,
        name: th.textContent.trim(),
        width: null,
      }));
      const rows = [...el.querySelectorAll('tbody tr[data-row]')].map(tr => ({
        id: tr.dataset.row,
        cells: Object.fromEntries(
          [...tr.querySelectorAll('td[data-col]')].map(td => [td.dataset.col, td.textContent])
        ),
      }));
      return { id, type, headerRow: !!el.querySelector('thead'), cols, rows };
    }
    case 'image':
      return { id, type, attachmentId: el.dataset.attachmentId || '', url: el.querySelector('img')?.getAttribute('src') || '', caption: el.querySelector('.image-caption')?.textContent || '' };
    case 'file':
      return { id, type, attachmentId: el.dataset.attachmentId || '', name: el.querySelector('.file-name')?.textContent || '', size: Number(el.dataset.size) || 0 };
    case 'page-link': {
      const chip = el.querySelector('.page-link-chip');
      return { id, type, pageId: chip?.dataset.page || '', title: chip?.querySelector('.page-link-title')?.textContent || '', icon: '📄' };
    }
    default:
      return { id, type: 'paragraph', html: el.querySelector('.block-content').innerHTML };
  }
}

// Fix the ordinal of every ordered list item in the editor container.
export function renumberLists(container) {
  const counters = {};
  container.querySelectorAll('.block-list-item').forEach((el) => {
    const indent = el.dataset.indent || '0';
    if (el.dataset.ordered === '1') {
      const key = `i${indent}`;
      counters[key] = (counters[key] || 0) + 1;
      el.querySelector('.list-bullet').textContent = `${counters[key]}.`;
    } else {
      counters[`i${indent}`] = 0;
      el.querySelector('.list-bullet').textContent = '•';
    }
  });
}