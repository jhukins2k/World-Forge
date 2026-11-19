// World Forge — starter packs. A pack is just a ready-made set of books and templates;
// once a world is created, everything in it can be renamed, changed or removed.

import { uid } from './store.js';

const F = (type, label, extra = {}) => ({ id: uid(), type, label, ...extra });

// A link field names its target books by book name here; they're turned into ids on creation.
const link = (label, targets, extra = {}) => F('link', label, { targets, notes: true, multiple: true, ...extra });

const character = (gearBooks, groupBook) => ({
  name: 'Characters', color: '#6e2a26', fields: [
    F('image', 'Portrait'),
    F('section', 'Overview'),
    F('text', 'Role'),
    F('text', 'Age'),
    link('Home', ['Places'], { multiple: false, notes: false }),
    F('tags', 'Personality'),
    F('timeline', 'Status'),
    F('longtext', 'Goal'),
    F('section', 'Equipment & Relationships'),
    link('Equipment', gearBooks),
    link('Relationships', ['Characters', groupBook]),
    F('section', 'Story'),
    F('longtext', 'Backstory'),
    F('longtext', 'Notes'),
  ],
});

const PACKS = {
  fantasy: {
    label: 'Fantasy',
    books: () => [
      character(['Items'], 'Factions'),
      { name: 'Items', color: '#2c3a55', fields: [
        F('image', 'Image'),
        F('select', 'Kind', { options: ['Weapon', 'Armor', 'Jewelry', 'Clothing', 'Tool', 'Relic', 'Other'] }),
        F('text', 'Rarity'),
        F('longtext', 'Appearance'),
        F('timeline', 'Powers'),
        F('longtext', 'Origin'),
        F('longtext', 'Notes'),
      ] },
      { name: 'Places', color: '#2f4a3a', fields: [
        F('image', 'Picture'),
        F('select', 'Kind', { options: ['Region', 'City', 'Town', 'Village', 'Landmark', 'Building', 'Other'] }),
        link('Part of', ['Places'], { multiple: false, notes: false }),
        link('Controlled by', ['Factions'], { notes: false }),
        F('longtext', 'Description'),
        F('longtext', 'History'),
      ] },
      { name: 'Factions', color: '#4a2f45', fields: [
        F('image', 'Emblem'),
        F('text', 'Motto or belief'),
        link('Leaders', ['Characters']),
        link('Base', ['Places'], { notes: false }),
        F('longtext', 'Goals'),
        F('longtext', 'History'),
      ] },
      { name: 'Creatures', color: '#5a4421', fields: [
        F('image', 'Image'),
        link('Found in', ['Places'], { notes: false }),
        F('longtext', 'Description'),
        F('longtext', 'Abilities'),
      ] },
      { name: 'Lore & Rules', color: '#2c4a4a', fields: [
        F('select', 'Kind', { options: ['Magic system', 'History', 'Culture', 'Religion', 'Technology', 'Rule', 'Other'] }),
        F('longtext', 'Summary'),
        F('longtext', 'Details'),
      ] },
    ],
  },
  scifi: {
    label: 'Sci-fi',
    books: () => [
      character(['Tech & Gear', 'Ships'], 'Factions'),
      { name: 'Tech & Gear', color: '#2c3a55', fields: [
        F('image', 'Image'),
        F('select', 'Kind', { options: ['Weapon', 'Armor', 'Device', 'Implant', 'Vehicle', 'Other'] }),
        F('longtext', 'What it does'),
        F('longtext', 'Limits'),
      ] },
      { name: 'Ships', color: '#3a3f47', fields: [
        F('image', 'Image'),
        F('text', 'Class'),
        link('Crew', ['Characters']),
        F('longtext', 'Description'),
      ] },
      { name: 'Places', color: '#2f4a3a', fields: [
        F('image', 'Picture'),
        F('select', 'Kind', { options: ['System', 'Planet', 'Moon', 'Station', 'City', 'Other'] }),
        link('Part of', ['Places'], { multiple: false, notes: false }),
        F('longtext', 'Description'),
      ] },
      { name: 'Factions', color: '#4a2f45', fields: [
        link('Leaders', ['Characters']),
        F('longtext', 'Goals'),
        F('longtext', 'History'),
      ] },
      { name: 'Lore & Rules', color: '#2c4a4a', fields: [
        F('longtext', 'Summary'),
        F('longtext', 'Details'),
      ] },
    ],
  },
  modern: {
    label: 'Modern',
    books: () => [
      character(['Items'], 'Organizations'),
      { name: 'Places', color: '#2f4a3a', fields: [
        F('image', 'Picture'),
        F('text', 'Address or area'),
        F('longtext', 'Description'),
      ] },
      { name: 'Organizations', color: '#4a2f45', fields: [
        link('People', ['Characters']),
        F('longtext', 'Description'),
      ] },
      { name: 'Items', color: '#2c3a55', fields: [
        F('longtext', 'Description'),
        F('longtext', 'Why it matters'),
      ] },
    ],
  },
  blank: { label: 'Blank', books: () => [] },
};

export const PACK_LIST = Object.entries(PACKS).map(([key, p]) => ({ key, label: p.label }));

// Returns new book records (not yet saved) for a world, with link targets resolved to ids.
export function buildPack(key, worldId) {
  const pack = PACKS[key] || PACKS.blank;
  const books = pack.books().map((b, i) => ({ id: uid(), worldId, kind: 'category', order: i, ...b }));
  const idByName = Object.fromEntries(books.map(b => [b.name, b.id]));
  for (const b of books) {
    for (const f of b.fields) {
      if (f.type === 'link') f.targets = (f.targets || []).map(n => idByName[n]).filter(Boolean);
    }
  }
  return books;
}

export function newField(type) {
  const f = { id: uid(), type, label: '' };
  if (type === 'select') f.options = [];
  if (type === 'link') Object.assign(f, { targets: [], notes: true, multiple: true });
  return f;
}
