// Export builders: Index blocks / planner data → Markdown and printable
// HTML. Pure functions — the save dialogs live in the main process
// (export:markdown / export:pdf); these only assemble the content.

// ---- Markdown ----------------------------------------------------------

export function blocksToMarkdown(blocks) {
  const out = [];
  for (const b of blocks || []) {
    switch (b.type) {
      case 'heading': out.push(`${'#'.repeat(Math.min(b.level || 1, 6))} ${plain(b.html)}`); break;
      case 'todo': out.push(`- [${b.checked ? 'x' : ' '}] ${plain(b.html)}`); break;
      case 'list-item': {
        const indent = '  '.repeat(Math.min(b.indent || 0, 4));
        out.push(`${indent}${b.ordered ? '1.' : '-'} ${plain(b.html)}`);
        break;
      }
      case 'quote': out.push(plain(b.html).split('\n').map(l => `> ${l}`).join('\n')); break;
      case 'code': out.push('```\n' + (b.text || '') + '\n```'); break;
      case 'divider': out.push('---'); break;
      case 'table': out.push(tableToMarkdown(b), ''); break;
      case 'image': out.push(`![${plain(b.name) || 'image'}](${b.url || ''})`, ''); break;
      default: if (b.html !== undefined) out.push(plain(b.html));
    }
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tableToMarkdown(b) {
  const head = (b.cols || []).map(c => (c.name || '').replace(/\|/g, '\\|'));
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const sep = `| ${head.map(() => '---').join(' | ')} |`;
  const body = (b.rows || []).map(row =>
    line((b.cols || []).map(c => String(row[c.id] ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>'))));
  return [line(head), sep, ...body].join('\n');
}

export function pageToMarkdown(page, meta) {
  const parts = [`# ${page.title || 'Untitled'}`];
  if (meta) parts.push(`*${meta.notebook.name} / ${meta.section.name}*`);
  const body = blocksToMarkdown(page.blocks);
  if (body) parts.push(body);
  return parts.join('\n\n');
}

// A sub-objective: its day rows — tasks day-stamped, the day diary — as
// Markdown. Newest day first, matching the planner.
export function sectionToMarkdown(nb, sec) {
  const parts = [`## ${sec.name}`];
  const tasks = sec.tasks || [];
  const dayKeys = [...new Set([...Object.keys(sec.days || {}), ...tasks.map(t => t.day)])].sort().reverse();
  if (!dayKeys.length) {
    parts.push('*No day rows yet.*');
    return parts.join('\n\n');
  }
  for (const day of dayKeys) {
    parts.push(`### ${day}`);
    const dayTasks = tasks.filter(t => t.day === day);
    for (const t of dayTasks) {
      const marks = [
        t.status === 'done' ? 'done' : t.status === 'scrapped' ? 'scrapped' : null,
        t.dueDate ? `due ${t.dueDate}` : null,
      ].filter(Boolean);
      parts.push(`- [${t.status === 'done' ? 'x' : ' '}] ${t.title}${marks.length ? ` *(${marks.join(', ')})*` : ''}`);
    }
    if (!dayTasks.length) parts.push('- —');
    const note = sec.days[day]?.note;
    if (note) parts.push(note);
  }
  return parts.join('\n\n');
}

// A whole project: hunt fields, objectives, every sub-objective.
export function projectToMarkdown(nb) {
  const parts = [`# ${nb.name}`];
  const flags = [
    nb.status && nb.status !== 'active' ? nb.status : null,
    nb.dueDate ? `due ${nb.dueDate}` : null,
  ].filter(Boolean);
  if (flags.length) parts.push(`*${flags.join(' · ')}*`);
  if (nb.description) parts.push(nb.description);

  const tiered = new Set();
  for (const o of nb.objectives || []) {
    parts.push(`## ${o.name}`);
    for (const sec of (nb.sections || []).filter(s => s.objectiveId === o.id)) {
      tiered.add(sec.id);
      parts.push(sectionToMarkdown(nb, sec));
    }
  }
  // Sub-objectives outside any objective tier ("General", imported ones).
  const loose = (nb.sections || []).filter(s => !tiered.has(s.id));
  if (loose.length) {
    parts.push(`## ${nb.objectives?.length ? 'More' : 'Threads'}`);
    for (const sec of loose) parts.push(sectionToMarkdown(nb, sec));
  }
  return parts.join('\n\n');
}

// ---- Printable HTML (for PDF) ------------------------------------------

export function pageToPdfHtml(page, meta) {
  const body = (page.blocks || []).map(blockToHtml).join('\n');
  const title = page.title || 'Untitled';
  const metaLine = meta ? `${meta.notebook.name} / ${meta.section.name}` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font: 13px/1.65 Georgia, 'Times New Roman', serif; color: #1d1f21; max-width: 680px; margin: 40px auto; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin-top: 28px; }
  h3 { font-size: 15px; margin-top: 20px; }
  .meta { color: #7a7f83; font: 11px/1.4 Menlo, monospace; margin-bottom: 26px; }
  blockquote { border-left: 3px solid #ccc; margin: 10px 0; padding: 2px 14px; color: #555; }
  pre { background: #f4f4f2; padding: 10px 12px; border-radius: 4px; font: 11.5px/1.5 Menlo, monospace; overflow-x: auto; }
  table { border-collapse: collapse; margin: 12px 0; width: 100%; }
  th, td { border: 1px solid #d8d8d4; padding: 5px 9px; text-align: left; font-size: 12px; }
  th { background: #f4f4f2; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #ddd; margin: 22px 0; }
  .todo .box { margin-right: 4px; }
  .li { margin: 3px 0; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
${metaLine ? `<div class="meta">${escapeHtml(metaLine)}</div>` : ''}
${body}
</body></html>`;
}

function blockToHtml(b) {
  switch (b.type) {
    case 'heading': {
      const lv = Math.min(b.level || 1, 6);
      return `<h${lv}>${b.html || ''}</h${lv}>`;
    }
    case 'todo': return `<div class="todo"><span class="box">${b.checked ? '☑' : '☐'}</span> ${b.html || ''}</div>`;
    case 'list-item': return `<div class="li" style="margin-left:${(b.indent || 0) * 18}px">${b.ordered ? '1.' : '·'} ${b.html || ''}</div>`;
    case 'quote': return `<blockquote>${b.html || ''}</blockquote>`;
    case 'code': return `<pre><code>${escapeHtml(b.text || '')}</code></pre>`;
    case 'divider': return '<hr>';
    case 'table': return tableToHtml(b);
    case 'image': return b.url ? `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.name || '')}">` : '';
    default: return `<p>${b.html || ''}</p>`;
  }
}

function tableToHtml(b) {
  const head = (b.cols || []).map(c => `<th>${escapeHtml(c.name || '')}</th>`).join('');
  const body = (b.rows || []).map(row =>
    `<tr>${(b.cols || []).map(c => `<td>${escapeHtml(String(row[c.id] ?? '')).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// html blocks carry trusted inline markup from the editor; strip tags only
// for plain-text contexts (markdown titles, alt text).
function plain(html) {
  if (!html) return '';
  const el = new DOMParser().parseFromString(String(html), 'text/html');
  el.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  return (el.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}