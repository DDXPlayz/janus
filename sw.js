/* JANUS service worker — scope /hackathon/janus/
   Precaches the app shell, serves same-origin requests cache-first with
   network fallback, caches Google Fonts at runtime (cache-first), and cleans
   old caches on activate. Content packs ask it to cache their assets. */

const VERSION = '1.0.0';
const SHELL_CACHE = 'janus-shell-v' + VERSION;
const CONTENT_CACHE = 'janus-content-v1';
const FONT_CACHE = 'janus-fonts-v1';
const KEEP = new Set([SHELL_CACHE, CONTENT_CACHE, FONT_CACHE]);
const BASE = '/hackathon/janus/';

const SHELL = [
  '', 'index.html', 'app/', 'app/index.html', 'docs/', 'docs/index.html',
  'janus.css', 'favicon.svg', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/settings.js', 'js/db.js', 'js/net.js', 'js/sync.js', 'js/content.js', 'js/retrieval.js',
  'js/tutor.js', 'js/packs.js', 'js/progress.js', 'js/sims.js', 'js/illustrations.js', 'js/landing.js', 'js/ui.js', 'js/views-learn.js', 'js/views-manage.js',
  'content/manifest.json',
].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Add one by one so a single missing file does not fail the whole install.
    await Promise.all(SHELL.map(async (url) => {
      try { const res = await fetch(url, { cache: 'no-cache' }); if (res.ok) await cache.put(url, res); } catch (e) { /* skipped */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('janus-') && !KEEP.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.postMessage({ type: 'VERSION', version: VERSION }));
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'GET_VERSION') { if (event.source) event.source.postMessage({ type: 'VERSION', version: VERSION }); return; }
  if (data.type === 'CACHE_URLS') {
    const port = event.ports && event.ports[0];
    event.waitUntil((async () => {
      const cache = await caches.open(CONTENT_CACHE);
      let cached = 0, failed = 0;
      for (const url of data.urls || []) {
        try { const res = await fetch(url, { cache: 'no-cache' }); if (res.ok) { await cache.put(url, res); cached++; } else failed++; } catch (e) { failed++; }
      }
      if (port) port.postMessage({ cached, failed });
    })());
    return;
  }
  if (data.type === 'UNCACHE_URLS') {
    event.waitUntil((async () => { const cache = await caches.open(CONTENT_CACHE); for (const url of data.urls || []) await cache.delete(url); })());
  }
});

function stripParams(url) {
  const u = new URL(url);
  u.searchParams.delete('simoffline'); u.searchParams.delete('ping');
  return u.toString();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);

  // Reachability pings must always hit the network.
  if (url.searchParams.has('ping')) { event.respondWith(fetch(req).catch(() => new Response('', { status: 503 }))); return; }

  // Simulated offline: answer from cache only, never from the network.
  if (url.searchParams.has('simoffline')) {
    event.respondWith((async () => {
      const key = stripParams(req.url);
      const hit = await caches.match(key, { ignoreSearch: false }) || await caches.match(key, { ignoreSearch: true });
      return hit || new Response(JSON.stringify({ error: 'simulated offline: not in cache' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    })());
    return;
  }

  // Google Fonts: cache-first at runtime. Opaque responses are fine to cache.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }
      catch (e) { return new Response('', { status: 503 }); }
    })());
    return;
  }

  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  // Same-origin, in scope: cache-first with network fallback; store new responses.
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) {
      // Refresh the shell in the background so an update is picked up next load.
      if (SHELL.includes(url.pathname) || SHELL.includes(url.pathname.replace(/\/$/, '') + '/')) {
        event.waitUntil(fetch(req).then((res) => { if (res.ok) return caches.open(SHELL_CACHE).then((c) => c.put(req, res)); }).catch(() => {}));
      }
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok && req.method === 'GET') {
        const cacheName = url.pathname.includes('/content/') ? CONTENT_CACHE : SHELL_CACHE;
        const cache = await caches.open(cacheName);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      if (req.mode === 'navigate') {
        const fallback = await caches.match(BASE + 'app/index.html') || await caches.match(BASE + 'index.html');
        if (fallback) return fallback;
      }
      return new Response('Offline and not cached.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
