// World Forge — an open book: its table of contents, and an entry page (reading or editing).

import { esc, $, safeColor, safeImage, icons, promptDialog, confirmDialog, readImage, toast } from './ui.js';
import { state, uid, entriesOfBook, entryHref, saveEntry, deleteEntry, linkedFrom, mentionedIn, appearsIn, eventsWith, mapsOf, chapterNumber } from './store.js';
import { formatDate, toDays } from './chrono.js';
import { renderFieldsView, renderFieldsEdit, fieldEditInner, plainText, norm, toEditable, fromEditable } from './fields.js';
import { attachMentions } from './mentions.js';

const setStatus = text => { const s = document.getElementById('save-status'); if (s) s.textContent = text; };

function crumbs(world, book, entry) {
  return `<nav class="crumbs" aria-label="Breadcrumb">
    <a href="#/">Library</a><span aria-hidden="true">›</span>
    <span>${esc(world.name)}</span><span aria-hidden="true">›</span>
    ${entry ? `<a href="#/w/${world.id}/b/${book.id}">${esc(book.name)}</a><span aria-hidden="true">›</span><span aria-current="page">${esc(entry.name)}</span>`
            : `<span aria-current="page">${esc(book.name)}</span>`}
  </nav>`;
}

function toc(book, currentId) {
  const entries = entriesOfBook(book.id);
  return `<aside class="toc" aria-label="${esc(book.name)} contents">
    <div class="toc-head">
      <span class="toc-swatch" style="background:${safeColor(book.color)}" aria-hidden="true"></span>
      <a class="toc-title" href="#/w/${book.worldId}/b/${book.id}">${esc(book.name)}</a>
    </div>
    ${entries.length > 8 ? `<div class="toc-filter"><label class="sr-only" for="toc-filter">Filter ${esc(book.name)}</label>
      <input class="inp sm" id="toc-filter" placeholder="Filter…" autocomplete="off"></div>` : ''}
    <ul class="toc-list">
      ${entries.map(e => `<li><a href="${entryHref(e)}" data-eid="${e.id}" ${e.id === currentId ? 'aria-current="page" class="on"' : ''}>${esc(e.name)}</a></li>`).join('')}
      ${entries.length ? '' : '<li class="toc-empty">No entries yet</li>'}
    </ul>
    <div class="toc-foot">
      <button type="button" class="btn ghost dashed" data-act="new-entry">+ New entry</button>
      <a class="btn link-btn" href="#/w/${book.worldId}/b/${book.id}/template">${icons.template} Template &amp; book settings</a>
    </div>
  </aside>`;
}

function landing(book) {
  const entries = entriesOfBook(book.id);
  const firstShort = book.fields.find(f => ['text', 'select'].includes(f.type));
  return `<div class="landing">
    <div class="page-head">
      <div>
        <h1 class="h1">${esc(book.name)}</h1>
        <p class="lede">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${book.fields.filter(f => f.type !== 'section').length} fields in the template</p>
      </div>
      <button type="button" class="btn primary" data-act="new-entry">+ New entry</button>
    </div>
    ${entries.length ? `<div class="cards">${entries.map(e => {
      const sub = e.subtitle || (firstShort ? e.values?.[firstShort.id] : '') || '';
      return `<a class="card" href="${entryHref(e)}"><span class="card-name">${esc(e.name)}</span>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}</a>`;
    }).join('')}</div>`
    : `<div class="empty-card"><p>This book is empty. Add your first entry, or adjust the template first so every entry starts with the fields you want.</p></div>`}
  </div>`;
}

function appearsHtml(entry) {
  const list = appearsIn(entry);
  if (!list.length) return '';
  return `<div class="side-card"><h2 class="side-h">Appears in · ${list.length} ${list.length === 1 ? 'chapter' : 'chapters'}</h2>
    <div class="ch-chips">${list.map(({ ch, pov }) => `<a class="ch-chip ${pov ? 'pov' : ''}" href="#/w/${entry.worldId}/manuscript/c/${ch.id}" title="${esc(ch.title || '')}${pov ? ' (POV)' : ''}">${chapterNumber(ch)}</a>`).join('')}</div>
    ${list.some(x => x.pov) ? '<p class="muted small">Ringed: told from their point of view</p>' : ''}</div>`;
}

function eventsHtml(entry) {
  const world = state.worlds.get(entry.worldId);
  const evs = eventsWith(entry).map(ev => ({ ev, d: toDays(ev.start, world) })).sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  if (!evs.length) return '';
  return `<div class="side-card"><h2 class="side-h">On the timeline · ${evs.length}</h2><ul class="side-list">
    ${evs.slice(0, 8).map(({ ev }) => `<li><a href="#/w/${entry.worldId}/chronicle/e/${ev.id}">${esc(ev.title)}</a><span class="muted"> · ${esc(formatDate(ev.start, world) || 'undated')}</span></li>`).join('')}
    </ul>${evs.length > 8 ? `<a class="small" href="#/w/${entry.worldId}/chronicle">See all in the Chronicle</a>` : ''}</div>`;
}

function mapsHtml(entry) {
  const maps = mapsOf(entry.worldId).filter(m => (m.pins || []).some(p => p.entryId === entry.id));
  if (!maps.length) return '';
  return `<div class="side-card"><h2 class="side-h">On the map</h2><ul class="side-list">
    ${maps.map(m => `<li><a href="#/w/${entry.worldId}/atlas/m/${m.id}">${esc(m.name)}</a></li>`).join('')}</ul></div>`;
}

function sidebar(entry) {
  const from = linkedFrom(entry);
  const ment = mentionedIn(entry).filter(m => !from.some(f => f.entry.id === m.id));
  const qs = entry.questions || [];
  return `<aside class="side" aria-label="Connections">
    <div class="side-card">
      <h2 class="side-h">Linked from</h2>
      ${from.length ? `<ul class="side-list">${from.map(l => `<li><a href="${entryHref(l.entry)}">${esc(l.entry.name)}</a>
        <span class="muted"> · ${esc(l.field.label)}${l.note ? ` · ${esc(l.note)}` : ''}</span></li>`).join('')}</ul>`
        : '<p class="muted small">Nothing links here yet. When another entry links to this one, it shows up here.</p>'}
    </div>
    ${appearsHtml(entry)}
    ${eventsHtml(entry)}
    ${mapsHtml(entry)}
    ${ment.length ? `<div class="side-card"><h2 class="side-h">Mentioned in</h2>
      <div class="chips">${ment.map(m => `<a class="chip dark" href="${entryHref(m)}">${esc(m.name)}</a>`).join('')}</div></div>` : ''}
    <div class="side-card">
      <h2 class="side-h">Open questions · ${qs.filter(q => !q.done).length}</h2>
      <ul class="qlist">${qs.map(q => `<li class="${q.done ? 'done' : ''}">
        <input type="checkbox" id="q-${q.id}" data-act="q-toggle" data-q="${q.id}" ${q.done ? 'checked' : ''}>
        <label for="q-${q.id}">${esc(q.text)}</label>
        <button type="button" class="icon-btn" data-act="q-delete" data-q="${q.id}" aria-label="Delete question">${icons.x}</button>
      </li>`).join('')}</ul>
      <form class="qadd" data-form="q-add">
        <label class="sr-only" for="q-new">New question</label>
        <input class="inp sm" id="q-new" name="q" placeholder="Something still undecided…" autocomplete="off">
        <button type="submit" class="btn ghost sm">Add</button>
      </form>
    </div>
  </aside>`;
}

function entryView(book, entry) {
  const portraitField = book.fields.find(f => f.type === 'image' && safeImage(entry.values?.[f.id]));
  const { html, empty } = renderFieldsView(book, entry, portraitField?.id);
  const src = portraitField ? safeImage(entry.values[portraitField.id]) : '';
  return `<div class="entry-wrap">
    <article class="parchment">
      <header class="p-head">
        ${src ? `<img class="portrait" src="${src}" alt="${esc(portraitField.label)} of ${esc(entry.name)}">` : ''}
        <div class="p-head-text">
          <h1 class="p-title">${esc(entry.name)}</h1>
          ${entry.subtitle ? `<p class="p-sub">${esc(entry.subtitle)}</p>` : ''}
        </div>
        <a class="btn ink" href="${entryHref(entry)}/edit">${icons.edit} Edit</a>
      </header>
      ${html || '<p class="p-empty">Nothing written here yet.</p>'}
      ${empty ? `<p class="p-foot"><a href="${entryHref(entry)}/edit">${empty} empty ${empty === 1 ? 'field' : 'fields'} · edit to fill</a></p>` : ''}
    </article>
    ${sidebar(entry)}
  </div>`;
}

function entryEdit(book, draft) {
  return `<div class="entry-wrap">
    <form class="parchment editing" data-form="entry" autocomplete="off" onsubmit="return false">
      <div class="edit-bar">
        <span class="edit-note">Changes save as you type</span>
        <a class="btn ink" href="${entryHref(draft)}">Done</a>
      </div>
      <label class="flabel" for="e-name">Name</label>
      <input class="inp big" id="e-name" data-k="name" value="${esc(draft.name)}" required maxlength="120">
      <label class="flabel" for="e-sub">Subtitle <span class="muted">(optional, e.g. “Protagonist” or “The capital city”)</span></label>
      <input class="inp" id="e-sub" data-k="subtitle" value="${esc(draft.subtitle)}" maxlength="160">
      <div class="fe-list">${renderFieldsEdit(book, draft, { worldId: draft.worldId, entryId: draft.id })}</div>
      <div class="danger-zone">
        <button type="button" class="btn danger-ghost" data-act="delete-entry">${icons.trash} Delete this entry</button>
      </div>
    </form>
  </div>`;
}

export function render(root, { worldId, bookId, entryId, mode }) {
  const world = state.worlds.get(worldId);
  const book = state.books.get(bookId);
  const entry = entryId ? state.entries.get(entryId) : null;
  if (!world || !book || (entryId && !entry)) {
    root.innerHTML = `<div class="page"><h1 class="h1">Not found</h1><p class="lede">That page doesn't exist anymore. <a href="#/">Back to the Library</a></p></div>`;
    return;
  }

  const draft = mode === 'edit' ? structuredClone(entry) : null;
  if (draft) {
    draft.values ||= {}; draft.questions ||= [];
    for (const f of book.fields) {
      if (['tags', 'link', 'timeline'].includes(f.type) && f.id in draft.values) draft.values[f.id] = norm(f, draft.values[f.id]);
      if (f.type === 'longtext' && typeof draft.values[f.id] === 'string') draft.values[f.id] = toEditable(draft.values[f.id], worldId);
    }
  }

  root.innerHTML = `<div class="page wide">
    ${crumbs(world, book, entry)}
    <div class="book-layout">
      ${toc(book, entry?.id)}
      <div class="book-main">
        ${!entry ? landing(book) : mode === 'edit' ? entryEdit(book, draft) : entryView(book, entry)}
      </div>
    </div>
  </div>`;

  // ----- table of contents -----
  const filter = $('#toc-filter', root);
  if (filter) filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase();
    root.querySelectorAll('.toc-list li').forEach(li => { li.hidden = !li.textContent.toLowerCase().includes(q); });
  });

  // ----- saving while editing -----
  let timer = null;
  const flush = async () => {
    clearTimeout(timer); timer = null;
    if (!draft) return;
    if (!draft.name.trim()) draft.name = entry.name;
    const out = structuredClone(draft);
    for (const f of book.fields) {
      if (f.type === 'longtext' && typeof out.values[f.id] === 'string') out.values[f.id] = fromEditable(out.values[f.id], worldId);
    }
    await saveEntry(out);
    setStatus('Saved on this device');
  };
  const scheduleSave = () => { setStatus('Saving…'); clearTimeout(timer); timer = setTimeout(flush, 500); };
  if (draft) {
    window.addEventListener('hashchange', () => { if (timer) flush(); }, { once: true });
    attachMentions(root, worldId);
  }

  const fieldOf = el => {
    const box = el.closest('.fe');
    return box ? { box, f: book.fields.find(x => x.id === box.dataset.fid) } : {};
  };
  const rerender = (box, f) => { box.innerHTML = fieldEditInner(f, draft.values[f.id], { worldId, entryId: draft.id }); };

  root.oninput = e => {
    if (!draft) return;
    const el = e.target;
    const k = el.dataset.k;
    if (!k) return;
    if (k === 'name' || k === 'subtitle') {
      draft[k] = el.value;
      if (k === 'name') { const a = root.querySelector(`.toc-list a[data-eid="${draft.id}"]`); if (a) a.textContent = el.value || entry.name; }
      return scheduleSave();
    }
    const { f } = fieldOf(el);
    if (!f) return;
    const i = Number(el.dataset.i);
    if (k === 'v') draft.values[f.id] = el.value;
    if (k === 'tags') draft.values[f.id] = el.value.split(',').map(s => s.trim()).filter(Boolean);
    if (k === 'note') draft.values[f.id][i].note = el.value;
    if (k === 'tval') draft.values[f.id][i].value = el.value;
    if (k === 'twhen') draft.values[f.id][i].when = el.value;
    scheduleSave();
  };

  root.onchange = async e => {
    const el = e.target;
    if (el.dataset.act === 'q-toggle') {
      const q = entry.questions.find(x => x.id === el.dataset.q);
      q.done = el.checked;
      await saveEntry(entry);
      return render(root, { worldId, bookId, entryId, mode });
    }
    if (!draft) return;
    const { box, f } = fieldOf(el);
    if (!f) return;
    if (el.dataset.act === 'link-add' && el.value) {
      (draft.values[f.id] ||= []).push({ id: el.value, note: '' });
      rerender(box, f); scheduleSave();
      const notes = box.querySelectorAll('[data-k="note"]');
      if (notes.length) notes[notes.length - 1].focus();
    }
    if (el.dataset.act === 'img-pick' && el.files[0]) {
      try {
        draft.values[f.id] = await readImage(el.files[0]);
        rerender(box, f); scheduleSave();
      } catch (err) { toast(err.message); }
    }
  };

  root.onclick = async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'SELECT' || btn.tagName === 'INPUT') return;
    const act = btn.dataset.act;

    if (act === 'new-entry') {
      const name = await promptDialog(`New entry in ${book.name}`, 'Name', '', 'e.g. a name or title');
      if (!name) return;
      const e2 = { id: uid(), worldId, bookId, name, subtitle: '', values: {}, questions: [] };
      await saveEntry(e2);
      location.hash = entryHref(e2) + '/edit';
      return;
    }
    if (act === 'q-delete') {
      entry.questions = entry.questions.filter(x => x.id !== btn.dataset.q);
      await saveEntry(entry);
      return render(root, { worldId, bookId, entryId, mode });
    }
    if (act === 'delete-entry') {
      const n = linkedFrom(entry).length;
      const ok = await confirmDialog(
        `Delete “${entry.name}”? This can't be undone.${n ? ` ${n} link${n === 1 ? '' : 's'} pointing to it will show as deleted.` : ''}`,
        { title: 'Delete this entry?', confirmLabel: 'Delete entry' });
      if (!ok) return;
      clearTimeout(timer); timer = null;
      await deleteEntry(entry.id);
      toast('Entry deleted.');
      location.hash = `#/w/${worldId}/b/${bookId}`;
      return;
    }
    if (!draft) return;
    const { box, f } = fieldOf(btn);
    if (!f) return;
    const i = Number(btn.dataset.i);
    if (act === 'link-remove') draft.values[f.id].splice(i, 1);
    if (act === 'tl-add') (draft.values[f.id] ||= []).push({ value: '', when: '' });
    if (act === 'tl-remove') draft.values[f.id].splice(i, 1);
    if (act === 'img-remove') delete draft.values[f.id];
    rerender(box, f); scheduleSave();
    if (act === 'tl-add') { const rows = box.querySelectorAll('[data-k="tval"]'); rows[rows.length - 1]?.focus(); }
  };

  root.onsubmit = async e => {
    if (e.target.dataset.form !== 'q-add') return;
    e.preventDefault();
    const text = e.target.q.value.trim();
    if (!text) return;
    (entry.questions ||= []).push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
    await saveEntry(entry);
    render(root, { worldId, bookId, entryId, mode });
    $('#q-new', root)?.focus();
  };

  if (entry && mode !== 'edit') document.title = `${entry.name} · World Forge`;
  if (draft) $('#e-name', root)?.focus();
}

export { plainText };
