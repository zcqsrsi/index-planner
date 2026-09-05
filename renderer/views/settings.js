// Settings: theme picker, dress, backups, journal-table conversion, about.

import { getState, setState, allProjects } from '../store.js';
import { THEMES } from '../themes.js';
import { esc, toast, openModal, promptModal, closeModal } from '../ui/components.js';
import { scanForJournalPages, applyJournal } from '../onenote/journal.js';
import { LOGOS, canonicalLogoId, logoById, logoSvgMarkup, logoPngDataUrl } from '../ui/logo.js';
import { localFontFamilies, BUILTIN_STACKS } from '../ui/fonts.js';
import { DRESSES, dressId } from '../ui/dresses.js';

export function renderPanel(panelEl) {
  panelEl.innerHTML = `
    <div class="panel-header"><span>Settings</span></div>
    <div class="panel-body">
      <div class="settings-nav">
        <button data-anchor="themes">🎨 Theme</button>
        <button data-anchor="logo">◍ Logo</button>
        <button data-anchor="fonts">✎ Fonts</button>
        <button data-anchor="projects">✓ Projects</button>
        <button data-anchor="threads">◇ Threads</button>
        <button data-anchor="backups">⌸ Backups</button>
        <button data-anchor="about">◎ About</button>
      </div>
    </div>`;
  panelEl.querySelectorAll('.settings-nav button').forEach(btn => {
    btn.onclick = () => document.getElementById(btn.dataset.anchor)?.scrollIntoView({ behavior: 'smooth' });
  });
}

export function renderMain(mainEl) {
  const { settings } = getState();
  mainEl.innerHTML = `
    <div class="settings-main">
      <h2 id="themes">Theme</h2>
      <p class="settings-sub">Dark originals and their light twins.</p>
      <div class="theme-grid">
        ${THEMES.map(t => `
          <button class="theme-card ${settings.theme === t.id ? 'sel' : ''}" data-theme="${t.id}">
            <div class="theme-swatch">
              ${t.swatch.map(c => `<span data-color="${c}"></span>`).join('')}
            </div>
            <div class="theme-name">${esc(t.name)}</div>
          </button>`).join('')}
      </div>

      <h2 id="logo">Logo</h2>
      <p class="settings-sub">The mark in the Dock — the segment withdrawn from the shelf, in sixteen finishes. The choice repaints the Dock icon live.</p>
      <div class="ql-settings-row">
        <span>Dock logo</span>
        <div class="logo-pick">
          <span class="logo-preview" id="logo-preview">${logoSvgMarkup(logoById(settings.logo) || LOGOS[0], 34)}</span>
          <select id="logo-select" class="logo-select" title="The Dock mark">
            ${LOGOS.map(l => `<option value="${l.id}" ${canonicalLogoId(settings.logo) === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <h2 id="fonts">Fonts</h2>
      <p class="settings-sub">Interface and page fonts are set separately — click a field to browse every installed family. One font note in <a data-goto="help" class="help-link">Help</a>.</p>
      <div class="ql-settings-row font-row">
        <span>Interface font</span>
        <div class="font-wrap">
          <input type="text" id="font-ui" class="backup-input font-input"
                 value="${esc(settings.uiFont || '')}" placeholder="system default" spellcheck="false" autocomplete="off">
          <div class="font-menu" hidden></div>
        </div>
      </div>
      <div class="ql-settings-row font-row">
        <span>Page font</span>
        <div class="font-wrap">
          <input type="text" id="font-editor" class="backup-input font-input"
                 value="${esc(settings.editorFont || '')}" placeholder="matches interface font" spellcheck="false" autocomplete="off">
          <div class="font-menu" hidden></div>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Interface text size</span>
        <label class="pm-item"><input type="number" id="ui-scale" min="80" max="140" step="5" value="${Math.round((settings.uiScale ?? 1) * 100)}" style="width:52px"> %</label>
      </div>
      <div class="ql-settings-row">
        <span>Page text size</span>
        <label class="pm-item"><input type="number" id="font-size" min="11" max="28" value="${settings.editorFontSize ?? 15}" style="width:52px"> px</label>
      </div>
      <div class="font-preview">
        <div class="font-preview-ui">Interface text — counts, titles, buttons</div>
        <div class="font-preview-editor">Page text at its chosen size. 0123456789</div>
        <div class="font-preview-note" id="font-yibaiti-note" hidden>Microsoft Yi Baiti isn't installed on this Mac yet.</div>
      </div>

      <h2 id="projects">Projects</h2>
      <p class="settings-sub">Dress, staleness, and the dashboard layout.</p>
      <div class="ql-settings-row">
        <span>Project page dress</span>
        <div class="dress-wrap">
          <select id="dress-select" class="dress-select" title="How the tasks pane is set — the content never changes, only the clothes">
            ${DRESSES.map(d => `<option value="${d.id}" ${(settings.dress || 'quiet-console') === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
          <span class="dress-blurb" id="dress-blurb">${esc(DRESSES.find(d => d.id === (settings.dress || 'quiet-console'))?.blurb || '')}</span>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Day pulse (the dot in today's date)</span>
        <div class="ql-voice-toggle" id="settings-daypulse">
          <button data-pulse="off" class="${settings.dayPulse === false ? 'on' : ''}">Off</button>
          <button data-pulse="on" class="${settings.dayPulse === false ? '' : 'on'}">On</button>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Progress glyph (project head)</span>
        <select id="progress-style" class="holo-style-select">
          <option value="bar"${settings.progressStyle === 'bar' ? ' selected' : ''}>Bar</option>
          <option value="pulse"${(settings.progressStyle ?? 'pulse') === 'pulse' ? ' selected' : ''}>Pulse</option>
          <option value="nodes"${settings.progressStyle === 'nodes' ? ' selected' : ''}>Nodes</option>
          <option value="comet"${settings.progressStyle === 'comet' ? ' selected' : ''}>Comet</option>
          <option value="filament"${settings.progressStyle === 'filament' ? ' selected' : ''}>Filament</option>
        </select>
      </div>
      <div class="ql-settings-row">
        <span>A thread is stale after</span>
        <label class="pm-item"><input type="number" id="stale-days" min="1" max="30" value="${settings.staleDays ?? 3}" style="width:52px"> days afloat</label>
      </div>
      <div class="ql-settings-row">
        <span>Active projects on the dashboard as</span>
        <div class="ql-voice-toggle" id="settings-layout">
          <button data-layout="list" class="${(settings.dashboardLayout || 'list') === 'list' ? 'on' : ''}">List</button>
          <button data-layout="ring" class="${settings.dashboardLayout === 'ring' ? 'on' : ''}">Ring</button>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Ring segments scale with open tasks</span>
        <div class="ql-voice-toggle" id="settings-ringscale">
          <button data-scale="on" class="${settings.ringScale !== false ? 'on' : ''}">On</button>
          <button data-scale="off" class="${settings.ringScale === false ? 'on' : ''}">Off</button>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Ring plates lift on hover</span>
        <div class="ql-voice-toggle" id="settings-ringlift">
          <button data-lift="off" class="${settings.ringHoverLift === false ? 'on' : ''}">Off</button>
          <button data-lift="on" class="${settings.ringHoverLift === false ? '' : 'on'}">On</button>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Number in the ring's centre</span>
        <div class="ql-voice-toggle" id="settings-ringcount">
          <button data-count="off" class="${settings.ringCount === false ? 'on' : ''}">Off</button>
          <button data-count="on" class="${settings.ringCount === false ? '' : 'on'}">On</button>
        </div>
      </div>

      <h2 id="threads">Threads</h2>
      <div class="ql-settings-row">
        <span>Big-picture glow (the halo on question heads)</span>
        <div class="ql-voice-toggle" id="settings-qglow">
          <button data-glow="off" class="${settings.questionGlow === false ? 'on' : ''}">Off</button>
          <button data-glow="on" class="${settings.questionGlow === false ? '' : 'on'}">On</button>
        </div>
      </div>
      <div class="ql-settings-row">
        <span>Question head size</span>
        <select id="question-size" class="holo-style-select">
          <option value="small"${(settings.questionSize ?? 'normal') === 'small' ? ' selected' : ''}>Small</option>
          <option value="normal"${(settings.questionSize ?? 'normal') === 'normal' ? ' selected' : ''}>Normal</option>
          <option value="large"${(settings.questionSize ?? 'normal') === 'large' ? ' selected' : ''}>Large</option>
        </select>
      </div>
      <div class="ql-settings-row">
        <span>Passing glow (two lights riding the sky's rim)</span>
        <div class="ql-voice-toggle" id="settings-skydrift">
          <button data-drift="off" class="${settings.skyDrift === false ? 'on' : ''}">Off</button>
          <button data-drift="on" class="${settings.skyDrift === false ? '' : 'on'}">On</button>
        </div>
      </div>

      <h2 id="backups">Backups</h2>
      <p class="settings-sub">Snapshot on every launch, automatic restore. Retention and setup in <a data-goto="help" class="help-link">Help</a>.</p>
      <div class="backup-status" id="backup-status"><span class="backup-loading">reading…</span></div>

      <h3 id="journal">Journal tables</h3>
      <p class="settings-sub">Pages that are still one-table-per-day (Tasks · Notes · Files) — pasted from OneNote, or converted — can become real threads: tasks day-stamped, notes into the day diary. Nothing is applied until you preview and confirm.</p>
      <div class="backup-status" id="journal-box"></div>

      <h2 id="about">About</h2>
      <p class="settings-sub">
        Welcome to <b>Index</b>, designed to assist you in undertaking long-term projects.<br>
        Personal notes, projects and change tracking form the basis of the app.<br>
        Create projects with aims and assign the corresponding steps to reach them.<br>
        The map is a peaceful focal point to view projects unfolding at a glance.<br>
        Plain files belong in one folder: <code>data/</code> beside the app from source,
        <code>~/Library/Application Support/Index/data</code> packaged.<br>
        Point your backups wherever you like (such as iCloud drive).<br>
        shortcuts under <a data-goto="help" class="help-link">Help</a>.
      </p>
    </div>`;

  // CSP blocks inline style attributes, so the swatches are painted through
  // CSSOM instead.
  mainEl.querySelectorAll('.theme-swatch span').forEach(span => {
    span.style.setProperty('background', span.dataset.color);
  });

  // The long explanations live in Help; these links jump there.
  mainEl.querySelectorAll('[data-goto]').forEach(a => {
    a.onclick = () => window.__index.goto(a.dataset.goto);
  });

  mainEl.querySelectorAll('.theme-card').forEach(card => {
    card.onclick = async () => {
      const themeId = card.dataset.theme;
      const newSettings = await window.api.setSetting('theme', themeId);
      getState().settings.theme = themeId;
      mainEl.querySelectorAll('.theme-card').forEach(c => {
        c.classList.toggle('sel', c.dataset.theme === themeId);
      });
      document.documentElement.dataset.theme = themeId;
    };
  });

  mainEl.querySelectorAll('#settings-daypulse button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('dayPulse', btn.dataset.pulse === 'on');
      getState().settings = s;
      mainEl.querySelectorAll('#settings-daypulse button').forEach(b =>
        b.classList.toggle('on', b.dataset.pulse === btn.dataset.pulse));
    };
  });
  mainEl.querySelector('#progress-style')?.addEventListener('change', async (e) => {
    const s = await window.api.setSetting('progressStyle', e.target.value);
    getState().settings = s;
    toast(e.target.value === 'bar' ? 'Progress bar' : 'Progress glyph — visit a project pane to see it');
  });
  mainEl.querySelector('#stale-days').addEventListener('change', async (e) => {
    const days = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 3));
    e.target.value = days;
    const s = await window.api.setSetting('staleDays', days);
    getState().settings = s;
  });
  mainEl.querySelectorAll('#settings-layout button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('dashboardLayout', btn.dataset.layout);
      getState().settings = s;
      mainEl.querySelectorAll('#settings-layout button').forEach(b =>
        b.classList.toggle('on', b.dataset.layout === btn.dataset.layout));
      toast('Map layout: ' + btn.dataset.layout);
    };
  });
  mainEl.querySelectorAll('#settings-ringscale button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('ringScale', btn.dataset.scale === 'on');
      getState().settings = s;
      mainEl.querySelectorAll('#settings-ringscale button').forEach(b =>
        b.classList.toggle('on', b.dataset.scale === btn.dataset.scale));
    };
  });
  mainEl.querySelectorAll('#settings-ringlift button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('ringHoverLift', btn.dataset.lift === 'on');
      getState().settings = s;
      mainEl.querySelectorAll('#settings-ringlift button').forEach(b =>
        b.classList.toggle('on', b.dataset.lift === btn.dataset.lift));
    };
  });
  mainEl.querySelectorAll('#settings-ringcount button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('ringCount', btn.dataset.count === 'on');
      getState().settings = s;
      mainEl.querySelectorAll('#settings-ringcount button').forEach(b =>
        b.classList.toggle('on', b.dataset.count === btn.dataset.count));
      toast(btn.dataset.count === 'on' ? 'Ring number on — see the Map' : 'Ring number off — see the Map');
    };
  });
  mainEl.querySelectorAll('#settings-qglow button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('questionGlow', btn.dataset.glow === 'on');
      getState().settings = s;
      mainEl.querySelectorAll('#settings-qglow button').forEach(b =>
        b.classList.toggle('on', b.dataset.glow === btn.dataset.glow));
      toast(btn.dataset.glow === 'on' ? 'Big-picture glow on' : 'Big-picture glow off — see Threads');
    };
  });
  mainEl.querySelectorAll('#settings-skydrift button').forEach(btn => {
    btn.onclick = async () => {
      const s = await window.api.setSetting('skyDrift', btn.dataset.drift === 'on');
      getState().settings = s;
      mainEl.querySelectorAll('#settings-skydrift button').forEach(b =>
        b.classList.toggle('on', b.dataset.drift === btn.dataset.drift));
      toast(btn.dataset.drift === 'on' ? 'Passing glow on — see the sky' : 'Passing glow off');
    };
  });
  mainEl.querySelector('#question-size')?.addEventListener('change', async (e) => {
    const s = await window.api.setSetting('questionSize', e.target.value);
    getState().settings = s;
    toast('Question size: ' + e.target.value);
  });

  wireFonts(mainEl);
  wireLogos(mainEl);
  wireDress(mainEl);

  wireBackups(mainEl);
  wireJournal(mainEl.querySelector('#journal-box'));
}

// ---- Logo: a dropdown of the sixteen finishes; Dock icon repaints live ----

function wireLogos(mainEl) {
  const select = mainEl.querySelector('#logo-select');
  const preview = mainEl.querySelector('#logo-preview');
  select?.addEventListener('change', async () => {
    const logo = logoById(select.value);
    if (!logo) return;
    const s = await window.api.setSetting('logo', select.value);
    getState().settings = s;
    preview.innerHTML = logoSvgMarkup(logo, 34);
    await window.api.setDockIcon(logoPngDataUrl(logo));
    toast('Dock icon: ' + logo.name);
  });
}

// ---- Dress: how the project page is set; the pane re-clothes on re-render ----

function wireDress(mainEl) {
  const select = mainEl.querySelector('#dress-select');
  const blurb = mainEl.querySelector('#dress-blurb');
  select?.addEventListener('change', async () => {
    const s = await window.api.setSetting('dress', select.value);
    getState().settings = s;
    blurb.textContent = DRESSES.find(d => d.id === select.value)?.blurb || '';
  });
}

// ---- Fonts section: live preview, saved on change ----

function wireFonts(mainEl) {
  const uiInput = mainEl.querySelector('#font-ui');
  const editorInput = mainEl.querySelector('#font-editor');
  const sizeInput = mainEl.querySelector('#font-size');
  const scaleInput = mainEl.querySelector('#ui-scale');
  if (!uiInput || !editorInput || !sizeInput || !scaleInput) return;

  // Each font field gets a menu of every installed family (plus the built-in
  // stacks) — the full list on focus (the field's current value filters
  // nothing until you actually type), filtered as you type, with the
  // recently chosen families riding on top. Each option previews in its
  // own face.
  const wirePicker = (input) => {
    const menu = input.closest('.font-wrap')?.querySelector('.font-menu');
    if (!menu) return;
    let fonts = null;
    const render = (query) => {
      const needle = (query || '').trim().toLowerCase();
      const recents = (getState().settings.recentFonts || [])
        .filter(f => !needle || f.toLowerCase().includes(needle));
      const fams = (fonts || []).filter(f => !needle || f.toLowerCase().includes(needle));
      const stacks = BUILTIN_STACKS.filter(s =>
        !needle || s.label.toLowerCase().includes(needle) || s.value.toLowerCase().includes(needle));
      menu.innerHTML = `
        ${recents.length ? `<div class="font-menu-group">recent</div>
        ${recents.map(f => `<button class="font-menu-item" data-font="${esc(f)}" data-face="${esc(f)}">${esc(f)}</button>`).join('')}` : ''}
        <div class="font-menu-group">installed</div>
        ${fams.length
          ? fams.map(f => `<button class="font-menu-item" data-font="${esc(f)}" data-face="${esc(f)}">${esc(f)}</button>`).join('')
          : `<div class="font-menu-empty">${fonts ? 'no installed family matches' : 'reading installed fonts…'}</div>`}
        <div class="font-menu-group">built-in stacks</div>
        ${stacks.map(s => `<button class="font-menu-item" data-font="${esc(s.value)}"><code>${esc(s.label)}</code><span class="font-menu-stack">${esc(s.value)}</span></button>`).join('')}`;
      menu.querySelectorAll('.font-menu-item').forEach(item => {
        // Installed families and recents preview in their own face; stack
        // rows keep the interface font. CSSOM-set styles survive the CSP
        // (style-src 'self').
        if (item.dataset.face) {
          item.style.setProperty('font-family', `'${item.dataset.face.replace(/['"]/g, '')}'`);
        }
      });
      menu.hidden = false;
    };
    input.addEventListener('focus', async () => {
      // Open on the whole list — the field's current value would filter it
      // down to itself, which read like an empty menu.
      if (fonts === null) {
        fonts = await localFontFamilies();
        // Only the first enumeration needs the gesture; render once it lands.
        if (document.activeElement === input) render('');
      } else {
        render('');
      }
    });
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('blur', () => setTimeout(() => { menu.hidden = true; }, 150));
    menu.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.font-menu-item');
      if (!item) return;
      e.preventDefault();
      input.value = item.dataset.font;
      input.dispatchEvent(new Event('change'));
      menu.hidden = true;
    });
  };
  wirePicker(uiInput);
  wirePicker(editorInput);

  // Recently used fonts: both fields feed one list, most recent first,
  // five deep — typed choices and menu picks alike.
  const rememberFont = async (fam) => {
    if (!fam) return;
    const cur = getState().settings.recentFonts || [];
    if (cur[0] === fam) return;
    const next = [fam, ...cur.filter(f => f !== fam)].slice(0, 5);
    getState().settings = await window.api.setSetting('recentFonts', next);
  };

  const apply = () => {
    const root = document.documentElement;
    // Empty input = fall back to the theme default.
    if (uiInput.value.trim()) {
      root.style.setProperty('--font-ui', uiInput.value.trim());
      root.style.setProperty('--font-data', uiInput.value.trim());
    } else {
      root.style.removeProperty('--font-ui');
      root.style.removeProperty('--font-data');
    }
    // The page font rules the dresses too (--font-serif) — boot-time
    // applyFontSettings does this; live preview must not fall behind, or
    // the Projects pane's serif titles keep the old face until relaunch.
    if (editorInput.value.trim()) {
      root.style.setProperty('--font-editor', editorInput.value.trim());
      root.style.setProperty('--font-serif', editorInput.value.trim());
    } else {
      root.style.removeProperty('--font-editor');
      root.style.removeProperty('--font-serif');
    }
    root.style.setProperty('--editor-font-size', `${parseInt(sizeInput.value, 10) || 15}px`);
  };

  const save = async (key, value) => {
    getState().settings = await window.api.setSetting(key, value || undefined);
    apply();
  };

  uiInput.addEventListener('change', () => { save('uiFont', uiInput.value.trim()); rememberFont(uiInput.value.trim()); });
  editorInput.addEventListener('change', () => { save('editorFont', editorInput.value.trim()); rememberFont(editorInput.value.trim()); });
  // The size picker applies live while you spin or type it (save on change).
  sizeInput.addEventListener('input', () => {
    const size = Math.max(11, Math.min(28, parseInt(sizeInput.value, 10) || 15));
    document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
  });
  sizeInput.addEventListener('change', async (e) => {
    const size = Math.max(11, Math.min(28, parseInt(e.target.value, 10) || 15));
    e.target.value = size;
    await save('editorFontSize', size);
  });
  // Interface scale works the same way: live while typing, saved on change.
  scaleInput.addEventListener('input', () => {
    const pct = Math.max(80, Math.min(140, parseInt(scaleInput.value, 10) || 100));
    document.documentElement.style.setProperty('--ui-scale', String(pct / 100));
  });
  scaleInput.addEventListener('change', async (e) => {
    const pct = Math.max(80, Math.min(140, parseInt(e.target.value, 10) || 100));
    e.target.value = pct;
    await save('uiScale', pct / 100);
  });

  // Microsoft Yi Baiti is a Windows font — warn if this Mac doesn't have it.
  // document.fonts.check only tracks web fonts, so detect availability by
  // comparing rendered width against generic fallbacks.
  if (!isFontAvailable('Microsoft Yi Baiti')) {
    const note = mainEl.querySelector('#font-yibaiti-note');
    if (note) note.hidden = false;
  }
}

function isFontAvailable(family) {
  const text = 'mmmmmmmmmmlliWW';
  const measure = (font) => {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.font = `72px ${font}`;
    el.textContent = text;
    document.body.appendChild(el);
    const width = el.getBoundingClientRect().width;
    el.remove();
    return width;
  };
  const mono = measure('monospace');
  const serif = measure('serif');
  const quoted = `'${family.replace(/['"]/g, '')}'`;
  return measure(`${quoted}, monospace`) !== mono || measure(`${quoted}, serif`) !== serif;
}

// ---- Backups section ----

function fmtStamp(ts) {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function renderBackupStatus(el) {
  const st = await window.api.backupStatus();
  el.innerHTML = `
    <div class="backup-row">
      <span class="backup-key">local snapshots</span>
      <span class="backup-val">${st.count} kept · newest ${fmtStamp(st.lastBackup?.ts)}</span>
      <button class="backup-btn" id="backup-now">Back up now</button>
    </div>
    <div class="backup-row">
      <span class="backup-key">off this machine</span>
      <span class="backup-val" id="backup-dest-line">${esc(st.dest || 'no destination set')}</span>
      <button class="backup-btn" id="backup-choose">Choose…</button>
    </div>
    <div class="backup-row">
      <span class="backup-key">last off-machine copy</span>
      <span class="backup-val" id="backup-off-line">${fmtStamp(st.lastOffMachineTs)}</span>
      <button class="backup-btn" id="backup-sync" ${st.dest ? '' : 'disabled'}>Copy now</button>
    </div>`;
  return st;
}

function wireBackups(mainEl) {
  const el = mainEl.querySelector('#backup-status');
  if (!el) return;
  renderBackupStatus(el).then(() => {

  el.querySelector('#backup-now').onclick = async () => {
    const btn = el.querySelector('#backup-now');
    btn.disabled = true;
    const result = await window.api.backupNow();
    btn.disabled = false;
    toast(result ? `Snapshot taken — ${result.file}` : 'Backup failed — see console');
    renderBackupStatus(el);
  };

  el.querySelector('#backup-choose').onclick = async () => {
    const dir = await window.api.chooseDirectory();
    if (!dir) return;
    getState().settings = await window.api.backupSetDest(dir);
    await window.api.backupSync();
    toast('Destination set — copying backups');
    renderBackupStatus(el);
  };

  el.querySelector('#backup-sync').onclick = async (e) => {
    e.target.disabled = true;
    const result = await window.api.backupSync();
    e.target.disabled = false;
    toast(result.copied ? `Copied ${result.copied} backup${result.copied === 1 ? '' : 's'}` : 'Already up to date');
    renderBackupStatus(el);
  };
  });
}

// ---- Journal tables → threads ----
// Works on already-imported pages, so it's offered whether or not the
// Microsoft account is still connected.

function wireJournal(box) {
  if (!box) return;
  box.innerHTML = `
    <div class="backup-row">
      <span class="backup-key">converter</span>
      <span class="backup-val" id="journal-val">scans imported pages for day tables</span>
      <button class="backup-btn" id="journal-scan">Find journal tables…</button>
    </div>
    <div id="journal-results"></div>`;
  box.querySelector('#journal-scan').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Scanning…';
    const hits = await scanForJournalPages();
    e.target.disabled = false;
    e.target.textContent = 'Find journal tables…';
    const out = box.querySelector('#journal-results');
    if (!hits.length) {
      out.innerHTML = '<div class="backup-row"><span class="backup-val backup-dim">no journal tables found — imported pages with a Tasks · Notes · Files table will appear here</span></div>';
      return;
    }
    out.innerHTML = hits.map((h, i) => `
      <div class="backup-row">
        <span class="backup-key">${esc(h.meta.title || 'Untitled')}</span>
        <span class="backup-val backup-dim">${h.dayCount} day${h.dayCount === 1 ? '' : 's'} · ${h.taskCount} task${h.taskCount === 1 ? '' : 's'}</span>
        <button class="backup-btn" data-hit="${i}">Convert…</button>
      </div>`).join('');
    out.querySelectorAll('button[data-hit]').forEach(btn => {
      btn.onclick = () => previewJournal(hits[Number(btn.dataset.hit)]);
    });
  };
}

function previewJournal(hit) {
  const projects = allProjects();
  if (!projects.length) { toast('Create a project first, then convert'); return; }
  const sample = hit.rows.slice(0, 4).map(r => `
    <div class="journal-preview-day">
      <span class="journal-preview-date">${esc(r.date)}</span>
      <span>${r.tasks.length ? esc(r.tasks.join(' · ')) : '<i>no tasks</i>'}</span>
      ${r.notes ? `<div class="journal-preview-note">${esc(r.notes.slice(0, 140))}${r.notes.length > 140 ? '…' : ''}</div>` : ''}
    </div>`).join('');
  openModal({
    title: `Convert “${esc(hit.meta.title || 'Untitled')}” to threads`,
    body: `
      <label class="field"><span>Into project</span>
        <select class="modal-input" id="journal-target">
          ${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Sub-objective name</span>
        <input type="text" class="modal-input" id="journal-name" value="${esc(hit.meta.title || 'Imported journal')}">
      </label>
      <div class="journal-preview">
        ${sample}
        ${hit.rows.length > 4 ? `<div class="backup-dim">…and ${hit.rows.length - 4} more day${hit.rows.length - 4 === 1 ? '' : 's'}</div>` : ''}
      </div>`,
    actions: [
      { label: 'Cancel', style: 'secondary' },
      {
        label: 'Convert',
        onClick: async (el) => {
          const notebookId = el.querySelector('#journal-target').value;
          const name = el.querySelector('#journal-name').value.trim() || 'Imported journal';
          const res = await applyJournal({ notebookId, sectionName: name, rows: hit.rows });
          toast(`Converted — ${res.tasks} task${res.tasks === 1 ? '' : 's'} across ${res.days} day${res.days === 1 ? '' : 's'}`);
          window.__index?.refreshTree?.();
        },
      },
    ],
  });
}