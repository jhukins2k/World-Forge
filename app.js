// World Forge — start-up, page routing, header search and app install.

import { esc, $ } from './ui.js';
import { state, load, entryHref, onSaved } from './store.js';
import { plainText } from './fields.js';
import { installState } from './config.js';
import * as library from './library.js';
import * as book from './book.js';
import * as template from './template.js';
import * as questions from './questions.js';
import * as settings from './settings.js';
import * as manuscript from './manuscript.js';
import * as chronicle from './chronicle.js';
import * as atlas from './atlas.js';
import * as lineage from './lineage.js';
import * as sync from './sync.js';

const app = document.getElementById('app');

function parse() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (p[0] === 'settings') return [settings, {}];
  if (p[0] === 'sync') return [sync, { auto: p[1] === 'now' }];
  if (p[0] === 'w' && p[1]) {
    const worldId = p[1];
    if (p[2] === 'questions') return [questions, { worldId }];
    if (p[2] === 'manuscript') return [manuscript, { worldId, chapterId: p[3] === 'c' ? p[4] : null }];
    if (p[2] === 'chronicle') return [chronicle, { worldId, eventId: p[3] === 'e' ? p[4] : null }];
    if (p[2] === 'atlas') return [atlas, { worldId, mapId: p[3] === 'm' ? p[4] : null }];
    if (p[2] === 'lineage') return [lineage, { worldId, mode: p[3] || 'tree', personId: p[4] || null }];
    if (p[2] === 'b' && p[3]) {
      const bookId = p[3];
      if (p[4] === 'template') return [template, { worldId, bookId }];
      if (p[4] === 'e' && p[5]) return [book, { worldId, bookId, entryId: p[5], mode: p[6] === 'edit' ? 'edit' : 'view' }];
      return [book, { worldId, bookId }];
    }
  }
  return [library, {}];
}

let lastHash = null;
function route() {
  const [view, params] = parse();
  document.title = 'World Forge';
  // A fresh container each time, so one page's event handlers never leak into the next.
  const root = document.createElement('div');
  app.replaceChildren(root);
  view.render(root, params);
  if (lastHash !== null) {
    window.scrollTo(0, 0);
    if (!root.querySelector(':focus')) app.focus({ preventScroll: true });
  }
  lastHash = location.hash;
}
// Deferred a tick so a page that's still saving can finish first.
window.addEventListener('hashchange', () => setTimeout(route, 0));

// ---------- search across every world ----------

const search = $('#search');
const results = $('#search-results');

function runSearch() {
  const q = search.value.trim().toLowerCase();
  if (!q) { results.hidden = true; return; }
  const hits = [];
  for (const e of state.entries.values()) {
    const inName = e.name.toLowerCase().includes(q);
    const inSub = (e.subtitle || '').toLowerCase().includes(q);
    const inText = !inName && !inSub && Object.values(e.values || {}).some(v => typeof v === 'string' && plainText(v).toLowerCase().includes(q));
    if (inName || inSub || inText) hits.push({ e, score: inName ? 0 : inSub ? 1 : 2 });
  }
  hits.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name));
  results.innerHTML = hits.length
    ? hits.slice(0, 12).map(({ e, score }) => {
        const b = state.books.get(e.bookId);
        const w = state.worlds.get(e.worldId);
        return `<a class="sr-item" href="${entryHref(e)}"><span>${esc(e.name)}</span>
          <small>${esc(b?.name || '')} · ${esc(w?.name || '')}${score === 2 ? ' · mentioned in text' : ''}</small></a>`;
      }).join('')
    : `<div class="sr-none">Nothing matches “${esc(search.value.trim())}”</div>`;
  results.hidden = false;
}
search.addEventListener('input', runSearch);
search.addEventListener('focus', runSearch);
search.addEventListener('keydown', e => {
  if (e.key === 'Escape') { search.value = ''; results.hidden = true; }
  if (e.key === 'Enter') { const first = results.querySelector('a'); if (first) { location.hash = first.getAttribute('href'); } }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) results.hidden = true;
  if (e.target.closest('.sr-item')) { search.value = ''; results.hidden = true; }
});

// ---------- install as an app ----------

const installBtn = $('#install-btn');
installState.installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installState.prompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installState.prompt) return;
  installState.prompt.prompt();
  await installState.prompt.userChoice;
  installState.prompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { installState.installed = true; installBtn.hidden = true; });

onSaved(() => { const s = $('#save-status'); if (s) s.textContent = 'Saved on this device'; sync.refreshHeader(); });

// ---------- start ----------

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  // When a new version finishes installing, reload once so every file comes from the same version.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

load().then(() => { route(); sync.refreshHeader(); sync.startupReminder(); }).catch(err => {
  app.innerHTML = `<div class="page"><h1 class="h1">World Forge couldn't open its storage</h1>
    <p class="lede">${esc(err?.message || err)}</p>
    <p class="muted">Private or incognito windows sometimes block storage. Try a normal window.</p></div>`;
});
