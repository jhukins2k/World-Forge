// World Forge — small shared helpers: escaping, dialogs, toasts, colors, icons.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const LEATHER = [
  { name: 'Oxblood', hex: '#6e2a26' },
  { name: 'Navy', hex: '#2c3a55' },
  { name: 'Forest', hex: '#2f4a3a' },
  { name: 'Plum', hex: '#4a2f45' },
  { name: 'Ochre', hex: '#5a4421' },
  { name: 'Teal', hex: '#2c4a4a' },
  { name: 'Slate', hex: '#3a3f47' },
  { name: 'Umber', hex: '#5b3a24' },
];

export function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#5b3a24'; }
export function safeImage(src) { return typeof src === 'string' && src.startsWith('data:image/') ? src : ''; }

export function colorOptions(selected) {
  return LEATHER.map(c => `<option value="${c.hex}" ${c.hex === selected ? 'selected' : ''}>${c.name}</option>`).join('');
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2800);
}

// A modal dialog with a form. Resolves to the form values, or null if cancelled.
export function openDialog({ title, body, submitLabel = 'Save', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        <div class="dlg-body">${body}</div>
        <div class="dlg-actions">
          <button type="button" class="btn ghost" data-cancel>${esc(cancelLabel)}</button>
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>
        </div>
      </form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    let result = null;
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      result = Object.fromEntries(fd.entries());
      result._all = name => fd.getAll(name);
      d.close();
    });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.showModal();
    const first = d.querySelector('.dlg-body input, .dlg-body select, .dlg-body textarea');
    if (first) first.focus();
  });
}

export async function confirmDialog(message, { title = 'Are you sure?', confirmLabel = 'Delete', danger = true } = {}) {
  const r = await openDialog({ title, body: `<p>${esc(message)}</p>`, submitLabel: confirmLabel, danger });
  return r !== null;
}

export async function promptDialog(title, label, value = '', placeholder = '') {
  const r = await openDialog({
    title,
    body: `<label class="flabel" for="dlg-text">${esc(label)}</label>
           <input class="inp" id="dlg-text" name="text" required maxlength="120" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
  });
  return r ? r.text.trim() : null;
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Shrinks a picked image so it doesn't bloat storage (and later, sync).
export function readImage(file, max = 1000) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export function hashNum(s) {
  let h = 7;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const svg = (body, size = 22) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  quill: svg('<path d="M20 4c-6 1-11 6-13 13l-2 3"/><path d="M9 15c3 0 6-2 8-5"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>'),
  tree: svg('<circle cx="12" cy="4" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 6v6M5 17v-3h14v3"/>'),
  hourglass: svg('<path d="M6 3h12M6 21h12"/><path d="M7 3c0 6 10 6 10 12v6M17 3c0 6-10 6-10 12v6"/>'),
  question: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17v.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>', 18),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 18),
  back: svg('<path d="M15 5l-7 7 7 7"/>', 18),
  left: svg('<path d="M15 5l-7 7 7 7"/>', 16),
  right: svg('<path d="M9 5l7 7-7 7"/>', 16),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>', 16),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 16),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>', 16),
  template: svg('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>', 18),
};
