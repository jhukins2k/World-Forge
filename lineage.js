// World Forge — Lineage: family trees, and a web of every relationship your links describe.

import { esc, $, icons, safeColor, toast } from './ui.js';
import { state, uid, saveRec, deleteRec, saveWorld, relationsOf, booksOf, entriesOfBook, entriesOfWorld, entryHref } from './store.js';

const NODE_W = 160, NODE_H = 58, GAP_X = 36, GAP_Y = 90;

function entryOptions(worldId, exclude = new Set()) {
  return booksOf(worldId).map(b => {
    const opts = entriesOfBook(b.id).filter(e => !exclude.has(e.id)).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    return opts ? `<optgroup label="${esc(b.name)}">${opts}</optgroup>` : '';
  }).join('');
}

// ---------- family data ----------

function family(worldId) {
  const parents = new Map(), children = new Map(), partners = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  for (const r of relationsOf(worldId)) {
    if (!state.entries.has(r.a) || !state.entries.has(r.b)) continue;
    if (r.kind === 'parent') { add(parents, r.b, r.a); add(children, r.a, r.b); }
    if (r.kind === 'partner') { add(partners, r.a, r.b); add(partners, r.b, r.a); }
  }
  const get = (m, k) => [...(m.get(k) || [])];
  return {
    parents: id => get(parents, id), children: id => get(children, id), partners: id => get(partners, id),
    siblings: id => [...new Set(get(parents, id).flatMap(p => get(children, p)))].filter(x => x !== id),
  };
}

function findRel(worldId, kind, a, b) {
  return relationsOf(worldId).find(r => r.kind === kind && ((r.a === a && r.b === b) || (kind === 'partner' && r.a === b && r.b === a)));
}

// Lays out everyone connected to the root, generation by generation.
function layoutTree(worldId, rootId) {
  const F = family(worldId);
  const gen = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length && gen.size < 200) {
    const id = queue.shift();
    const g = gen.get(id);
    const visit = (other, og) => { if (!gen.has(other) && Math.abs(og) <= 5) { gen.set(other, og); queue.push(other); } };
    F.parents(id).forEach(p => visit(p, g - 1));
    F.children(id).forEach(c => visit(c, g + 1));
    F.partners(id).forEach(p => visit(p, g));
  }
  const rows = new Map();
  for (const [id, g] of gen) { if (!rows.has(g)) rows.set(g, []); rows.get(g).push(id); }
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const x = new Map();
  const place = row => {
    // keep partners side by side
    const out = [], seen = new Set();
    for (const id of row) {
      if (seen.has(id)) continue;
      out.push(id); seen.add(id);
      for (const p of F.partners(id)) if (row.includes(p) && !seen.has(p)) { out.push(p); seen.add(p); }
    }
    return out;
  };
  const order = (row, ref) => {
    const score = id => { const xs = ref(id).filter(o => x.has(o)).map(o => x.get(o)); return xs.length ? xs.reduce((a, b) => a + b) / xs.length : Infinity; };
    return [...row].sort((a, b) => score(a) - score(b));
  };
  const setRow = ids => ids.forEach((id, i) => x.set(id, i * (NODE_W + GAP_X)));
  setRow(place(order(rows.get(0), () => []).sort((a, b) => (a === rootId ? -1 : b === rootId ? 1 : 0))));
  for (const g of gens.filter(g => g > 0)) setRow(place(order(rows.get(g), F.parents)));
  for (const g of gens.filter(g => g < 0).reverse()) setRow(place(order(rows.get(g), F.children)));
  // centre each row under the widest
  const widths = gens.map(g => rows.get(g).length * (NODE_W + GAP_X) - GAP_X);
  const maxW = Math.max(...widths);
  gens.forEach((g, i) => { const off = (maxW - widths[i]) / 2; rows.get(g).forEach(id => x.set(id, x.get(id) + off)); });
  const nodes = [...gen.entries()].map(([id, g]) => ({ id, g, x: x.get(id) + 20, y: (gens.indexOf(g)) * (NODE_H + GAP_Y) + 20 }));
  return { nodes, F, width: maxW + 40, height: gens.length * (NODE_H + GAP_Y) - GAP_Y + 40 };
}

function treeSVG(worldId, rootId) {
  const L = layoutTree(worldId, rootId);
  const pos = new Map(L.nodes.map(n => [n.id, n]));
  const lines = [];
  const done = new Set();
  for (const n of L.nodes) {
    for (const p of L.F.partners(n.id)) {
      const m = pos.get(p); const key = [n.id, p].sort().join();
      if (!m || done.has(key) || m.g !== n.g) continue; done.add(key);
      const [l, r] = n.x < m.x ? [n, m] : [m, n];
      lines.push(`<line x1="${l.x + NODE_W}" y1="${l.y + NODE_H / 2 - 3}" x2="${r.x}" y2="${r.y + NODE_H / 2 - 3}" class="tl-partner"/><line x1="${l.x + NODE_W}" y1="${l.y + NODE_H / 2 + 3}" x2="${r.x}" y2="${r.y + NODE_H / 2 + 3}" class="tl-partner"/>`);
    }
    const ps = L.F.parents(n.id).map(p => pos.get(p)).filter(Boolean);
    if (ps.length) {
      const px = ps.reduce((a, p) => a + p.x + NODE_W / 2, 0) / ps.length;
      const py = ps[0].y + NODE_H;
      const midY = py + GAP_Y / 2;
      const cx = n.x + NODE_W / 2;
      lines.push(`<path d="M${px} ${ps.length > 1 ? py - NODE_H / 2 : py} V${midY} H${cx} V${n.y}" class="tl-child"/>`);
    }
  }
  const nodes = L.nodes.map(n => {
    const e = state.entries.get(n.id);
    const b = state.books.get(e.bookId);
    return `<g class="fnode ${n.id === rootId ? 'root' : ''}" data-node="${n.id}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="${esc(e.name)}: show their family">
      <rect width="${NODE_W}" height="${NODE_H}" rx="6"/>
      <rect width="6" height="${NODE_H}" rx="3" fill="${safeColor(b?.color)}"/>
      <text x="16" y="25" class="fn-name">${esc(e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name)}</text>
      <text x="16" y="44" class="fn-sub">${esc((t => t.length > 22 ? t.slice(0, 21) + '…' : t)(e.subtitle || b?.name || ''))}</text>
    </g>`;
  }).join('');
  return `<svg class="tree-svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" role="group" aria-label="Family tree">${lines.join('')}${nodes}</svg>`;
}

// ---------- relationship web ----------

function webData(worldId, bookIds) {
  const nodes = entriesOfWorld(worldId).filter(e => bookIds.includes(e.bookId));
  const ids = new Set(nodes.map(n => n.id));
  const edges = new Map();
  const addEdge = (a, b, label, family) => {
    if (a === b || !ids.has(a) || !ids.has(b)) return;
    const k = [a, b].sort().join('|');
    const ex = edges.get(k);
    if (ex) { if (label && !ex.labels.includes(label)) ex.labels.push(label); ex.family ||= family; }
    else edges.set(k, { a, b, labels: label ? [label] : [], family });
  };
  for (const e of nodes) {
    const book = state.books.get(e.bookId);
    for (const f of book.fields) {
      if (f.type !== 'link') continue;
      for (const l of e.values?.[f.id] || []) addEdge(e.id, l.id, l.note || f.label, false);
    }
  }
  for (const r of relationsOf(worldId)) addEdge(r.a, r.b, r.kind === 'parent' ? 'parent' : 'partner', true);
  return { nodes, edges: [...edges.values()] };
}

function simulate(nodes, edges, W, H, saved = {}) {
  const P = new Map();
  nodes.forEach((n, i) => {
    const s = saved[n.id];
    const a = (i / nodes.length) * Math.PI * 2;
    P.set(n.id, s ? { x: s[0] * W, y: s[1] * H, fixed: true } : { x: W / 2 + Math.cos(a) * W * 0.35, y: H / 2 + Math.sin(a) * H * 0.35 });
  });
  const k = Math.sqrt((W * H) / Math.max(nodes.length, 1)) * 0.75;
  for (let it = 0; it < 320; it++) {
    const t = 1 - it / 320;
    const D = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = P.get(nodes[i].id), b = P.get(nodes[j].id);
      let dx = a.x - b.x, dy = a.y - b.y; const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (k * k) / d; dx /= d; dy /= d;
      D.get(nodes[i].id).x += dx * f; D.get(nodes[i].id).y += dy * f;
      D.get(nodes[j].id).x -= dx * f; D.get(nodes[j].id).y -= dy * f;
    }
    for (const e of edges) {
      const a = P.get(e.a), b = P.get(e.b);
      let dx = a.x - b.x, dy = a.y - b.y; const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d * d) / k; dx /= d; dy /= d;
      D.get(e.a).x -= dx * f; D.get(e.a).y -= dy * f;
      D.get(e.b).x += dx * f; D.get(e.b).y += dy * f;
    }
    for (const n of nodes) {
      const p = P.get(n.id), d = D.get(n.id);
      if (p.fixed) continue;
      d.x += (W / 2 - p.x) * 0.02 * k / 10; d.y += (H / 2 - p.y) * 0.02 * k / 10;
      const len = Math.max(Math.hypot(d.x, d.y), 1), step = Math.min(len, k * 0.6 * t + 1);
      p.x = Math.min(W - 70, Math.max(70, p.x + (d.x / len) * step));
      p.y = Math.min(H - 30, Math.max(30, p.y + (d.y / len) * step));
    }
  }
  return P;
}

// ---------- page ----------

export function render(root, { worldId, mode, personId }) {
  const world = state.worlds.get(worldId);
  if (!world) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }
  world.lineage ||= {};
  const tab = mode === 'web' ? 'web' : 'tree';
  let rootId = (personId && state.entries.has(personId) ? personId : null) || (world.lineage.root && state.entries.has(world.lineage.root) ? world.lineage.root : null);
  let selected = null;

  function treeTab() {
    const people = entriesOfWorld(worldId);
    if (!people.length) return '<div class="empty-card"><p>Add some characters first; then come back to connect their families.</p></div>';
    if (!rootId) rootId = relationsOf(worldId)[0]?.a || people[0].id;
    const F = family(worldId);
    const me = state.entries.get(rootId);
    const rel = (ids, kind, label, addLabel) => `<div class="fam-group"><h3 class="roll-h">${label}</h3>
      <ul class="fam-list">${ids.map(id => { const e = state.entries.get(id); return `<li><button type="button" class="linklike" data-node="${id}">${esc(e.name)}</button>
        ${kind ? `<button type="button" class="icon-btn" data-unlink="${kind}" data-other="${id}" aria-label="Remove ${esc(e.name)} as ${label.toLowerCase()}">${icons.x}</button>` : ''}</li>`; }).join('') || '<li class="muted small">None yet</li>'}</ul>
      ${addLabel ? `<label class="sr-only" for="add-${kind}">${addLabel}</label><select class="inp sm" id="add-${kind}" data-link="${kind}"><option value="">${addLabel}</option>${entryOptions(worldId, new Set([rootId, ...ids]))}</select>` : ''}</div>`;
    return `<div class="lin-layout">
      <div class="tree-wrap">${treeSVG(worldId, rootId)}</div>
      <aside class="side">
        <section class="side-card">
          <label class="flabel" for="lin-root">Centre the tree on</label>
          <select class="inp sm" id="lin-root" data-act="root">${booksOf(worldId).map(b => `<optgroup label="${esc(b.name)}">${entriesOfBook(b.id).map(e => `<option value="${e.id}" ${e.id === rootId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}</select>
          <h2 class="side-h fam-h"><a href="${entryHref(me)}">${esc(me.name)}</a>'s family</h2>
          ${rel(F.parents(rootId), 'parent', 'Parents', '+ Add a parent…')}
          ${rel(F.partners(rootId), 'partner', 'Partners', '+ Add a partner…')}
          ${rel(F.children(rootId), 'child', 'Children', '+ Add a child…')}
          ${rel(F.siblings(rootId), '', 'Siblings (through shared parents)', '')}
          <p class="muted small">Click anyone in the tree to centre on them.</p>
        </section>
      </aside></div>`;
  }

  function webTab() {
    const books = booksOf(worldId);
    const chosen = (world.lineage.webBooks || books.filter(b => /character|faction|organi[sz]ation|people/i.test(b.name)).map(b => b.id)).filter(id => state.books.has(id));
    const bookIds = chosen.length ? chosen : books.slice(0, 1).map(b => b.id);
    const D = webData(worldId, bookIds);
    const W = Math.max(900, Math.min(1600, 260 + D.nodes.length * 34)), H = Math.max(560, Math.min(1100, 200 + D.nodes.length * 22));
    const P = simulate(D.nodes, D.edges, W, H, world.lineage.webPos || {});
    root._web = { D, P, W, H };
    const deg = new Map(D.nodes.map(n => [n.id, 0])); D.edges.forEach(e => { deg.set(e.a, deg.get(e.a) + 1); deg.set(e.b, deg.get(e.b) + 1); });
    const sel = selected && D.nodes.find(n => n.id === selected);
    const near = new Set(sel ? D.edges.filter(e => e.a === selected || e.b === selected).flatMap(e => [e.a, e.b]) : []);
    const conns = sel ? D.edges.filter(e => e.a === selected || e.b === selected) : [];
    return `<div class="checks web-books" role="group" aria-label="Books shown">${books.map(b => `<label class="check"><input type="checkbox" data-webbook="${b.id}" ${bookIds.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div>
      <div class="lin-layout">
        <div class="web-wrap"><svg class="web-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Relationship web">
          ${D.edges.map((e, i) => { const a = P.get(e.a), b = P.get(e.b); const hot = sel && (e.a === selected || e.b === selected);
            return `<line data-edge="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="wedge ${e.family ? 'fam' : ''} ${hot ? 'hot' : sel ? 'dim' : ''}"><title>${esc(e.labels.join(', '))}</title></line>`; }).join('')}
          ${D.nodes.map(n => { const p = P.get(n.id); const b = state.books.get(n.bookId); const r = 9 + Math.min(deg.get(n.id), 10) * 1.6;
            const cls = sel ? (n.id === selected ? 'on' : near.has(n.id) ? 'near' : 'dim') : '';
            return `<g class="wnode ${cls}" data-wnode="${n.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(n.name)}, ${deg.get(n.id)} connections">
              <circle r="${r}" fill="${safeColor(b?.color)}"/><text y="${r + 16}" text-anchor="middle">${esc(n.name)}</text></g>`; }).join('')}
        </svg></div>
        <aside class="side"><section class="side-card">
          ${sel ? `<h2 class="side-h"><a href="${entryHref(sel)}">${esc(sel.name)}</a></h2>
            <ul class="side-list">${conns.map(e => { const o = state.entries.get(e.a === selected ? e.b : e.a); return `<li><button type="button" class="linklike" data-wsel="${o.id}">${esc(o.name)}</button>${e.labels.length ? `<span class="muted"> · ${esc(e.labels.join(', '))}</span>` : ''}</li>`; }).join('') || '<li class="muted small">No connections</li>'}</ul>`
            : `<h2 class="side-h">Relationship web</h2><p class="muted small">Every “Link to entries” field and family link becomes a line. Bigger circles have more connections. Click someone to highlight their links; drag to rearrange (positions are remembered).</p>`}
          <p class="muted small">${D.nodes.length} entries · ${D.edges.length} connections</p>
          ${Object.keys(world.lineage.webPos || {}).length ? '<button type="button" class="btn ghost sm" data-act="web-reset">Reset layout</button>' : ''}
        </section></aside>
      </div>`;
  }

  function draw() {
    root.innerHTML = `<div class="page wide">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span><span aria-current="page">Lineage</span></nav>
      <div class="page-head"><div><h1 class="h1">Lineage</h1><p class="lede">${tab === 'tree' ? 'Family trees, built from parent and partner links.' : 'Everyone, and how they connect.'}</p></div>
        <div class="seg" role="tablist" aria-label="View">
          <a role="tab" aria-selected="${tab === 'tree'}" class="${tab === 'tree' ? 'on' : ''}" href="#/w/${worldId}/lineage">Family tree</a>
          <a role="tab" aria-selected="${tab === 'web'}" class="${tab === 'web' ? 'on' : ''}" href="#/w/${worldId}/lineage/web">Relationship web</a>
        </div></div>
      ${tab === 'tree' ? treeTab() : webTab()}
    </div>`;
  }

  root.onchange = async e => {
    const el = e.target;
    if (el.dataset.act === 'root') { rootId = el.value; world.lineage.root = rootId; await saveWorld(world); return draw(); }
    if (el.dataset.link && el.value) {
      const other = el.value, kind = el.dataset.link;
      const rec = kind === 'parent' ? { kind: 'parent', a: other, b: rootId } : kind === 'child' ? { kind: 'parent', a: rootId, b: other } : { kind: 'partner', a: rootId, b: other };
      if (rec.kind === 'parent' && findRel(worldId, 'parent', rec.b, rec.a)) { toast('That would make someone their own ancestor.'); return draw(); }
      if (!findRel(worldId, rec.kind, rec.a, rec.b)) await saveRec('relations', { id: uid(), worldId, ...rec });
      return draw();
    }
    if (el.dataset.webbook) {
      const books = booksOf(worldId);
      const cur = new Set((world.lineage.webBooks || books.filter(b => /character|faction|organi[sz]ation|people/i.test(b.name)).map(b => b.id)));
      el.checked ? cur.add(el.dataset.webbook) : cur.delete(el.dataset.webbook);
      world.lineage.webBooks = [...cur]; await saveWorld(world); return draw();
    }
  };

  root.onclick = async e => {
    const un = e.target.closest('[data-unlink]');
    if (un) {
      const o = un.dataset.other, kind = un.dataset.unlink;
      const r = kind === 'parent' ? findRel(worldId, 'parent', o, rootId) : kind === 'child' ? findRel(worldId, 'parent', rootId, o) : findRel(worldId, 'partner', rootId, o);
      if (r) await deleteRec('relations', r.id);
      return draw();
    }
    const node = e.target.closest('[data-node]');
    if (node) { rootId = node.dataset.node; world.lineage.root = rootId; await saveWorld(world); return draw(); }
    const ws = e.target.closest('[data-wsel]');
    if (ws) { selected = ws.dataset.wsel; return draw(); }
    if (e.target.closest('[data-act="web-reset"]')) { world.lineage.webPos = {}; await saveWorld(world); return draw(); }
  };
  root.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const n = e.target.closest('[data-node], [data-wnode]');
    if (!n) return;
    e.preventDefault();
    if (n.dataset.node) { rootId = n.dataset.node; draw(); } else { selected = selected === n.dataset.wnode ? null : n.dataset.wnode; draw(); }
  };

  // dragging nodes in the web
  let drag = null;
  root.onpointerdown = e => {
    const g = e.target.closest('[data-wnode]');
    if (!g || !root._web) return;
    const svg = g.ownerSVGElement;
    drag = { id: g.dataset.wnode, g, svg, moved: false, sx: e.clientX, sy: e.clientY };
    g.setPointerCapture(e.pointerId);
  };
  root.onpointermove = e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const pt = drag.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(drag.svg.getScreenCTM().inverse());
    const pos = root._web.P.get(drag.id); pos.x = p.x; pos.y = p.y;
    drag.g.setAttribute('transform', `translate(${p.x} ${p.y})`);
    root._web.D.edges.forEach((ed, i) => {
      if (ed.a !== drag.id && ed.b !== drag.id) return;
      const l = root.querySelector(`[data-edge="${i}"]`);
      const a = root._web.P.get(ed.a), b = root._web.P.get(ed.b);
      l.setAttribute('x1', a.x); l.setAttribute('y1', a.y); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
    });
  };
  root.onpointerup = async () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { selected = selected === d.id ? null : d.id; return draw(); }
    const { P, W, H } = root._web;
    world.lineage.webPos = Object.fromEntries([...P.entries()].map(([id, p]) => [id, [p.x / W, p.y / H]]));
    await saveWorld(world);
  };

  draw();
}
