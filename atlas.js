// World Forge — Atlas: your maps, with pins that link to entries and routes you draw.

import { esc, $, icons, openDialog, promptDialog, confirmDialog, readImage, toast, safeImage, safeColor } from './ui.js';
import { state, uid, saveRec, deleteRec, mapsOf, booksOf, entriesOfBook, entryHref } from './store.js';

const ROUTE_COLORS = [['#e0b863', 'Gold'], ['#d0604a', 'Red'], ['#7fb0e0', 'Blue'], ['#8fc08a', 'Green'], ['#f1e6cc', 'Parchment']];

function entryOptions(worldId, selected = '') {
  return booksOf(worldId).map(b => {
    const opts = entriesOfBook(b.id).map(e => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    return opts ? `<optgroup label="${esc(b.name)}">${opts}</optgroup>` : '';
  }).join('');
}

// ---------- list of maps ----------

function list(root, world) {
  const maps = mapsOf(world.id);
  root.innerHTML = `<div class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span><span aria-current="page">Atlas</span></nav>
    <div class="page-head"><div><h1 class="h1">Atlas</h1>
      <p class="lede">${maps.length ? `${maps.length} ${maps.length === 1 ? 'map' : 'maps'}` : 'Upload any map image, even a photo of a hand-drawn one, then pin your places to it.'}</p></div>
      <button type="button" class="btn primary" data-act="new">+ New map</button></div>
    ${maps.length ? `<div class="map-cards">${maps.map(m => `<a class="map-card" href="#/w/${world.id}/atlas/m/${m.id}">
        <img src="${safeImage(m.image)}" alt="">
        <span class="map-card-name">${esc(m.name)}</span>
        <span class="map-card-sub">${(m.pins || []).length} pins · ${(m.routes || []).length} routes</span></a>`).join('')}</div>`
      : '<div class="empty-card"><p>No maps yet.</p></div>'}
  </div>`;
  root.onclick = async e => {
    if (!e.target.closest('[data-act="new"]')) return;
    const m = await newMapDialog(world);
    if (m) location.hash = `#/w/${world.id}/atlas/m/${m.id}`;
  };
}

async function newMapDialog(world) {
  const r = await openDialog({
    title: 'New map', submitLabel: 'Add map',
    body: `<label class="flabel" for="nm-name">Name</label>
      <input class="inp" id="nm-name" name="name" required maxlength="60" placeholder="e.g. The Elderreach">
      <label class="flabel" for="nm-file">Map image</label>
      <input class="inp" id="nm-file" name="file" type="file" accept="image/*" required>`,
  });
  if (!r || !r.file || !r.file.size) return null;
  try {
    const image = await readImage(r.file, 2400);
    const dims = await new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = image; });
    const m = { id: uid(), worldId: world.id, name: r.name.trim(), image, width: dims[0], height: dims[1], pins: [], routes: [], order: mapsOf(world.id).length };
    await saveRec('maps', m);
    return m;
  } catch (err) { toast(err.message); return null; }
}

// ---------- one map ----------

function mapView(root, world, map) {
  let mode = 'move';       // move | pin | route
  let selectedPin = null;
  let draft = null;        // route being drawn: [[x,y]…]
  const view = { s: 1, x: 0, y: 0 };

  function sidebar() {
    const pins = map.pins || [];
    const pin = pins.find(p => p.id === selectedPin);
    const e = pin && state.entries.get(pin.entryId);
    return `
      ${pin ? `<section class="side-card"><h2 class="side-h">Selected pin</h2>
        <p class="pin-sel-name">${e ? `<a href="${entryHref(e)}">${esc(e.name)}</a>` : esc(pin.label || 'Pin')}</p>
        ${e && pin.label ? `<p class="muted small">${esc(pin.label)}</p>` : ''}
        <p class="muted small">Drag the pin to move it.</p>
        <div class="btn-row"><button type="button" class="btn ghost sm" data-act="pin-edit">Change</button>
        <button type="button" class="btn danger-ghost sm" data-act="pin-delete">${icons.trash} Remove pin</button></div></section>` : ''}
      <section class="side-card"><h2 class="side-h">Pins · ${pins.length}</h2>
        ${pins.length ? `<ul class="side-list">${pins.map(p => { const pe = state.entries.get(p.entryId); return `<li><button type="button" class="linklike" data-pin="${p.id}">${esc(pe?.name || p.label || 'Pin')}</button></li>`; }).join('')}</ul>`
          : '<p class="muted small">Choose “Add pin”, then click the map.</p>'}</section>
      <section class="side-card"><h2 class="side-h">Routes · ${(map.routes || []).length}</h2>
        ${(map.routes || []).length ? `<ul class="side-list">${map.routes.map(r => `<li class="route-li"><span class="route-swatch" style="background:${safeColor(r.color)}"></span>
          <span>${esc(r.name)}</span><button type="button" class="icon-btn" data-route-del="${r.id}" aria-label="Delete route ${esc(r.name)}">${icons.x}</button></li>`).join('')}</ul>`
          : '<p class="muted small">Choose “Draw route”, click along the path, then press Finish.</p>'}</section>`;
  }

  function pinsHTML() {
    return (map.pins || []).map(p => {
      const e = state.entries.get(p.entryId);
      const b = e && state.books.get(e.bookId);
      return `<button type="button" class="pin ${p.id === selectedPin ? 'on' : ''}" data-pin="${p.id}" style="left:${p.x * 100}%;top:${p.y * 100}%;--c:${safeColor(b?.color || '#6e2a26')}" aria-label="Pin: ${esc(e?.name || p.label || 'Pin')}">
        <span class="pin-dot"></span><span class="pin-label">${esc(e?.name || p.label || 'Pin')}</span></button>`;
    }).join('');
  }

  function routesSVG() {
    const W = map.width, H = map.height;
    const line = (pts, color, dash) => pts.length > 1 ? `<polyline points="${pts.map(([x, y]) => `${x * W},${y * H}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${Math.max(W, H) / 280}" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${Math.max(W, H) / 120} ${Math.max(W, H) / 160}"` : ''} vector-effect="non-scaling-stroke" style="stroke-width:4px"/>` : '';
    return `<svg class="routes" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${(map.routes || []).map(r => line(r.points, safeColor(r.color), true)).join('')}
      ${draft ? line(draft, '#f3d48f', false) + draft.map(([x, y]) => `<circle cx="${x * W}" cy="${y * H}" r="${Math.max(W, H) / 250}" fill="#f3d48f"/>`).join('') : ''}
    </svg>`;
  }

  function draw() {
    root.innerHTML = `<div class="page wide">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span>
        <a href="#/w/${world.id}/atlas">Atlas</a><span aria-hidden="true">›</span><span aria-current="page">${esc(map.name)}</span></nav>
      <div class="page-head"><h1 class="h1">${esc(map.name)}</h1>
        <div class="btn-row">
          <button type="button" class="btn ghost sm" data-act="rename">Rename</button>
          <label class="btn ghost sm file-btn">Replace image<input type="file" accept="image/*" class="sr-only" data-act="replace"></label>
          <button type="button" class="btn danger-ghost sm" data-act="delete">Delete map</button>
        </div></div>
      <div class="map-toolbar" role="toolbar" aria-label="Map tools">
        <div class="seg" role="group" aria-label="Mode">
          <button type="button" class="${mode === 'move' ? 'on' : ''}" aria-pressed="${mode === 'move'}" data-mode="move">Move</button>
          <button type="button" class="${mode === 'pin' ? 'on' : ''}" aria-pressed="${mode === 'pin'}" data-mode="pin">Add pin</button>
          <button type="button" class="${mode === 'route' ? 'on' : ''}" aria-pressed="${mode === 'route'}" data-mode="route">Draw route</button>
        </div>
        ${mode === 'route' ? `<span class="muted small">${draft?.length ? `${draft.length} points` : 'Click along the path'}</span>
          <button type="button" class="btn primary sm" data-act="route-finish" ${draft?.length > 1 ? '' : 'disabled'}>Finish route</button>
          <button type="button" class="btn ghost sm" data-act="route-undo" ${draft?.length ? '' : 'disabled'}>Undo point</button>` : ''}
        ${mode === 'pin' ? '<span class="muted small">Click the map where the pin goes</span>' : ''}
        <span class="spacer"></span>
        <button type="button" class="icon-btn boxed" data-act="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" class="icon-btn boxed" data-act="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="btn ghost sm" data-act="fit">Fit</button>
      </div>
      <div class="map-area">
        <div class="map-viewport mode-${mode}" tabindex="0" aria-label="Map. Use the zoom buttons, or drag to move around.">
          <div class="map-stage" style="width:${map.width}px;height:${map.height}px">
            <img src="${safeImage(map.image)}" alt="${esc(map.name)}" draggable="false">
            ${routesSVG()}
            <div class="pins">${pinsHTML()}</div>
          </div>
        </div>
        <aside class="side">${sidebar()}</aside>
      </div>
    </div>`;
    apply();
  }

  const vp = () => root.querySelector('.map-viewport');
  const stage = () => root.querySelector('.map-stage');
  function apply() {
    const st = stage(); if (!st) return;
    st.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    st.style.setProperty('--inv', 1 / view.s);
  }
  function fit() {
    const v = vp(); if (!v) return;
    const r = v.getBoundingClientRect();
    view.s = Math.min(r.width / map.width, r.height / map.height);
    view.x = (r.width - map.width * view.s) / 2;
    view.y = (r.height - map.height * view.s) / 2;
    apply();
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(8, Math.max(0.05, view.s * f));
    view.x = cx - (cx - view.x) * (ns / view.s);
    view.y = cy - (cy - view.y) * (ns / view.s);
    view.s = ns; apply();
  }
  const toMap = (clientX, clientY) => {
    const r = vp().getBoundingClientRect();
    return [Math.min(1, Math.max(0, (clientX - r.left - view.x) / view.s / map.width)), Math.min(1, Math.max(0, (clientY - r.top - view.y) / view.s / map.height))];
  };
  const keepView = () => ({ ...view });
  const redraw = () => { const v = keepView(); draw(); Object.assign(view, v); apply(); };

  async function pinDialog(existing) {
    const r = await openDialog({
      title: existing ? 'Change pin' : 'New pin', submitLabel: existing ? 'Save' : 'Add pin',
      body: `<label class="flabel" for="pd-entry">Links to</label>
        <select class="inp" id="pd-entry" name="entry"><option value="">Nothing (just a label)</option>${entryOptions(world.id, existing?.entryId)}</select>
        <label class="flabel" for="pd-label">Label (optional)</label>
        <input class="inp" id="pd-label" name="label" maxlength="60" value="${esc(existing?.label || '')}" placeholder="Shown if not linked; otherwise a note">`,
    });
    if (!r) return null;
    if (!r.entry && !r.label.trim()) { toast('Pick an entry or type a label.'); return null; }
    return { entryId: r.entry, label: r.label.trim() };
  }

  // pointer handling: pan, place pins, add route points, drag pins
  let drag = null;
  root.addEventListener('pointerdown', e => {
    const v = e.target.closest('.map-viewport');
    if (!v || e.button !== 0) return;
    const pinEl = e.target.closest('.pin');
    if (pinEl && mode === 'move') {
      drag = { kind: 'pin', id: pinEl.dataset.pin, sx: e.clientX, sy: e.clientY, moved: false };
    } else {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
    v.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'pan') { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
    if (drag.kind === 'pin') {
      const [x, y] = toMap(e.clientX, e.clientY);
      const el = root.querySelector(`.pin[data-pin="${drag.id}"]`);
      if (el) { el.style.left = x * 100 + '%'; el.style.top = y * 100 + '%'; }
      drag.x = x; drag.y = y;
    }
  });
  root.addEventListener('pointerup', async e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'pin') {
      const p = map.pins.find(x => x.id === d.id);
      if (d.moved && d.x != null) { p.x = d.x; p.y = d.y; await saveRec('maps', map); }
      selectedPin = d.id; redraw(); return;
    }
    if (d.moved) return;
    if (!e.target.closest('.map-viewport')) return;
    const [x, y] = toMap(e.clientX, e.clientY);
    if (mode === 'pin') {
      const r = await pinDialog(null);
      if (!r) return;
      const pin = { id: uid(), x, y, ...r };
      (map.pins ||= []).push(pin);
      await saveRec('maps', map);
      selectedPin = pin.id; redraw();
    } else if (mode === 'route') {
      (draft ||= []).push([x, y]); redraw();
    } else if (selectedPin) { selectedPin = null; redraw(); }
  });
  root.addEventListener('wheel', e => {
    const v = e.target.closest('.map-viewport');
    if (!v) return;
    e.preventDefault();
    const r = v.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  root.onclick = async e => {
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; if (mode !== 'route') draft = null; return redraw(); }
    const listPin = e.target.closest('.side [data-pin]');
    if (listPin) {
      selectedPin = listPin.dataset.pin;
      const p = map.pins.find(x => x.id === selectedPin);
      const r = vp().getBoundingClientRect();
      view.s = Math.max(view.s, 0.6);
      view.x = r.width / 2 - p.x * map.width * view.s; view.y = r.height / 2 - p.y * map.height * view.s;
      const v = keepView(); draw(); Object.assign(view, v); apply(); return;
    }
    const rd = e.target.closest('[data-route-del]');
    if (rd) {
      const r = map.routes.find(x => x.id === rd.dataset.routeDel);
      if (!await confirmDialog(`Delete the route “${r.name}”?`, { title: 'Delete route?', confirmLabel: 'Delete' })) return;
      map.routes = map.routes.filter(x => x.id !== r.id); await saveRec('maps', map); return redraw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const v = vp()?.getBoundingClientRect();
    if (act === 'zoom-in') zoomAt(1.3, v.width / 2, v.height / 2);
    if (act === 'zoom-out') zoomAt(1 / 1.3, v.width / 2, v.height / 2);
    if (act === 'fit') fit();
    if (act === 'route-undo') { draft.pop(); redraw(); }
    if (act === 'route-finish') {
      const r = await openDialog({ title: 'Name this route', submitLabel: 'Save route',
        body: `<label class="flabel" for="rt-name">Name</label><input class="inp" id="rt-name" name="name" required maxlength="60" placeholder="e.g. Journey to the city">
          <label class="flabel" for="rt-color">Color</label><select class="inp" id="rt-color" name="color">${ROUTE_COLORS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select>` });
      if (!r) return;
      (map.routes ||= []).push({ id: uid(), name: r.name.trim(), color: r.color, points: draft });
      draft = null; mode = 'move'; await saveRec('maps', map); redraw();
    }
    if (act === 'pin-edit') {
      const p = map.pins.find(x => x.id === selectedPin);
      const r = await pinDialog(p); if (!r) return;
      Object.assign(p, r); await saveRec('maps', map); redraw();
    }
    if (act === 'pin-delete') { map.pins = map.pins.filter(x => x.id !== selectedPin); selectedPin = null; await saveRec('maps', map); redraw(); }
    if (act === 'rename') { const n = await promptDialog('Rename map', 'Name', map.name); if (n) { map.name = n; await saveRec('maps', map); redraw(); } }
    if (act === 'delete') {
      if (!await confirmDialog(`Delete the map “${map.name}” with its ${(map.pins || []).length} pins and ${(map.routes || []).length} routes? This can't be undone.`, { title: 'Delete map?', confirmLabel: 'Delete map' })) return;
      await deleteRec('maps', map.id); location.hash = `#/w/${world.id}/atlas`;
    }
  };
  root.onchange = async e => {
    if (e.target.dataset.act !== 'replace' || !e.target.files[0]) return;
    try {
      map.image = await readImage(e.target.files[0], 2400);
      const dims = await new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = map.image; });
      [map.width, map.height] = dims;
      await saveRec('maps', map); draw(); fit();
      toast('Image replaced. Pins keep their relative positions.');
    } catch (err) { toast(err.message); }
  };

  draw();
  requestAnimationFrame(fit);
}

export function render(root, { worldId, mapId }) {
  const world = state.worlds.get(worldId);
  if (!world) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }
  if (mapId) {
    const map = state.maps.get(mapId);
    if (!map) { root.innerHTML = `<div class="page"><h1 class="h1">Map not found</h1><p><a href="#/w/${worldId}/atlas">Back to the Atlas</a></p></div>`; return; }
    return mapView(root, world, map);
  }
  list(root, world);
}
