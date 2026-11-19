// World Forge — settings: backups, storage safety, installing, about.

import { esc, download, toast } from './ui.js';
import { state, exportData, importData } from './store.js';
import { APP_VERSION, installState } from './config.js';

export async function render(root) {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const usedMb = est ? (est.usage / 1048576).toFixed(1) : null;

  root.innerHTML = `<div class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Library</a><span aria-hidden="true">›</span><span aria-current="page">Settings</span></nav>
    <div class="page-head"><div><h1 class="h1">Settings</h1>
      <p class="lede">${state.worlds.size} ${state.worlds.size === 1 ? 'world' : 'worlds'}, ${state.entries.size} entries, saved in this browser on this device.</p></div></div>

    <section class="panel" aria-labelledby="gs-h">
      <h2 class="panel-h" id="gs-h">GitHub sync</h2>
      <p class="muted">Keep the same Library on every device, with a private copy of your worlds on GitHub.</p>
      <a class="btn ghost" href="#/sync">Open GitHub sync</a>
    </section>

    <section class="panel" aria-labelledby="bk-h">
      <h2 class="panel-h" id="bk-h">Backups</h2>
      <p class="muted">A backup file is a complete copy of your Library in one file. Even with sync on, download one now and then and keep it somewhere safe.</p>
      <div class="btn-row">
        <button type="button" class="btn primary" data-act="export">Download a full backup</button>
        <label class="btn ghost file-btn">Restore or import a backup…
          <input type="file" accept=".json,application/json" class="sr-only" data-act="import">
        </label>
      </div>
      <p class="hint">Importing adds the file's worlds to your Library. Anything with the same ID is replaced by the version in the file.</p>
    </section>

    <section class="panel" aria-labelledby="st-h">
      <h2 class="panel-h" id="st-h">Storage</h2>
      <p>${persisted === true ? 'Protected: this browser has agreed not to clear World Forge\'s data to free up space.'
        : persisted === false ? 'Not yet protected. Browsers can clear website data when the device runs low on space. Installing the app usually protects it too.'
        : 'This browser does not say whether the data is protected.'}${usedMb ? ` Using about ${usedMb} MB.` : ''}</p>
      ${persisted === false ? '<button type="button" class="btn ghost" data-act="persist">Ask the browser to protect my data</button>' : ''}
    </section>

    <section class="panel" aria-labelledby="in-h">
      <h2 class="panel-h" id="in-h">Install as an app</h2>
      <p class="muted">${installState.installed ? 'World Forge is running as an installed app.'
        : installState.prompt ? 'Install World Forge to get its own window and icon, and to use it offline.'
        : 'In Chrome or Edge on a computer, use the install icon at the right end of the address bar. On iPhone, tap Share → Add to Home Screen. On Android, open the ⋮ menu → Install app.'}</p>
      ${installState.prompt ? '<button type="button" class="btn primary" data-act="install">Install World Forge</button>' : ''}
    </section>

    <section class="panel" aria-labelledby="ab-h">
      <h2 class="panel-h" id="ab-h">About</h2>
      <p class="muted">World Forge ${esc(APP_VERSION)}. Everything is stored in this browser; GitHub sync keeps your devices in step.</p>
    </section>
  </div>`;

  root.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') {
      download(`world-forge-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportData(), null, 2));
      toast('Backup downloaded.');
    }
    if (act === 'persist') {
      const ok = await navigator.storage.persist();
      toast(ok ? 'Your data is now protected.' : 'The browser said no for now. Installing the app usually helps.');
      render(root);
    }
    if (act === 'install' && installState.prompt) {
      installState.prompt.prompt();
      await installState.prompt.userChoice;
      installState.prompt = null;
      render(root);
    }
  };
  root.onchange = async e => {
    if (e.target.dataset.act !== 'import' || !e.target.files[0]) return;
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const c = await importData(data);
      const parts = [['worlds', 'world'], ['books', 'book'], ['entries', 'entry'], ['chapters', 'chapter'], ['scenes', 'scene'], ['events', 'event'], ['maps', 'map']]
        .filter(([k]) => c[k]).map(([k, one]) => `${c[k]} ${c[k] === 1 ? one : k}`);
      toast(`Imported ${parts.join(', ') || 'nothing new'}.`);
      location.hash = '#/';
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file isn\'t valid JSON.' : err.message);
    }
    e.target.value = '';
  };
}
