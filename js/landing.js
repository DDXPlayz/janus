// Landing/docs page script: register the service worker, report its state,
// and fill in live numbers from the content catalogue.
import { registerServiceWorker, onSWChange, getSWState } from './net.js';
import { BASE } from './settings.js';

const $ = (s) => document.querySelector(s);

function renderSW(s) {
  const el = $('#sw-state'); if (!el) return;
  const map = { unsupported: 'This browser does not support service workers, so pages cannot be cached; installed packs still work.', registering: 'Registering the offline worker…', installing: 'Saving JANUS for offline use…', ready: 'JANUS is saved on this device and will open without a connection.', updated: 'A newer version of JANUS is ready — reload to update.', error: 'Offline caching could not be enabled here: ' + s.message };
  el.textContent = map[s.status] || s.message;
}
onSWChange(renderSW);
registerServiceWorker().then(() => renderSW(getSWState()));

fetch(BASE + 'content/manifest.json').then((r) => r.json()).then((m) => {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('n-lessons', m.lessons.length); set('n-lessons-2', m.lessons.length); set('n-sims', m.sims.length); set('n-hindi', m.hindi.fullLessons);
}).catch(() => {});

async function cacheReport() {
  const el = $('#cache-report'); if (!el || !('caches' in window)) return;
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith('janus-shell'));
    if (!names.length) { el.textContent = 'App shell not cached yet on this device.'; return; }
    const cache = await caches.open(names[0]);
    const keys = await cache.keys();
    let bytes = 0;
    for (const k of keys) { const r = await cache.match(k); if (r) { try { bytes += (await r.clone().blob()).size; } catch (e) { /* opaque */ } } }
    el.textContent = `Measured on this device: the app shell cache (${names[0]}) holds ${keys.length} files, ${(bytes / 1024).toFixed(0)} KB.`;
  } catch (e) { /* ignore */ }
}
setTimeout(cacheReport, 2500);
onSWChange((s) => { if (s.status === 'ready') setTimeout(cacheReport, 1500); });
