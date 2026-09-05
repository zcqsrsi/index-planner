# Index

Approach sustained, exploratory projects through trackable tasks and organised notes.

Index is a project planner and notebook for macOS that reacts to the tasks you create. The motivation was to create a notebook and planner to help break down research tasks with broad, open-ended goals into tangible sub objectives all while having those objects tracked- so you never lose your bearings. Everything was designed with a calm, accessible and productive working environment in mind. 

Instead of long lists of overdue reminders, I chose more abstract (and satisfying) ways of presenting a workload.   

To that end, the focal point of Index is a floating ring that tracks your projects, allowing you to get to grips with tasks with merely a glance. 

As your projects evolve, the threads of tasks, notes and their “big-picture” questions are recorded in a constellation, giving a birds-eye view of the history of your work and any revisions, changes in direction, or resolved questions that you made.


More Details: 
Projects are broken into aims and sub-objectives- which each have a day planner and block editor for the notes you want to make along the way to reaching those objectives. 
The Map is a dashboard that
monitors everything for overdue work. 

Everything lives as plain JSON and Markdown
in one `data/` folder — no account, no sync, no server. You can direct your backups to anywhere you like (such as an iCloud folder).


Big picture statements per project (or shared across a group), with a full revision history
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
