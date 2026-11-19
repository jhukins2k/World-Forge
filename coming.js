// World Forge — placeholder pages for tool books that arrive in later stages.

import { esc, icons } from './ui.js';
import { state } from './store.js';
import { TOOLS } from './library.js';

export function render(root, { worldId, tool }) {
  const world = state.worlds.get(worldId);
  const t = TOOLS.find(x => x.key === tool);
  if (!world || !t) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }
  root.innerHTML = `<div class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span><span aria-current="page">${t.name}</span></nav>
    <div class="coming">
      <div class="coming-icon">${icons[t.icon].replace(/width="22" height="22"/, 'width="56" height="56"')}</div>
      <h1 class="h1">${t.name}</h1>
      <p class="lede">${esc(t.about)}</p>
      <p class="muted">Still on the anvil. Arrives in stage ${t.stage}.</p>
      <a class="btn ghost" href="#/">Back to the Library</a>
    </div>
  </div>`;
}
