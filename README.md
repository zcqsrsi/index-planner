# Index

Approach sustained, exploratory projects through trackable tasks and organised notes.

Index is a local-first project planner and notebook for macOS: projects broken
into aims and sub-objectives, a day planner under each, a dashboard that
watches everything for overdue and going-stale work, and a block editor
for the writing next to it. Everything lives as plain JSON and Markdown
in one `data/` folder — no account, no sync, no server.

- Projects → aims → sub-objectives → tasks, with a day-planner table under each sub-objective
- Dashboard "map": every open thread on one ring, color-coded healthy / going stale / overdue
- Big picture statements per project (or shared across a group), with a full revision history
- Block editor with page links (`@`), inline tags (`#tag`), undo/redo, images, page history
- The Log: one automatic case file per day, with a capture inbox (⌘J)
- Threads: a replayable timeline of everything, backlinks included
- Paste a journal table and it converts to planner day rows
- Full-text search across pages and tasks
- Markdown and PDF export
- Automatic snapshot backups on every launch (30 daily + 10 weekly)
- Themes, fonts, and seven "dresses" for the tasks pane

## Running it

Built with Electron, no framework, no bundler — every file is plain readable
JavaScript.

```
npm install     # once; installs the dev dependencies
npm start       # run the app
npm run dev     # run with DevTools attached
npm run icon    # regenerate build/icon.png (the app icon source)
npm run dist    # package as .app + .dmg (unsigned → right-click, Open)
```

## Where your data lives

Plain files in one folder — `data/` beside the app when running from
source, `~/Library/Application Support/Index/data` in the packaged app.
Back it up by copying that one directory:

```
data/
  settings.json      theme + preferences
  notebooks.json     projects, groups, aims, sub-objectives, tasks
  pages/<id>.json    each page: content + version snapshots
  activity.jsonl     append-only log powering the dashboard feed and Threads
  daylog.json        day stamps (spirits / energy / weather)
  attachments/       pasted images and attached files
```

All JSON writes are atomic (temp file + rename), so a crash can never
half-write a file. Attachments are served over the internal `note://`
protocol. On every launch Index zips `data/` into `data/backups/` — the
newest copy for each of the last 30 days, then a weekly copy for 10 more
weeks — and restores from the newest good snapshot automatically if the
folder is ever corrupted. A backup destination inside iCloud Drive copies
snapshots off the machine when the network allows.

## Shortcuts

| Keys | Action |
|---|---|
| `⌘K` | Quick-add task |
| `⌘P` | Quick-open page |
| `⌘N` | New page |
| `⌘D` | Today's file |
| `⌘J` | Capture a thought |
| `⌘H` | Page history |
| `⌘S` | Force save + snapshot |
| `⌘Z` / `⌘⇧Z` | Undo / redo block changes |
| `⌘L` | Loose-end sweep (stale threads) |
| `⌘,` | Settings |
| `/`, `@`, `#tag` | Block menu, page link, tag (in editor) |

## Notes & limits

- The editor's undo is block-level (structural changes), not character-level.
- No tables or nested pages — deliberately.
- The packaged app is unsigned; macOS Gatekeeper needs a first
  right-click → Open.
- macOS only (the day planner and shortcuts assume Mac keys).

## License

[MIT](LICENSE) — Copyright (c) 2026 Roop Singh Virk
