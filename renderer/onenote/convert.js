// OneNote page HTML -> Index block JSON.
//
// OneNote's Graph /content endpoint returns XHTML: nested <div> outlines,
// h1-h6, p, ul/ol (nested lists), tables, and <img> whose src points at a
// Graph resource URL. This walks it and emits the same block vocabulary the
// editor saves (see data/pages/*.json). Inline markup (b/i/u/code/a) is kept
// as the block's `html`; OneNote's style attributes are stripped — they
// carry no meaning here and CSP ignores them anyway.
//
// Images are NOT downloaded here: the block comes back with `resourceId` and
// the import driver replaces it with a note://attachments/ URL once the main
// process has stored the bytes locally.

import { uid } from '../ui/components.js';

export function convertOneNoteHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  const resourceIds = new Set();
  walk(doc.body, 0, blocks, resourceIds);
  return { blocks, resourceIds: [...resourceIds] };
}

function walk(node, indent, blocks, resourceIds) {
  for (const el of node.children) {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const text = cleanHtml(el);
        if (text) blocks.push({ id: uid('b'), type: 'heading', level: Number(tag[1]), html: text });
        break;
      }
      case 'p': {
        emitParagraph(el, indent, blocks);
        break;
      }
      case 'ul': case 'ol': {
        emitList(el, indent, blocks, tag === 'ol');
        break;
      }
      case 'table': {
        emitTable(el, blocks);
        break;
      }
      case 'img': {
        emitImage(el, blocks, resourceIds);
        break;
      }
      case 'blockquote': {
        const text = cleanHtml(el);
        if (text) blocks.push({ id: uid('b'), type: 'quote', html: text });
        break;
      }
      case 'pre': {
        blocks.push({ id: uid('b'), type: 'code', text: el.textContent });
        break;
      }
      case 'hr': {
        blocks.push({ id: uid('b'), type: 'divider' });
        break;
      }
      case 'br': {
        break;
      }
      default: {
        // OneNote wraps everything in outline <div>s; also stray spans,
        // <cite> markers, and page-title fragments. Recurse.
        walk(el, indent, blocks, resourceIds);
      }
    }
  }
}

function emitParagraph(el, indent, blocks) {
  const checkbox = el.querySelector('input[type="checkbox"]');
  if (checkbox) {
    const html = cleanHtml(el.cloneNode(true));
    if (html) blocks.push({ id: uid('b'), type: 'todo', checked: checkbox.hasAttribute('checked'), html });
    return;
  }
  const text = cleanHtml(el);
  if (!text) return;
  if (indent > 0) blocks.push({ id: uid('b'), type: 'list-item', ordered: false, indent, html: text });
  else blocks.push({ id: uid('b'), type: 'paragraph', html: text });
}

function emitList(list, indent, blocks, ordered) {
  for (const li of list.children) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const checkbox = li.querySelector('input[type="checkbox"]');
    // Nested lists belong to their own blocks, not the item's text.
    const childLists = li.querySelectorAll(':scope > ul, :scope > ol');
    const itemClone = li.cloneNode(true);
    itemClone.querySelectorAll('ul, ol').forEach(n => n.remove());
    const html = cleanHtml(itemClone);
    if (checkbox) {
      if (html) blocks.push({ id: uid('b'), type: 'todo', checked: checkbox.hasAttribute('checked'), html });
    } else if (html) {
      blocks.push({ id: uid('b'), type: 'list-item', ordered, indent, html });
    }
    for (const child of childLists) {
      emitList(child, Math.min(indent + 1, 4), blocks, child.tagName.toLowerCase() === 'ol');
    }
  }
}

function emitTable(table, blocks) {
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return;
  const head = [...rows[0].querySelectorAll('th, td')].map((cell, i) => ({ id: `c${i}`, name: cleanText(cell) }));
  // Cell values keep their line structure ('\n' between lines) — OneNote
  // journal cells hold one task per line, and the table→threads converter
  // splits on it. Renderers collapse whitespace, so display is unchanged.
  const body = rows.slice(1).map(row =>
    Object.fromEntries([...row.querySelectorAll('th, td')].map((cell, i) => [head[i]?.id || `c${i}`, cellLines(cell).join('\n')])));
  if (head.length) blocks.push({ id: uid('b'), type: 'table', cols: head, rows: body });
}

// Lines within a table cell: block elements and <br> each end a line.
function cellLines(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('input, cite').forEach(n => n.remove());
  clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
  const raw = clone.children.length
    ? [...clone.children].map(c => c.textContent).join('\n')
    : clone.textContent;
  return (raw || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function emitImage(el, blocks, resourceIds) {
  const src = el.getAttribute('src') || '';
  // Clipboard paste (OneNote desktop embeds copied images as data URIs) —
  // no download needed; the paste mapper saves them as local attachments.
  if (/^data:image\//i.test(src)) {
    blocks.push({ id: uid('b'), type: 'image', url: null, dataUri: src, name: el.getAttribute('alt') || 'OneNote image' });
    return;
  }
  // Graph page content marks every outline object with data-id; the img src
  // also carries the resource id. Either is a stable handle for the download.
  const fromSrc = /resources\/([0-9a-f-]{36})\/content/i.exec(src);
  const resourceId = el.getAttribute('data-id') || (fromSrc && fromSrc[1]);
  if (!resourceId) return; // stray embedded data: icon — not worth importing
  resourceIds.add(resourceId);
  blocks.push({ id: uid('b'), type: 'image', url: null, resourceId, name: el.getAttribute('alt') || 'OneNote image' });
}

// Keep allowed inline tags, drop style/class/other attributes.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'A', 'BR', 'SPAN', 'SUB', 'SUP']);

function cleanHtml(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('input').forEach(n => n.remove());
  clone.querySelectorAll('cite').forEach(n => n.remove());
  stripAttrs(clone);
  const html = clone.innerHTML
    .replace(/&nbsp;/g, ' ')
    .replace(/(?:\s|<br\s*\/?>)+$/i, '')
    .trim();
  return html || '';
}

function stripAttrs(node) {
  for (const child of node.querySelectorAll('*')) {
    if (!ALLOWED.has(child.tagName)) {
      // Unknown element: keep its text but not the wrapper's semantics.
      const text = child.textContent;
      const replacement = document.createElement('span');
      replacement.textContent = text;
      child.replaceWith(...(text ? [replacement] : []));
    } else {
      [...child.attributes].forEach(a => {
        if (child.tagName === 'A' && a.name === 'href') return;
        child.removeAttribute(a.name);
      });
    }
  }
  [...node.attributes].forEach(a => {
    if (!(node.tagName === 'A' && a.name === 'href')) node.removeAttribute(a.name);
  });
}

function cleanText(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}