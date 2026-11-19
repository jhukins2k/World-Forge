// World Forge — a book's template (its list of fields) and the book's own settings.

import { esc, $, icons, colorOptions, confirmDialog, toast } from './ui.js';
import { state, uid, booksOf, entriesOfBook, saveBook, deleteBook } from './store.js';
import { FIELD_TYPES, isEmpty } from './fields.js';
import { newField } from './templates.js';

function fieldRow(f, i, n, books, original) {
  const typeChanged = original && original.type !== f.type;
  let config = '';
  if (f.type === 'select') {
    config = `<label class="flabel" for="opt-${f.id}">Choices, one per line</label>
      <textarea class="inp sm" id="opt-${f.id}" data-k="options" rows="3">${esc((f.options || []).join('\n'))}</textarea>`;
  }
  if (f.type === 'link') {
    config = `<fieldset class="cfg"><legend class="flabel">Can link to entries in</legend>
      <div class="checks">${books.map(b => `<label class="check"><input type="checkbox" data-k="target" value="${b.id}" ${(f.targets || []).includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div>
      <div class="hint">Leave all unticked to allow any book.</div></fieldset>
      <div class="checks">
        <label class="check"><input type="checkbox" data-k="multiple" ${f.multiple !== false ? 'checked' : ''}> Allow more than one</label>
        <label class="check"><input type="checkbox" data-k="notes" ${f.notes !== false ? 'checked' : ''}> Add a short note to each link</label>
      </div>`;
  }
  return `<li class="frow ${f.type === 'section' ? 'is-section' : ''}" data-i="${i}">
    <div class="frow-move">
      <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(f.label || 'field')} up">${icons.up}</button>
      <button type="button" class="icon-btn" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${esc(f.label || 'field')} down">${icons.down}</button>
    </div>
    <div class="frow-main">
      <div class="frow-top">
        <div class="frow-label">
          <label class="sr-only" for="lbl-${f.id}">Field name</label>
          <input class="inp" id="lbl-${f.id}" data-k="label" value="${esc(f.label)}" placeholder="${f.type === 'section' ? 'Section heading' : 'Field name'}" maxlength="60">
        </div>
        <div class="frow-type">
          <label class="sr-only" for="type-${f.id}">Field type</label>
          <select class="inp" id="type-${f.id}" data-k="type">
            ${FIELD_TYPES.map(([t, l]) => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
      ${typeChanged ? '<div class="hint warn">Changing the type starts this field fresh. What entries had in it before will no longer show.</div>' : ''}
      ${config}
    </div>
    <button type="button" class="icon-btn" data-act="remove" aria-label="Remove ${esc(f.label || 'field')}">${icons.trash}</button>
  </li>`;
}

export function render(root, { worldId, bookId }) {
  const world = state.worlds.get(worldId);
  const book = state.books.get(bookId);
  if (!world || !book) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }

  const originals = new Map(book.fields.map(f => [f.id, f]));
  let fields = structuredClone(book.fields);
  let dirty = false;
  let pendingName;
  const books = booksOf(worldId);

  function draw() {
    const siblings = booksOf(worldId);
    const pos = siblings.findIndex(b => b.id === book.id);
    root.innerHTML = `<div class="page">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span>
        <a href="#/w/${worldId}/b/${bookId}">${esc(book.name)}</a><span aria-hidden="true">›</span><span aria-current="page">Template</span>
      </nav>
      <div class="page-head">
        <div>
          <h1 class="h1">${esc(book.name)} template</h1>
          <p class="lede">Every entry in this book gets these fields. Empty fields stay hidden when reading.</p>
        </div>
      </div>

      <section class="panel" aria-labelledby="bs-h">
        <h2 class="panel-h" id="bs-h">Book settings</h2>
        <div class="bs-grid">
          <div>
            <label class="flabel" for="bs-name">Book name</label>
            <input class="inp" id="bs-name" data-k="book-name" value="${esc(pendingName ?? book.name)}" maxlength="40">
          </div>
          <div>
            <label class="flabel" for="bs-color">Leather color</label>
            <select class="inp" id="bs-color" data-k="book-color">${colorOptions(book.color)}</select>
          </div>
          <div>
            <span class="flabel">Place on shelf</span>
            <div class="btn-row">
              <button type="button" class="btn ghost sm" data-act="shelf-left" ${pos <= 0 ? 'disabled' : ''}>${icons.left} Move left</button>
              <button type="button" class="btn ghost sm" data-act="shelf-right" ${pos >= siblings.length - 1 ? 'disabled' : ''}>Move right ${icons.right}</button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="tf-h">
        <h2 class="panel-h" id="tf-h">Fields</h2>
        <ol class="frows">${fields.map((f, i) => fieldRow(f, i, fields.length, books, originals.get(f.id))).join('')}</ol>
        <div class="add-field">
          <label class="sr-only" for="add-type">Type of field to add</label>
          <select class="inp" id="add-type">${FIELD_TYPES.map(([t, l]) => `<option value="${t}">${l}</option>`).join('')}</select>
          <button type="button" class="btn ghost" data-act="add">+ Add field</button>
        </div>
      </section>

      <div class="save-bar">
        <span class="muted" id="dirty-note">${dirty ? 'Unsaved changes' : ''}</span>
        <a class="btn ghost" href="#/w/${worldId}/b/${bookId}">${dirty ? 'Discard' : 'Back to book'}</a>
        <button type="button" class="btn primary" data-act="save">Save template</button>
      </div>

      <section class="panel danger-panel" aria-labelledby="dz-h">
        <h2 class="panel-h" id="dz-h">Remove this book</h2>
        <p class="muted">Deletes the book and all ${entriesOfBook(bookId).length} entries in it.</p>
        <button type="button" class="btn danger-ghost" data-act="delete-book">${icons.trash} Delete ${esc(book.name)}</button>
      </section>
    </div>`;
  }

  const markDirty = () => { dirty = true; const n = $('#dirty-note', root); if (n) n.textContent = 'Unsaved changes'; };
  const rowField = el => { const li = el.closest('.frow'); return li ? fields[Number(li.dataset.i)] : null; };

  root.oninput = e => {
    const el = e.target, k = el.dataset.k;
    if (k === 'book-name') { pendingName = el.value; return markDirty(); }
    const f = rowField(el);
    if (!f) return;
    if (k === 'label') f.label = el.value;
    if (k === 'options') f.options = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    markDirty();
  };

  root.onchange = async e => {
    const el = e.target, k = el.dataset.k;
    if (k === 'book-color') { book.color = el.value; await saveBook(book); toast('Color saved.'); return; }
    const f = rowField(el);
    if (!f) return;
    if (k === 'type') {
      const label = f.label;
      Object.keys(f).forEach(key => { if (key !== 'id') delete f[key]; });
      Object.assign(f, newField(el.value), { id: f.id, label });
      markDirty(); draw(); return;
    }
    if (k === 'target') {
      const set = new Set(f.targets || []);
      el.checked ? set.add(el.value) : set.delete(el.value);
      f.targets = [...set];
    }
    if (k === 'multiple') f.multiple = el.checked;
    if (k === 'notes') f.notes = el.checked;
    markDirty();
  };

  root.onclick = async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const li = btn.closest('.frow');
    const i = li ? Number(li.dataset.i) : -1;

    if (act === 'add') {
      const f = newField($('#add-type', root).value);
      fields.push(f); markDirty(); draw();
      root.querySelectorAll('[data-k="label"]')[fields.length - 1]?.focus();
      return;
    }
    if (act === 'up' && i > 0) { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; markDirty(); draw(); return; }
    if (act === 'down' && i < fields.length - 1) { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; markDirty(); draw(); return; }
    if (act === 'remove') { fields.splice(i, 1); markDirty(); draw(); return; }

    if (act === 'shelf-left' || act === 'shelf-right') {
      const sib = booksOf(worldId);
      const pos = sib.findIndex(b => b.id === book.id);
      const j = act === 'shelf-left' ? pos - 1 : pos + 1;
      [sib[pos], sib[j]] = [sib[j], sib[pos]];
      for (let k = 0; k < sib.length; k++) if (sib[k].order !== k) { sib[k].order = k; await saveBook(sib[k]); }
      toast('Moved on the shelf.');
      draw(); return;
    }

    if (act === 'save') {
      // Warn if removed fields still hold something.
      const keptIds = new Set(fields.map(f => f.id));
      const removed = book.fields.filter(f => !keptIds.has(f.id) && f.type !== 'section');
      const withData = removed.filter(f => entriesOfBook(bookId).some(en => !isEmpty(f, en.values?.[f.id])));
      if (withData.length) {
        const ok = await confirmDialog(
          `Some entries have something written in ${withData.map(f => `“${f.label}”`).join(', ')}. Removing ${withData.length === 1 ? 'that field' : 'those fields'} hides it from every entry.`,
          { title: 'Remove fields with content?', confirmLabel: 'Remove and save' });
        if (!ok) return;
      }
      // A field whose type changed gets a new id, so old values of the wrong shape are left behind safely.
      book.fields = fields.map(f => {
        const o = originals.get(f.id);
        const clean = { ...f, label: f.label.trim() || (f.type === 'section' ? 'Section' : 'Untitled field') };
        if (o && o.type !== f.type) clean.id = uid();
        return clean;
      });
      if (pendingName !== undefined) book.name = pendingName.trim() || book.name;
      await saveBook(book);
      dirty = false;
      toast('Template saved.');
      location.hash = `#/w/${worldId}/b/${bookId}`;
      return;
    }

    if (act === 'delete-book') {
      const n = entriesOfBook(bookId).length;
      const ok = await confirmDialog(`Delete “${book.name}” and its ${n} ${n === 1 ? 'entry' : 'entries'}? This can't be undone.`,
        { title: 'Delete this book?', confirmLabel: 'Delete book' });
      if (!ok) return;
      await deleteBook(bookId);
      toast('Book removed from the shelf.');
      location.hash = '#/';
    }
  };

  draw();
}
