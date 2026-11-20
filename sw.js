// World Forge — offline support. Each version's files are saved together as one set, and the app is
// always served from a complete set, so old and new files never mix. A new version arrives only when
// this file changes: bump CACHE (and APP_VERSION in config.js) with every release.
const CACHE = 'world-forge-v0.3.0';
const FONTS = 'world-forge-fonts';
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'style.css',
  'app.js', 'config.js', 'db.js', 'store.js', 'ui.js', 'fields.js', 'mentions.js', 'templates.js', 'pickers.js', 'chrono.js',
  'library.js', 'book.js', 'template.js', 'questions.js', 'settings.js',
  'manuscript.js', 'chronicle.js', 'atlas.js', 'lineage.js', 'sync.js',
  'engine/index.js', 'engine/editor.js', 'engine/state.js', 'engine/renderer.js', 'engine/camera.js', 'engine/terrain.js',
  'engine/models.js', 'engine/noise.js', 'engine/codec.js', 'engine/types.js',
  'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('world-forge-v') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: use the saved copy, refresh it quietly.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    }));
    return;
  }
  if (url.origin !== self.location.origin) return; // GitHub sync calls always go to the network

  // App files: only ever from this version's complete set (never refreshed one by one).
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await c.match('index.html')) || fetch(req);
    return fetch(req);
  }));
});
