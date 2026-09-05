// Help: what the app is and how each part works. The UI itself stays terse;
// the explanations live here, one page, reachable from the nav.

const SECTIONS = [
  { id: 'idea', title: 'The idea' },
  { id: 'ring', title: 'The map' },
  { id: 'projects', title: 'Projects' },
  { id: 'log', title: 'The Log' },
  { id: 'threads', title: 'Threads' },
  { id: 'shortcuts', title: 'Shortcuts' },
  { id: 'fonts', title: 'Fonts and themes' },
  { id: 'backups', title: 'Backups' },
  { id: 'onenote', title: 'OneNote pages' },
  { id: 'data', title: 'Where your data lives' },
];

export function renderPanel(panelEl) {
  panelEl.innerHTML = `
    <div class="panel-header"><span>Help</span></div>
    <div class="panel-body">
      <div class="dash-nav">
        ${SECTIONS.map(s => `<button data-anchor="${s.id}">${s.title}</button>`).join('')}
      </div>
    </div>`;
  panelEl.querySelectorAll('[data-anchor]').forEach(btn => {
    btn.onclick = () => {
      document.getElementById(btn.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

export function renderMain(mainEl) {
  mainEl.innerHTML = `
    <div class="help-main">
      <h2 id="idea">The idea</h2>
      <p class="settings-sub">
        Index is made to make work with a very distant horizon approachable.
        Start a project by writing your broad or specific <b>aim</b>,
        broken down into more tangible <b>sub-objectives</b> and the <b>tasks</b> you will tick off to achieve them.
        Notes are attached to sub-objectives, so your writing resides with the work it documents.
      </p>
      <p class="settings-sub">
        Traditional notebooks don't help you keep on top of your work. In Index, unresolved tasks
        "float" on the map, meaning no tasks are quietly forgotten.
      </p>

      <h2 id="ring">The map</h2>
      <p class="settings-sub">
        The map is Index's heart, a quiet control room that lets you understand your work with a glance.
      </p>
      <ul class="help-list">
        <li>One <b>plate</b> per open thread, grouped by project. Hover a plate to see its project in the center; click to jump to it.</li>
        <li>Plate colors: teal is healthy, amber is going stale, red is a loose end (overdue) — loose ends also get a tick through their plate.</li>
        <li>The thin inner arc is resolved work eating into the project's span.</li>
        <li>The number in the center is every open thread at once: blue at 5 or fewer, amber to 12, red from 13.</li>
      </ul>
      <p class="settings-sub">
        Below the ring is today's briefing (threads that need attention first),
        as well as the Upcoming inbox (approaching due dates and unfiled tasks), recent changes
        and recent notes.
        If you prefer, you can change the map to a plain project list instead in settings.
      </p>

      <h2 id="projects">Projects</h2>
      <p class="settings-sub">Three collapsible panes from left to right.</p>
      <ul class="help-list">
        <li><b>Projects</b> Groups hold related projects, nest like section groups and paint their members in the group color.</li>
        <li><b>Shelve</b> parks a project on the <b>shelf</b> at the bottom of the tree — out of the counts, the briefing, and Quick add until it's unshelved. On the map its segment stays, plates quiet. Notes and search still find everything on it.</li>
        <li><b>Big picture</b> — the statement the journal is written under, restamped with the date each time you revise it; <b>past</b> opens the revisions before the current one. Projects in the same group <b>share one big picture</b> — set it from any member and the whole group carries it; an ungrouped project keeps its own.</li>
        <li><b>Resolve</b> answers the big picture — <i>so far</i>, not a verdict. The outcome hangs off its question on a vertical tie in the pane and a dashed diagonal in the sky, gold-edged; rewrite it as the evidence moves. Revising the question archives its outcome with the old wording, in <b>past</b>.</li>
        <li><b>Tasks pane</b> — the selected project: aims, their sub-objectives, and the day planner inside each. Tasks without a sub-objective sit in <b>Unfiled</b> unless later filed (task menu → File into).</li>
        <li>Each sub-objective functions as a <b>planner</b>, one row per day. Tasks written that day on the left, the day's note and files on the right. Tasks stay on the day they were written; while still open they also appear in today's row with an amber <i>from</i> pill. Done reads as bold struck-through, scrapped as struck-through in red.</li>
        <li><b>Deadlines</b> are set from a task's ⋯ menu — overdue tasks surface as loose ends on the map. <b>Tags</b> live there too: chips ride the task row, and <code>#tag</code> in Search browses tagged tasks across every project.</li>
        <li><b>Notes pane</b> — the selected sub-objective's pages, in the block editor. It starts folded so the planner keeps the full width; open it from the <b>Notes</b> strip on the right edge, from "notes" on a sub-objective, or any link to a page. Project-level notes live in General. Paste an image (or drop a file) straight into the page.</li>
        <li><b>Dress</b> — the tasks pane's look is a setting (Settings → Projects): seven ways the same content is set — type, rules, brackets, tabs. Aesthetic-only with no effect on content.</li>
      </ul>

      <h2 id="log">The Log</h2>
      <ul class="help-list">
        <li>One page per day, opened automatically the first time you look at it.</li>
        <li><b>Day stamps</b> (spirits, energy, weather) are kept beside the page, never inside it.</li>
        <li><kbd>⌘J</kbd> captures a thought to the inbox without breaking your flow.</li>
        <li><b>Reading</b> collects every note in a project or group into one scroll, with tasks greyed and small beside the prose.</li>
      </ul>

      <h2 id="threads">Threads</h2>
      <p class="settings-sub">
        A timeline of everything that happened, one band per day. Replay it as of
        any date, and <b>On this day</b> replays earlier years. Each day's entries sit
        under the <b>big question</b> each project answered to, as its wording stood
        on that day — when a question changed, the group threads back to the
        wording it replaced. <b>Backlinks</b> show what points at a page. The <b>sky</b>
        toggle reads the same threads as a constellation: pages and open tasks as stars, each thread its
        own figure, brightness fading as a thing goes untended. The dim italic
        lines are the big-picture questions — the <b>questions</b> toggle, top left
        of the sky, hides them. Click a star to open it.
      </p>

      <h2 id="shortcuts">Shortcuts</h2>
      <div class="settings-shortcuts">
        <div><kbd>⌘K</kbd> Quick-add task</div>
        <div><kbd>⌘P</kbd> Quick-open page</div>
        <div><kbd>⌘N</kbd> New page</div>
        <div><kbd>⌘D</kbd> Today's file (Log)</div>
        <div><kbd>⌘J</kbd> Capture to inbox</div>
        <div><kbd>⌘H</kbd> Page history</div>
        <div><kbd>⌘S</kbd> Force save + snapshot</div>
        <div><kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> Undo / redo block changes</div>
        <div><kbd>/</kbd> Block menu (in editor)</div>
        <div><kbd>@</kbd> Link a page (in editor)</div>
        <div><kbd>#tag</kbd> Inline tag (in editor)</div>
        <div><kbd>⌘,</kbd> Settings</div>
        <div><kbd>⌘L</kbd> Loose-end sweep (stale threads)</div>
        <div><kbd>↩</kbd> Accept · <kbd>esc</kbd> cancel, in dialogs</div>
        <div>Double-click a task title to rename it</div>
        <div>Double-click a project, aim or sub-objective name to rename it</div>
        <div>Drag a sub-objective by its header to reorder it</div>
        <div>Dates typed into names light up as they get close (red = now or overdue, amber = this week)</div>
        <div>Set an aim's importance from its ⋯ menu</div>
        <div>Right-click a pasted OneNote day table → “Split into day rows…”</div>
        <div>Right-click a page → Paste as text / Paste as image — a OneNote table that refuses to convert still gives up its words</div>
      </div>

      <h2 id="fonts">Fonts and themes</h2>
      <p class="settings-sub">
        The interface font and the page font are set separately (Settings →
        Fonts); the interface text size scales the whole UI, the page text
        size only the editor. Any family installed on this Mac works. The
        interface font covers <i>everything</i> — counts, dates, labels,
        stamps — except code blocks inside pages, which stay mono.
      </p>
      <p class="settings-sub">
        OneNote note: <b>Microsoft Yi Baiti</b> is a Windows font. Install it
        first (copy the .ttf into Font Book) if pasted pages should read
        exactly as they did in OneNote.
      </p>

      <h2 id="backups">Backups</h2>
      <p class="settings-sub">
        On every launch, Index zips <code>data/</code> into
        <code>data/backups/</code> — the newest copy for each of the last 30
        days, then a weekly copy for 10 more weeks. A corrupt data file is
        restored from the newest good snapshot automatically. Set a
        destination (Settings → Backups) inside iCloud Drive and copies
        travel off this machine whenever the network allows.
      </p>

      <h2 id="onenote">OneNote pages</h2>
      <p class="settings-sub">
        <b>Copy a page (or table) in OneNote and paste it into any page
        here</b> — headings, lists and tables arrive as real blocks, and
        images are saved into the attachments folder. A pasted day table can
        be converted with Find journal tables (Settings → Backups): each
        row's day stamps its tasks, notes land in the day diary; nothing is
        applied until you preview and confirm.
      </p>

      <h2 id="data">Where your data lives</h2>
      <p class="settings-sub">
        Plain files in one folder — <code>data/</code> beside the app when
        running from source, <code>~/Library/Application Support/Index/data</code>
        in the packaged app:
      </p>
      <p class="settings-sub">
        <b>Universes</b> — the switcher left of the nav holds a level above
        projects: each universe keeps its own projects and groups, and the
        whole app narrows to the current one. The Log journal spans them all.
        From the switcher's menu, <b>Close</b> moves a universe's projects to
        another universe and keeps everything; <b>Delete</b> removes the
        universe and everything in it, permanently.
        <b>Export</b> — pages export as Markdown or PDF from the editor's ⇪
        button; sub-objectives and whole projects export as Markdown from
        their ⋯ menus.
      </p>
      <ul class="help-list">
        <li><code>notebooks.json</code> — projects, groups, aims, sub-objectives, tasks</li>
        <li><code>pages/&lt;id&gt;.json</code> — each page: content + version snapshots</li>
        <li><code>activity.jsonl</code> — the append-only log behind the dashboard feed and Threads</li>
        <li><code>daylog.json</code> — day stamps</li>
        <li><code>attachments/</code> — pasted images and attached files</li>
      </ul>
      <p class="settings-sub">
        Back it up by copying that one folder. All JSON writes are atomic
        (temp file + rename), so a crash can never half-write a file.
      </p>
    </div>`;
}