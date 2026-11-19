// World Forge — dates in your world: calendars, exact / approximate / relative dates, and the date editor.
//
// A date is stored as:
//   { kind: 'none' }                                         not placed yet
//   { kind: 'exact',  year, month, day, label }              month/day optional; label like "early winter"
//   { kind: 'circa',  year, month, day, label }              approximate ("about")
//   { kind: 'relative', anchor: 'ev:<id>' | 'ch:<id>', offset, unit, dir }   e.g. 1 week after Ch 5
//   { kind: 'ongoing' }                                      only for the end of a span (still going)
// Internally every date becomes a number of days, so anything can be placed on one timeline.

import { esc } from './ui.js';
import { state, eventsOf, volumesOf, chaptersOf, chapterNumber } from './store.js';

export function calendarOf(world) {
  const c = world?.calendar || {};
  const months = Array.isArray(c.months) ? c.months.filter(m => m && m.name && m.days > 0) : [];
  const dpy = months.length ? months.reduce((n, m) => n + Number(m.days), 0) : (Number(c.daysPerYear) > 0 ? Number(c.daysPerYear) : 365);
  return { relative: c.mode !== 'custom', era: c.era || '', months, dpy };
}

const UNIT_DAYS = (unit, cal) => ({ days: 1, weeks: 7, months: cal.dpy / 12, years: cal.dpy }[unit] || 1);

// Resolve a date to a day number (or null if it can't be placed).
export function toDays(date, world, depth = 0) {
  if (!date || depth > 25) return null;
  const cal = calendarOf(world);
  if (date.kind === 'exact' || date.kind === 'circa') {
    const y = Number(date.year);
    if (!Number.isFinite(y) || date.year === '' || date.year == null) return null;
    let d = y * cal.dpy;
    const m = Number(date.month);
    if (m >= 1 && cal.months.length) d += cal.months.slice(0, m - 1).reduce((n, x) => n + Number(x.days), 0);
    const dd = Number(date.day);
    if (dd >= 1) d += dd - 1;
    return d;
  }
  if (date.kind === 'relative') {
    const base = anchorDays(date.anchor, world, depth + 1);
    if (base == null) return null;
    const n = Number(date.offset) || 0;
    return base + (date.dir === 'before' ? -1 : 1) * n * UNIT_DAYS(date.unit, cal);
  }
  return null;
}

export function anchorDays(anchor, world, depth = 0) {
  const [type, id] = String(anchor || '').split(':');
  const rec = type === 'ev' ? state.events.get(id) : type === 'ch' ? state.chapters.get(id) : null;
  if (!rec) return null;
  return toDays(type === 'ev' ? rec.start : rec.date, world, depth);
}

export function anchorName(anchor) {
  const [type, id] = String(anchor || '').split(':');
  if (type === 'ev') return state.events.get(id)?.title || 'a deleted event';
  if (type === 'ch') { const c = state.chapters.get(id); return c ? `Ch ${chapterNumber(c)}` : 'a deleted chapter'; }
  return 'nothing';
}

export function formatYear(year, cal) {
  if (cal.relative) return year === 0 ? 'Year 0' : year < 0 ? `Y−${-year}` : `Y+${year}`;
  return cal.era ? `${year} ${cal.era}` : `Year ${year}`;
}

// A day number back to a readable date (used for axis labels and relative dates).
export function formatDays(days, world, { withDay = true } = {}) {
  const cal = calendarOf(world);
  const year = Math.floor(days / cal.dpy);
  let rest = Math.round(days - year * cal.dpy);
  if (!withDay || rest === 0) return formatYear(year, cal);
  if (cal.months.length) {
    for (const m of cal.months) {
      if (rest < m.days) return `${rest + 1} ${m.name}, ${formatYear(year, cal)}`;
      rest -= m.days;
    }
  }
  return `${formatYear(year, cal)}, day ${rest + 1}`;
}

export function formatDate(date, world) {
  if (!date || date.kind === 'none') return '';
  if (date.kind === 'ongoing') return 'still going';
  const cal = calendarOf(world);
  if (date.kind === 'relative') {
    const n = Number(date.offset) || 0;
    const unit = n === 1 ? String(date.unit || 'days').replace(/s$/, '') : (date.unit || 'days');
    return `${n ? `${n} ${unit} ` : 'same time as '}${n ? (date.dir === 'before' ? 'before ' : 'after ') : ''}${anchorName(date.anchor)}`;
  }
  if (date.year === '' || date.year == null) return date.label || '';
  const y = Number(date.year);
  const m = Number(date.month);
  const parts = [];
  if (Number(date.day) >= 1 && m >= 1 && cal.months[m - 1]) parts.push(`${date.day} ${cal.months[m - 1].name},`);
  else if (m >= 1 && cal.months[m - 1]) parts.push(cal.months[m - 1].name);
  else if (Number(date.day) >= 1) parts.push(`Day ${date.day} of`);
  parts.push(formatYear(y, cal));
  const txt = (date.kind === 'circa' ? '~' : '') + parts.join(' ');
  return date.label ? `${txt} · ${date.label}` : txt;
}

export function formatElapsed(days, world) {
  const cal = calendarOf(world);
  const a = Math.abs(days);
  const r = (n, u) => `${Math.round(n) === 1 ? '1 ' + u : Math.round(n) + ' ' + u + 's'}`;
  if (a >= cal.dpy * 0.95) return '≈ ' + r(a / cal.dpy, 'year');
  if (a >= 28) return '≈ ' + r(a / (cal.dpy / 12), 'month');
  if (a >= 7) return '≈ ' + r(a / 7, 'week');
  if (a >= 1) return r(a, 'day');
  return 'same day';
}

// ---------- editor ----------

function anchorOptions(world, selected, excludeEventId) {
  const evs = eventsOf(world.id).filter(e => e.id !== excludeEventId).sort((a, b) => a.title.localeCompare(b.title));
  const chs = volumesOf(world.id).flatMap(v => chaptersOf(v.id).map((c, i) => ({ c, label: `${volumesOf(world.id).length > 1 ? v.title + ', ' : ''}Ch ${i + 1}${c.title ? ': ' + c.title : ''}` })));
  return `<option value="">Choose…</option>
    ${chs.length ? `<optgroup label="Chapters">${chs.map(({ c, label }) => `<option value="ch:${c.id}" ${selected === 'ch:' + c.id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</optgroup>` : ''}
    ${evs.length ? `<optgroup label="Events">${evs.map(e => `<option value="ev:${e.id}" ${selected === 'ev:' + e.id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</optgroup>` : ''}`;
}

export function dateEditorHTML(prefix, date, world, { allowRelative = true, allowOngoing = false, excludeEventId = null } = {}) {
  const d = date || { kind: 'none' };
  const cal = calendarOf(world);
  const kinds = [['none', 'Not placed yet'], ['exact', 'Exact'], ['circa', 'Approximate (about)']];
  if (allowRelative) kinds.push(['relative', 'Relative to a chapter or event']);
  if (allowOngoing) kinds.push(['ongoing', 'Still going']);
  const id = s => `${prefix}-${s}`;
  let body = '';
  if (d.kind === 'exact' || d.kind === 'circa') {
    body = `<div class="date-row">
      <div class="dr-year"><label class="flabel" for="${id('year')}">Year</label>
        <input class="inp sm" id="${id('year')}" type="number" step="1" value="${esc(d.year ?? '')}" placeholder="${cal.relative ? '0' : 'e.g. 412'}"></div>
      ${cal.months.length ? `<div class="dr-month"><label class="flabel" for="${id('month')}">Month</label>
        <select class="inp sm" id="${id('month')}"><option value="">—</option>${cal.months.map((m, i) => `<option value="${i + 1}" ${Number(d.month) === i + 1 ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>` : ''}
      <div class="dr-day"><label class="flabel" for="${id('day')}">Day</label>
        <input class="inp sm" id="${id('day')}" type="number" min="1" step="1" value="${esc(d.day ?? '')}"></div>
      <div class="dr-label"><label class="flabel" for="${id('label')}">Note</label>
        <input class="inp sm" id="${id('label')}" value="${esc(d.label || '')}" placeholder="e.g. early winter"></div>
    </div>
    ${cal.relative ? '<div class="hint">Year 0 is when your story starts. Use negative years for the past: −90 is ninety years before.</div>' : ''}`;
  }
  if (d.kind === 'relative') {
    body = `<div class="date-row">
      <div class="dr-day"><label class="flabel" for="${id('offset')}">How many</label>
        <input class="inp sm" id="${id('offset')}" type="number" min="0" step="any" value="${esc(d.offset ?? 1)}"></div>
      <div class="dr-month"><label class="flabel" for="${id('unit')}">Unit</label>
        <select class="inp sm" id="${id('unit')}">${['days', 'weeks', 'months', 'years'].map(u => `<option ${u === (d.unit || 'days') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="dr-month"><label class="flabel" for="${id('dir')}">Before or after</label>
        <select class="inp sm" id="${id('dir')}"><option value="after" ${d.dir !== 'before' ? 'selected' : ''}>after</option><option value="before" ${d.dir === 'before' ? 'selected' : ''}>before</option></select></div>
      <div class="dr-label"><label class="flabel" for="${id('anchor')}">This chapter or event</label>
        <select class="inp sm" id="${id('anchor')}">${anchorOptions(world, d.anchor, excludeEventId)}</select></div>
    </div>
    <div class="hint">${toDays(d, world) != null ? `Lands on ${esc(formatDays(toDays(d, world), world))}. It moves automatically if that chapter or event moves.` : 'Pick a chapter or event that has a date of its own.'}</div>`;
  }
  return `<div class="date-ed" data-prefix="${esc(prefix)}">
    <label class="sr-only" for="${id('kind')}">Kind of date</label>
    <select class="inp sm date-kind" id="${id('kind')}">${kinds.map(([k, l]) => `<option value="${k}" ${k === d.kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${body}
  </div>`;
}

export function readDateEditor(root, prefix) {
  const v = s => root.querySelector(`#${CSS.escape(prefix + '-' + s)}`)?.value;
  const kind = v('kind') || 'none';
  const num = s => { const x = v(s); return x === undefined || x === '' ? '' : Number(x); };
  if (kind === 'exact' || kind === 'circa') return { kind, year: num('year'), month: num('month'), day: num('day'), label: v('label') || '' };
  if (kind === 'relative') return { kind, offset: num('offset') === '' ? 1 : num('offset'), unit: v('unit') || 'days', dir: v('dir') || 'after', anchor: v('anchor') || '' };
  return { kind };
}
