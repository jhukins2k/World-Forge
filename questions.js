// World Forge — Open Questions: every undecided thing in a world, in one place.

import { esc, $, icons } from './ui.js';
import { state, uid, entriesOfWorld, entryHref, saveEntry, saveWorld } from './store.js';

export function render(root, { worldId }) {
  const world = state.worlds.get(worldId);
  if (!world) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }
  let showDone = false;

  function item(q, owner) {
    const entry = owner.bookId ? owner : null;
    return `<li class="${q.done ? 'done' : ''}">
      <input type="checkbox" id="q-${q.id}" data-act="toggle" data-q="${q.id}" data-owner="${owner.id}" ${q.done ? 'checked' : ''}>
      <label for="q-${q.id}">${esc(q.text)}</label>
      ${entry ? `<a class="q-owner" href="${entryHref(entry)}">${esc(entry.name)}</a>` : ''}
      <button type="button" class="icon-btn" data-act="delete" data-q="${q.id}" data-owner="${owner.id}" aria-label="Delete question">${icons.x}</button>
    </li>`;
  }

  function draw() {
    const groups = [];
    const wq = world.questions || [];
    groups.push({ label: 'General', owner: world, qs: wq });
    const byBook = new Map();
    for (const e of entriesOfWorld(worldId)) {
      if (!(e.questions || []).length) continue;
      const b = state.books.get(e.bookId);
      if (!byBook.has(b?.name)) byBook.set(b?.name, []);
      byBook.get(b?.name).push(e);
    }
    let open = 0, done = 0;
    const all = [...wq.map(q => [q, world])];
    for (const list of byBook.values()) for (const e of list) for (const q of e.questions) all.push([q, e]);
    all.forEach(([q]) => q.done ? done++ : open++);

    const section = (label, pairs) => {
      const shown = pairs.filter(([q]) => showDone || !q.done);
      if (!shown.length) return '';
      return `<section class="panel"><h2 class="panel-h">${esc(label)}</h2><ul class="qlist big">${shown.map(([q, o]) => item(q, o)).join('')}</ul></section>`;
    };

    root.innerHTML = `<div class="page">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span><span aria-current="page">Open Questions</span></nav>
      <div class="page-head">
        <div>
          <h1 class="h1">Open Questions</h1>
          <p class="lede">${open} unresolved · ${done} resolved. Questions added on any entry show up here too.</p>
        </div>
        ${done ? `<button type="button" class="btn ghost" data-act="show-done">${showDone ? 'Hide' : 'Show'} resolved</button>` : ''}
      </div>
      <form class="panel qadd wide" data-form="add">
        <label class="flabel" for="wq-new">Add a general question about this world</label>
        <div class="btn-row">
          <input class="inp" id="wq-new" name="q" placeholder="e.g. How long has the Corporation been in power?" autocomplete="off">
          <button type="submit" class="btn primary">Add</button>
        </div>
      </form>
      ${section('General', wq.map(q => [q, world]))}
      ${[...byBook.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([name, list]) =>
        section(name || 'Other', list.flatMap(e => e.questions.map(q => [q, e])))).join('')}
      ${open === 0 && !showDone ? '<div class="empty-card"><p>Nothing undecided. Add questions here, or from the side of any entry page.</p></div>' : ''}
    </div>`;
  }

  async function ownerSave(ownerId) {
    if (ownerId === world.id) return saveWorld(world);
    return saveEntry(state.entries.get(ownerId));
  }
  const ownerOf = id => id === world.id ? world : state.entries.get(id);

  root.onchange = async e => {
    const el = e.target;
    if (el.dataset.act !== 'toggle') return;
    const o = ownerOf(el.dataset.owner);
    const q = o.questions.find(x => x.id === el.dataset.q);
    q.done = el.checked;
    await ownerSave(o.id);
    draw();
  };
  root.onclick = async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    if (btn.dataset.act === 'show-done') { showDone = !showDone; return draw(); }
    if (btn.dataset.act === 'delete') {
      const o = ownerOf(btn.dataset.owner);
      o.questions = o.questions.filter(x => x.id !== btn.dataset.q);
      await ownerSave(o.id);
      draw();
    }
  };
  root.onsubmit = async e => {
    e.preventDefault();
    const text = e.target.q.value.trim();
    if (!text) return;
    (world.questions ||= []).push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
    await saveWorld(world);
    draw();
    $('#wq-new', root)?.focus();
  };
  draw();
}
