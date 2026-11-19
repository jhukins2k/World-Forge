// World Forge — how each kind of field looks when reading an entry, and when editing it.

import { esc, safeColor, safeImage, icons } from './ui.js';
import { state, booksOf, entriesOfBook, entryHref } from './store.js';

export const FIELD_TYPES = [
  ['text', 'Short text'],
  ['longtext', 'Long text (supports @links)'],
  ['number', 'Number'],
  ['select', 'Dropdown'],
  ['tags', 'Tags'],
  ['link', 'Link to entries'],
  ['timeline', 'Changes over time'],
  ['image', 'Image'],
  ['section', 'Section heading'],
];
export const typeLabel = t => (FIELD_TYPES.find(x => x[0] === t) || [, t])[1];

const SHORT = new Set(['text', 'number', 'select', 'tags']);

const ARRAY_TYPES = new Set(['tags', 'link', 'timeline']);

// Makes sure a stored value has the shape its field type expects (protects against odd imported data).
export function norm(f, v) {
  if (ARRAY_TYPES.has(f.type)) return Array.isArray(v) ? v.filter(x => x != null) : [];
  if (v == null) return '';
  return typeof v === 'object' ? '' : String(v);
}

export function isEmpty(f, v) {
  v = norm(f, v);
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === '';
}

// ---------- rich text with @mentions ----------

const MENTION = /@\[([^\]]+)\]\(([A-Za-z0-9-]+)\)/g;

export function renderRich(text) {
  return String(text || '').trim().split(/\n{2,}/).map(p => {
    const html = esc(p).replace(MENTION, (m, name, id) => {
      const e = state.entries.get(id);
      if (!e) return `<span class="mention missing" title="This entry no longer exists">${name}</span>`;
      return `<a class="mention" href="${entryHref(e)}">${esc(e.name)}</a>`;
    });
    return `<p>${html.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// While editing, mentions show as @[Name] (no ids). They're turned back into @[Name](id) when saved.
export function toEditable(text, worldId) {
  return String(text || '').replace(MENTION, (m, name, id) => {
    const e = state.entries.get(id);
    if (!e) return m;
    const clean = e.name.replace(/[[\]()]/g, '');
    const twins = [...state.entries.values()].filter(x => x.worldId === worldId && x.name.replace(/[[\]()]/g, '').toLowerCase() === clean.toLowerCase());
    return twins.length === 1 ? `@[${clean}]` : m; // keep the id if two entries share a name
  });
}

export function fromEditable(text, worldId) {
  return String(text || '').replace(/@\[([^\]]+)\](?!\()/g, (m, name) => {
    const hits = [...state.entries.values()].filter(x => x.worldId === worldId && x.name.replace(/[[\]()]/g, '').toLowerCase() === name.trim().toLowerCase());
    return hits.length === 1 ? `@[${name}](${hits[0].id})` : m;
  });
}

export function plainText(text) {
  return String(text || '').replace(MENTION, (m, name, id) => state.entries.get(id)?.name || name);
}

// ---------- reading view ----------

function shortValue(f, v) {
  if (f.type === 'tags') return `<span class="chips">${v.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</span>`;
  return esc(v);
}

function wideValue(f, v) {
  switch (f.type) {
    case 'longtext':
      return `<div class="rich">${renderRich(v)}</div>`;
    case 'image': {
      const src = safeImage(v);
      return src ? `<img class="field-img" src="${src}" alt="${esc(f.label)}">` : '';
    }
    case 'timeline':
      return `<div class="chain">${v.map((s, i) => `
        ${i ? '<span class="chain-arrow" aria-hidden="true">→</span>' : ''}
        <span class="step ${i === v.length - 1 ? 'current' : ''}">${esc(s.value || '—')}${s.when ? ` <small>· ${esc(s.when)}</small>` : ''}</span>`).join('')}</div>`;
    case 'link':
      return `<div class="links">${v.map(l => {
        const t = state.entries.get(l.id);
        if (!t) return '';
        const b = state.books.get(t.bookId);
        return `<a class="linkcard" href="${entryHref(t)}">
          <span class="lc-dot" style="background:${safeColor(b?.color)}"></span>
          <span class="lc-name">${esc(t.name)}</span>
          <span class="lc-book">${esc(b?.name || '')}</span>
          ${l.note ? `<span class="lc-note">${esc(l.note)}</span>` : ''}
        </a>`;
      }).join('')}</div>`;
    default:
      return esc(v);
  }
}

// Renders an entry's fields for reading. Empty fields (and sections with nothing in them) are hidden.
export function renderFieldsView(book, entry, skipFieldId) {
  const sections = [{ label: null, items: [] }];
  let empty = 0;
  for (const f of book.fields) {
    if (f.id === skipFieldId) continue;
    if (f.type === 'section') { sections.push({ label: f.label, items: [] }); continue; }
    const v = norm(f, entry.values?.[f.id]);
    if (isEmpty(f, v)) { empty++; continue; }
    const cur = sections[sections.length - 1];
    cur.items.push(SHORT.has(f.type)
      ? { short: true, html: `<div class="fv"><div class="flabel">${esc(f.label)}</div><div class="fval">${shortValue(f, v)}</div></div>` }
      : { short: false, html: `<div class="fv wide"><div class="flabel">${esc(f.label)}</div>${wideValue(f, v)}</div>` });
  }
  let html = '';
  for (const s of sections) {
    if (!s.items.length) continue;
    html += `<section class="psec">${s.label ? `<h2 class="sec">${esc(s.label)}</h2>` : ''}`;
    let grid = [];
    const flush = () => { if (grid.length) { html += `<div class="fgrid">${grid.join('')}</div>`; grid = []; } };
    for (const it of s.items) {
      if (it.short) grid.push(it.html);
      else { flush(); html += it.html; }
    }
    flush();
    html += '</section>';
  }
  return { html, empty };
}

// ---------- editing ----------

function linkCandidates(f, worldId, selfId, taken) {
  const targetIds = f.targets?.length ? f.targets : booksOf(worldId).map(b => b.id);
  return targetIds.map(bid => state.books.get(bid)).filter(Boolean).map(b => {
    const opts = entriesOfBook(b.id)
      .filter(e => e.id !== selfId && !taken.has(e.id))
      .map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    return opts ? `<optgroup label="${esc(b.name)}">${opts}</optgroup>` : '';
  }).join('');
}

export function fieldEditInner(f, v, ctx) {
  v = norm(f, v);
  const id = `f-${f.id}`;
  const label = `<label class="flabel" for="${id}">${esc(f.label)}</label>`;
  switch (f.type) {
    case 'section':
      return `<h2 class="sec">${esc(f.label)}</h2>`;
    case 'text':
      return `${label}<input class="inp" id="${id}" data-k="v" value="${esc(v)}">`;
    case 'number':
      return `${label}<input class="inp" id="${id}" type="number" step="any" data-k="v" value="${esc(v)}">`;
    case 'select':
      return `${label}<select class="inp" id="${id}" data-k="v"><option value=""></option>${(f.options || [])
        .map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'tags':
      return `${label}<input class="inp" id="${id}" data-k="tags" value="${esc((v || []).join(', '))}" aria-describedby="${id}-h">
        <div class="hint" id="${id}-h">Separate with commas</div>`;
    case 'longtext':
      return `${label}<textarea class="inp" id="${id}" data-k="v" data-mention rows="5" aria-describedby="${id}-h">${esc(v)}</textarea>
        <div class="hint" id="${id}-h">Type @ to link an entry</div>`;
    case 'image': {
      const src = safeImage(v);
      return `<span class="flabel">${esc(f.label)}</span>
        <div class="img-edit">
          ${src ? `<img class="field-img" src="${src}" alt="${esc(f.label)}">` : '<div class="img-ph">No image</div>'}
          <div class="img-btns">
            <label class="btn ghost sm file-btn">${src ? 'Replace image' : 'Choose image'}
              <input type="file" accept="image/*" data-act="img-pick" class="sr-only">
            </label>
            ${src ? '<button type="button" class="btn ghost sm" data-act="img-remove">Remove</button>' : ''}
          </div>
        </div>`;
    }
    case 'timeline': {
      const rows = (v || []).map((s, i) => `
        <div class="trow">
          <input class="inp sm" data-k="tval" data-i="${i}" value="${esc(s.value)}" placeholder="What it is" aria-label="${esc(f.label)} ${i + 1}: value">
          <input class="inp sm" data-k="twhen" data-i="${i}" value="${esc(s.when)}" placeholder="When (e.g. Ch 4, Book 2)" aria-label="${esc(f.label)} ${i + 1}: when">
          <button type="button" class="icon-btn" data-act="tl-remove" data-i="${i}" aria-label="Remove this change">${icons.x}</button>
        </div>`).join('');
      return `<span class="flabel">${esc(f.label)} <span class="badge">changes over time</span></span>
        <div class="trows">${rows}</div>
        <button type="button" class="btn ghost sm" data-act="tl-add">+ Add a change</button>`;
    }
    case 'link': {
      const list = v || [];
      const taken = new Set(list.map(l => l.id));
      const rows = list.map((l, i) => {
        const t = state.entries.get(l.id);
        const b = t && state.books.get(t.bookId);
        return `<div class="lrow">
          <span class="lc-dot" style="background:${safeColor(b?.color)}"></span>
          <span class="lc-name">${esc(t ? t.name : 'Deleted entry')}</span>
          ${f.notes !== false ? `<input class="inp sm" data-k="note" data-i="${i}" value="${esc(l.note)}" placeholder="Note (e.g. bonded, stolen, Ch 3)" aria-label="Note for ${esc(t?.name || 'link')}">` : ''}
          <button type="button" class="icon-btn" data-act="link-remove" data-i="${i}" aria-label="Remove ${esc(t?.name || 'link')}">${icons.x}</button>
        </div>`;
      }).join('');
      const canAdd = f.multiple !== false || list.length === 0;
      const cands = canAdd ? linkCandidates(f, ctx.worldId, ctx.entryId, taken) : '';
      const targets = (f.targets || []).map(b => state.books.get(b)?.name).filter(Boolean);
      return `<span class="flabel">${esc(f.label)}</span>
        <div class="lrows">${rows}</div>
        ${canAdd ? (cands
          ? `<select class="inp sm link-add" data-act="link-add" aria-label="Link an entry to ${esc(f.label)}"><option value="">+ Link an entry…</option>${cands}</select>`
          : `<div class="hint">${list.length ? 'Everything available is already linked.' : `Nothing to link yet${targets.length ? ` — add entries to ${esc(targets.join(' or '))} first` : ''}.`}</div>`) : ''}`;
    }
    default:
      return `${label}<input class="inp" id="${id}" data-k="v" value="${esc(v)}">`;
  }
}

export function renderFieldsEdit(book, draft, ctx) {
  return book.fields.map(f => `<div class="fe fe-${f.type}" data-fid="${f.id}">${fieldEditInner(f, draft.values[f.id], ctx)}</div>`).join('');
}
