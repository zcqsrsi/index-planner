// Theme registry — metadata for the settings picker. The palettes themselves
// live in styles/themes.css; this just drives the swatch previews. Each dark
// theme is listed beside its light twin.

export const THEMES = [
  { id: 'index',              name: 'Index',                 swatch: ['#191c1e', '#cfa050', '#cc6a56', '#6e9a9c'] },
  { id: 'index-dawn',         name: 'Index Dawn',            swatch: ['#f2efe6', '#b3822a', '#b0472e', '#3d7376'] },
  { id: 'index-bright',       name: 'Index Bright',          swatch: ['#23292e', '#8abec0', '#eb8163', '#eeba63'] },
  { id: 'index-daylight',     name: 'Index Daylight',        swatch: ['#f4f6f7', '#2e8a8d', '#c25438', '#a06a12'] },
  { id: 'index-bright-alt',   name: 'Index Bright Alt',      swatch: ['#231f1a', '#d3a25e', '#c48fd6', '#3fc7c9'] },
  { id: 'index-daylight-alt', name: 'Index Daylight Alt',    swatch: ['#f4f1ea', '#a3722c', '#8a4bb0', '#0e8a8d'] },
  { id: 'index-silver',       name: 'Index Silver',          swatch: ['#1c2024', '#d7dde3', '#c2788a', '#6fa0c4'] },
  { id: 'index-silver-day',   name: 'Index Silver Day',      swatch: ['#f2f4f6', '#3f4750', '#a84e66', '#34699c'] },
  { id: 'index-silver-alt',   name: 'Index Silver Alt',      swatch: ['#1a1c1e', '#c9e6f2', '#d48fce', '#52c6c8'] },
  { id: 'index-silver-frost', name: 'Index Silver Frost',    swatch: ['#f1f5f8', '#2478a0', '#a34b86', '#0e7d80'] },
  { id: 'index-stock',        name: 'Index Stock',           swatch: ['#191c1e', '#cfa050', '#6e9a9c', '#d6d2c6'] },
  { id: 'index-stock-paper',  name: 'Index Stock Paper',     swatch: ['#f2efe6', '#a87d2a', '#4a463e', '#3d7376'] },
  { id: 'olive',              name: 'Olive',                 swatch: ['#1d1f1a', '#ced971', '#5a6843', '#e45e5e'] },
  { id: 'olive-dawn',         name: 'Olive Dawn',            swatch: ['#f3f2e9', '#7a852e', '#4f5c39', '#b23a2e'] },
  { id: 'navy',               name: 'Navy',                  swatch: ['#030713', '#007acc', '#0f1c3d', '#4ec9b0'] },
  { id: 'navy-dawn',          name: 'Navy Dawn',             swatch: ['#eef2f6', '#0067b8', '#d8e3ee', '#0e7d78'] },
];

export const DEFAULT_THEME = 'index-bright';

export function applyTheme(themeId) {
  const valid = typeof themeId === 'string' && THEMES.some(t => t.id === themeId);
  document.documentElement.dataset.theme = valid ? themeId : DEFAULT_THEME;
}