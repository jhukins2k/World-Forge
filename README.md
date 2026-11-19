# World Forge

A private worldbuilding library for writers. Each world is a shelf; each book on it is a category you define — characters, items, places, factions, whatever your world needs — with its own template of fields.

Runs entirely in the browser and installs as an app. Your worlds are saved on your own device; nothing in this repository contains story content.

**Open it:** https://jhukins2k.github.io/World-Forge/

## Stage 1 (this version)

- Library of worlds, with Fantasy, Sci-fi, Modern and Blank starter packs
- Books with editable templates: short and long text, numbers, dropdowns, tags, images, section headings, links to other entries (with notes), and fields that change over time
- `@` mentions in long text, plus automatic "Linked from" and "Mentioned in" lists
- Open Questions, per entry and per world
- Search across every world
- Backup download and restore; works offline; installable

## Coming next

2. Manuscript — books, chapters and scenes
3. Chronicle — the timeline
4. GitHub sync
5. Atlas (maps) and Lineage (family trees)

## Files

All files sit in one folder so they can be uploaded from a phone.

| File | What it is |
| --- | --- |
| `index.html` | The page shell |
| `style.css` | All styling; colors are variables at the top |
| `app.js` | Start-up, page routing, search, install |
| `store.js`, `db.js` | Saving and loading data |
| `fields.js`, `mentions.js` | Field types and `@` mentions |
| `templates.js` | Starter packs |
| `library.js`, `book.js`, `template.js`, `questions.js`, `settings.js`, `coming.js` | One file per screen |
| `ui.js`, `config.js` | Shared helpers and the version number |
| `sw.js` | Offline support — bump `CACHE` with each release |
