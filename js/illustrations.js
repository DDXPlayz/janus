// Hand-drawn-feeling inline SVG line art for JANUS. All decorative SVGs are
// aria-hidden; the lesson JSON carries a text description (illustration_alt)
// that is shown instead in low-bandwidth mode and read by screen readers.

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const WORDMARK = `<svg class="wordmark-svg" viewBox="0 0 44 40" width="44" height="40" aria-hidden="true" focusable="false">
  <path ${S} d="M6 6 h14 a2 2 0 0 1 2 2 v26 a2 2 0 0 1 -2 2 h-14 a2 2 0 0 1 -2 -2 v-26 a2 2 0 0 1 2 -2 z"/>
  <path ${S} d="M22 8 a2 2 0 0 1 2 -2 h14 a2 2 0 0 1 2 2 v26 a2 2 0 0 1 -2 2 h-14 a2 2 0 0 1 -2 -2"/>
  <path ${S} stroke-width="1.2" d="M8 13 h10 M8 18 h10 M8 23 h7"/>
  <path ${S} stroke-width="1.2" d="M26 12 c3 -3 7 -3 10 0 M26 20 c3 3 7 3 10 0"/>
  <circle cx="29" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="35" cy="16" r="1" fill="currentColor" stroke="none"/>
</svg>`;

const art = {
  motion: `<path ${S} d="M6 60 H114"/><path ${S} d="M28 48 h28 l8 -10 h14 l6 10 h6 v12 h-62 z"/><circle ${S} cx="40" cy="62" r="5"/><circle ${S} cx="80" cy="62" r="5"/><path ${S} d="M92 34 h20 m-5 -5 l5 5 l-5 5"/><path ${S} stroke-dasharray="3 4" d="M10 40 h14"/><text x="96" y="26" font-size="9" fill="currentColor" font-family="inherit">v</text>`,
  forces: `<path ${S} d="M20 70 H110"/><rect ${S} x="42" y="42" width="34" height="28" rx="2"/><path ${S} d="M76 56 h26 m-5 -5 l5 5 l-5 5"/><path ${S} d="M42 56 h-16 m5 -5 l-5 5 l5 5"/><path ${S} d="M59 42 v-20 m-5 5 l5 -5 l5 5"/><path ${S} d="M59 70 v18 m-5 -5 l5 5 l5 -5"/><text x="90" y="50" font-size="8" fill="currentColor">F</text><text x="26" y="50" font-size="8" fill="currentColor">f</text><text x="64" y="28" font-size="8" fill="currentColor">N</text><text x="64" y="88" font-size="8" fill="currentColor">W</text>`,
  projectile: `<path ${S} d="M8 80 H112"/><path ${S} stroke-dasharray="3 4" d="M18 80 Q 60 -10 102 80"/><path ${S} d="M18 80 l20 -22"/><path ${S} stroke-width="1" d="M30 80 a12 12 0 0 0 -4 -8"/><text x="32" y="74" font-size="8" fill="currentColor">θ</text><circle cx="60" cy="35" r="3" fill="currentColor"/>`,
  orbit: `<circle ${S} cx="60" cy="50" r="18"/><path ${S} stroke-width="1" d="M50 44 q6 -6 12 0 M46 54 q14 10 28 0"/><ellipse ${S} stroke-dasharray="3 4" cx="60" cy="50" rx="46" ry="30"/><circle cx="104" cy="38" r="4" fill="currentColor"/><path ${S} d="M104 38 L 70 47 m 6 -4 l -6 4 l 7 1"/><path ${S} d="M100 30 l 8 -6"/>`,
  atom: `<circle ${S} cx="60" cy="50" r="7"/><circle cx="56" cy="47" r="1.6" fill="currentColor"/><circle cx="63" cy="52" r="1.6" fill="currentColor"/><circle cx="61" cy="46" r="1.6" fill="currentColor"/><circle ${S} cx="60" cy="50" r="20"/><circle ${S} cx="60" cy="50" r="36"/><circle cx="60" cy="30" r="2.4" fill="currentColor"/><circle cx="60" cy="70" r="2.4" fill="currentColor"/><circle cx="24" cy="50" r="2.4" fill="currentColor"/><circle cx="96" cy="50" r="2.4" fill="currentColor"/><circle cx="85" cy="25" r="2.4" fill="currentColor"/><circle cx="35" cy="75" r="2.4" fill="currentColor"/>`,
  bonding: `<circle ${S} cx="38" cy="50" r="18"/><circle ${S} cx="62" cy="50" r="18"/><circle cx="50" cy="45" r="2" fill="currentColor"/><path ${S} stroke-width="1.2" d="M48 55 l4 0 m-2 -2 l0 4"/><circle ${S} cx="96" cy="36" r="10"/><circle ${S} cx="96" cy="66" r="10"/><text x="93" y="40" font-size="10" fill="currentColor">+</text><text x="93" y="70" font-size="10" fill="currentColor">−</text>`,
  balance: `<path ${S} d="M60 24 v46 M40 74 h40"/><path ${S} d="M20 30 H100"/><path ${S} d="M20 30 l-8 22 h16 z M100 30 l-8 22 h16 z"/><path ${S} d="M16 44 h8 v-8 h-8 z"/><path ${S} d="M94 40 h12 v12 h-12 z M97 36 h6"/>`,
  reaction: `<path ${S} d="M40 20 h20 v20 l16 32 a4 4 0 0 1 -4 6 h-44 a4 4 0 0 1 -4 -6 l16 -32 z"/><circle cx="44" cy="62" r="2.2" fill="currentColor"/><circle cx="56" cy="68" r="2.2" fill="currentColor"/><circle cx="50" cy="56" r="2.2" fill="currentColor"/><circle cx="60" cy="58" r="2.2" fill="currentColor"/><path ${S} stroke-width="1.2" d="M46 86 q4 -8 8 0 q4 -8 8 0"/><path ${S} d="M88 78 V30 M88 78 H116"/><path ${S} d="M90 76 Q 100 40 114 34"/>`,
  line: `<path ${S} d="M20 84 V16 M20 84 H108"/><path ${S} stroke-width="0.7" stroke-dasharray="1 5" d="M20 64 h88 M20 44 h88 M20 24 h88 M40 84 v-68 M60 84 v-68 M80 84 v-68 M100 84 v-68"/><path ${S} d="M22 74 L104 24"/><path ${S} stroke-width="1" d="M50 57 h24 v-15"/><text x="58" y="66" font-size="7" fill="currentColor">run</text><text x="76" y="52" font-size="7" fill="currentColor">rise</text>`,
  parabola: `<path ${S} d="M60 88 V12 M12 60 H110"/><path ${S} d="M22 20 Q 60 120 98 20"/><circle cx="35" cy="60" r="2.5" fill="currentColor"/><circle cx="85" cy="60" r="2.5" fill="currentColor"/><circle cx="60" cy="72" r="2.5" fill="currentColor"/><path ${S} stroke-width="1" d="M60 72 l14 10"/><text x="76" y="86" font-size="7" fill="currentColor">vertex</text>`,
  machine: `<rect ${S} x="42" y="32" width="36" height="36" rx="4"/><text x="54" y="56" font-size="14" font-style="italic" fill="currentColor">f</text><path ${S} d="M8 50 h30 m-5 -5 l5 5 l-5 5"/><path ${S} d="M82 50 h30 m-5 -5 l5 5 l-5 5"/><text x="12" y="44" font-size="8" fill="currentColor">x</text><text x="86" y="44" font-size="8" fill="currentColor">f(x)</text>`,
  tangent: `<path ${S} d="M12 80 C 40 10, 70 90, 110 30"/><path ${S} stroke-dasharray="4 3" d="M28 78 L 92 22"/><circle cx="58" cy="52" r="3" fill="currentColor"/>`,
  lever: `<path ${S} d="M60 66 l-9 14 h18 z"/><path ${S} d="M14 58 L 106 66"/><path ${S} d="M22 56 l-2 -14 h14 l-2 14 z"/><path ${S} d="M94 64 l-1 -8 h8 l-1 8 z"/><path ${S} d="M14 88 h92"/>`,
  circuit: `<rect ${S} x="16" y="24" width="88" height="52" rx="2"/><path ${S} d="M16 44 v-6 M16 62 v-6" stroke="var(--paper)" stroke-width="6"/><path ${S} d="M10 46 h12 M13 52 h6 M10 56 h12"/><path ${S} d="M104 40 l4 3 l-8 4 l8 4 l-8 4 l8 4 l-4 3" stroke="var(--paper)" stroke-width="6"/><path ${S} d="M104 40 l4 3 l-8 4 l8 4 l-8 4 l8 4 l-4 3"/><circle ${S} cx="60" cy="24" r="8" fill="var(--paper)"/><path ${S} d="M55 19 l10 10 M65 19 l-10 10"/>`,
  beam: `<path ${S} d="M30 14 H90"/><path ${S} d="M60 14 v46"/><rect ${S} x="46" y="60" width="28" height="22" rx="2"/><path ${S} stroke-width="1" d="M78 14 v46 m-4 -46 h8 m-8 46 h8"/><text x="82" y="40" font-size="7" fill="currentColor">ΔL</text>`,
  sankey: `<path ${S} d="M8 36 H60 L78 36 H110 M8 64 H40 C60 64 62 78 74 84 M74 84 L 88 96 M60 36"/><path ${S} d="M8 36 V64"/><path ${S} d="M110 36 V52 H60 C48 52 44 70 88 96"/><path ${S} stroke-width="1" d="M104 40 l6 4 l-6 4"/><text x="62" y="30" font-size="7" fill="currentColor">useful</text><text x="80" y="76" font-size="7" fill="currentColor">heat</text>`,
};

export function illustration(key, alt) {
  const body = art[key];
  if (!body) return '';
  return `<figure class="illus" role="img" aria-label="${escape(alt || '')}"><svg viewBox="0 0 120 100" aria-hidden="true" focusable="false">${body}</svg></figure>`;
}
export function illustrationBytes(key) { return (art[key] || '').length + 80; }
export function hasIllustration(key) { return !!art[key]; }

function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Small UI glyphs (16px). Text labels accompany every use.
export const ICON = {
  online: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path ${S} d="M2 6.5 q6 -5 12 0 M4.5 9.5 q3.5 -3 7 0"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/></svg>`,
  offline: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path ${S} d="M2 6.5 q6 -5 12 0 M4.5 9.5 q3.5 -3 7 0"/><path ${S} d="M3 13 L13 3"/></svg>`,
  simulated: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect ${S} x="2" y="3" width="12" height="10" rx="2" stroke-dasharray="2 2"/><path ${S} d="M5 8 h6"/></svg>`,
  tutor: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path ${S} d="M2.5 3.5 h11 v7 h-6 l-3 3 v-3 h-2 z"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path ${S} d="M3 8.5 l3 3 l7 -7"/></svg>`,
  speaker: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path ${S} d="M2.5 6 h3 l4 -3 v10 l-4 -3 h-3 z M11.5 6 q2 2 0 4 M13 4 q3.5 4 0 8"/></svg>`,
  stop: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect ${S} x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>`,
  lock: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect ${S} x="3" y="7" width="10" height="7" rx="1.5"/><path ${S} d="M5.5 7 v-2 a2.5 2.5 0 0 1 5 0 v2"/></svg>`,
  download: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path ${S} d="M8 2 v8 m-3.5 -3.5 l3.5 3.5 l3.5 -3.5 M3 13 h10"/></svg>`,
};
