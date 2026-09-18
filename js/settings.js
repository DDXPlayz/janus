// JANUS settings — persisted in localStorage under `janus:v1`.
// Every storage access is wrapped in try/catch: the app must work even when
// storage is unavailable (private mode, quota exceeded, blocked).

export const STORAGE_KEY = 'janus:v1';
export const BASE = '/hackathon/janus/';
export const APP_VERSION = '1.0.0';

const DEFAULTS = Object.freeze({
  readingLevel: 'standard',   // 'standard' | 'simple'
  language: 'en',             // 'en' | 'hi'
  lowBandwidth: false,
  dyslexia: false,
  dyslexiaFont: false,
  highContrast: false,
  reducedMotion: false,
  textScale: 1,               // 0.9 .. 1.4
  simulateOffline: false,
  ttsRate: 1,
  fontBytesMeasured: 0,       // measured once fonts have loaded over the network
  illustrationBytesSaved: 0,  // bytes of inline SVG not rendered in low-bandwidth mode
  lastView: '#/library',
  onboarded: false,
});

let cache = null;
const listeners = new Set();

export function loadSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) || {};
  } catch (e) { stored = {}; }
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

export function getSetting(key) {
  return loadSettings()[key];
}

export function setSettings(patch) {
  const s = loadSettings();
  Object.assign(s, patch);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
  applySettings();
  for (const fn of listeners) { try { fn(s, patch); } catch (e) { console.error(e); } }
  return s;
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Apply presentation settings to the document (classes + root font size). */
export function applySettings() {
  const s = loadSettings();
  const root = document.documentElement;
  root.classList.toggle('lb', !!s.lowBandwidth);
  root.classList.toggle('dyslexia', !!s.dyslexia);
  root.classList.toggle('dyslexia-font', !!s.dyslexiaFont);
  root.classList.toggle('hc', !!s.highContrast);
  root.classList.toggle('rm', !!s.reducedMotion);
  root.style.fontSize = (Math.round(s.textScale * 100)) + '%';
  root.setAttribute('lang', s.language === 'hi' ? 'hi' : 'en');
}

export function prefersReducedMotion() {
  const s = loadSettings();
  if (s.reducedMotion) return true;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

export function resetSettings() {
  cache = { ...DEFAULTS };
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  applySettings();
  for (const fn of listeners) { try { fn(cache, {}); } catch (e) { /* ignore */ } }
}
