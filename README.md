# Index: approach sustained exploratory projects with trackable tasks and organised notes.

Index is a project planner and notebook for macOS that dynamically reacts to the work you need to do. When undertaking open-ended projects (like a PhD), with many moving parts, drawing up to-do lists is easy, but actually keeping your bearings is hard. 

The motivation was to create a notebook and planner specifically designed to help break down research tasks with broad, open-ended goals into tangible sub objectives and while tracking those objectives- so you never lose your bearings.

Everything about Index was designed with the aim of creating a calm, pleasant and productive workspace. Therefore, instead of traditional long lists of overdue reminders(!), Index includes more abstract ways to present your workload. 

The focal point is a floating ring that tracks your projects, allowing you to get to grips with the tasks ahead with a simple glance. As your projects evolve, the threads of their tasks, notes and the “big-picture” questions they aim to answer are stored in a constellation (threads: sky view), giving you the big picture of your work and any revisions, changes in direction, or resolved questions so far.

## Features:
- Big picture statements per project (or shared across a group), with a full revision history
- Block editor with page links (`@`), inline tags (`#tag`), undo/redo, images, page history
- The Log: one automatic case file per day, with a capture inbox (⌘J)
- Threads: a replayable timeline of everything, backlinks included
- Paste a journal table and it converts to planner day rows
- Full-text search across pages and tasks
- Markdown and PDF export
- Automatic snapshot backups on every launch (30 daily + 10 weekly)
- Themes, fonts, and seven "dresses" for the tasks pane

## More Details:

- Breakdown:
Projects are broken into aims, then sub-objectives, then tracked tasks. Sub-objectives function as a day planner and include block     editor for the notes you want to make along the way to reaching those objectives. The Map is a dashboard that monitors all your various projects, so overdue work always lands in the central "control centre". 
- Data:
Everything lives as plain JSON and Markdown
in one `data/` folder — no account, no sync, no server. You can direct your backups to anywhere you like (such as an iCloud folder).

## Install

1. [Download the DMG](https://github.com/zcqsrsi/index-planner/releases/latest)
   from the Releases page (Apple Silicon Macs — M1 or later).
2. Open the DMG and drag **Index** into Applications.
3. On first launch only, right-click the app and choose **Open**, then
   confirm — Index is an unsigned app, so macOS Gatekeeper needs that one
   nudge. After that it opens like any other app.

New versions appear on the same Releases page; replace the app in
Applications to update. Your data is untouched — see below.

## Building from source

Built with Electron, no framework, no bundler — every file is plain readable
JavaScript. You need Node.js and npm.

```
git clone https://github.com/zcqsrsi/index-planner.git
cd index-planner
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
- macOS only (the day planner and shortcuts assume Mac keys).

## License

[MIT](LICENSE) — Copyright (c) 2026 Roop Singh Virk
