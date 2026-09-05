// Locally installed font families, for Settings → Fonts.
//
// window.queryLocalFonts() is Chromium's Local Font Access API; main.js
// grants the 'local-fonts' permission. The first call must ride a user
// gesture (the font input's focus), and the list is cached for the session.
// If the API is unavailable (older Electron, other platforms), we return an
// empty list and the built-in stacks remain the only suggestions.

let cached = null;

export async function localFontFamilies() {
  if (cached) return cached;
  try {
    if (typeof window.queryLocalFonts !== 'function') return (cached = []);
    const fonts = await window.queryLocalFonts();
    const fams = [...new Set(fonts.map(f => f.family))].filter(Boolean);
    fams.sort((a, b) => a.localeCompare(b));
    cached = fams;
  } catch {
    cached = cached || [];
  }
  return cached;
}

// Curated stacks that always work, shown above the installed families.
export const BUILTIN_STACKS = [
  { label: 'system', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" },
  { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Palatino', value: "Palatino, 'Palatino Linotype', serif" },
  { label: 'Charter', value: "Charter, 'Bitstream Charter', serif" },
  { label: 'SF Mono', value: "'SF Mono', ui-monospace, Menlo, monospace" },
];