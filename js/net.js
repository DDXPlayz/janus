// Connection state + service-worker registration state for JANUS.
//
// Connection: navigator.onLine + online/offline events + a periodic HEAD
// request to our own content manifest (never a third party) to confirm real
// reachability. A "Simulate offline" setting overrides everything and is
// labelled as a simulation in the UI.

import { BASE, getSetting, onSettingsChange } from './settings.js';

const PING_URL = BASE + 'content/manifest.json';
const PING_INTERVAL = 30000;

const state = {
  browserOnline: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  reachable: null,       // null = unknown, true/false once a ping has run
  lastPingAt: null,
  simulated: !!getSetting('simulateOffline'),
};

const listeners = new Set();
function emit() { for (const fn of listeners) { try { fn(getConnection()); } catch (e) { console.error(e); } } }

export function getConnection() {
  const online = !state.simulated && state.browserOnline && state.reachable !== false;
  return {
    online,
    simulated: state.simulated,
    browserOnline: state.browserOnline,
    reachable: state.reachable,
    lastPingAt: state.lastPingAt,
    label: state.simulated ? 'OFFLINE (simulated)' : (online ? 'ONLINE' : 'OFFLINE'),
    detail: state.simulated
      ? 'Simulated by the "Simulate offline" setting — the real connection is not being used.'
      : (!state.browserOnline ? 'The browser reports no network connection.'
        : (state.reachable === false ? 'The network is up but JANUS could not reach its own server.'
          : (state.reachable === null ? 'Checking reachability…' : 'Connected; the JANUS server answered a check.'))),
  };
}

export function isOnline() { return getConnection().online; }

export function onConnectionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Fetch that honours the simulated-offline setting (the service worker serves cache only). */
export function netFetch(url, opts = {}) {
  if (state.simulated) {
    const u = new URL(url, location.href);
    u.searchParams.set('simoffline', '1');
    return fetch(u.toString(), opts);
  }
  return fetch(url, opts);
}

let pingTimer = null;
let pingInFlight = false;

export async function ping() {
  if (state.simulated || pingInFlight) return getConnection();
  pingInFlight = true;
  const before = getConnection().online;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
    const res = await fetch(PING_URL + '?ping=' + Date.now(), { method: 'HEAD', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (timer) clearTimeout(timer);
    state.reachable = res.ok || res.status === 405 || res.status === 501; // some static servers reject HEAD; that still proves reachability
  } catch (e) {
    state.reachable = false;
  } finally {
    pingInFlight = false;
    state.lastPingAt = Date.now();
  }
  if (getConnection().online !== before || state.reachable !== null) emit();
  return getConnection();
}

export function startConnectionMonitor() {
  window.addEventListener('online', () => { state.browserOnline = true; emit(); ping(); });
  window.addEventListener('offline', () => { state.browserOnline = false; state.reachable = null; emit(); });
  onSettingsChange((s, patch) => {
    if ('simulateOffline' in patch) {
      state.simulated = !!s.simulateOffline;
      emit();
      if (!state.simulated) ping();
    }
  });
  ping();
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => { if (document.visibilityState !== 'hidden') ping(); }, PING_INTERVAL);
}

// ---------------- Service worker ----------------

const sw = {
  supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  status: 'unsupported',   // unsupported | registering | installing | waiting | ready | updated | error
  message: '',
  registration: null,
  version: null,
  updateAvailable: false,
  controlled: false,
};
const swListeners = new Set();
function emitSW() { for (const fn of swListeners) { try { fn(getSWState()); } catch (e) { console.error(e); } } }

export function getSWState() { return { ...sw, registration: undefined }; }
export function onSWChange(fn) { swListeners.add(fn); return () => swListeners.delete(fn); }

export async function registerServiceWorker() {
  if (!sw.supported) { sw.status = 'unsupported'; sw.message = 'Service workers are not supported here, so pages will not be cached for offline use. Installed packs still work from IndexedDB.'; emitSW(); return null; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    sw.status = 'error'; sw.message = 'Service workers need HTTPS (or localhost). Offline caching is disabled on this origin.'; emitSW(); return null;
  }
  sw.status = 'registering'; sw.message = 'Registering the offline worker…'; emitSW();
  try {
    const reg = await navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE });
    sw.registration = reg;
    sw.controlled = !!navigator.serviceWorker.controller;
    const track = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => refresh(reg));
    };
    track(reg.installing); track(reg.waiting); track(reg.active);
    reg.addEventListener('updatefound', () => { track(reg.installing); refresh(reg); });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      sw.controlled = true;
      if (sw.reloadOnControl) { sw.reloadOnControl = false; location.reload(); }
      refresh(reg);
    });
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'VERSION') { sw.version = d.version; emitSW(); }
    });
    refresh(reg);
    askVersion();
    // Check for a newer sw.js periodically while the app is open.
    setInterval(() => { try { reg.update(); } catch (e) { /* ignore */ } }, 60 * 60 * 1000);
    return reg;
  } catch (e) {
    sw.status = 'error'; sw.message = 'The offline worker could not be registered: ' + (e && e.message ? e.message : e); emitSW();
    return null;
  }
}

function refresh(reg) {
  const hasController = !!navigator.serviceWorker.controller;
  if (reg.waiting && hasController) {
    sw.status = 'updated'; sw.updateAvailable = true;
    sw.message = 'A new version of JANUS has been downloaded. Reload to update.';
  } else if (reg.installing) {
    sw.status = 'installing'; sw.updateAvailable = false;
    sw.message = hasController ? 'Downloading an update in the background…' : 'Installing: saving the app shell for offline use…';
  } else if (reg.waiting && !hasController) {
    sw.status = 'installing'; sw.message = 'Installed; will take control on next load.';
  } else if (reg.active) {
    sw.status = 'ready'; sw.updateAvailable = false;
    sw.message = hasController ? 'Ready: the app shell is cached and this page is served offline-first.' : 'Ready: cached. Reload once for offline-first serving.';
  }
  sw.controlled = hasController;
  emitSW();
}

export function applyUpdate() {
  const reg = sw.registration;
  if (reg && reg.waiting) {
    sw.reloadOnControl = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    location.reload();
  }
}

export function askVersion() {
  try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }); } catch (e) { /* ignore */ }
}

/** Ask the active service worker to cache a list of same-origin URLs. Resolves with {cached, failed}. */
export function cacheUrls(urls) {
  return new Promise((resolve) => {
    if (!sw.supported || !navigator.serviceWorker.controller) { resolve({ cached: 0, failed: urls.length, reason: 'no active service worker' }); return; }
    let done = false;
    const chan = new MessageChannel();
    chan.port1.onmessage = (ev) => { done = true; resolve(ev.data || { cached: 0, failed: urls.length }); };
    setTimeout(() => { if (!done) resolve({ cached: 0, failed: urls.length, reason: 'timeout' }); }, 20000);
    try { navigator.serviceWorker.controller.postMessage({ type: 'CACHE_URLS', urls }, [chan.port2]); } catch (e) { resolve({ cached: 0, failed: urls.length, reason: String(e) }); }
  });
}

export function uncacheUrls(urls) {
  try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'UNCACHE_URLS', urls }); } catch (e) { /* ignore */ }
}
