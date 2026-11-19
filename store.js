// World Forge — the app's data: worlds, books (categories) and entries.
// Everything is kept in memory while the app runs and saved to IndexedDB on every change.

import * as db from './db.js';

export const state = {
  worlds: new Map(),
  books: new Map(),
  entries: new Map(),
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const listeners = new Set();
export function onSaved(fn) { listeners.add(fn); }
function saved() { listeners.forEach(fn => fn()); }

export async function load() {
  for (const name of ['worlds', 'books', 'entries']) {
    const rows = await db.getAll(name);
    state[name] = new Map(rows.map(r => [r.id, r]));
  }
}

function stamp(record) {
  const now = new Date().toISOString();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  return record;
}

async function save(storeName, record) {
  stamp(record);
  state[storeName].set(record.id, record);
  await db.put(storeName, record);
  saved();
  return record;
}

export const saveWorld = w => save('worlds', w);
export const saveBook = b => save('books', b);
export const saveEntry = e => save('entries', e);

async function remove(storeName, kind, id) {
  state[storeName].delete(id);
  await db.del(storeName, id);
  // Remembered so a future sync knows this was deleted on purpose.
  await db.put('deletions', { id, kind, at: new Date().toISOString() });
}

export async function deleteEntry(id) { await remove('entries', 'entry', id); saved(); }

export async function deleteBook(id) {
  for (const e of [...state.entries.values()]) if (e.bookId === id) await remove('entries', 'entry', e.id);
  await remove('books', 'book', id);
  saved();
}

export async function deleteWorld(id) {
  for (const b of [...state.books.values()]) if (b.worldId === id) await deleteBook(b.id);
  await remove('worlds', 'world', id);
  saved();
}

// ---------- lookups ----------

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export const worldsSorted = () => [...state.worlds.values()].sort(byOrder);
export const booksOf = worldId => [...state.books.values()].filter(b => b.worldId === worldId).sort(byOrder);
export const entriesOfBook = bookId => [...state.entries.values()].filter(e => e.bookId === bookId).sort(byName);
export const entriesOfWorld = worldId => [...state.entries.values()].filter(e => e.worldId === worldId).sort(byName);

export function entryHref(e) { return `#/w/${e.worldId}/b/${e.bookId}/e/${e.id}`; }

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

export function openQuestionCount(worldId) {
  const world = state.worlds.get(worldId);
  let n = (world?.questions || []).filter(q => !q.done).length;
  for (const e of entriesOfWorld(worldId)) n += (e.questions || []).filter(q => !q.done).length;
  return n;
}

// ---------- backups ----------

export function exportData(worldId = null) {
  const keep = r => !worldId || r.id === worldId || r.worldId === worldId;
  return {
    format: 'world-forge',
    version: 1,
    exportedAt: new Date().toISOString(),
    worlds: [...state.worlds.values()].filter(keep),
    books: [...state.books.values()].filter(keep),
    entries: [...state.entries.values()].filter(keep),
  };
}

export async function importData(data) {
  if (!data || data.format !== 'world-forge' || !Array.isArray(data.worlds)) {
    throw new Error('This file is not a World Forge backup.');
  }
  const counts = { worlds: 0, books: 0, entries: 0 };
  for (const name of ['worlds', 'books', 'entries']) {
    for (const r of data[name] || []) {
      if (!r || typeof r.id !== 'string') continue;
      state[name].set(r.id, r);
      await db.put(name, r);
      counts[name]++;
    }
  }
  saved();
  return counts;
}
