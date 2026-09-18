// JANUS app: boot, hash router, header (connection state, status strip),
// tutor panel, and wiring between modules.
import { applySettings, getSetting, setSettings, onSettingsChange } from './settings.js';
import { idbAvailable } from './db.js';
import { loadCatalogue, getCatalogue, escapeHtml } from './content.js';
import { startConnectionMonitor, getConnection, onConnectionChange, registerServiceWorker, getSWState, onSWChange, applyUpdate, isOnline } from './net.js';
import { syncEngine } from './sync.js';
import { tutor } from './tutor.js';
import { ICON } from './illustrations.js';
import { $, $$, el, html, esc, toast, navigate, fmtAgo, measureFontBytes, speech } from './ui.js';
import * as learn from './views-learn.js';
import * as manage from './views-manage.js';

const NAV = [
  ['#/library', 'Library', '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M2.5 3h4v10h-4zM9.5 3h4v10h-4zM4.5 6h0M11.5 6h0"/></svg>'],
  ['#/sims', 'Sims', '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><ellipse cx="8" cy="8" rx="6.5" ry="3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/></svg>'],
  ['#/packs', 'Packs', ICON.download],
  ['#/notebook', 'Notebook', '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 2.5h8.5v11H4zM4 5.5h-1.5M4 8h-1.5M4 10.5h-1.5M6.5 6h4M6.5 9h3"/></svg>'],
  ['#/settings', 'Settings', '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1"/></svg>'],
];

const ROUTES = [
  [/^#\/library/, learn.library],
  [/^#\/lesson\/([\w-]+)/, learn.lesson, ['id']],
  [/^#\/quiz\/([\w-]+)/, learn.quiz, ['id']],
  [/^#\/problems\/([\w-]+)/, learn.problems, ['id']],
  [/^#\/sims/, learn.sims],
  [/^#\/sim\/([\w-]+)/, learn.sim, ['key']],
  [/^#\/packs/, manage.packs],
  [/^#\/notebook/, manage.notebook],
  [/^#\/settings/, manage.settings],
];

export const app = {
  tutor,
  online: () => isOnline(),
  openTutor() { setTutor(true); },
  askTutor(text) { setTutor(true); ask(text); },
  renderTutorHistory,
};

let cleanup = [];
let currentHash = '';

async function route() {
  const raw = location.hash || getSetting('lastView') || '#/library';
  if (!raw.startsWith('#/')) { location.replace('#/library'); return; }
  // "#/lesson/id#s2?x" → path, fragment, query
  const m = raw.match(/^(#\/[^#?]*)(?:\?([^#]*))?(?:#([\w-]+))?$/);
  const path = m ? m[1] : raw, query = new URLSearchParams(m && m[2] ? m[2] : ''), fragment = m ? m[3] : '';
  const view = $('#view');
  for (const fn of cleanup) { try { fn && fn(); } catch (e) { /* ignore */ } }
  cleanup = [];
  speech.stop();
  let handler = null, params = {};
  for (const [re, fn, names] of ROUTES) { const mm = path.match(re); if (mm) { handler = fn; (names || []).forEach((n, i) => { params[n] = mm[i + 1]; }); break; } }
  if (!handler) { view.innerHTML = '<div class="notice warn">Page not found. <a href="#/library">Go to the library</a>.</div>'; return; }
  $$('#app-nav a').forEach((a) => { const on = path.startsWith(a.getAttribute('href')) || (a.getAttribute('href') === '#/library' && /^#\/(lesson|quiz|problems)/.test(path)) || (a.getAttribute('href') === '#/sims' && path.startsWith('#/sim/')); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  setSettings({ lastView: raw });
  const ctx = { view, params, query, fragment, app, cleanup };
  try { await handler(ctx); } catch (e) { console.error(e); view.innerHTML = `<div class="notice err"><p><strong>Something went wrong rendering this page.</strong> ${esc(e.message || e)}</p><p><a href="#/library">Back to the library</a></p></div>`; }
  if (!fragment && currentHash !== raw) { window.scrollTo({ top: 0, behavior: 'auto' }); }
  currentHash = raw;
  if (!fragment) view.focus({ preventScroll: true });
}

// ---------- header pieces ----------
function renderNav() {
  $('#app-nav').innerHTML = NAV.map(([h, label, icon]) => `<a href="${h}">${icon}<span>${label}</span></a>`).join('');
}

function renderConn(c) {
  const box = $('#conn');
  const cls = c.simulated ? 'simulated' : (c.online ? 'online' : 'offline');
  box.className = 'conn ' + cls;
  box.innerHTML = (c.simulated ? ICON.simulated : (c.online ? ICON.online : ICON.offline)) + '<span>' + esc(c.label) + '</span>';
  box.title = c.detail;
  box.setAttribute('aria-label', 'Connection: ' + c.label + '. ' + c.detail);
}

let stripSeq = 0;
async function renderStrip() {
  const seq = ++stripSeq;
  const sw = getSWState();
  const s = await syncEngine.status();
  if (seq !== stripSeq) return; // a newer render is in flight
  const strip = $('#status-strip');
  strip.innerHTML = `<span><span class="dot ${esc(sw.status)}" aria-hidden="true"></span><strong>Offline worker:</strong> ${esc(sw.status)}${sw.version ? ' v' + esc(sw.version) : ''} — ${esc(sw.message)} ${sw.updateAvailable ? '<button type="button" class="link" id="strip-update">Reload to update</button>' : ''}</span>
    <span><strong>Sync:</strong> ${s.queued} queued · last ${esc(fmtAgo(s.lastSyncedAt))} · target: ${esc(s.targetName)} (no server connected) ${s.queued && s.online ? '<button type="button" class="link" id="strip-sync">Sync now</button>' : ''}</span>`;
  const u = $('#strip-update'); if (u) u.addEventListener('click', applyUpdate);
  const y = $('#strip-sync'); if (y) y.addEventListener('click', () => syncEngine.syncNow('manual'));
}

// ---------- tutor panel ----------
let tutorOpen = false;
function setTutor(open) {
  tutorOpen = open;
  const panel = $('#tutor-panel'); const body = $('#app-body'); const btn = $('#tutor-toggle');
  panel.hidden = !open; body.classList.toggle('tutor-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { renderTutorHistory(); setTimeout(() => $('#tutor-input').focus(), 50); } else btn.focus();
}

const CHIPS = [['Explain this in simpler language', 'explain this in simpler language'], ['Explain in Hindi', 'explain in Hindi'], ['Harder problem', 'give me a harder problem'], ['Easier problem', 'give me an easier problem'], ['Quiz me', 'quiz me'], ['What is a mole?', 'what is a mole'], ['Help', 'help']];
function renderChips() {
  $('#tutor-chips').innerHTML = CHIPS.map(([l, q]) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(l)}</button>`).join('');
  $$('#tutor-chips .chip').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
}

function msgEl(role, entry) {
  if (role === 'user') return el(`<div class="msg user"><p>${esc(entry.text)}</p></div>`);
  const conf = entry.confidence && entry.confidence !== 'high' ? `<span class="conf ${esc(entry.confidence)}">${entry.confidence === 'none' ? 'No match' : entry.confidence === 'low' ? 'Weak match' : 'Partial match'}</span> ` : '';
  const src = entry.source ? `<div class="src">${conf}Source: <a href="${esc(entry.source.hash)}">${esc(entry.source.title)}</a>${entry.note ? ' · ' + esc(entry.note) : ''}</div>` : (entry.note || conf ? `<div class="src">${conf}${esc(entry.note || '')}</div>` : '');
  return el(`<div class="msg tutor">${entry.html}${src}</div>`);
}

async function renderTutorHistory() {
  const log = $('#tutor-log'); log.innerHTML = '';
  const hist = await tutor.history();
  if (!hist.length) log.appendChild(el(`<div class="msg tutor"><p>I am the local tutor. I search the lessons downloaded to this device — nothing leaves your phone, and I am not an AI model. Ask about a topic, or use the buttons above.</p><p class="small muted">${(await tutor.ready, tutor.installed.size)} lessons installed.</p></div>`));
  else hist.slice(-40).forEach((e) => log.appendChild(msgEl(e.role, e)));
  log.scrollTop = log.scrollHeight;
}

let asking = false;
async function ask(text) {
  if (asking || !text) return;
  asking = true;
  const log = $('#tutor-log'); const input = $('#tutor-input');
  log.appendChild(msgEl('user', { text })); log.scrollTop = log.scrollHeight; input.value = '';
  const thinking = el('<div class="msg tutor muted"><p>Searching your packs…</p></div>'); log.appendChild(thinking);
  try {
    const r = await tutor.ask(text);
    thinking.remove(); log.appendChild(msgEl('tutor', r)); log.scrollTop = log.scrollHeight;
    if (r.navigate) navigate(r.navigate);
  } catch (e) { thinking.remove(); log.appendChild(el(`<div class="msg tutor"><p>Sorry — something went wrong: ${esc(e.message || e)}</p></div>`)); console.error(e); }
  asking = false;
}

// ---------- boot ----------
async function boot() {
  applySettings();
  renderNav(); renderChips();
  $('#tutor-toggle').addEventListener('click', () => setTutor(!tutorOpen));
  $('#tutor-close').addEventListener('click', () => setTutor(false));
  $('#tutor-form').addEventListener('submit', (e) => { e.preventDefault(); ask($('#tutor-input').value.trim()); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tutorOpen) setTutor(false); });
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('#tutor-log a[href^="#/"]'); if (a && window.matchMedia('(max-width: 900px)').matches) setTutor(false); });

  if (!idbAvailable()) toast('IndexedDB is not available in this browser: packs and progress cannot be saved.', 'err', 8000);
  try { await loadCatalogue(); } catch (e) {
    $('#view').innerHTML = `<div class="notice err"><p><strong>The lesson catalogue could not be loaded</strong> (${esc(e.message)}). If this is the first visit, a connection is needed once to save JANUS for offline use.</p></div>`;
    return;
  }
  renderConn(getConnection());
  onConnectionChange((c) => { renderConn(c); renderStrip(); });
  startConnectionMonitor();
  onSWChange((s) => { renderStrip(); if (s.status === 'updated') toast('A new version of JANUS is ready. Use “Reload to update” in the status bar.', '', 6000); });
  registerServiceWorker();
  syncEngine.onChange(renderStrip);
  syncEngine.start();
  await tutor.rebuild(getCatalogue().lessons);
  onSettingsChange((s, patch) => { if ('language' in patch || 'readingLevel' in patch) { /* views re-render on navigation */ } });
  window.addEventListener('hashchange', route);
  renderStrip();
  await route();
  setTimeout(measureFontBytes, 3000);
  if (!getSetting('onboarded')) { setSettings({ onboarded: true }); toast('Welcome. Start in Packs to download lessons to this device.', '', 6000); }
}

boot();
