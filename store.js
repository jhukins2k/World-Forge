// World Forge — the app's data. Everything is kept in memory while the app runs
// and saved to IndexedDB (inside this browser) on every change.
//
// Kinds of record:
//   worlds    — one per shelf
//   books     — categories on a shelf (Characters, Items…), each with a template of fields
//   entries   — the pages inside a category book
//   volumes   — Manuscript books (Book 1, Book 2…)
//   chapters  — chapters inside a volume
//   scenes    — scenes inside a chapter
//   events    — Chronicle timeline events
//   maps      — Atlas maps, with their pins and routes
//   relations — Lineage family links (parent of / partner of)

import * as db from './db.js';

export const KINDS = ['worlds', 'books', 'entries', 'volumes', 'chapters', 'scenes', 'events', 'maps', 'relations'];

export const state = Object.fromEntries(KINDS.map(k => [k, new Map()]));

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const listeners = new Set();
export function onSaved(fn) { listeners.add(fn); }
function saved() { listeners.forEach(fn => fn()); }

export async function load() {
  for (const kind of KINDS) {
    const rows = await db.getAll(kind);
    state[kind] = new Map(rows.map(r => [r.id, r]));
  }
}

function stamp(record) {
  const now = new Date().toISOString();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  return record;
}

export async function saveRec(kind, record) {
  stamp(record);
  state[kind].set(record.id, record);
  await db.put(kind, record);
  saved();
  return record;
}

export const saveWorld = w => saveRec('worlds', w);
export const saveBook = b => saveRec('books', b);
export const saveEntry = e => saveRec('entries', e);

async function drop(kind, id) {
  state[kind].delete(id);
  await db.del(kind, id);
}

export async function deleteRec(kind, id) {
  if (kind === 'books') for (const e of [...state.entries.values()]) if (e.bookId === id) await drop('entries', e.id);
  if (kind === 'volumes') for (const c of [...state.chapters.values()]) if (c.volumeId === id) await deleteRec('chapters', c.id);
  if (kind === 'chapters') for (const s of [...state.scenes.values()]) if (s.chapterId === id) await drop('scenes', s.id);
  if (kind === 'entries') for (const r of [...state.relations.values()]) if (r.a === id || r.b === id) await drop('relations', r.id);
  if (kind === 'worlds') for (const k of KINDS) if (k !== 'worlds') for (const r of [...state[k].values()]) if (r.worldId === id) await drop(k, r.id);
  await drop(kind, id);
  saved();
}

export const deleteEntry = id => deleteRec('entries', id);
export const deleteBook = id => deleteRec('books', id);
export const deleteWorld = id => deleteRec('worlds', id);

// Silent replace, used by sync and import (no new timestamps).
export async function putRaw(kind, record) {
  state[kind].set(record.id, record);
  await db.put(kind, record);
}
export async function dropRaw(kind, id) { await drop(kind, id); }
export function notifySaved() { saved(); }

// ---------- lookups ----------

export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const inWorld = (kind, worldId) => [...state[kind].values()].filter(r => r.worldId === worldId);

export const worldsSorted = () => [...state.worlds.values()].sort(byOrder);
export const booksOf = worldId => inWorld('books', worldId).sort(byOrder);
export const entriesOfBook = bookId => [...state.entries.values()].filter(e => e.bookId === bookId).sort(byName);
export const entriesOfWorld = worldId => inWorld('entries', worldId).sort(byName);
export const volumesOf = worldId => inWorld('volumes', worldId).sort(byOrder);
export const chaptersOf = volumeId => [...state.chapters.values()].filter(c => c.volumeId === volumeId).sort(byOrder);
export const scenesOf = chapterId => [...state.scenes.values()].filter(s => s.chapterId === chapterId).sort(byOrder);
export const eventsOf = worldId => inWorld('events', worldId);
export const mapsOf = worldId => inWorld('maps', worldId).sort(byOrder);
export const relationsOf = worldId => inWorld('relations', worldId);

export function entryHref(e) { return `#/w/${e.worldId}/b/${e.bookId}/e/${e.id}`; }

// Chapter number within its volume (1-based), or 0 if not found.
export function chapterNumber(ch) {
  return chaptersOf(ch.volumeId).findIndex(c => c.id === ch.id) + 1;
}
export function chapterLabel(ch) {
  const vol = state.volumes.get(ch.volumeId);
  const many = vol && volumesOf(vol.worldId).length > 1;
  return `${many ? vol.title + ', ' : ''}Ch ${chapterNumber(ch)}${ch.title ? ': ' + ch.title : ''}`;
}

// Everything a chapter touches: its POV plus everything in its scenes.
export function chapterRollup(ch) {
  const people = new Set(), places = new Set(), items = new Set(), povs = new Set();
  if (ch.pov) povs.add(ch.pov);
  for (const s of scenesOf(ch.id)) {
    if (s.pov) povs.add(s.pov);
    (s.characters || []).forEach(id => people.add(id));
    if (s.location) places.add(s.location);
    (s.items || []).forEach(id => items.add(id));
  }
  povs.forEach(id => people.add(id));
  return { people, places, items, povs };
}

// Chapters an entry appears in (as POV, in a scene, as a location or item).
export function appearsIn(entry) {
  const out = [];
  for (const v of volumesOf(entry.worldId)) {
    for (const ch of chaptersOf(v.id)) {
      const r = chapterRollup(ch);
      if (r.people.has(entry.id) || r.places.has(entry.id) || r.items.has(entry.id)) out.push({ ch, pov: r.povs.has(entry.id) });
    }
  }
  return out;
}

// Entries that link to this one through a "Link to entries" field.
export function linkedFrom(entry) {
  const out = [];
  for (const other of entriesOfWorld(entry.worldId)) {
    if (other.id === entry.id) continue;
    const book = state.books.get(other.bookId);
    if (!book) continue;
    for (const f of book.fields) {
      if (f.type !== 'link') continue;
      const v = other.values?.[f.id];
      if (!Array.isArray(v)) continue;
      for (const l of v) if (l.id === entry.id) out.push({ entry: other, field: f, note: l.note || '' });
    }
  }
  return out;
}

// Entries whose long text mentions this one with @.
export function mentionedIn(entry) {
  const needle = `](${entry.id})`;
  const out = [];
  for (const other of entriesOfWorld(entry.worldId)) {
    if (other.id === entry.id) continue;
    const texts = Object.values(other.values || {}).filter(v => typeof v === 'string');
    if (texts.some(t => t.includes(needle))) out.push(other);
  }
  return out;
}

export function eventsWith(entry) {
  return eventsOf(entry.worldId).filter(ev => [...(ev.people || []), ...(ev.places || []), ...(ev.items || [])].includes(entry.id));
}

export function openQuestionCount(worldId) {
  const world = state.worlds.get(worldId);
  let n = (world?.questions || []).filter(q => !q.done).length;
  for (const e of entriesOfWorld(worldId)) n += (e.questions || []).filter(q => !q.done).length;
  return n;
}

// ---------- backups ----------

export function exportData(worldId = null) {
  const keep = r => !worldId || r.id === worldId || r.worldId === worldId;
  const out = { format: 'world-forge', version: 2, exportedAt: new Date().toISOString() };
  for (const k of KINDS) out[k] = [...state[k].values()].filter(keep);
  return out;
}

export async function importData(data) {
  if (!data || data.format !== 'world-forge' || !Array.isArray(data.worlds)) {
    throw new Error('This file is not a World Forge backup.');
  }
  const counts = Object.fromEntries(KINDS.map(k => [k, 0]));
  let skipped = 0;
  for (const k of KINDS) {
    for (const r of data[k] || []) {
      if (!r || typeof r.id !== 'string') continue;
      if (k !== 'worlds' && r.worldId && !state.worlds.has(r.worldId) && !data.worlds.some(w => w.id === r.worldId)) { skipped++; continue; }
      await putRaw(k, r);
      counts[k]++;
    }
  }
  saved();
  if (skipped && !Object.values(counts).some(Boolean)) {
    throw new Error('This file adds to a world that isn\'t in this Library yet. Import that world\'s main file first (or sync it down from GitHub), then import this one.');
  }
  return counts;
}
