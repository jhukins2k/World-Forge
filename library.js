// World Forge — the Library: one shelf per world, one book per category, then the tool books.

import { esc, safeColor, hashNum, icons, openDialog, promptDialog, confirmDialog, colorOptions, download, toast, LEATHER } from './ui.js';
import { state, uid, worldsSorted, booksOf, entriesOfBook, entriesOfWorld, saveWorld, saveBook, deleteWorld, openQuestionCount, exportData } from './store.js';
import { PACK_LIST, buildPack } from './templates.js';

export const TOOLS = [
  { key: 'manuscript', name: 'Manuscript', icon: 'quill', stage: 2, about: 'Your books, chapters and scenes, with the characters, places and items in each.' },
  { key: 'atlas', name: 'Atlas', icon: 'map', stage: 5, about: 'Upload maps and drop pins that link to your Places.' },
  { key: 'lineage', name: 'Lineage', icon: 'tree', stage: 5, about: 'Family trees and a web of relationships, drawn from the links you already make.' },
  { key: 'chronicle', name: 'Chronicle', icon: 'hourglass', stage: 3, about: 'A zoomable timeline from the first recorded event to the last.' },
];

function spine(book, count) {
  const len = book.name.length;
  const h = Math.min(300, Math.max(228 + (hashNum(book.id) % 52), 120 + len * 14));
  const small = len > 14;
  return `<a class="spine" href="#/w/${book.worldId}/b/${book.id}" style="height:${h}px;background:${safeColor(book.color)}"
      aria-label="${esc(book.name)}, ${count} ${count === 1 ? 'entry' : 'entries'}">
    <span class="band" aria-hidden="true"></span>
    <span class="spine-title ${small ? 'small' : ''}">${esc(book.name)}</span>
    <span class="spine-foot">${count}</span>
  </a>`;
}

function toolSpine(worldId, t, i) {
  const h = [286, 270, 280, 264][i];
  return `<a class="spine tool" href="#/w/${worldId}/tool/${t.key}" style="height:${h}px" aria-label="${t.name} (coming in stage ${t.stage})">
    <span class="band thick" aria-hidden="true"></span>
    <span class="spine-title">${t.name}</span>
    <span class="spine-foot icon">${icons[t.icon]}</span>
  </a>`;
}

function shelf(world) {
  const books = booksOf(world.id);
  const q = openQuestionCount(world.id);
  const n = entriesOfWorld(world.id).length;
  return `<section class="shelf" aria-label="${esc(world.name)}">
    <div class="shelf-back">
      <div class="books">
        ${books.map(b => spine(b, entriesOfBook(b.id).length)).join('')}
        <button type="button" class="spine ghost" data-act="new-book" data-world="${world.id}" aria-label="Add a book to ${esc(world.name)}">
          <span class="ghost-plus" aria-hidden="true">+</span>
          <span class="spine-title">New book</span>
        </button>
        <div class="bookend" aria-hidden="true"></div>
        ${TOOLS.map((t, i) => toolSpine(world.id, t, i)).join('')}
        <a class="spine tool questions" href="#/w/${world.id}/questions" style="height:252px" aria-label="Open Questions, ${q} unresolved">
          <span class="band thick" aria-hidden="true"></span>
          <span class="spine-title small">Open Questions</span>
          <span class="spine-foot"><span class="qcount">${q}</span></span>
        </a>
      </div>
    </div>
    <div class="plank">
      <div class="plank-left">
        <span class="plaque">${esc(world.name)}</span>
        <span class="plank-meta">${world.genre ? esc(world.genre) + ' · ' : ''}${books.length} ${books.length === 1 ? 'book' : 'books'} · ${n} ${n === 1 ? 'entry' : 'entries'}</span>
      </div>
      <div class="plank-right">
        <button type="button" class="btn plank-btn" data-act="rename-world" data-world="${world.id}">Rename</button>
        <button type="button" class="btn plank-btn" data-act="export-world" data-world="${world.id}">Export</button>
        <button type="button" class="btn plank-btn" data-act="delete-world" data-world="${world.id}">Delete</button>
      </div>
    </div>
  </section>`;
}

function emptyShelf() {
  return `<section class="shelf" aria-label="Forge a new world">
    <div class="shelf-back empty">
      <div class="empty-inner">
        <h2 class="empty-title">Forge a new world</h2>
        <p class="muted">Pick a starter pack and the shelf comes stocked with books and templates. You can rename, change or remove any of them.</p>
        <div class="pack-row">
          ${PACK_LIST.map(p => `<button type="button" class="btn pack" data-act="new-world" data-pack="${p.key}">${esc(p.label)}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="plank thin"></div>
  </section>`;
}

export function render(root) {
  const worlds = worldsSorted();
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="h1">Your Library</h1>
          <p class="lede">Each shelf is a world. Each book on it is a part of that world.</p>
        </div>
      </div>
      <div class="bookcase">
        ${worlds.map(shelf).join('')}
        ${emptyShelf()}
      </div>
    </div>`;

  root.onclick = async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const worldId = btn.dataset.world;
    const world = worldId && state.worlds.get(worldId);

    if (btn.dataset.act === 'new-world') {
      const pack = btn.dataset.pack;
      const label = PACK_LIST.find(p => p.key === pack)?.label;
      const name = await promptDialog(`New ${label} world`, 'What is this world called?', '', 'e.g. The Shattered Isles');
      if (!name) return;
      const w = { id: uid(), name, genre: pack === 'blank' ? '' : label, order: worlds.length, questions: [] };
      await saveWorld(w);
      for (const b of buildPack(pack, w.id)) await saveBook(b);
      toast(`“${name}” is on the shelf.`);
      render(root);
    }

    if (btn.dataset.act === 'new-book') {
      const others = booksOf(worldId);
      const r = await openDialog({
        title: 'New book',
        submitLabel: 'Add to shelf',
        body: `
          <label class="flabel" for="nb-name">Name</label>
          <input class="inp" id="nb-name" name="name" required maxlength="40" placeholder="e.g. Stores, Spells, Ships">
          <label class="flabel" for="nb-color">Leather color</label>
          <select class="inp" id="nb-color" name="color">${colorOptions(LEATHER[others.length % LEATHER.length].hex)}</select>
          <label class="flabel" for="nb-copy">Start its template from</label>
          <select class="inp" id="nb-copy" name="copy">
            <option value="">A blank page (just a Notes field)</option>
            ${others.map(b => `<option value="${b.id}">A copy of ${esc(b.name)}</option>`).join('')}
          </select>`,
      });
      if (!r) return;
      const src = r.copy && state.books.get(r.copy);
      const fields = src
        ? src.fields.map(f => ({ ...f, id: uid(), options: f.options ? [...f.options] : undefined, targets: f.targets ? [...f.targets] : undefined }))
        : [{ id: uid(), type: 'longtext', label: 'Notes' }];
      const book = { id: uid(), worldId, kind: 'category', name: r.name.trim(), color: r.color, order: others.length, fields };
      await saveBook(book);
      location.hash = `#/w/${worldId}/b/${book.id}`;
    }

    if (btn.dataset.act === 'rename-world' && world) {
      const name = await promptDialog('Rename world', 'World name', world.name);
      if (!name) return;
      world.name = name;
      await saveWorld(world);
      render(root);
    }

    if (btn.dataset.act === 'export-world' && world) {
      const date = new Date().toISOString().slice(0, 10);
      download(`${world.name.replace(/[^\w-]+/g, '-')}-${date}.json`, JSON.stringify(exportData(world.id), null, 2));
      toast('Backup downloaded.');
    }

    if (btn.dataset.act === 'delete-world' && world) {
      const n = entriesOfWorld(world.id).length;
      const ok = await confirmDialog(
        `Delete “${world.name}”, its ${booksOf(world.id).length} books and ${n} entries? This can't be undone. Export it first if you might want it back.`,
        { title: 'Delete this world?', confirmLabel: 'Delete world' });
      if (!ok) return;
      await deleteWorld(world.id);
      toast('World deleted.');
      render(root);
    }
  };
}
