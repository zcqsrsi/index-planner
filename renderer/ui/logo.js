// The Index mark: a heavy ring with one open slot, the withdrawn segment
// pulled out of the shelf like a book. Seventeen finishes — colour slots are
// plate (the squircle), ring (the shelf), seg (the pulled segment), glow.
// Monitor, the chrome finish, swaps the flat plate/ring colours for
// plateGrad/markGrad: top-to-bottom metal stops, rendered as gradients in
// the settings grid and the Dock PNG alike. Settings → Logo picks one; it
// repaints the macOS Dock icon live. The first finish is the default.

export const LOGOS = [
  { id: 'gunmetal-ice', name: 'Array', plate: '#3a4148', ring: '#bfe9f5', glow: 'rgba(191,233,245,.4)' },
  { id: 'terminal-green', name: 'Terminal Green', plate: '#22282c', ring: '#93ef9e', glow: 'rgba(147,239,158,.6)' },
  { id: 'steel', name: 'Installation Classic', plate: '#92989e', ring: '#9dc8da' },
  { id: 'hologram', name: 'Hologram', plate: '#232b33', ring: '#6ed2f2', glow: 'rgba(110,210,242,.75)' },
  { id: 'amber-sigil', name: 'Amber Sigil', plate: '#92989e', ring: '#e0a458' },
  { id: 'night-ops', name: 'Night Ops', plate: '#262b31', ring: '#dde8ee' },
  { id: 'two-tone-pull', name: 'Two-tone Pull', plate: '#92989e', ring: '#9dc8da', seg: '#e0a458', glow: 'rgba(224,164,88,.45)' },
  { id: 'deep-sea', name: 'Deep Sea', plate: '#1c232b', ring: '#54c8f0', glow: 'rgba(84,200,240,.85)' },
  { id: 'two-tone-night', name: 'Two-tone Night', plate: '#262b31', ring: '#8fb9cc', seg: '#e0a458', glow: 'rgba(224,164,88,.45)' },
  { id: 'blue-green-pull', name: 'Blue + Green Pull', plate: '#92989e', ring: '#8fc3d8', seg: '#7fdc9e', glow: 'rgba(127,220,158,.5)' },
  { id: 'jade-hard-light', name: 'Jade Hard Light', plate: '#39424a', ring: '#5fd6b4', glow: 'rgba(95,214,180,.5)' },
  { id: 'bronze-cyan', name: 'Bronze + Cyan', plate: '#8a7355', ring: '#9fd9ee', glow: 'rgba(159,217,238,.4)' },
  { id: 'violet-luminous', name: 'Violet Luminous', plate: '#262e38', ring: '#a98ef2', glow: 'rgba(169,142,242,.65)' },
  { id: 'blue-violet-pull', name: 'Blue + Violet Pull', plate: '#92989e', ring: '#8fc3d8', seg: '#a98ef2', glow: 'rgba(169,142,242,.5)' },
  { id: 'glacier-duo', name: 'Glacier Duo', plate: '#1f262c', ring: '#6ed2f2', seg: '#8ef0b4', glow: 'rgba(110,210,242,.55)' },
  { id: 'desert', name: 'Desert', plate: '#7d6647', ring: '#e8b869', glow: 'rgba(232,184,105,.4)' },
  // Monitor: a steel body with a blue eye. plateGrad is the shell, darker
  // steel that falls to a cool floor so the eye carries the plate; markGrad
  // is the eye, electric mid-blue opening to ice and closing to a deep
  // floor. ring (flat blue) is the glow colour and the flat fallback.
  { id: 'monitor', name: 'Monitor', plate: '#8d97a2', ring: '#2e7fe0', glow: 'rgba(120,190,255,.45)',
    plateGrad: ['#b9c1cb', '#8d97a2', '#6f7984'],
    markGrad: ['#aee0ff', '#2e7fe0', '#123f8f'] },
];

export const DEFAULT_LOGO = LOGOS[0];

// Logo ids were renamed in the theme pass; settings written before the
// rename still carry the old ids, so fold them in.
const RENAMED = {
  'installation': 'steel',
  'deep-installation': 'deep-sea',
  'desert-installation': 'desert',
  'monitor-green': 'terminal-green',
};

export function canonicalLogoId(id) {
  return (id && RENAMED[id]) || id;
}

export function logoById(id) {
  return LOGOS.find(l => l.id === id)
    || LOGOS.find(l => l.id === RENAMED[id])
    || DEFAULT_LOGO;
}

// ---- Geometry (200-unit mockup space, plate spans 18..182) --------------

const R = 44, HALF = 8, RING_TAPER = 1, SLOT = 28, PIECE_HALF = 21, LIFT = 18, SPINE = 4, TILT = 120;

function bandW(aDeg) {
  const a = aDeg * Math.PI / 180;
  return HALF + RING_TAPER * (0.5 - 0.5 * Math.cos(a));
}

// SVG markup for embedding in the settings grid / anywhere in the DOM.
let filterSeq = 0;
export function logoSvgMarkup(logo, size = 64) {
  const fid = `logo-glow-${++filterSeq}`;
  const gid = `logo-grad-${filterSeq}`;
  const glow = logo.glow
    ? `<filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%">
         <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="${logo.ring}" flood-opacity="${glowOpacity(logo)}"/>
       </filter>`
    : '';
  // Metal finishes: plate shades top-to-bottom across the squircle; the
  // mark shades across the ring band in its own (rotated) space, so the
  // chrome reads as lit from above whatever the tilt.
  const grad = (id, stops, y1, y2) =>
    `<linearGradient id="${id}" x1="100" y1="${y1}" x2="100" y2="${y2}" gradientUnits="userSpaceOnUse">` +
    stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('') +
    '</linearGradient>';
  const defs = (logo.plateGrad ? grad(`${gid}-p`, logo.plateGrad, 30, 170) : '') +
    (logo.markGrad ? grad(`${gid}-m`, logo.markGrad, 42, 158) : '');
  const plateFill = logo.plateGrad ? `url(#${gid}-p)` : logo.plate;
  const markFill = logo.markGrad ? `url(#${gid}-m)` : logo.ring;
  const groupAttrs = logo.glow ? ` filter="url(#${fid})"` : '';
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" aria-label="${logo.name}">
    ${glow}${defs}
    <rect x="18" y="18" width="164" height="164" rx="37" fill="${plateFill}"/>
    <g transform="rotate(${TILT} 100 100)"${groupAttrs}>
      <path d="${bandPathD()}" fill="${markFill}"/>
      <path d="${piecePathD()}" fill="${logo.seg || markFill}"/>
    </g>
  </svg>`;
}

function glowOpacity(logo) {
  // Pull the alpha out of the rgba() glow spec for feDropShadow.
  const m = /rgba\([^)]+[,)]\s*([\d.]+)\)/.exec(logo.glow);
  return m ? m[1] : 0.5;
}

function bandPathD() {
  const steps = 48, out = [], inn = [];
  for (let i = 0; i <= steps; i++) {
    const aDeg = SLOT + (360 - 2 * SLOT) * i / steps;
    const a = aDeg * Math.PI / 180 - Math.PI / 2;
    const w = bandW(aDeg);
    out.push([100 + Math.cos(a) * (R + w), 100 + Math.sin(a) * (R + w)]);
    inn.push([100 + Math.cos(a) * (R - w), 100 + Math.sin(a) * (R - w)]);
  }
  return 'M' + out.concat(inn.reverse()).map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
}

function piecePathD() {
  const steps = 24, out = [], inn = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const aDeg = -PIECE_HALF + 2 * PIECE_HALF * t;
    const a = aDeg * Math.PI / 180 - Math.PI / 2;
    const co = (Math.cos(aDeg / PIECE_HALF * Math.PI / 2) + 1) / 2;
    const wOut = bandW(aDeg) + SPINE * Math.pow(co, 2);
    const wIn = bandW(aDeg);
    out.push([100 + Math.cos(a) * (R + wOut + LIFT), 100 + Math.sin(a) * (R + wOut + LIFT)]);
    inn.push([100 + Math.cos(a) * (R - wIn + LIFT), 100 + Math.sin(a) * (R - wIn + LIFT)]);
  }
  return 'M' + out.concat(inn.reverse()).map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
}

// PNG data URL for the Dock icon — drawn on the Apple grid (squircle inset
// ~82.4%), same geometry, glow via canvas shadow.
export function logoPngDataUrl(logo, px = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  const scale = (px * 0.805) / 164; // plate 824/1024 ≈ 82.4%
  const cx = px / 2;
  // Metal stops as a canvas gradient — coordinates are mockup units, so it
  // rides whatever transform is current when it is filled with.
  const vGrad = (y1, y2, stops) => {
    const g = ctx.createLinearGradient(100, y1, 100, y2);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  };

  // Plate (unrotated squircle), mockup 18..182 → canvas.
  ctx.save();
  ctx.translate(cx, cx);
  ctx.scale(scale, scale);
  ctx.translate(-100, -100);
  ctx.beginPath();
  ctx.roundRect(18, 18, 164, 164, 37);
  ctx.fillStyle = logo.plateGrad ? vGrad(18, 182, logo.plateGrad) : logo.plate;
  ctx.fill();
  ctx.restore();

  // The mark, rotated about the centre.
  ctx.save();
  ctx.translate(cx, cx);
  ctx.scale(scale, scale);
  ctx.rotate(TILT * Math.PI / 180);
  ctx.translate(-100, -100);
  if (logo.glow) {
    ctx.shadowColor = logo.ring;
    ctx.shadowBlur = px * 0.008;
  }
  const fillPath = (pathD) => ctx.fill(new Path2D(pathD), 'nonzero');
  const markFill = logo.markGrad ? vGrad(42, 158, logo.markGrad) : logo.ring;
  ctx.fillStyle = markFill;
  fillPath(bandPathD());
  ctx.fillStyle = logo.seg || markFill;
  fillPath(piecePathD());
  ctx.restore();

  return canvas.toDataURL('image/png');
}