// Fullscreen image viewer — double-click an image block to open it.
// Scroll zooms toward the cursor, drag pans, double-click toggles
// fit ↔ 1:1, Esc or backdrop click closes. The transform is set through
// CSSOM (style.setProperty) — the CSP blocks inline style attributes.

import { esc } from './components.js';

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const FIT_PAD = 48; // breathing room around a fitted image

let viewer = null;

export function openImageViewer(src, caption = '') {
  if (viewer) return;
  const el = document.createElement('div');
  el.className = 'imgview';
  el.innerHTML = `
    <div class="imgview-stage"></div>
    <img class="imgview-img" src="${esc(src)}" alt="" draggable="false">
    <div class="imgview-bar">
      <span class="imgview-caption"></span>
      <span class="imgview-meta"><span class="imgview-zoom"></span><span class="imgview-hint">scroll to zoom · drag to pan · double-click for 1:1 · esc to close</span></span>
    </div>`;
  el.querySelector('.imgview-caption').textContent = caption;

  const img = el.querySelector('.imgview-img');
  const stage = el.querySelector('.imgview-stage');
  const zoomEl = el.querySelector('.imgview-zoom');
  const bar = el.querySelector('.imgview-bar');

  let scale = 1, tx = 0, ty = 0; // pan offset; position derives from both
  let fitScale = 1;
  let barTimer = null;

  const apply = () => {
    img.style.setProperty('transform', `translate(${tx}px, ${ty}px) scale(${scale})`);
    zoomEl.textContent = `${Math.round(scale * 100)}%`;
  };

  // Centre the image at scale s: base position plus the pan offset.
  const base = (s) => {
    const r = stage.getBoundingClientRect();
    return {
      x: (r.width - img.naturalWidth * s) / 2,
      y: (r.height - img.naturalHeight * s) / 2,
    };
  };
  const clampPan = () => {
    // Loose clamp — the image should never wander fully off stage.
    const r = stage.getBoundingClientRect();
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    const b = base(scale);
    const minX = Math.min(0, r.width - FIT_PAD - (b.x + w));
    const maxX = Math.max(0, FIT_PAD - b.x);
    tx = Math.max(minX, Math.min(maxX, tx));
    const minY = Math.min(0, r.height - FIT_PAD - (b.y + h));
    const maxY = Math.max(0, FIT_PAD - b.y);
    ty = Math.max(minY, Math.min(maxY, ty));
  };

  const fit = () => {
    const r = stage.getBoundingClientRect();
    const zw = (r.width - FIT_PAD * 2) / (img.naturalWidth || 1);
    const zh = (r.height - FIT_PAD * 2) / (img.naturalHeight || 1);
    fitScale = Math.min(1, zw, zh); // never upscale past 1:1 on fit
    scale = fitScale; tx = 0; ty = 0;
    apply();
  };

  const zoomAt = (cx, cy, factor) => {
    const r = stage.getBoundingClientRect();
    const b = base(scale);
    // Image point under the cursor stays under the cursor.
    const ix = (cx - r.left - b.x - tx) / scale;
    const iy = (cy - r.top - b.y - ty) / scale;
    const s2 = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    const b2 = base(s2);
    tx = (cx - r.left - b2.x) - ix * s2;
    ty = (cy - r.top - b2.y) - iy * s2;
    scale = s2;
    clampPan();
    apply();
  };

  const showBar = () => {
    bar.style.setProperty('opacity', '1');
    clearTimeout(barTimer);
    barTimer = setTimeout(() => bar.style.setProperty('opacity', '0'), 2600);
  };

  img.addEventListener('load', fit);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
    showBar();
  }, { passive: false });

  // Drag to pan. The move/up listeners live on window (the drag continues
  // outside the image) and are removed on close — a per-open window
  // listener that outlives its viewer leaks one per open.
  let drag = null;
  const onMove = (e) => {
    if (!drag) return;
    tx = drag.tx + (e.clientX - drag.x);
    ty = drag.ty + (e.clientY - drag.y);
    clampPan();
    apply();
  };
  const onUp = () => {
    drag = null;
    img.classList.remove('dragging');
  };
  img.addEventListener('mousedown', (e) => {
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, tx, ty };
    img.classList.add('dragging');
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (Math.abs(scale - fitScale) < 0.01) zoomAt(e.clientX, e.clientY, 1 / scale); // → 1:1
    else fit();
  });

  const close = () => {
    if (!viewer || viewer !== el) return;
    viewer = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    el.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  window.addEventListener('keydown', onKey, true);
  stage.addEventListener('mousedown', close);
  el.addEventListener('mousemove', showBar);

  document.getElementById('overlays').appendChild(el);
  viewer = el;
  showBar();
}