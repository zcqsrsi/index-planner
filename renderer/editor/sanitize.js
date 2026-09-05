// Whitelist sanitizer for block HTML. Only b/i/u/s/em/strong/code/a/span.tag
// survive; everything else is unwrapped. Run on every save (and after paste)
// so what lands in pages/*.json is safe, small, and greppable.

const ALLOWED = new Set(['B', 'I', 'U', 'S', 'EM', 'STRONG', 'CODE', 'A', 'SPAN']);
const VOID_KEEP = new Set(['BR']);

export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  clean(root);
  return root.innerHTML;

  function clean(node) {
    for (const child of [...node.children]) {
      const tag = child.tagName;
      if (VOID_KEEP.has(tag)) {
        clean(child);
        continue;
      }
      if (!ALLOWED.has(tag)) {
        // Unwrap: keep text and children, drop the disallowed element.
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        continue;
      }
      // Strip all attributes except href on <a> and the tag class on <span>.
      for (const attr of [...child.attributes]) {
        if (tag === 'A' && attr.name === 'href' && /^https?:|^mailto:/i.test(child.getAttribute('href'))) continue;
        if (tag === 'SPAN' && attr.name === 'class' && attr.value.trim() === 'tag') continue;
        child.removeAttribute(attr.name);
      }
      if (tag === 'A' && !child.hasAttribute('href')) {
        // <a> without a safe href is just text.
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        continue;
      }
      clean(child);
    }
  }
}

// Extract inline #tags from block HTML. A tag is a span.tag, or a literal
// "#word" in text (converted to a span.tag mark on save).
export function extractTags(blocks) {
  const tags = new Set();
  const walker = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        for (const m of child.textContent.matchAll(/(?:^|\s)#([\w-]+)/g)) tags.add(m[1]);
      } else if (child.tagName === 'SPAN' && child.classList.contains('tag')) {
        tags.add(child.textContent.replace(/^#/, ''));
      } else {
        walker(child);
      }
    }
  };
  for (const b of blocks) {
    if (b.html) {
      const doc = new DOMParser().parseFromString(b.html, 'text/html');
      walker(doc.body);
    }
  }
  return [...tags];
}