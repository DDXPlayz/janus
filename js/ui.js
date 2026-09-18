// Shared UI helpers for the JANUS app.
import { getSetting, setSettings } from './settings.js';
import { escapeHtml, SUBJECT_META, plainText } from './content.js';
import { ICON } from './illustrations.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const esc = escapeHtml;

export function html(str) {
  const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content;
}
export function el(str) { return html(str).firstElementChild; }

export function toast(msg, kind = '', ms = 3800) {
  const box = $('#toasts'); if (!box) return;
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.setAttribute('role', 'status'); t.textContent = msg;
  box.appendChild(t); setTimeout(() => t.remove(), ms);
}

export function setTitle(t) { document.title = (t ? t + ' — ' : '') + 'JANUS'; }
export function navigate(hash) { if (location.hash !== hash) location.hash = hash; else window.dispatchEvent(new HashChangeEvent('hashchange')); }

export function levelBadge(level) { return `<span class="badge ${String(level).toLowerCase()}">${esc(level)}</span>`; }
export function subjectBadge(subject) { const m = SUBJECT_META[subject]; return `<span class="badge ${subject}">${esc(m ? m.name : subject)}</span>`; }

export function fmtDate(ts) {
  if (!ts) return 'never';
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(ts).toISOString(); }
}
export function fmtAgo(ts) {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.round(d / 60000) + ' min ago';
  if (d < 86400000) return Math.round(d / 3600000) + ' h ago';
  return fmtDate(ts);
}

/** Toggle switch button with aria-checked. onChange(bool). */
export function switchRow({ label, hint, checked, onChange, id, warn }) {
  const row = el(`<div class="switch"><span class="lab" id="${id}-lab">${esc(label)}${hint ? `<span class="hint">${hint}</span>` : ''}</span><button type="button" class="toggle" role="switch" aria-checked="${checked ? 'true' : 'false'}" aria-labelledby="${id}-lab" id="${id}"></button></div>`);
  const btn = row.querySelector('button');
  btn.addEventListener('click', () => { const v = btn.getAttribute('aria-checked') !== 'true'; btn.setAttribute('aria-checked', v ? 'true' : 'false'); onChange(v); });
  return row;
}

// ---------- Text-to-speech ----------
export const speech = {
  get supported() { return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; },
  current: null,
  speak(text, lang = 'en', onEnd) {
    if (!this.supported) return false;
    this.stop();
    const u = new SpeechSynthesisUtterance(plainText(text));
    u.lang = lang === 'hi' ? 'hi-IN' : 'en-GB';
    u.rate = Number(getSetting('ttsRate')) || 1;
    try {
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(lang === 'hi' ? 'hi' : 'en'));
      if (v) u.voice = v;
    } catch (e) { /* ignore */ }
    u.onend = () => { this.current = null; if (onEnd) onEnd(); };
    u.onerror = () => { this.current = null; if (onEnd) onEnd(); };
    this.current = u;
    speechSynthesis.speak(u);
    return true;
  },
  stop() { if (this.supported) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } this.current = null; },
};

/** Play/stop buttons for a piece of text. */
export function ttsControls(getText, getLang) {
  const wrap = el(`<span class="tts-bar"><button type="button" class="btn ghost small" aria-pressed="false">${ICON.speaker}<span>Read aloud</span></button></span>`);
  const btn = wrap.querySelector('button');
  if (!speech.supported) { btn.disabled = true; btn.title = 'Read-aloud is not available in this browser (no speechSynthesis).'; btn.querySelector('span').textContent = 'Read-aloud unavailable'; return wrap; }
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-pressed') === 'true') { speech.stop(); btn.setAttribute('aria-pressed', 'false'); btn.querySelector('span').textContent = 'Read aloud'; return; }
    $$('.tts-bar button[aria-pressed="true"]').forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.querySelector('span').textContent = 'Read aloud'; });
    btn.setAttribute('aria-pressed', 'true'); btn.querySelector('span').textContent = 'Stop reading';
    speech.speak(getText(), getLang ? getLang() : 'en', () => { btn.setAttribute('aria-pressed', 'false'); btn.querySelector('span').textContent = 'Read aloud'; });
  });
  return wrap;
}

/** Measure web-font bytes once they have loaded (resource timing), for the low-bandwidth estimate. */
export function measureFontBytes() {
  try {
    if (getSetting('fontBytesMeasured') > 0 || getSetting('lowBandwidth')) return;
    // Only count actual font files (fonts.gstatic.com) with a real transfer size; the CSS alone is ~1 KB and would understate savings.
    const entries = performance.getEntriesByType('resource').filter((e) => /fonts\.gstatic\.com/.test(e.name));
    const bytes = entries.reduce((a, e) => a + (e.transferSize || 0), 0);
    if (bytes > 10240) setSettings({ fontBytesMeasured: bytes });
  } catch (e) { /* ignore */ }
}

export function confirmDialog(msg) { try { return window.confirm(msg); } catch (e) { return false; } }

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return blob.size;
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); });
    document.body.appendChild(input); input.click();
  });
}
