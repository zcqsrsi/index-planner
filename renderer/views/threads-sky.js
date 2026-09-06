// Threads → Sky: every thread in this universe as a constellation. Pages and
// open tasks are stars; each thread is the figure its stars make; brightness
// is recency — touched yesterday burns, neglected for months fades toward
// the dark. The dim italic lines are the big-picture questions their threads
// answer to. Nothing moves but a slow twinkle.
//
// Every theme-dependent color rides a CSS class (threads.css) — SVG
// attributes can't take var(), so the only literals here are the per-thread
// hues. The sky also scales with its crowd: five constellations is the
// design point; a quiet sky lets its few loom large, a busy one packs down
// — and hubs repel each other so name labels never overlap.

import { esc, ageDays, todayStr } from '../ui/components.js';
import { getState, setState, currentUniverseId, findGroup } from '../store.js';
import { iterTasks } from '../quest/model.js';

const W = 1240, H = 620;
// Sky type sizes — hub names and question plates (the tooltip lives in
// threads.css). The hub-repulsion math below reads these back.
const NAME_FS = 13.5, Q_FS = 13;

// Stable per-id seed, so a thread's stars sit in the same places each visit.
function seedOf(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2147483646) + 1;
}
const rndFrom = (s) => { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

// A style key rides the CSSOM, never an attribute — the page's CSP blocks
// style attributes outright, and anything set that way vanishes silently.
const el = (t, at) => { const n = document.createElementNS('http://www.w3.org/2000/svg', t);
  for (const k in at) {
    if (k !== 'style') { n.setAttribute(k, at[k]); continue; }
    for (const d of at[k].split(';').filter(Boolean)) {
      const i = d.indexOf(':');
      n.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  return n; };

export async function renderSky(host, qi, questionAsOf) {
  const tree = (await window.api.bootstrap()).notebooks;
  const uniId = currentUniverseId();
  const projects = tree.notebooks.filter(nb => nb.universeId === uniId && nb.kind !== 'log');
  const todayKey = todayStr();
  // SVG attributes can't take var(), so the fallback is literal — steel for
  // a project that never picked a color (the dashboard falls back to accent).
  // A grouped project wears its GROUP's color: the same family, one paint —
  // the sky should read a group as one thing before you read a name.
  const colorOf = (p) => {
    const g = p.groupId && findGroup(p.groupId);
    return (g && g.color) || p.color || '#8895a4';
  };

  host.innerHTML = projects.length ? `
    <svg class="sky-svg${getState().settings?.skyQuestions === false ? ' q-off' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" id="sky-svg"></svg>
    <div class="sky-tip" id="sky-tip"></div>` : `
    <div class="empty"><div class="empty-icon">✦</div>No threads in this universe yet —
    create one in the Projects view and its stars will gather here.</div>`;
  if (!projects.length) return;
  const svg = host.querySelector('#sky-svg');
  const tip = host.querySelector('#sky-tip');

  // The scale of everything in the sky. Five constellations is the design
  // point (S = 1); fewer loom up to nearly twice the size, many pack down.
  const n = Math.max(1, projects.length);
  const S = Math.max(0.75, Math.min(1.9, Math.sqrt(5 / n)));
  // Hub labels (NAME_FS mono, scaled) are roughly 0.6px per character wide.
  const nameHalfW = (p) => (p.name ? p.name.length : 8) * 0.6 * NAME_FS * S;

  // Hubs first — a golden-angle spiral over the space, stable per order,
  // spread wider when the sky is quiet. The spiral's units are GROUPS, not
  // projects: members of one group hang together in a tight cluster around
  // their shared anchor, so a family keeps its own neighbourhood. The sky
  // re-reads the tree on every render, so a project joining or leaving a
  // group re-clusters here on the next visit.
  const units = [];
  const unitOf = new Map();
  for (const p of projects) {
    const key = p.groupId || p.id;
    if (!unitOf.has(key)) { unitOf.set(key, true); units.push([]); }
    units[units.length - 1].push(p);
  }
  const nu = Math.max(1, units.length);
  units.forEach((members, i) => {
    const a = i * 2.399963 + 0.9;
    const rr = Math.sqrt((i + 0.6) / nu) * 0.86;
    const amp = 40 * Math.min(1.6, S);
    const anchor = [
      90 + (50 + Math.cos(a) * rr * amp) / 100 * (W - 180),
      90 + (50 + Math.sin(a) * rr * 34) / 100 * (H - 180),
    ];
    // Members take the same golden angle around the anchor — a local,
    // tight echo of the sky above them. A lone member sits on it. The
    // spread grows with the family: each member carries a star cloud
    // ~120·S wide, so the spacing has to clear two of those.
    const m = members.length;
    const spread = (64 + m * 20) * Math.min(1.4, S);
    members.forEach((p, j) => {
      const aa = j * 2.399963 + i * 1.7;
      const rm = m === 1 ? 0 : Math.sqrt((j + 0.5) / m);
      p.hub = [
        Math.max(nameHalfW(p) + 16, Math.min(W - nameHalfW(p) - 16,
          anchor[0] + Math.cos(aa) * rm * spread)),
        Math.max(72, Math.min(H - 58,
          anchor[1] + Math.sin(aa) * rm * spread * 0.72)),
      ];
    });
  });
  // Names hang centered under hubs, so hubs repel until no two labels can
  // collide — and stay inside the panel while they do. Inside a group the
  // repulsion eases (family members sit closer than strangers ever may,
  // their color is what binds them) but never so far that their star
  // clouds interleave.
  const sameGroup = (A, B) => A.groupId && A.groupId === B.groupId;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < projects.length; i++) {
      for (let j = i + 1; j < projects.length; j++) {
        const A = projects[i], B = projects[j];
        const dx = B.hub[0] - A.hub[0], dy = B.hub[1] - A.hub[1];
        const d = Math.hypot(dx, dy) || 0.01;
        let minD = nameHalfW(A) + nameHalfW(B) + 30;
        if (sameGroup(A, B)) minD = Math.max(40, minD * 0.72);
        if (d >= minD) continue;
        const push = (minD - d) / 2, ux = dx / d, uy = dy / d;
        A.hub[0] -= ux * push; A.hub[1] -= uy * push;
        B.hub[0] += ux * push; B.hub[1] += uy * push;
        moved = true;
      }
    }
    for (const p of projects) {
      p.hub[0] = Math.max(nameHalfW(p) + 16, Math.min(W - nameHalfW(p) - 16, p.hub[0]));
      p.hub[1] = Math.max(72, Math.min(H - 58, p.hub[1]));
    }
    if (!moved) break;
  }

  // The thread's stars: its pages, and the tasks still open under it.
  projects.forEach((p) => {
    const rnd = rndFrom(seedOf(p.id));
    const stars = [];
    for (const sec of p.sections || []) {
      for (const pg of sec.pages || []) {
        stars.push({ kind: 'page', id: pg.id, title: pg.title || 'Untitled',
                     ts: pg.updatedAt || pg.createdAt || 0 });
      }
    }
    for (const { task } of iterTasks(p)) {
      if (task.status === 'done' || task.status === 'scrapped') continue;
      stars.push({ kind: 'task', id: task.id, title: task.title || 'Untitled',
                   ts: task.updatedAt || task.createdAt || 0,
                   overdue: !!(task.dueDate && task.dueDate < todayKey) });
    }
    // The original scatter: stars random around the hub, stable per thread,
    // brightness riding on each for its glow. Placement has no order — the
    // reveal (below) reads its own, around the loop.
    stars.forEach((s) => {
      const age = s.ts ? ageDays(s.ts) : 120;
      s.b = Math.max(0.12, 1 - age / 120); // brightness — recency
      s.fresh = age < 8;
      const ang = rnd() * Math.PI * 2, rad = (36 + rnd() * 96) * S;
      s.x = Math.max(46, Math.min(W - 46, p.hub[0] + Math.cos(ang) * rad));
      s.y = Math.max(64, Math.min(H - 52, p.hub[1] + Math.sin(ang) * rad * 0.9));
      // The name hangs centered under the hub — a star that lands in its
      // band lifts above the hub instead, so no constellation caption ever
      // reads through starlight.
      if (s.y > p.hub[1] && s.y < p.hub[1] + 48 &&
          Math.abs(s.x - p.hub[0]) < nameHalfW(p) + 14) {
        s.y = Math.max(64, p.hub[1] - 52 - rnd() * 34);
      }
      s.r = ((s.kind === 'page' ? 3 : 1.9) + s.b * (s.kind === 'page' ? 2.6 : 1.7)) * Math.min(S, 1.5);
    });
    stars.forEach(s => { s.thread = p; });
    p.stars = stars;
  });

  // Questions: their plates hover at the heart of the constellations that
  // answer to them. They render even when the toggle has them hidden — the
  // toggle only lifts the finished plates out of the drawn sky (a .q-off
  // class below), so flipping it never redraws or rekindles the stars. A
  // question is never one long line lying across the stars; it wraps into
  // a narrow plate a few lines deep, in quotation marks, on ground of its own.
  const byOwner = new Map();
  for (const p of projects) {
    const owner = qi.ownerOf(p);
    if (!byOwner.has(owner.id)) byOwner.set(owner.id, { owner, members: [] });
    byOwner.get(owner.id).members.push(p);
  }
  const qlabels = [];
  // Wrap words into lines no wider than a plate's worth of text — the
  // question and its outcome share the measure.
  const wrap = (text, fs) => {
    const charW = 0.62 * fs;
    const maxW = 290 * Math.min(S, 1.35);
    const lines = [];
    let cur = '';
    for (const w of text.split(' ')) {
      const cand = cur ? `${cur} ${w}` : w;
      if (cand.length * charW > maxW && cur) { lines.push(cur); cur = w; }
      else cur = cand;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  for (const { owner, members } of byOwner.values()) {
    const q = questionAsOf(qi, owner, todayKey);
    if (!q.text) continue;
    const fs = Q_FS * Math.min(S, 1.35);
    const lh = fs * 1.5;
    const cx = members.reduce((s, p) => s + p.hub[0], 0) / members.length;
    const lines = wrap(`“${q.text}”`, fs);
    const h = lines.length * lh;
    // The plate hangs just above its constellations — a caption, never a
    // lid. Starting clear beats nudging clear: the escape pass below then
    // only has to settle disagreements between plates, names and stars.
    const topY = Math.min(...members.map(p =>
      Math.min(p.hub[1], ...p.stars.map(s => s.y - s.r))));
    let y = topY - h / 2 - 16;
    if (y - h / 2 < 8) {
      // No room above — the plate slips below its constellations instead.
      const botY = Math.max(...members.map(p =>
        Math.max(p.hub[1], ...p.stars.map(s => s.y + s.r))));
      y = botY + h / 2 + 16;
      if (y + h / 2 > H - 8) y = topY - h / 2 - 16; // neither fits: above, clamped
    }
    const plate = {
      lines, fs, lh,
      x: cx, y,
      halfW: Math.max(...lines.map(l => l.length * 0.62 * fs)) / 2,
      h,
    };
    qlabels.push(plate);
    // The outcome: the answer, so far — landed text, no quotation marks.
    // Its plate sits down-right of the question on a dashed diagonal, so
    // the eye reads question → answer the way we read. It rides the same
    // escape pass as every plate, and the diagonal is drawn between
    // wherever the two finally settle.
    const res = owner.bigPictureResolution?.text;
    if (res) {
      const olines = wrap(res, fs);
      const oh = olines.length * lh;
      qlabels.push({
        lines: olines, fs, lh,
        outcome: true, q: plate,
        x: plate.x + plate.halfW + 52,
        y: plate.y + h / 2 + oh / 2 + 22,
        halfW: Math.max(...olines.map(l => l.length * 0.62 * fs)) / 2,
        h: oh,
      });
    }
  }
  // Plates that share space: every question plate against every other
  // plate, every thread name, and every star — a question never sits on
  // a constellation. Only question plates move, along whichever axis
  // escapes soonest.
  const others = projects.map((p) => ({
    x: p.hub[0], y: p.hub[1] + 22, halfW: nameHalfW(p), h: NAME_FS * Math.min(S, 1.5),
  }));
  for (const p of projects) {
    for (const s of p.stars) {
      others.push({ x: s.x, y: s.y, halfW: s.r + 9, h: s.r * 2 + 9 });
    }
  }
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (const m of qlabels) {
      for (const o of [...qlabels, ...others]) {
        if (o === m) continue;
        const dx = m.x - o.x, dy = m.y - o.y;
        const ox = m.halfW + o.halfW - Math.abs(dx);
        const oy = (m.h + o.h) / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // Escape along the axis with the least overlap to travel.
        if (oy <= ox) m.y += (dy >= 0 ? 1 : -1) * (oy + 2);
        else m.x += (dx >= 0 ? 1 : -1) * (ox + 2);
        moved = true;
      }
      m.x = Math.max(m.halfW + 14, Math.min(W - m.halfW - 14, m.x));
      m.y = Math.max(m.h / 2 + 8, Math.min(H - m.h / 2 - 8, m.y));
    }
    if (!moved) break;
  }
  for (const m of qlabels) {
    const top = m.y - m.h / 2;
    // The diagonal runs under the plates: the question's bottom-right
    // corner down to its outcome's top-left.
    if (m.outcome) {
      const q = m.q;
      svg.appendChild(el('path', {
        d: `M ${(q.x + q.halfW + 9).toFixed(1)} ${(q.y + q.h / 2 + 5).toFixed(1)} ` +
           `L ${(m.x - m.halfW - 9).toFixed(1)} ${(top - 5).toFixed(1)}`,
        fill: 'none', class: 'sky-q-diag',
      }));
    }
    svg.appendChild(el('rect', {
      x: (m.x - m.halfW - 9).toFixed(1), y: (top - 5).toFixed(1),
      width: (m.halfW * 2 + 18).toFixed(1), height: (m.h + 10).toFixed(1),
      rx: 5, class: m.outcome ? 'sky-o-box' : 'sky-q-box',
    }));
    const label = el('text', {
      x: m.x.toFixed(1), y: (top + m.fs * 1.1).toFixed(1),
      'text-anchor': 'middle', class: m.outcome ? 'sky-o-label' : 'sky-q-label',
      style: `font-size:calc(${m.fs.toFixed(1)}px * var(--ui-scale))`,
    });
    m.lines.forEach((line, i) => {
      const t = el('tspan', { x: m.x.toFixed(1), dy: i ? m.lh.toFixed(1) : 0 });
      t.textContent = line;
      label.appendChild(t);
    });
    svg.appendChild(label);
  }

  // The constellations: one closed figure per thread, then hub names. The
  // loop draws itself around its stars (pathLength normalises the dash),
  // and each star kindles as the line reaches it — the reveal keeps its
  // build, the layout stays the original scatter.
  for (const p of projects) {
    if (p.stars.length) {
      const byAng = [...p.stars].sort((a, b) =>
        Math.atan2(a.y - p.hub[1], a.x - p.hub[0]) -
        Math.atan2(b.y - p.hub[1], b.x - p.hub[0]));
      byAng.forEach((s, i) => { s.order = i; });
      svg.appendChild(el('path', {
        d: byAng.map((s, i) => `${i ? 'L' : 'M'} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`).join(' '),
        fill: 'none', stroke: colorOf(p), opacity: 0.26, 'stroke-width': 1,
        pathLength: 1, class: 'sky-line',
      }));
    }
    svg.appendChild(el('circle', { cx: p.hub[0].toFixed(1), cy: p.hub[1].toFixed(1),
      r: (1.8 * Math.min(S, 1.5)).toFixed(2), fill: colorOf(p), opacity: 0.55 }));
    const name = el('text', { x: p.hub[0].toFixed(1), y: (p.hub[1] + 22).toFixed(1),
      'text-anchor': 'middle', class: 'sky-name', fill: colorOf(p),
      style: `font-size:calc(${(NAME_FS * Math.min(S, 1.5)).toFixed(1)}px * var(--ui-scale))` });
    name.textContent = p.name;
    svg.appendChild(name);
  }

  // The stars, each with a hover plate and a way in. Each kindles as the
  // figure's line reaches it — the group fades in on the draw's tail.
  // Hovering swells the star; the plate stays the same, so the pointer
  // never loses its target.
  for (const p of projects) {
    p.stars.forEach((s, j) => {
      const g = el('g', { class: 'sky-fig',
        style: `animation-delay:${140 + s.order * 90}ms` });
      const op = (0.25 + 0.75 * s.b).toFixed(2);
      const star = el('circle', { cx: s.x.toFixed(1), cy: s.y.toFixed(1),
        r: s.r.toFixed(2), fill: colorOf(p), opacity: op });
      star.setAttribute('class', s.fresh ? 'sky-star sky-tw' : 'sky-star');
      if (s.fresh) star.style.animationDelay = `${-(j * 0.9)}s`;
      g.appendChild(star);
      const over = s.overdue ? el('circle', { cx: s.x.toFixed(1), cy: s.y.toFixed(1),
        r: (s.r + 4).toFixed(1), class: 'sky-overdue' }) : null;
      if (over) g.appendChild(over);
      const hit = el('circle', { cx: s.x.toFixed(1), cy: s.y.toFixed(1),
        r: (13 * Math.min(S, 1.5)).toFixed(1),
        fill: 'transparent', class: 'sky-hit' });
      hit.addEventListener('mouseenter', () => {
        star.setAttribute('r', (s.r * 1.8).toFixed(2));
        if (over) over.setAttribute('r', (s.r * 1.8 + 4).toFixed(2));
      });
      hit.addEventListener('mouseleave', () => {
        star.setAttribute('r', s.r.toFixed(2));
        if (over) over.setAttribute('r', (s.r + 4).toFixed(1));
      });
      hit.addEventListener('mousemove', (e) => {
        const rc = host.getBoundingClientRect();
        const age = s.ts ? ageDays(s.ts) : null;
        tip.innerHTML = `<span style="color:${colorOf(p)}">●</span> ${esc(s.title)} ` +
          `<span class="sky-dim">· ${s.kind}${s.overdue ? ' · <span style="color:var(--keyword)">overdue</span>' : ''}</span><br>` +
          `<span class="sky-dim">${age === null ? 'never touched' : age === 0 ? 'touched today' : `last touched ${age}d ago`}</span>`;
        tip.style.display = 'block';
        tip.style.left = Math.min(e.clientX - rc.left + 14, host.clientWidth - 240) + 'px';
        tip.style.top = Math.max(4, e.clientY - rc.top - 14) + 'px';
      });
      hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      hit.addEventListener('click', () => {
        if (s.kind === 'page') { window.__index.openPage(s.id); return; }
        setState({ currentProjectId: p.id, focusTaskId: s.id });
        window.__index.goto('projects');
      });
      g.appendChild(hit);
      svg.appendChild(g);
    });
  }
}