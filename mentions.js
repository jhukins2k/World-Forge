// World Forge — "@" autocomplete in long text boxes. Picking an entry inserts @[Name]; on save it is
// stored as @[Name](id), so it shows as a link when reading and keeps working if the entry is renamed.

import { esc } from './ui.js';
import { state, entriesOfWorld } from './store.js';

const pop = () => document.getElementById('mention-pop');
let active = null; // { ta, start, items, index }

function close() {
  const p = pop();
  p.hidden = true;
  p.innerHTML = '';
  if (active) active.ta.removeAttribute('aria-activedescendant');
  active = null;
}

function show(ta, start, query, worldId) {
  const q = query.toLowerCase();
  const items = entriesOfWorld(worldId)
    .filter(e => e.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
    .slice(0, 8);
  if (!items.length) return close();
  active = { ta, start, items, index: 0 };
  const p = pop();
  p.innerHTML = items.map((e, i) => {
    const b = state.books.get(e.bookId);
    return `<div class="mp-item ${i === 0 ? 'on' : ''}" role="option" id="mp-${i}" data-i="${i}" aria-selected="${i === 0}">
      <span>${esc(e.name)}</span><small>${esc(b?.name || '')}</small></div>`;
  }).join('');
  const r = ta.getBoundingClientRect();
  p.style.left = `${Math.max(8, r.left + window.scrollX)}px`;
  p.style.top = `${r.bottom + window.scrollY + 4}px`;
  p.style.minWidth = `${Math.min(r.width, 320)}px`;
  p.hidden = false;
  ta.setAttribute('aria-activedescendant', 'mp-0');
}

function highlight(i) {
  active.index = (i + active.items.length) % active.items.length;
  [...pop().children].forEach((el, j) => {
    el.classList.toggle('on', j === active.index);
    el.setAttribute('aria-selected', j === active.index);
  });
  active.ta.setAttribute('aria-activedescendant', `mp-${active.index}`);
}

function pick(i) {
  const { ta, start, items } = active;
  const e = items[i];
  const name = e.name.replace(/[[\]()]/g, '');
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(ta.selectionStart);
  const insert = `@[${name}] `;
  ta.value = before + insert + after;
  const caret = before.length + insert.length;
  ta.setSelectionRange(caret, caret);
  close();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

// Attach to a container; any textarea[data-mention] inside gets autocomplete.
export function attachMentions(root, worldId) {
  root.addEventListener('input', e => {
    const ta = e.target;
    if (!ta.matches('textarea[data-mention]')) return;
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = upto.match(/(^|\s)@([^\s@[\]()]{0,30})$/);
    if (!m) return close();
    show(ta, ta.selectionStart - m[2].length - 1, m[2], worldId);
  });
  root.addEventListener('keydown', e => {
    if (!active || e.target !== active.ta) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active.index + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active.index - 1); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active.index); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  root.addEventListener('focusout', e => {
    if (active && e.target === active.ta) setTimeout(() => { if (active && document.activeElement !== active.ta) close(); }, 150);
  });
}

document.addEventListener('mousedown', e => {
  const item = e.target.closest('.mp-item');
  if (item && active) { e.preventDefault(); pick(Number(item.dataset.i)); }
});
window.addEventListener('hashchange', close);
