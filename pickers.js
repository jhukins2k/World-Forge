// World Forge — a reusable "pick entries" control (used by scenes, events, maps and lineage).
// Shows chosen entries as chips, plus a dropdown to add more, grouped by book.

import { esc, safeColor, icons } from './ui.js';
import { state, booksOf, entriesOfBook, entryHref } from './store.js';

// key: name of the property on the record; value: id string (single) or array of ids.
export function pickerHTML(key, value, { worldId, single = false, label = '', placeholder = '+ Add…', exclude = [] } = {}) {
  const ids = single ? (value ? [value] : []) : (Array.isArray(value) ? value : []);
  const chips = ids.map(id => {
    const e = state.entries.get(id);
    const b = e && state.books.get(e.bookId);
    return `<span class="pchip">
      <span class="lc-dot" style="background:${safeColor(b?.color)}"></span>
      ${e ? `<a href="${entryHref(e)}">${esc(e.name)}</a>` : '<span class="muted">Deleted entry</span>'}
      <button type="button" class="pchip-x" data-pick-remove="${esc(key)}" data-id="${esc(id)}" aria-label="Remove ${esc(e?.name || 'entry')}">${icons.x}</button>
    </span>`;
  }).join('');
  const taken = new Set([...ids, ...exclude]);
  const groups = booksOf(worldId).map(b => {
    const opts = entriesOfBook(b.id).filter(e => !taken.has(e.id)).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    return opts ? `<optgroup label="${esc(b.name)}">${opts}</optgroup>` : '';
  }).join('');
  const showAdd = !single || ids.length === 0;
  return `<div class="picker" data-picker="${esc(key)}">
    ${label ? `<span class="flabel">${esc(label)}</span>` : ''}
    <div class="pchips">${chips}${showAdd && groups ? `<select class="inp sm pick-add" data-pick-add="${esc(key)}" aria-label="${esc(label || 'Add an entry')}">
      <option value="">${esc(placeholder)}</option>${groups}</select>` : ''}${showAdd && !groups && !ids.length ? '<span class="muted small">No entries to pick yet</span>' : ''}</div>
  </div>`;
}

// Applies a picker event to a record. Returns the key that changed, or null.
export function applyPickerEvent(e, record, singles = []) {
  const add = e.target.dataset?.pickAdd;
  if (add && e.type === 'change' && e.target.value) {
    if (singles.includes(add)) record[add] = e.target.value;
    else (record[add] = Array.isArray(record[add]) ? record[add] : []).push(e.target.value);
    return add;
  }
  const btn = e.target.closest?.('[data-pick-remove]');
  if (btn && e.type === 'click') {
    const key = btn.dataset.pickRemove;
    if (singles.includes(key)) record[key] = '';
    else record[key] = (record[key] || []).filter(id => id !== btn.dataset.id);
    return key;
  }
  return null;
}
