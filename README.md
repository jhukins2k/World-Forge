# World Forge

A private worldbuilding library for writers. Each world is a shelf; each book on it is a category you define (characters, items, places, factions, whatever your world needs) with its own template of fields.

Runs entirely in the browser and installs as an app. Your worlds are saved on your own device, and optionally synced to a private GitHub repository of your choice. Nothing in this repository contains story content.

**Open it:** https://jhukins2k.github.io/World-Forge/

## What's in it

- **Library:** worlds as shelves; Fantasy, Sci-fi, Modern and Blank starter packs
- **Books and templates:** short and long text, numbers, dropdowns, tags, images, section headings, links to other entries (with notes), and fields that change over time
- **`@` mentions** in long text, with automatic “Linked from”, “Mentioned in”, “Appears in”, “On the timeline” and “On the map” lists
- **Manuscript:** books → chapters → scenes, auto-numbered, with each chapter's characters, places and items gathered from its scenes, plus a “who appears where” grid
- **Chronicle:** a timeline with custom calendars; exact, approximate and relative dates; spans; lanes; folded gaps; and an “at this moment” snapshot
- **Atlas:** forged maps (generated terrain you sculpt and paint, stacked-pixel trees and buildings, roads, rivers, walls, regions, pins, sun and shadows, top-down and isometric views, and zoom-in maps from continent down to city), plus uploaded map images with pins and routes
- **Lineage:** family trees, plus a relationship web drawn from every link
- **Open Questions,** search, backups, offline use, installable
- **GitHub sync** to a private repository, with side-by-side conflict choices

## Files

Most files sit in one folder so they can be uploaded from a phone; the map engine has its own folders.

| File | What it is |
| --- | --- |
| `index.html` | The page shell |
| `style.css` | All styling; colors are variables at the top |
| `app.js` | Start-up, page routing, search, install |
| `store.js`, `db.js` | Saving and loading data |
| `fields.js`, `mentions.js`, `pickers.js` | Field types, `@` mentions, the entry picker |
| `chrono.js` | Calendars and dates |
| `templates.js` | Starter packs |
| `library.js`, `book.js`, `template.js`, `questions.js`, `settings.js` | Library, entries, templates, questions, settings screens |
| `manuscript.js`, `chronicle.js`, `atlas.js`, `lineage.js` | The tool books |
| `sync.js` | GitHub sync |
| `ui.js`, `config.js` | Shared helpers and the version number |
| `sw.js` | Offline support. Bump `CACHE` (and `APP_VERSION` in `config.js`) with each release |
| `src/*.ts` | The map engine, in TypeScript |
| `engine/*.js` | The map engine compiled to JavaScript. Rebuilt automatically by GitHub; don't edit these |
| `tsconfig.json` | TypeScript settings |
| `.github/workflows/pages.yml` | Tells GitHub to compile the map engine and publish the site on every commit |

## Building

Whenever something is committed to `main`, GitHub Actions compiles `src/` into `engine/` and publishes the site. For this, **Settings → Pages → Source** must be set to **GitHub Actions**. To build on your own computer instead: `npx -p typescript@7.0.2 tsc -p .`
