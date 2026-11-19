// World Forge — GitHub sync. Keeps a copy of every world in a private GitHub repository,
// one small file per record, so several devices can share the same Library.
//
// How it decides what to do with each file, comparing this device, GitHub, and the last sync:
//   unchanged here, changed on GitHub  → take GitHub's version
//   changed here, unchanged on GitHub  → send this device's version
//   changed in both places             → a conflict: you choose, field by field
// Deleting something is just another kind of change, so deletions travel too.

import { esc, $, icons, toast, confirmDialog } from './ui.js';
import { state, KINDS, putRaw, dropRaw, notifySaved } from './store.js';
import * as db from './db.js';

const CFG_KEY = 'wf-sync';
const ROOT = 'world-forge/';

export function getConfig() {
  try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return c && c.owner && c.repo && c.token ? c : null; } catch { return null; }
}
function setConfig(c) { c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY); }

async function getBase() { return (await db.get('meta', 'sync-base')) || { id: 'sync-base', files: {}, lastSync: null }; }
async function setBase(b) { await db.put('meta', b); }

// ---------- helpers ----------

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
const serialize = rec => JSON.stringify(canonical(rec), null, 1) + '\n';

async function gitSha(text) {
  const bytes = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const h = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const pathOf = (kind, id) => `${ROOT}${kind}/${id}.json`;
function parsePath(p) {
  const m = p.match(/^world-forge\/([a-z]+)\/([^/]+)\.json$/);
  return m && KINDS.includes(m[1]) ? { kind: m[1], id: m[2] } : null;
}

class GitHubError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

function api(cfg) {
  const base = (cfg.apiBase || 'https://api.github.com').replace(/\/$/, '');
  const repo = `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  return async (method, path, body) => {
    let res;
    try {
      res = await fetch(base + (path.startsWith('/repos') || path === '/user' ? path : repo + path), {
        method,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new GitHubError('Could not reach GitHub. Check your internet connection.', 0);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = res.status === 401 ? 'GitHub did not accept the token. It may have expired or been typed wrong.'
        : res.status === 403 ? 'The token does not have permission. It needs “Contents: Read and write” on this repository.'
        : res.status === 404 ? 'Repository not found. Check the owner and name, and that the token can see it.'
        : data.message || `GitHub error ${res.status}`;
      throw new GitHubError(msg, res.status);
    }
    return data;
  };
}

async function localFiles() {
  const out = new Map();
  for (const kind of KINDS) {
    for (const rec of state[kind].values()) {
      const text = serialize(rec);
      out.set(pathOf(kind, rec.id), { text, sha: await gitSha(text), rec, kind });
    }
  }
  return out;
}

export async function unsyncedCount() {
  if (!getConfig()) return null;
  const base = await getBase();
  const local = await localFiles();
  let n = 0;
  for (const [p, f] of local) if (base.files[p] !== f.sha) n++;
  for (const p of Object.keys(base.files)) if (!local.has(p)) n++;
  return n;
}

// ---------- the sync itself ----------

async function remoteHead(gh, cfg, log) {
  try {
    const ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(cfg.branch || 'main')}`);
    const commit = await gh('GET', `/git/commits/${ref.object.sha}`);
    const tree = await gh('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
    const files = new Map();
    for (const t of tree.tree || []) if (t.type === 'blob' && t.path.startsWith(ROOT) && parsePath(t.path)) files.set(t.path, t.sha);
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha, files };
  } catch (err) {
    if (err.status === 404 || err.status === 409) {
      // Empty repository (no commits yet): create a first file so there is a branch to work on.
      log('Setting up the repository for the first time…');
      await gh('PUT', `/contents/${ROOT}README.md`, {
        message: 'Set up World Forge sync',
        content: b64encode('# World Forge data\n\nThis folder is written by the World Forge app. Edit your worlds in the app, not here.\n'),
        branch: cfg.branch || 'main',
      });
      return remoteHead(gh, cfg, () => {});
    }
    throw err;
  }
}

// Works out what needs doing. Downloads GitHub's version of anything that changed there.
export async function planSync(log = () => {}) {
  const cfg = getConfig();
  if (!cfg) throw new Error('Sync is not set up yet.');
  const gh = api(cfg);
  log('Checking GitHub…');
  const head = await remoteHead(gh, cfg, log);
  const base = await getBase();
  const local = await localFiles();
  const paths = new Set([...local.keys(), ...head.files.keys(), ...Object.keys(base.files)]);
  const plan = { head, pulls: [], pushes: [], conflicts: [], same: [] };
  for (const p of paths) {
    const L = local.get(p)?.sha || null, R = head.files.get(p) || null, B = base.files[p] || null;
    if (L === R) { plan.same.push({ path: p, sha: L }); continue; }
    if (L === B) plan.pulls.push({ path: p, sha: R });
    else if (R === B) plan.pushes.push({ path: p, local: local.get(p) || null });
    else plan.conflicts.push({ path: p, local: local.get(p) || null, remoteSha: R });
  }
  const need = [...plan.pulls.filter(x => x.sha), ...plan.conflicts.filter(x => x.remoteSha).map(x => ({ path: x.path, sha: x.remoteSha }))];
  if (need.length) log(`Downloading ${need.length} changed ${need.length === 1 ? 'file' : 'files'}…`);
  const fetched = new Map();
  let i = 0;
  const worker = async () => {
    while (i < need.length) {
      const it = need[i++];
      const blob = await gh('GET', `/git/blobs/${it.sha}`);
      fetched.set(it.path, JSON.parse(b64decode(blob.content)));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const x of plan.pulls) x.remote = x.sha ? fetched.get(x.path) : null;
  for (const x of plan.conflicts) x.remote = x.remoteSha ? fetched.get(x.path) : null;
  return plan;
}

// Applies the plan. `choices` maps a conflict path to the record to keep (or null to delete).
export async function applySync(plan, choices = new Map(), log = () => {}) {
  const cfg = getConfig();
  const gh = api(cfg);
  const base = await getBase();
  const newBase = { ...base.files };
  for (const s of plan.same) { if (s.sha) newBase[s.path] = s.sha; else delete newBase[s.path]; }

  // 1. Bring GitHub's changes onto this device.
  for (const x of plan.pulls) {
    const { kind, id } = parsePath(x.path);
    if (x.remote) { await putRaw(kind, x.remote); newBase[x.path] = x.sha; }
    else { await dropRaw(kind, id); delete newBase[x.path]; }
  }

  // 2. Conflicts: save the chosen version here, and send it to GitHub too.
  const toPush = plan.pushes.map(x => ({ path: x.path, text: x.local?.text ?? null }));
  for (const c of plan.conflicts) {
    const { kind, id } = parsePath(c.path);
    const keep = choices.has(c.path) ? choices.get(c.path) : c.local?.rec ?? null;
    if (keep) { await putRaw(kind, keep); toPush.push({ path: c.path, text: serialize(keep) }); }
    else { await dropRaw(kind, id); toPush.push({ path: c.path, text: null }); }
  }

  // 3. Send this device's changes to GitHub as one commit.
  if (toPush.length) {
    log(`Sending ${toPush.length} ${toPush.length === 1 ? 'change' : 'changes'} to GitHub…`);
    const tree = await gh('POST', '/git/trees', {
      base_tree: plan.head.treeSha,
      tree: toPush.map(x => x.text == null
        ? { path: x.path, mode: '100644', type: 'blob', sha: null }
        : { path: x.path, mode: '100644', type: 'blob', content: x.text }),
    });
    const commit = await gh('POST', '/git/commits', {
      message: `World Forge sync: ${toPush.length} ${toPush.length === 1 ? 'change' : 'changes'}`,
      tree: tree.sha,
      parents: [plan.head.commitSha],
    });
    try {
      await gh('PATCH', `/git/refs/heads/${encodeURIComponent(cfg.branch || 'main')}`, { sha: commit.sha, force: false });
    } catch (err) {
      if (err.status === 422) throw new GitHubError('Another device synced at the same moment. Press Sync again.', 422);
      throw err;
    }
    for (const x of toPush) {
      if (x.text == null) delete newBase[x.path];
      else newBase[x.path] = await gitSha(x.text);
    }
  }
  await setBase({ id: 'sync-base', files: newBase, lastSync: new Date().toISOString() });
  notifySaved();
  return { pulled: plan.pulls.length, pushed: toPush.length };
}

// ---------- conflict screen ----------

function recordTitle(kind, rec) {
  if (!rec) return '(deleted)';
  return rec.name || rec.title || (kind === 'relations' ? 'Family link' : rec.id);
}

function plainValue(v) {
  if (v == null || v === '') return '<span class="muted">empty</span>';
  if (Array.isArray(v)) return esc(v.map(x => typeof x === 'object' ? (state.entries.get(x.id)?.name ? `${state.entries.get(x.id).name}${x.note ? ` (${x.note})` : ''}` : x.text || x.value || JSON.stringify(x)) : x).join(', ')) || '<span class="muted">empty</span>';
  if (typeof v === 'object') return esc(JSON.stringify(v));
  const s = String(v).replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1');
  return esc(s.length > 400 ? s.slice(0, 400) + '…' : s).replace(/\n/g, '<br>');
}

const same = (x, y) => JSON.stringify(canonical(x)) === JSON.stringify(canonical(y));
const KIND_WORD = { worlds: 'world', books: 'book', entries: 'entry', volumes: 'manuscript book', chapters: 'chapter', scenes: 'scene', events: 'timeline event', maps: 'map', relations: 'family link' };

// The keys that differ between two versions of a record, with readable labels.
function diffKeys(kind, a, b) {
  const skip = new Set(['updatedAt', 'createdAt', 'id']);
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    if (kind === 'entries' && k === 'values') {
      const book = state.books.get(a?.bookId || b?.bookId);
      const vk = new Set([...Object.keys(a?.values || {}), ...Object.keys(b?.values || {})]);
      for (const f of vk) {
        if (same(a?.values?.[f], b?.values?.[f]) === false) {
          out.push({ key: `values.${f}`, label: book?.fields.find(x => x.id === f)?.label || 'Field', a: a?.values?.[f], b: b?.values?.[f] });
        }
      }
      continue;
    }
    if (!same(a?.[k], b?.[k])) out.push({ key: k, label: k[0].toUpperCase() + k.slice(1), a: a?.[k], b: b?.[k] });
  }
  return out;
}

function conflictHTML(c, i) {
  const { kind } = parsePath(c.path);
  const mine = c.local?.rec || null, theirs = c.remote || null;
  const head = `<h3 class="cf-title">${esc(recordTitle(kind, mine || theirs))} <span class="muted small">· ${esc(KIND_WORD[kind] || kind)}</span></h3>`;
  if (!mine || !theirs) {
    return `<div class="cf" data-cf="${i}">${head}
      <p>${!mine ? 'Deleted on this device, but changed on GitHub.' : 'Changed on this device, but deleted on GitHub.'}</p>
      <div class="cf-whole">
        <label class="check"><input type="radio" name="cf-${i}" value="mine" checked> ${!mine ? 'Keep it deleted' : "Keep this device's version"}</label>
        <label class="check"><input type="radio" name="cf-${i}" value="theirs"> ${!theirs ? 'Delete it' : "Keep GitHub's version"}</label>
      </div></div>`;
  }
  const keys = diffKeys(kind, mine, theirs);
  return `<div class="cf" data-cf="${i}">${head}
    <p class="muted small">Changed on both devices. For each difference, pick which to keep. The rest of the record is the same.</p>
    <div class="cf-table">
      <div class="cf-row cf-headrow"><span></span><span>This device</span><span>GitHub</span></div>
      ${keys.map((k, j) => `<div class="cf-row">
        <span class="cf-label">${esc(k.label)}</span>
        <label class="cf-opt"><input type="radio" name="cf-${i}-${j}" value="mine" checked><span>${plainValue(k.a)}</span></label>
        <label class="cf-opt"><input type="radio" name="cf-${i}-${j}" value="theirs"><span>${plainValue(k.b)}</span></label>
      </div>`).join('') || '<p class="muted small">Only timestamps differ.</p>'}
    </div></div>`;
}

function readChoices(root, plan) {
  const out = new Map();
  plan.conflicts.forEach((c, i) => {
    const { kind } = parsePath(c.path);
    const mine = c.local?.rec || null, theirs = c.remote || null;
    if (!mine || !theirs) {
      const v = root.querySelector(`input[name="cf-${i}"]:checked`)?.value || 'mine';
      out.set(c.path, v === 'mine' ? mine : theirs);
      return;
    }
    const merged = structuredClone(mine);
    diffKeys(kind, mine, theirs).forEach((k, j) => {
      const pick = root.querySelector(`input[name="cf-${i}-${j}"]:checked`)?.value || 'mine';
      if (pick !== 'theirs') return;
      if (k.key.startsWith('values.')) {
        const f = k.key.slice(7);
        merged.values ||= {};
        if (k.b === undefined) delete merged.values[f]; else merged.values[f] = structuredClone(k.b);
      } else if (k.b === undefined) delete merged[k.key];
      else merged[k.key] = structuredClone(k.b);
    });
    merged.updatedAt = new Date().toISOString();
    out.set(c.path, merged);
  });
  return out;
}

// ---------- page ----------

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return new Date(iso).toLocaleDateString();
}

export async function render(root, { auto } = {}) {
  const cfg = getConfig();
  const base = await getBase();
  let busy = false;

  if (!cfg) {
    root.innerHTML = `<div class="page narrow">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><a href="#/settings">Settings</a><span aria-hidden="true">›</span><span aria-current="page">GitHub sync</span></nav>
      <h1 class="h1">Set up GitHub sync</h1>
      <p class="lede">Sync keeps every device's Library the same, with a private copy of your worlds on GitHub.</p>
      <section class="panel">
        <h2 class="panel-h">1. A private repository</h2>
        <p>On github.com, create a new repository (for example <strong>world-forge-data</strong>). Make it <strong>Private</strong> so only you can read your story. Ticking “Add a README” is fine.</p>
      </section>
      <section class="panel">
        <h2 class="panel-h">2. An access token</h2>
        <ol class="steps">
          <li>On github.com, click your picture → <strong>Settings</strong> → <strong>Developer settings</strong> (bottom of the left menu) → <strong>Personal access tokens</strong> → <strong>Fine-grained tokens</strong> → <strong>Generate new token</strong>.</li>
          <li>Name it “World Forge” and pick an expiration (a year is reasonable).</li>
          <li>Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick your data repository.</li>
          <li>Under <strong>Permissions → Repository permissions</strong>, set <strong>Contents</strong> to <strong>Read and write</strong>.</li>
          <li>Click <strong>Generate token</strong> and copy it. Paste it below. Don't share it anywhere else; it works like a password for that one repository.</li>
        </ol>
      </section>
      <form class="panel" data-form="setup" autocomplete="off">
        <h2 class="panel-h">3. Connect</h2>
        <div class="bs-grid">
          <div><label class="flabel" for="sy-owner">GitHub username</label><input class="inp" id="sy-owner" name="owner" required placeholder="your username" autocapitalize="off" spellcheck="false"></div>
          <div><label class="flabel" for="sy-repo">Repository name</label><input class="inp" id="sy-repo" name="repo" required value="world-forge-data" autocapitalize="off" spellcheck="false"></div>
          <div><label class="flabel" for="sy-branch">Branch</label><input class="inp" id="sy-branch" name="branch" value="main" autocapitalize="off" spellcheck="false"></div>
        </div>
        <label class="flabel" for="sy-token">Access token</label>
        <input class="inp" id="sy-token" name="token" type="password" required autocomplete="off" spellcheck="false" placeholder="github_pat_…">
        <p class="hint">The token is saved only in this browser on this device. Set it up once on each device you use.</p>
        <div id="sy-msg" class="sy-msg" role="status"></div>
        <button type="submit" class="btn primary">Connect and test</button>
      </form>
    </div>`;
    root.onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      const c = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', token: f.token.value.trim() };
      const prev = getConfig();
      if (prev?.apiBase) c.apiBase = prev.apiBase;
      const test = localStorage.getItem('wf-api-base'); if (test) c.apiBase = test;
      const msg = $('#sy-msg', root);
      msg.textContent = 'Testing the connection…';
      try {
        const info = await api(c)('GET', `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`);
        if (!info.private && !await confirmDialog('This repository is public, so anyone could read your worlds. Make it private on GitHub (Settings → General → Danger Zone → Change visibility) before syncing. Connect anyway?', { title: 'Public repository', confirmLabel: 'Connect anyway', danger: true })) { msg.textContent = ''; return; }
        if (info.permissions && !info.permissions.push) throw new Error('The token can read this repository but not write to it. Set Contents to “Read and write”.');
        setConfig(c);
        await setBase({ id: 'sync-base', files: {}, lastSync: null });
        toast('Connected to GitHub.');
        render(root, { auto: true });
      } catch (err) { msg.textContent = err.message; }
    };
    return;
  }

  const pending = await unsyncedCount();
  root.innerHTML = `<div class="page narrow">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><a href="#/settings">Settings</a><span aria-hidden="true">›</span><span aria-current="page">GitHub sync</span></nav>
    <div class="page-head"><div>
      <h1 class="h1">GitHub sync</h1>
      <p class="lede">Connected to <strong>${esc(cfg.owner)}/${esc(cfg.repo)}</strong> · last synced ${esc(timeAgo(base.lastSync))}</p>
    </div><button type="button" class="btn primary" data-act="sync">Sync now</button></div>
    <section class="panel"><p id="sy-state">${pending ? `${pending} ${pending === 1 ? 'change' : 'changes'} on this device not yet on GitHub.` : 'Everything on this device is on GitHub.'}</p>
      <ul class="sy-log" id="sy-log" aria-live="polite"></ul></section>
    <div id="sy-conflicts"></div>
    <section class="panel">
      <h2 class="panel-h">Good habits</h2>
      <ul class="steps">
        <li>Sync when you sit down to write, and again before you stop.</li>
        <li>On a new device, connect sync <em>before</em> adding anything, then sync to pull your worlds down. Don't import the same backup on two devices.</li>
      </ul>
    </section>
    <section class="panel danger-panel">
      <h2 class="panel-h">Disconnect</h2>
      <p class="muted">Forgets the token on this device. Your worlds stay here and on GitHub.</p>
      <button type="button" class="btn danger-ghost" data-act="disconnect">Disconnect this device</button>
    </section>
  </div>`;

  const logEl = $('#sy-log', root);
  const log = t => { const li = document.createElement('li'); li.textContent = t; logEl.appendChild(li); };

  async function run() {
    if (busy) return;
    busy = true;
    logEl.innerHTML = '';
    const btn = root.querySelector('[data-act="sync"]');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      const plan = await planSync(log);
      if (plan.conflicts.length) {
        log(`${plan.conflicts.length} ${plan.conflicts.length === 1 ? 'thing was' : 'things were'} changed on both devices. Choose what to keep below.`);
        const box = $('#sy-conflicts', root);
        box.innerHTML = `<section class="panel cf-panel"><h2 class="panel-h">Changed in both places</h2>
          ${plan.conflicts.map(conflictHTML).join('')}
          <div class="btn-row"><button type="button" class="btn primary" data-act="resolve">Keep my choices and finish syncing</button>
          <button type="button" class="btn ghost" data-act="cancel">Cancel</button></div></section>`;
        box.onclick = async e => {
          const a = e.target.closest('[data-act]')?.dataset.act;
          if (a === 'cancel') { box.innerHTML = ''; log('Sync cancelled. Nothing was changed.'); }
          if (a === 'resolve') {
            const choices = readChoices(box, plan);
            box.innerHTML = '';
            await finish(plan, choices);
          }
        };
        box.scrollIntoView({ behavior: 'smooth' });
      } else {
        await finish(plan, new Map());
      }
    } catch (err) {
      log(err.message);
      toast(err.message);
    }
    busy = false;
    btn.disabled = false; btn.textContent = 'Sync now';
  }

  async function finish(plan, choices) {
    try {
      const r = await applySync(plan, choices, log);
      const msg = !r.pulled && !r.pushed ? 'Already in sync.' : `Synced: ${r.pulled} from GitHub, ${r.pushed} to GitHub.`;
      log(msg); toast(msg);
      $('#sy-state', root).textContent = 'Everything on this device is on GitHub.';
      root.querySelector('.lede').innerHTML = `Connected to <strong>${esc(cfg.owner)}/${esc(cfg.repo)}</strong> · last synced just now`;
      refreshHeader();
    } catch (err) { log(err.message); toast(err.message); }
  }

  root.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'sync') run();
    if (act === 'disconnect') {
      if (!await confirmDialog('Disconnect this device from GitHub sync? Your worlds stay on this device and on GitHub.', { title: 'Disconnect sync?', confirmLabel: 'Disconnect' })) return;
      setConfig(null);
      await setBase({ id: 'sync-base', files: {}, lastSync: null });
      refreshHeader();
      render(root);
    }
  };
  if (auto) run();
}

// ---------- header button & reminders ----------

let headerTimer = null;
export function refreshHeader() {
  clearTimeout(headerTimer);
  headerTimer = setTimeout(async () => {
    const btn = document.getElementById('sync-btn');
    const status = document.getElementById('save-status');
    if (!btn) return;
    const cfg = getConfig();
    btn.hidden = false;
    btn.setAttribute('href', cfg ? '#/sync/now' : '#/sync');
    const n = await unsyncedCount();
    btn.classList.toggle('has-changes', !!n);
    btn.querySelector('.sync-n').textContent = n ? String(n) : '';
    btn.setAttribute('aria-label', cfg ? (n ? `Sync now, ${n} unsynced changes` : 'Sync now') : 'Set up GitHub sync');
    if (status && cfg) status.textContent = n ? `${n} unsynced ${n === 1 ? 'change' : 'changes'}` : 'Synced';
  }, 600);
}

export async function startupReminder() {
  if (!getConfig()) return;
  const base = await getBase();
  if (!base.lastSync || Date.now() - new Date(base.lastSync) > 6 * 3600 * 1000) {
    toast('Tip: sync first to pick up changes from your other devices.');
  }
}
