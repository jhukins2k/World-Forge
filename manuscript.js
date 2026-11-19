// World Forge — Manuscript: the books of a series, their chapters and scenes.

import { esc, $, icons, promptDialog, confirmDialog, toast } from './ui.js';
import {
  state, uid, saveRec, deleteRec, volumesOf, chaptersOf, scenesOf, chapterNumber, chapterRollup,
  entryHref, byOrder,
} from './store.js';
import { plainText, toEditable, fromEditable } from './fields.js';
import { attachMentions } from './mentions.js';
import { pickerHTML, applyPickerEvent } from './pickers.js';
import { dateEditorHTML, readDateEditor, formatDate } from './chrono.js';

export const STATUSES = ['Idea', 'Outlined', 'Drafted', 'Revised', 'Done'];
const statusClass = s => 'st-' + (STATUSES.indexOf(s) >= 0 ? STATUSES.indexOf(s) : 0);
const setStatus = t => { const s = document.getElementById('save-status'); if (s) s.textContent = t; };

function crumbs(world, tail) {
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span>
    <span>${esc(world.name)}</span><span aria-hidden="true">›</span>
    ${tail ? `<a href="#/w/${world.id}/manuscript">Manuscript</a><span aria-hidden="true">›</span><span aria-current="page">${esc(tail)}</span>`
           : '<span aria-current="page">Manuscript</span>'}</nav>`;
}

const name = id => state.entries.get(id)?.name || '';
const link = id => { const e = state.entries.get(id); return e ? `<a href="${entryHref(e)}">${esc(e.name)}</a>` : ''; };

async function reorder(kind, list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) if (list[k].order !== k) { list[k].order = k; await saveRec(kind, list[k]); }
}

// ---------- overview ----------

function presenceGrid(worldId) {
  const vols = volumesOf(worldId);
  const cols = vols.flatMap(v => chaptersOf(v.id).map((c, i) => ({ c, label: (vols.length > 1 ? `${vols.indexOf(v) + 1}.` : '') + (i + 1), r: chapterRollup(c) })));
  if (!cols.length) return '';
  const ids = new Set();
  cols.forEach(({ r }) => { r.people.forEach(x => ids.add(x)); r.places.forEach(x => ids.add(x)); r.items.forEach(x => ids.add(x)); });
  const rows = [...ids].map(id => state.entries.get(id)).filter(Boolean);
  if (!rows.length) return `<section class="panel"><h2 class="panel-h">Who appears where</h2><p class="muted">Add characters, places or items to scenes and they'll show up here, chapter by chapter.</p></section>`;
  const byBook = new Map();
  for (const e of rows) { const b = state.books.get(e.bookId); if (!byBook.has(b)) byBook.set(b, []); byBook.get(b).push(e); }
  const groups = [...byBook.entries()].sort((a, b) => byOrder(a[0] || {}, b[0] || {}));
  return `<section class="panel"><h2 class="panel-h">Who appears where</h2>
    <p class="muted small">Filled squares are chapters an entry appears in; a ring marks a point-of-view chapter. Gaps show who's been off the page.</p>
    <div class="grid-scroll"><table class="presence">
      <thead><tr><th scope="col"><span class="sr-only">Entry</span></th>${cols.map(({ c, label }) => `<th scope="col"><a href="#/w/${worldId}/manuscript/c/${c.id}" title="${esc(c.title || '')}">${label}</a></th>`).join('')}</tr></thead>
      <tbody>${groups.map(([b, list]) => `
        <tr class="pg-group"><th scope="rowgroup" colspan="${cols.length + 1}">${esc(b?.name || 'Other')}</th></tr>
        ${list.sort((x, y) => x.name.localeCompare(y.name)).map(e => `<tr><th scope="row"><a href="${entryHref(e)}">${esc(e.name)}</a></th>
          ${cols.map(({ c, r }) => {
            const on = r.people.has(e.id) || r.places.has(e.id) || r.items.has(e.id);
            const pov = r.povs.has(e.id);
            return `<td>${on ? `<span class="pg-cell ${pov ? 'pov' : ''}" title="${esc(e.name)} in Ch ${chapterNumber(c)}${pov ? ' (POV)' : ''}"></span>` : ''}</td>`;
          }).join('')}</tr>`).join('')}`).join('')}
      </tbody></table></div></section>`;
}

function overview(root, world) {
  const vols = volumesOf(world.id);
  const nCh = vols.reduce((n, v) => n + chaptersOf(v.id).length, 0);
  const nSc = vols.reduce((n, v) => n + chaptersOf(v.id).reduce((m, c) => m + scenesOf(c.id).length, 0), 0);
  root.innerHTML = `<div class="page">
    ${crumbs(world)}
    <div class="page-head"><div>
      <h1 class="h1">Manuscript</h1>
      <p class="lede">${vols.length} ${vols.length === 1 ? 'book' : 'books'} · ${nCh} chapters · ${nSc} scenes</p>
    </div><button type="button" class="btn primary" data-act="new-vol">+ New book in the series</button></div>
    ${vols.length ? '' : '<div class="empty-card"><p>Start with the first book of your series, then add its chapters.</p></div>'}
    ${vols.map((v, vi) => {
      const chs = chaptersOf(v.id);
      return `<section class="panel vol" aria-label="${esc(v.title)}">
        <div class="vol-head">
          <h2 class="vol-title">${esc(v.title)}</h2>
          <div class="btn-row">
            <button type="button" class="icon-btn" data-act="vol-up" data-i="${vi}" ${vi === 0 ? 'disabled' : ''} aria-label="Move ${esc(v.title)} earlier">${icons.up}</button>
            <button type="button" class="icon-btn" data-act="vol-down" data-i="${vi}" ${vi === vols.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(v.title)} later">${icons.down}</button>
            <button type="button" class="btn ghost sm" data-act="vol-rename" data-id="${v.id}">Rename</button>
            <button type="button" class="btn ghost sm" data-act="vol-delete" data-id="${v.id}">Delete</button>
          </div>
        </div>
        <label class="flabel" for="vs-${v.id}">Summary</label>
        <textarea class="inp sm" id="vs-${v.id}" rows="2" data-vol-summary="${v.id}" placeholder="What this book is about">${esc(v.summary || '')}</textarea>
        ${chs.length ? `<ol class="ch-list">${chs.map((c, ci) => {
          const sc = scenesOf(c.id).length;
          return `<li class="ch-row">
            <a class="ch-link" href="#/w/${world.id}/manuscript/c/${c.id}">
              <span class="ch-num">${ci + 1}</span>
              <span class="ch-main"><span class="ch-title">${esc(c.title || 'Untitled chapter')}</span>
                <span class="ch-sub">${c.pov ? `POV: ${esc(name(c.pov))} · ` : ''}${sc} ${sc === 1 ? 'scene' : 'scenes'}${c.date && formatDate(c.date, world) ? ' · ' + esc(formatDate(c.date, world)) : ''}${c.summary ? ' · ' + esc(plainText(c.summary).slice(0, 90)) + (plainText(c.summary).length > 90 ? '…' : '') : ''}</span></span>
              <span class="status ${statusClass(c.status)}">${esc(c.status || 'Idea')}</span>
            </a>
            <span class="ch-move">
              <button type="button" class="icon-btn" data-act="ch-up" data-vol="${v.id}" data-i="${ci}" ${ci === 0 ? 'disabled' : ''} aria-label="Move chapter ${ci + 1} earlier">${icons.up}</button>
              <button type="button" class="icon-btn" data-act="ch-down" data-vol="${v.id}" data-i="${ci}" ${ci === chs.length - 1 ? 'disabled' : ''} aria-label="Move chapter ${ci + 1} later">${icons.down}</button>
            </span>
          </li>`;
        }).join('')}</ol>` : '<p class="muted">No chapters yet.</p>'}
        <button type="button" class="btn ghost dashed" data-act="new-ch" data-vol="${v.id}">+ New chapter</button>
      </section>`;
    }).join('')}
    ${presenceGrid(world.id)}
  </div>`;

  let t = null;
  root.oninput = e => {
    const id = e.target.dataset.volSummary;
    if (!id) return;
    const v = state.volumes.get(id);
    v.summary = e.target.value;
    setStatus('Saving…'); clearTimeout(t); t = setTimeout(() => saveRec('volumes', v), 500);
  };
  root.onclick = async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'new-vol') {
      const title = await promptDialog('New book in the series', 'Title', `Book ${vols.length + 1}`);
      if (!title) return;
      await saveRec('volumes', { id: uid(), worldId: world.id, title, summary: '', order: vols.length });
    }
    if (act === 'vol-rename') {
      const v = state.volumes.get(btn.dataset.id);
      const title = await promptDialog('Rename book', 'Title', v.title);
      if (!title) return;
      v.title = title; await saveRec('volumes', v);
    }
    if (act === 'vol-delete') {
      const v = state.volumes.get(btn.dataset.id);
      const n = chaptersOf(v.id).length;
      if (!await confirmDialog(`Delete “${v.title}” and its ${n} chapters (and their scenes)? This can't be undone.`, { title: 'Delete this book?', confirmLabel: 'Delete book' })) return;
      await deleteRec('volumes', v.id);
    }
    if (act === 'vol-up' || act === 'vol-down') await reorder('volumes', vols, Number(btn.dataset.i), act === 'vol-up' ? -1 : 1);
    if (act === 'ch-up' || act === 'ch-down') await reorder('chapters', chaptersOf(btn.dataset.vol), Number(btn.dataset.i), act === 'ch-up' ? -1 : 1);
    if (act === 'new-ch') {
      const chs = chaptersOf(btn.dataset.vol);
      const title = await promptDialog(`New chapter ${chs.length + 1}`, 'Chapter title (you can change it later)', '', 'e.g. The Lake');
      if (title === null) return;
      const c = { id: uid(), worldId: world.id, volumeId: btn.dataset.vol, title, status: 'Idea', order: chs.length, summary: '' };
      await saveRec('chapters', c);
      location.hash = `#/w/${world.id}/manuscript/c/${c.id}`;
      return;
    }
    overview(root, world);
  };
}

// ---------- chapter page ----------

function sceneCard(s, i, n, worldId, open) {
  return `<details class="scene" data-scene="${s.id}" ${open ? 'open' : ''}>
    <summary>
      <span class="sc-num">${i + 1}</span>
      <span class="sc-title">${esc(s.title || 'Untitled scene')}</span>
      <span class="sc-meta">${s.location ? esc(name(s.location)) : ''}</span>
      <span class="status ${statusClass(s.status)}">${esc(s.status || 'Idea')}</span>
    </summary>
    <div class="sc-body">
      <div class="sc-grid">
        <div class="sc-wide"><label class="flabel" for="st-${s.id}">Scene title</label>
          <input class="inp" id="st-${s.id}" data-sk="title" value="${esc(s.title || '')}"></div>
        <div><label class="flabel" for="ss-${s.id}">Status</label>
          <select class="inp" id="ss-${s.id}" data-sk="status">${STATUSES.map(x => `<option ${x === (s.status || 'Idea') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      </div>
      <div class="sc-grid">
        ${pickerHTML('pov', s.pov, { worldId, single: true, label: 'Point of view', placeholder: '+ Choose POV…' })}
        ${pickerHTML('location', s.location, { worldId, single: true, label: 'Location', placeholder: '+ Choose a place…' })}
      </div>
      ${pickerHTML('characters', s.characters, { worldId, label: 'Characters present', placeholder: '+ Add a character…' })}
      ${pickerHTML('items', s.items, { worldId, label: 'Items or artifacts involved', placeholder: '+ Add an item…' })}
      <div class="sc-grid three">
        <div><label class="flabel" for="sg-${s.id}">Goal</label><textarea class="inp sm" id="sg-${s.id}" rows="2" data-sk="goal" data-mention>${esc(toEditable(s.goal, worldId))}</textarea></div>
        <div><label class="flabel" for="sc-${s.id}">Conflict</label><textarea class="inp sm" id="sc-${s.id}" rows="2" data-sk="conflict" data-mention>${esc(toEditable(s.conflict, worldId))}</textarea></div>
        <div><label class="flabel" for="so-${s.id}">Outcome</label><textarea class="inp sm" id="so-${s.id}" rows="2" data-sk="outcome" data-mention>${esc(toEditable(s.outcome, worldId))}</textarea></div>
      </div>
      <label class="flabel" for="sm-${s.id}">What happens</label>
      <textarea class="inp" id="sm-${s.id}" rows="4" data-sk="summary" data-mention>${esc(toEditable(s.summary, worldId))}</textarea>
      <div class="sc-actions">
        <button type="button" class="btn ghost sm" data-act="sc-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>${icons.up} Earlier</button>
        <button type="button" class="btn ghost sm" data-act="sc-down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''}>${icons.down} Later</button>
        <button type="button" class="btn danger-ghost sm" data-act="sc-delete" data-id="${s.id}">${icons.trash} Delete scene</button>
      </div>
    </div>
  </details>`;
}

function chapterPage(root, world, ch, openScenes = new Set()) {
  const vol = state.volumes.get(ch.volumeId);
  const chs = chaptersOf(ch.volumeId);
  const idx = chs.findIndex(c => c.id === ch.id);
  const scenes = scenesOf(ch.id);
  const roll = chapterRollup(ch);
  const rollList = (set, label) => set.size ? `<div class="roll"><h3 class="roll-h">${label}</h3><div class="chips">${[...set].map(id => {
    const e = state.entries.get(id); return e ? `<a class="chip dark" href="${entryHref(e)}">${esc(e.name)}${roll.povs.has(id) ? ' · POV' : ''}</a>` : '';
  }).join('')}</div></div>` : '';

  root.innerHTML = `<div class="page wide">
    ${crumbs(world, `Ch ${idx + 1}`)}
    <div class="book-layout">
      <aside class="toc" aria-label="${esc(vol.title)} chapters">
        <div class="toc-head"><span class="toc-swatch" style="background:#1f2a24" aria-hidden="true"></span>
          <a class="toc-title" href="#/w/${world.id}/manuscript">${esc(vol.title)}</a></div>
        <ol class="toc-list numbered">${chs.map((c, i) => `<li><a href="#/w/${world.id}/manuscript/c/${c.id}" ${c.id === ch.id ? 'aria-current="page" class="on"' : ''}>
          <span class="tn">${i + 1}</span> ${esc(c.title || 'Untitled')}</a></li>`).join('')}</ol>
      </aside>
      <div class="book-main"><div class="entry-wrap">
        <form class="parchment editing" autocomplete="off" onsubmit="return false">
          <div class="edit-bar"><span class="edit-note">Chapter ${idx + 1} of ${chs.length} · changes save as you type</span>
            <span class="btn-row">
              ${idx > 0 ? `<a class="btn ghost sm" href="#/w/${world.id}/manuscript/c/${chs[idx - 1].id}">${icons.left} Ch ${idx}</a>` : ''}
              ${idx < chs.length - 1 ? `<a class="btn ghost sm" href="#/w/${world.id}/manuscript/c/${chs[idx + 1].id}">Ch ${idx + 2} ${icons.right}</a>` : ''}
            </span></div>
          <label class="flabel" for="c-title">Chapter title</label>
          <input class="inp big" id="c-title" data-ck="title" value="${esc(ch.title || '')}" placeholder="Untitled chapter">
          <div class="sc-grid">
            <div><label class="flabel" for="c-status">Status</label>
              <select class="inp" id="c-status" data-ck="status">${STATUSES.map(x => `<option ${x === (ch.status || 'Idea') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
            <div><label class="flabel" for="c-words">Word count</label>
              <input class="inp" id="c-words" type="number" min="0" data-ck="words" value="${esc(ch.words ?? '')}"></div>
          </div>
          <div class="chapter-pov">${pickerHTML('pov', ch.pov, { worldId: world.id, single: true, label: 'Point of view', placeholder: '+ Choose POV…' })}</div>
          <div class="date-block">
            <span class="flabel">When in your world</span>
            ${dateEditorHTML('c-date', ch.date, world, { allowRelative: true, excludeEventId: null })}
          </div>
          <label class="flabel" for="c-summary">Summary</label>
          <textarea class="inp" id="c-summary" rows="5" data-ck="summary" data-mention>${esc(toEditable(ch.summary, world.id))}</textarea>
          <div class="hint">Type @ to link an entry</div>
          <label class="flabel" for="c-reveals">Reveals and secrets introduced</label>
          <textarea class="inp" id="c-reveals" rows="3" data-ck="reveals" data-mention>${esc(toEditable(ch.reveals, world.id))}</textarea>
          <label class="flabel" for="c-notes">Notes</label>
          <textarea class="inp" id="c-notes" rows="3" data-ck="notes" data-mention>${esc(toEditable(ch.notes, world.id))}</textarea>

          <h2 class="sec scenes-h">Scenes</h2>
          <div class="scenes">${scenes.map((s, i) => sceneCard(s, i, scenes.length, world.id, openScenes.has(s.id))).join('')}</div>
          <button type="button" class="btn ghost dashed" data-act="sc-new">+ Add a scene</button>

          <div class="danger-zone"><button type="button" class="btn danger-ghost" data-act="ch-delete">${icons.trash} Delete this chapter</button></div>
        </form>
        <aside class="side" aria-label="In this chapter">
          <div class="side-card">
            <h2 class="side-h">In this chapter</h2>
            ${rollList(roll.people, 'Characters')}${rollList(roll.places, 'Places')}${rollList(roll.items, 'Items')}
            ${roll.people.size + roll.places.size + roll.items.size ? '' : '<p class="muted small">Add characters, places and items to the scenes and they gather here automatically.</p>'}
          </div>
        </aside>
      </div></div>
    </div>
  </div>`;

  attachMentions(root, world.id);
  const dirty = new Map(); // id -> [kind, record]
  let timer = null;
  const flush = async () => {
    clearTimeout(timer); timer = null;
    for (const [, [kind, rec]] of dirty) await saveRec(kind, rec);
    dirty.clear();
    setStatus('Saved on this device');
  };
  const touch = (kind, rec) => { dirty.set(rec.id, [kind, rec]); setStatus('Saving…'); clearTimeout(timer); timer = setTimeout(flush, 500); };
  window.addEventListener('hashchange', () => { if (timer) flush(); }, { once: true });
  const openNow = () => new Set([...root.querySelectorAll('details.scene[open]')].map(d => d.dataset.scene));
  const redraw = async () => { await flush(); chapterPage(root, world, state.chapters.get(ch.id), openNow()); };
  const sceneOf = el => { const d = el.closest('details.scene'); return d ? state.scenes.get(d.dataset.scene) : null; };
  const TEXT = ['summary', 'reveals', 'notes', 'goal', 'conflict', 'outcome'];

  root.oninput = e => {
    const el = e.target;
    if (el.closest('.date-ed')) { ch.date = readDateEditor(root, 'c-date'); return touch('chapters', ch); }
    if (el.dataset.ck) {
      const k = el.dataset.ck;
      ch[k] = k === 'words' ? (el.value === '' ? '' : Number(el.value)) : TEXT.includes(k) ? fromEditable(el.value, world.id) : el.value;
      if (k === 'title') { const a = root.querySelector('.toc-list a.on'); if (a) a.innerHTML = `<span class="tn">${idx + 1}</span> ${esc(el.value || 'Untitled')}`; }
      return touch('chapters', ch);
    }
    if (el.dataset.sk) {
      const s = sceneOf(el); const k = el.dataset.sk;
      s[k] = TEXT.includes(k) ? fromEditable(el.value, world.id) : el.value;
      if (k === 'title') el.closest('details').querySelector('.sc-title').textContent = el.value || 'Untitled scene';
      return touch('scenes', s);
    }
  };
  root.onchange = async e => {
    const el = e.target;
    if (el.closest('.date-ed')) { ch.date = readDateEditor(root, 'c-date'); touch('chapters', ch); if (el.tagName === 'SELECT') redraw(); return; }
    if (el.dataset.ck === 'status') return;
    if (el.dataset.sk === 'status') { const s = sceneOf(el); s.status = el.value; touch('scenes', s); return redraw(); }
    if (el.dataset.pickAdd) {
      const s = sceneOf(el);
      const rec = s || ch;
      if (applyPickerEvent(e, rec, ['pov', 'location'])) { touch(s ? 'scenes' : 'chapters', rec); redraw(); }
    }
  };
  root.onclick = async e => {
    const pr = e.target.closest('[data-pick-remove]');
    if (pr) {
      const s = sceneOf(pr); const rec = s || ch;
      if (applyPickerEvent(e, rec, ['pov', 'location'])) { touch(s ? 'scenes' : 'chapters', rec); redraw(); }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'sc-new') {
      const s = { id: uid(), worldId: world.id, chapterId: ch.id, title: '', status: 'Idea', order: scenes.length, characters: [], items: [] };
      await saveRec('scenes', s);
      await flush();
      chapterPage(root, world, ch, new Set([...openNow(), s.id]));
      root.querySelector(`#st-${s.id}`)?.focus();
      return;
    }
    if (act === 'sc-up' || act === 'sc-down') { await flush(); await reorder('scenes', scenesOf(ch.id), Number(btn.dataset.i), act === 'sc-up' ? -1 : 1); return redraw(); }
    if (act === 'sc-delete') {
      const s = state.scenes.get(btn.dataset.id);
      if (!await confirmDialog(`Delete the scene “${s.title || 'Untitled scene'}”? This can't be undone.`, { title: 'Delete this scene?', confirmLabel: 'Delete scene' })) return;
      dirty.delete(s.id);
      await deleteRec('scenes', s.id);
      for (const [k, x] of scenesOf(ch.id).entries()) if (x.order !== k) { x.order = k; await saveRec('scenes', x); }
      return redraw();
    }
    if (act === 'ch-delete') {
      if (!await confirmDialog(`Delete chapter ${idx + 1}${ch.title ? ` “${ch.title}”` : ''} and its ${scenes.length} scenes? This can't be undone.`, { title: 'Delete this chapter?', confirmLabel: 'Delete chapter' })) return;
      clearTimeout(timer); timer = null; dirty.clear();
      await deleteRec('chapters', ch.id);
      for (const [k, x] of chaptersOf(ch.volumeId).entries()) if (x.order !== k) { x.order = k; await saveRec('chapters', x); }
      toast('Chapter deleted.');
      location.hash = `#/w/${world.id}/manuscript`;
    }
  };
}

export function render(root, { worldId, chapterId }) {
  const world = state.worlds.get(worldId);
  if (!world) { root.innerHTML = '<div class="page"><h1 class="h1">Not found</h1></div>'; return; }
  if (chapterId) {
    const ch = state.chapters.get(chapterId);
    if (!ch || !state.volumes.get(ch.volumeId)) { root.innerHTML = `<div class="page"><h1 class="h1">Chapter not found</h1><p><a href="#/w/${worldId}/manuscript">Back to the Manuscript</a></p></div>`; return; }
    return chapterPage(root, world, ch);
  }
  overview(root, world);
}
