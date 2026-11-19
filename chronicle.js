// World Forge — Chronicle: a timeline of every event, from the first recorded to the last.
// Spacing grows with the time between events, so centuries and days fit on one line;
// long stretches are folded and labelled with how much time passed.

import { esc, $, icons, openDialog, promptDialog, confirmDialog, toast } from './ui.js';
import { state, uid, saveRec, saveWorld, deleteRec, eventsOf, volumesOf, chaptersOf, entryHref, entriesOfWorld } from './store.js';
import { renderRich, toEditable, fromEditable } from './fields.js';
import { attachMentions } from './mentions.js';
import { pickerHTML, applyPickerEvent } from './pickers.js';
import { calendarOf, toDays, formatDate, formatDays, formatElapsed, dateEditorHTML, readDateEditor } from './chrono.js';

const ROW_H = 54;
const CARD_W = 144;
const LANE_COLORS = ['#a08868', '#e0b863', '#5fa39b', '#b585a8', '#7f9fd0', '#d08a6a', '#9cb06a'];
const setStatus = t => { const s = document.getElementById('save-status'); if (s) s.textContent = t; };

function allChaptersOrdered(worldId) {
  return volumesOf(worldId).flatMap((v, vi) => chaptersOf(v.id).map((c, ci) => ({ c, vi, ci, num: ci + 1 })));
}

// Where in the story an event sits (global chapter index), for the "as of this moment" snapshot.
function storyIndex(ev, world) {
  const all = allChaptersOrdered(world.id);
  const linked = all.filter(x => (ev.chapters || []).includes(x.c.id)).map(x => all.indexOf(x));
  if (linked.length) return Math.min(...linked);
  const d = toDays(ev.start, world);
  if (d == null) return null;
  let idx = null;
  all.forEach((x, i) => { const cd = toDays(x.c.date, world); if (cd != null && cd <= d) idx = i; });
  return idx;
}

function whenToIndex(when, world) {
  const all = allChaptersOrdered(world.id);
  const s = String(when || '');
  if (/before/i.test(s) && !/ch/i.test(s)) return -1;
  const ch = s.match(/ch(?:apter)?\.?\s*(\d+)/i);
  if (!ch) return null;
  const bk = s.match(/book\s*(\d+)/i);
  const vi = bk ? Number(bk[1]) - 1 : 0;
  const i = all.findIndex(x => x.vi === vi && x.num === Number(ch[1]));
  return i >= 0 ? i : null;
}

function snapshot(ev, world) {
  const idx = storyIndex(ev, world);
  if (idx == null) return '';
  const rows = [];
  for (const pid of ev.people || []) {
    const p = state.entries.get(pid);
    const book = p && state.books.get(p.bookId);
    if (!book) continue;
    const facts = [];
    for (const f of book.fields.filter(f => f.type === 'timeline')) {
      const steps = (p.values?.[f.id] || []).map(s => ({ ...s, i: whenToIndex(s.when, world) })).filter(s => s.i != null && s.i <= idx);
      if (steps.length) { const last = steps[steps.length - 1]; facts.push(`<div class="snap-fact"><span class="muted">${esc(f.label)}</span> ${esc(last.value)}${last.when ? ` <small class="muted">(since ${esc(last.when)})</small>` : ''}</div>`); }
    }
    if (facts.length) rows.push(`<div class="snap-person"><a href="${entryHref(p)}">${esc(p.name)}</a>${facts.join('')}</div>`);
  }
  const ch = allChaptersOrdered(world.id)[idx];
  return rows.length ? `<section class="side-card"><h2 class="side-h">At this moment</h2>
    <p class="muted small">As of ${ch ? `Ch ${ch.num}` : 'this point'}, from each person's “changes over time” fields.</p>${rows.join('')}</section>` : '';
}

function defaultLanes(world) {
  const counts = new Map();
  for (const ev of eventsOf(world.id)) for (const id of ev.people || []) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
}

export function render(root, { worldId, eventId }) {
  const world = state.worlds.get(worldId);
  if (!world) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }
  world.chronicle ||= {};
  let selected = eventId && state.events.has(eventId) ? eventId : null;
  let editing = false;
  let showLanes = false;

  function layout() {
    const cal = calendarOf(world);
    const lanesIds = (world.chronicle.lanes || defaultLanes(world)).filter(id => state.entries.has(id));
    const placed = [], undated = [];
    for (const ev of eventsOf(world.id)) {
      const s = toDays(ev.start, world);
      if (s == null) { undated.push(ev); continue; }
      const ongoing = ev.end?.kind === 'ongoing';
      let e = ongoing ? null : toDays(ev.end, world);
      if (e != null && e < s) e = null;
      placed.push({ ev, s, e, ongoing });
    }
    const chapterMarks = allChaptersOrdered(world.id).map(x => ({ ...x, d: toDays(x.c.date, world) })).filter(x => x.d != null);
    const key = d => Math.round(d * 100) / 100;
    const pts = [...new Set([...placed.flatMap(p => p.e != null ? [key(p.s), key(p.e)] : [key(p.s)]), ...chapterMarks.map(m => key(m.d))])].sort((a, b) => a - b);
    const zoom = Number(world.chronicle.zoom) || 1;
    const xOf = new Map();
    const gaps = [];
    let x = 90;
    pts.forEach((p, i) => {
      if (i) {
        const g = p - pts[i - 1];
        const w = (CARD_W + 10 + 26 * Math.log10(1 + g)) * zoom;
        gaps.push({ from: x, to: x + w, days: g, folded: g > cal.dpy * 3 });
        x += w;
      }
      xOf.set(p, x);
    });
    const width = Math.max(x + 260, 900);
    const X = d => xOf.get(key(d));

    const lanes = [{ id: 'world', label: 'World & other', color: LANE_COLORS[0] },
      ...lanesIds.map((id, i) => ({ id, label: state.entries.get(id).name, color: LANE_COLORS[(i + 1) % LANE_COLORS.length] }))];
    for (const l of lanes) { l.items = []; l.rows = []; }
    for (const p of placed) {
      const ids = [...(p.ev.people || []), ...(p.ev.places || []), ...(p.ev.items || [])];
      const hits = lanes.filter(l => l.id !== 'world' && ids.includes(l.id));
      for (const l of hits.length ? hits : [lanes[0]]) l.items.push(p);
    }
    for (const l of lanes) {
      l.items.sort((a, b) => a.s - b.s);
      for (const it of l.items) {
        const x1 = X(it.s);
        const isSpan = it.e != null || it.ongoing;
        const x2 = it.ongoing ? width - 30 : it.e != null ? X(it.e) : x1;
        const lo = isSpan ? x1 - 6 : x1 - CARD_W / 2 - 4;
        const hi = isSpan ? Math.max(x2, x1 + CARD_W) + 6 : x1 + CARD_W / 2 + 4;
        let r = l.rows.findIndex(row => row.every(([a, b]) => hi < a || lo > b));
        if (r < 0) { l.rows.push([]); r = l.rows.length - 1; }
        l.rows[r].push([lo, hi]);
        it.lane = l; it.row = r; it.x1 = x1; it.x2 = x2; it.isSpan = isSpan;
        l.placedItems = l.placedItems || [];
        l.placedItems.push({ ...it });
      }
      l.height = Math.max(1, l.rows.length) * ROW_H + 18;
    }
    return { cal, pts, X, gaps, width, lanes, undated, chapterMarks, placed };
  }

  function timeline(L) {
    if (!L.pts.length) return `<div class="empty-card"><p>No dated events yet. Add an event and give it a date, or give your chapters a “when” in the Manuscript, and they'll appear here.</p></div>`;
    const BAND = 54, AXIS = 56;
    let top = BAND + AXIS;
    const laneTops = L.lanes.map(l => { const t = top; top += l.height; return t; });
    const H = top;
    const vols = volumesOf(world.id);
    const band = vols.map((v, vi) => {
      const ms = L.chapterMarks.filter(m => m.vi === vi);
      if (!ms.length) return '';
      const xs = ms.map(m => L.X(m.d));
      const a = Math.min(...xs) - 30, b = Math.max(Math.max(...xs) + 30, a + 180);
      return `<div class="tl-vol" style="left:${a}px;width:${b - a}px" title="${esc(v.title)}">${esc(v.title)}</div>
        ${ms.map(m => `<a class="tl-chmark" style="left:${L.X(m.d) - 14}px" href="#/w/${world.id}/manuscript/c/${m.c.id}" title="Ch ${m.num}${m.c.title ? ': ' + esc(m.c.title) : ''}">${m.num}</a>`).join('')}`;
    }).join('');
    const axis = L.pts.map(p => `<div class="tl-tick" style="left:${L.X(p) - 70}px">${esc(formatDays(p, world))}</div>`).join('');
    const guides = L.pts.map(p => `<div class="tl-guide" style="left:${L.X(p)}px;top:${BAND}px;height:${H - BAND}px"></div>`).join('');
    const gaps = L.gaps.map(g => `
      ${g.folded ? `<div class="tl-fold" style="left:${(g.from + g.to) / 2 - 16}px;top:${BAND + AXIS}px;height:${H - BAND - AXIS}px" aria-hidden="true"></div>` : ''}
      <div class="tl-gap ${g.folded ? 'folded' : ''}" style="left:${(g.from + g.to) / 2 - 48}px;top:${BAND + 30}px">${esc(formatElapsed(g.days, world))}</div>`).join('');
    const lanesHtml = L.lanes.map((l, li) => {
      const t = laneTops[li];
      return `<div class="tl-lane-bg" style="top:${t}px;height:${l.height}px"></div>
        ${(l.placedItems || []).map(it => {
          const y = t + 9 + it.row * ROW_H;
          const ev = it.ev;
          const sel = ev.id === selected ? ' selected' : '';
          const fuzzy = ev.start?.kind === 'circa' ? ' fuzzy' : '';
          const date = formatDate(ev.start, world) || formatDays(it.s, world);
          if (it.isSpan) {
            const w = Math.max(it.x2 - it.x1, 24);
            const dur = it.ongoing ? 'still going' : formatElapsed(it.e - it.s, world).replace('≈ ', '');
            return `<button type="button" class="tl-span${sel}${fuzzy}${it.ongoing ? ' ongoing' : ''}" data-ev="${ev.id}" style="left:${it.x1}px;top:${y + 6}px;width:${w}px;--lane:${l.color}">
              <span class="tl-span-label">${esc(ev.title)} <small>· ${esc(dur)}</small></span></button>`;
          }
          return `<button type="button" class="tl-card${sel}${fuzzy}" data-ev="${ev.id}" style="left:${it.x1 - CARD_W / 2}px;top:${y}px;--lane:${l.color}">
            <span class="tl-card-t">${esc(ev.title)}</span><span class="tl-card-d">${esc(date)}</span></button>`;
        }).join('')}`;
    }).join('');
    return `<div class="tl-frame">
      <div class="tl-labels" style="height:${H}px">
        <div style="height:${BAND}px" class="tl-lab-band">Story</div>
        <div style="height:${AXIS}px" class="tl-lab-axis">When</div>
        ${L.lanes.map(l => `<div class="tl-lab" style="height:${l.height}px"><span class="tl-swatch" style="background:${l.color}"></span><span>${esc(l.label)}</span></div>`).join('')}
      </div>
      <div class="tl-scroll"><div class="tl-canvas" style="width:${L.width}px;height:${H}px">
        <div class="tl-band-bg" style="height:${BAND}px"></div>${band}
        <div class="tl-axis-bg" style="top:${BAND}px;height:${AXIS}px"></div>${axis}
        ${guides}${gaps}${lanesHtml}
      </div></div>
    </div>`;
  }

  function chaptersPicker(ev) {
    const all = allChaptersOrdered(world.id);
    const label = x => `${volumesOf(world.id).length > 1 ? state.volumes.get(x.c.volumeId)?.title + ', ' : ''}Ch ${x.num}${x.c.title ? ': ' + x.c.title : ''}`;
    const chosen = all.filter(x => (ev.chapters || []).includes(x.c.id));
    const rest = all.filter(x => !(ev.chapters || []).includes(x.c.id));
    return `<div class="picker"><span class="flabel">Chapters it happens in</span><div class="pchips">
      ${chosen.map(x => `<span class="pchip"><a href="#/w/${world.id}/manuscript/c/${x.c.id}">${esc(label(x))}</a>
        <button type="button" class="pchip-x" data-ch-remove="${x.c.id}" aria-label="Remove ${esc(label(x))}">${icons.x}</button></span>`).join('')}
      ${rest.length ? `<select class="inp sm pick-add" data-ch-add aria-label="Add a chapter"><option value="">+ Add a chapter…</option>${rest.map(x => `<option value="${x.c.id}">${esc(label(x))}</option>`).join('')}</select>` : (all.length ? '' : '<span class="muted small">No chapters in the Manuscript yet</span>')}
    </div></div>`;
  }

  function eventPanel(L) {
    const ev = selected && state.events.get(selected);
    if (!ev) return `<section class="panel ev-panel"><h2 class="panel-h">Events</h2><p class="muted">Click an event on the timeline to see it here, or add a new one.</p></section>`;
    const chips = (ids, label) => (ids || []).length ? `<div class="ev-row"><span class="flabel">${label}</span><div class="chips">${ids.map(id => { const e = state.entries.get(id); return e ? `<a class="chip" href="${entryHref(e)}">${esc(e.name)}</a>` : ''; }).join('')}</div></div>` : '';
    const s = toDays(ev.start, world);
    const e = ev.end?.kind === 'ongoing' ? null : toDays(ev.end, world);
    if (!editing) {
      const chs = allChaptersOrdered(world.id).filter(x => (ev.chapters || []).includes(x.c.id));
      return `<section class="parchment ev-panel">
        <div class="ev-head"><div>
          <div class="flabel">Selected event</div>
          <h2 class="ev-title">${esc(ev.title)}</h2>
          <p class="p-sub">${esc(formatDate(ev.start, world) || 'Not placed yet')}${ev.start?.kind === 'relative' && s != null ? ` · ${esc(formatDays(s, world))}` : ''}
            ${ev.end && ev.end.kind !== 'none' ? ` → ${esc(formatDate(ev.end, world))}${e != null && s != null ? ` (${esc(formatElapsed(e - s, world))})` : ''}` : ''}</p>
        </div><button type="button" class="btn ink" data-act="edit">${icons.edit} Edit</button></div>
        ${ev.description ? `<div class="rich">${renderRich(ev.description)}</div>` : ''}
        ${chips(ev.people, 'People')}${chips(ev.places, 'Places')}${chips(ev.items, 'Items')}
        ${chs.length ? `<div class="ev-row"><span class="flabel">Chapters</span><div class="chips">${chs.map(x => `<a class="chip" href="#/w/${world.id}/manuscript/c/${x.c.id}">Ch ${x.num}${x.c.title ? ': ' + esc(x.c.title) : ''}</a>`).join('')}</div></div>` : ''}
      </section>`;
    }
    return `<section class="parchment editing ev-panel">
      <div class="edit-bar"><span class="edit-note">Changes save as you type</span><button type="button" class="btn ink" data-act="done">Done</button></div>
      <label class="flabel" for="ev-title">Event</label>
      <input class="inp big" id="ev-title" data-evk="title" value="${esc(ev.title)}">
      <div class="date-block"><span class="flabel">When it happens</span>${dateEditorHTML('ev-start', ev.start, world, { excludeEventId: ev.id })}</div>
      <label class="check"><input type="checkbox" data-act="span" ${ev.end ? 'checked' : ''}> It lasts a while (a war, a journey, a lifetime)</label>
      ${ev.end ? `<div class="date-block"><span class="flabel">Until</span>${dateEditorHTML('ev-end', ev.end, world, { allowOngoing: true, excludeEventId: ev.id })}</div>` : ''}
      ${pickerHTML('people', ev.people, { worldId: world.id, label: 'People', placeholder: '+ Add someone…' })}
      ${pickerHTML('places', ev.places, { worldId: world.id, label: 'Places', placeholder: '+ Add a place…' })}
      ${pickerHTML('items', ev.items, { worldId: world.id, label: 'Items', placeholder: '+ Add an item…' })}
      ${chaptersPicker(ev)}
      <label class="flabel" for="ev-desc">What happens</label>
      <textarea class="inp" id="ev-desc" rows="4" data-evk="description" data-mention>${esc(toEditable(ev.description, world.id))}</textarea>
      <div class="danger-zone"><button type="button" class="btn danger-ghost" data-act="delete">${icons.trash} Delete this event</button></div>
    </section>`;
  }

  function draw() {
    const L = layout();
    const ev = selected && state.events.get(selected);
    const lanesIds = world.chronicle.lanes || defaultLanes(world);
    root.innerHTML = `<div class="page wide">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span>${esc(world.name)}</span><span aria-hidden="true">›</span><span aria-current="page">Chronicle</span></nav>
      <div class="page-head"><div>
        <h1 class="h1">Chronicle</h1>
        <p class="lede">${L.placed.length} events on the timeline${L.undated.length ? ` · ${L.undated.length} waiting for a date` : ''}. Long empty stretches are folded.</p>
      </div>
      <div class="btn-row">
        <label class="zoom"><span class="small muted">Spacing</span>
          <input type="range" min="0.6" max="2.5" step="0.1" value="${Number(world.chronicle.zoom) || 1}" data-act="zoom" aria-label="Timeline spacing"></label>
        <button type="button" class="btn ghost" data-act="lanes" aria-expanded="${showLanes}">Lanes</button>
        <button type="button" class="btn ghost" data-act="calendar">Calendar</button>
        <button type="button" class="btn primary" data-act="new">+ Event</button>
      </div></div>
      ${!world.calendar ? `<div class="notice">${icons.question}<span>No calendar set for this world yet. Years count from when your story starts (Year 0); Y−90 is ninety years before.</span>
        <button type="button" class="btn link-btn" data-act="calendar">Set up a calendar</button></div>` : ''}
      ${showLanes ? `<section class="panel lanes-panel" data-lanes>
        <h2 class="panel-h">Lanes</h2>
        <p class="muted small">Each lane follows one character, place or faction. Events with none of them go in “World & other”.</p>
        ${pickerHTML('lanes', lanesIds, { worldId: world.id, placeholder: '+ Add a lane…' })}
      </section>` : ''}
      ${timeline(L)}
      <div class="ev-area">
        ${eventPanel(L)}
        <aside class="side">
          ${ev ? snapshot(ev, world) : ''}
          <section class="side-card undated">
            <h2 class="side-h">Waiting for a date · ${L.undated.length}</h2>
            ${L.undated.length ? `<ul class="side-list">${L.undated.map(u => `<li><button type="button" class="linklike" data-ev="${u.id}">${esc(u.title)}</button></li>`).join('')}</ul>`
              : '<p class="muted small">Events you add without a date wait here until you place them.</p>'}
          </section>
        </aside>
      </div>
    </div>`;
    if (editing) attachMentions(root, world.id);
    const sc = root.querySelector('.tl-scroll');
    const selEl = root.querySelector('.tl-card.selected, .tl-span.selected');
    if (sc && root._scrollX != null) sc.scrollLeft = root._scrollX;
    else if (selEl) selEl.scrollIntoView({ block: 'nearest', inline: 'center' });
    else if (sc) { const first = root.querySelector('.tl-chmark'); if (first) sc.scrollLeft = Math.max(0, first.offsetLeft - sc.clientWidth / 4); }
    if (sc) sc.addEventListener('scroll', () => { root._scrollX = sc.scrollLeft; }, { passive: true });
  }

  let timer = null;
  const evNow = () => state.events.get(selected);
  const save = () => { setStatus('Saving…'); clearTimeout(timer); timer = setTimeout(async () => { timer = null; const ev = evNow(); if (ev) await saveRec('events', ev); }, 450); };
  const flush = async () => { if (timer) { clearTimeout(timer); timer = null; const ev = evNow(); if (ev) await saveRec('events', ev); } };
  window.addEventListener('hashchange', flush, { once: true });

  root.oninput = e => {
    const el = e.target;
    if (el.dataset.act === 'zoom') { world.chronicle.zoom = Number(el.value); clearTimeout(root._z); root._z = setTimeout(() => { saveWorld(world); draw(); }, 120); return; }
    const ev = evNow();
    if (!ev || !editing) return;
    if (el.dataset.evk) { ev[el.dataset.evk] = el.dataset.evk === 'description' ? fromEditable(el.value, world.id) : el.value; return save(); }
    const ed = el.closest('.date-ed');
    if (ed) { const p = ed.dataset.prefix; ev[p === 'ev-start' ? 'start' : 'end'] = readDateEditor(root, p); save(); }
  };

  root.onchange = async e => {
    const el = e.target;
    if (el.closest('[data-lanes]') && el.dataset.pickAdd) {
      const rec = { lanes: [...(world.chronicle.lanes || defaultLanes(world))] };
      applyPickerEvent(e, rec); world.chronicle.lanes = rec.lanes; await saveWorld(world); return draw();
    }
    const ev = evNow();
    if (!ev || !editing) return;
    if (el.dataset.act === 'span') { ev.end = el.checked ? { kind: 'none' } : null; await flush(); await saveRec('events', ev); return draw(); }
    if (el.closest('.date-ed') && el.tagName === 'SELECT') { await flush(); await saveRec('events', ev); return draw(); }
    if (el.dataset.chAdd !== undefined && el.value) { (ev.chapters ||= []).push(el.value); await saveRec('events', ev); return draw(); }
    if (el.dataset.pickAdd && applyPickerEvent(e, ev)) { await saveRec('events', ev); return draw(); }
  };

  root.onclick = async e => {
    const lr = e.target.closest('[data-lanes] [data-pick-remove]');
    if (lr) { const rec = { lanes: [...(world.chronicle.lanes || defaultLanes(world))] }; applyPickerEvent(e, rec); world.chronicle.lanes = rec.lanes; await saveWorld(world); return draw(); }
    const ev = evNow();
    if (ev && editing) {
      const cr = e.target.closest('[data-ch-remove]');
      if (cr) { ev.chapters = (ev.chapters || []).filter(id => id !== cr.dataset.chRemove); await saveRec('events', ev); return draw(); }
      if (e.target.closest('[data-pick-remove]') && applyPickerEvent(e, ev)) { await saveRec('events', ev); return draw(); }
    }
    const pick = e.target.closest('[data-ev]');
    if (pick) { await flush(); selected = pick.dataset.ev; editing = false; history.replaceState(null, '', `#/w/${world.id}/chronicle/e/${selected}`); return draw(); }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const act = btn.dataset.act;
    if (act === 'new') {
      const title = await promptDialog('New event', 'What happens?', '', 'e.g. The fall of Eldhavn');
      if (!title) return;
      const n = { id: uid(), worldId: world.id, title, start: { kind: 'none' }, end: null, people: [], places: [], items: [], chapters: [], description: '' };
      await saveRec('events', n);
      selected = n.id; editing = true;
      history.replaceState(null, '', `#/w/${world.id}/chronicle/e/${selected}`);
      draw(); $('#ev-start-kind', root)?.focus();
    }
    if (act === 'edit') { editing = true; draw(); $('#ev-title', root)?.focus(); }
    if (act === 'done') { await flush(); editing = false; draw(); }
    if (act === 'delete') {
      if (!await confirmDialog(`Delete the event “${ev.title}”? Anything dated relative to it will become undated.`, { title: 'Delete this event?', confirmLabel: 'Delete event' })) return;
      clearTimeout(timer); timer = null;
      await deleteRec('events', ev.id);
      selected = null; editing = false;
      history.replaceState(null, '', `#/w/${world.id}/chronicle`);
      draw();
    }
    if (act === 'lanes') { showLanes = !showLanes; draw(); }
    if (act === 'calendar') await calendarDialog();
  };

  async function calendarDialog() {
    const c = world.calendar || {};
    const months = (c.months || []).map(m => `${m.name}, ${m.days}`).join('\n');
    const r = await openDialog({
      title: 'Calendar',
      body: `
        <fieldset class="cfg"><legend class="flabel">Count years</legend>
          <label class="check"><input type="radio" name="mode" value="relative" ${c.mode !== 'custom' ? 'checked' : ''}> From when my story starts (Year 0)</label>
          <label class="check"><input type="radio" name="mode" value="custom" ${c.mode === 'custom' ? 'checked' : ''}> With my own calendar</label>
        </fieldset>
        <label class="flabel" for="cal-era">Era name (own calendar only)</label>
        <input class="inp" id="cal-era" name="era" value="${esc(c.era || '')}" placeholder="e.g. AC, or Third Age">
        <label class="flabel" for="cal-months">Months, one per line: name, days</label>
        <textarea class="inp" id="cal-months" name="months" rows="5" placeholder="Frostmoon, 30&#10;Thawing, 31">${esc(months)}</textarea>
        <label class="flabel" for="cal-dpy">Days in a year (if you don't list months)</label>
        <input class="inp" id="cal-dpy" name="dpy" type="number" min="1" value="${esc(c.daysPerYear || 365)}">`,
    });
    if (!r) return;
    const parsed = r.months.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^(.*?)[,;:\s]+(\d+)\s*$/);
      return m ? { name: m[1].trim(), days: Number(m[2]) } : { name: l, days: 30 };
    }).filter(m => m.name && m.days > 0);
    world.calendar = { mode: r.mode === 'custom' ? 'custom' : 'relative', era: r.era.trim(), months: parsed, daysPerYear: Number(r.dpy) || 365 };
    await saveWorld(world);
    toast('Calendar saved.');
    draw();
  }

  draw();
}
