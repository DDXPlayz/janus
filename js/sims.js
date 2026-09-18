// JANUS interactive simulations (canvas). Each export mounts into a container
// and returns { destroy }. Controls are native range/select/button elements so
// they work with the keyboard. Low-bandwidth mode lowers frame rate and
// resolution; reduced motion starts simulations paused with a Step button.

import { getSetting, prefersReducedMotion } from './settings.js';

export const SIMS = {
  orbit: { title: 'Why a satellite stays in orbit', lesson: 'phy-gravity', blurb: 'Change the sideways speed and watch the satellite fall around the planet, spiral in, or escape.' },
  projectile: { title: 'Projectile motion', lesson: 'phy-projectile', blurb: 'Launch speed and angle set the range, height and time of flight. Compare 30° with 60°.' },
  reaction: { title: 'Reaction rate and temperature', lesson: 'chem-rates', blurb: 'Raise the temperature and activation energy and count how many collisions succeed.' },
  lever: { title: 'Lever and torque balance', lesson: 'eng-levers', blurb: 'Slide two masses along a beam until the clockwise and anticlockwise moments match.' },
  grapher: { title: 'Function grapher', lesson: 'math-functions', blurb: 'Type any function of x and apply translations and stretches.' },
  circuit: { title: 'Ohm\'s law circuit', lesson: 'eng-circuits', blurb: 'Adjust voltage and resistance, series or parallel, and read the current and power.' },
};

function lowBandwidth() { return !!getSetting('lowBandwidth'); }
function el(tag, attrs = {}, html = '') { const e = document.createElement(tag); for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html) e.innerHTML = html; return e; }
let uid = 0;

function control(label, input, value) {
  const id = 'sim-c-' + (++uid);
  const wrap = el('label', { class: 'sim-control', for: id });
  input.id = id;
  const lab = el('span', { class: 'sim-label' }, label);
  const val = el('output', { class: 'sim-value', for: id }, value || '');
  wrap.append(lab, input, val);
  return { wrap, input, val };
}
function range(min, max, step, value) { const i = el('input', { type: 'range', min, max, step, value }); return i; }

function makeCanvas(root, ratio = 0.6) {
  const c = el('canvas', { class: 'sim-canvas', tabindex: '0' });
  root.appendChild(c);
  const fit = () => {
    const w = Math.max(240, root.clientWidth || 600);
    const h = Math.round(w * ratio);
    const scale = lowBandwidth() ? 0.6 : Math.min(2, window.devicePixelRatio || 1);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return { w, h };
  };
  return { canvas: c, fit };
}

/** Animation loop with frame-rate cap. */
function loop(fn) {
  let raf = 0, last = 0, running = false;
  const minDt = () => (lowBandwidth() ? 1000 / 12 : 1000 / 60);
  const tick = (t) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (t - last < minDt()) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    fn(dt);
  };
  return {
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
    get running() { return running; },
  };
}

function playControls(root, lp, step, reset) {
  const bar = el('div', { class: 'sim-bar' });
  const play = el('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false' }, 'Play');
  const stp = el('button', { type: 'button', class: 'btn small ghost' }, 'Step');
  const rst = el('button', { type: 'button', class: 'btn small ghost' }, 'Reset');
  const sync = () => { play.textContent = lp.running ? 'Pause' : 'Play'; play.setAttribute('aria-pressed', lp.running ? 'true' : 'false'); };
  play.addEventListener('click', () => { if (lp.running) lp.stop(); else lp.start(); sync(); });
  stp.addEventListener('click', () => { lp.stop(); step(1 / 30); sync(); });
  rst.addEventListener('click', () => { reset(); step(0); });
  bar.append(play, stp, rst);
  root.appendChild(bar);
  const note = el('p', { class: 'sim-note muted' }, prefersReducedMotion() ? 'Reduced motion is on: the simulation starts paused. Use Play or Step.' : (lowBandwidth() ? 'Low-bandwidth mode: rendering at 12 frames per second and reduced resolution.' : ''));
  if (note.textContent) root.appendChild(note);
  return { play, sync };
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#333';

// ------------------------------------------------------------ ORBIT
export function orbit(root) {
  root.innerHTML = '';
  const { canvas, fit } = makeCanvas(root, 0.66);
  const controls = el('div', { class: 'sim-controls' });
  const sp = control('Launch speed (× circular speed)', range(0.3, 1.6, 0.01, 1), '1.00');
  const alt = control('Starting altitude', range(0.3, 2.5, 0.05, 1), '1.00 R');
  controls.append(sp.wrap, alt.wrap);
  root.appendChild(controls);
  const readout = el('div', { class: 'sim-readout', 'aria-live': 'polite' });
  root.appendChild(readout);

  // Units: planet radius R = 1, GM = 1. Circular speed at r: sqrt(1/r).
  let s = { x: 0, y: 0, vx: 0, vy: 0, t: 0, trail: [], state: 'circular', crashed: false, escaped: false };
  const reset = () => {
    const r = 1 + parseFloat(alt.input.value);
    const f = parseFloat(sp.input.value);
    s = { x: r, y: 0, vx: 0, vy: -f * Math.sqrt(1 / r), t: 0, trail: [], crashed: false, escaped: false, r0: r, f };
  };
  const status = () => {
    const r = Math.hypot(s.x, s.y); const v = Math.hypot(s.vx, s.vy);
    const energy = 0.5 * v * v - 1 / r;
    const circ = Math.sqrt(1 / s.r0), esc = Math.sqrt(2 / s.r0);
    let label;
    if (s.crashed) label = 'Crashed: too slow to miss the planet';
    else if (energy >= 0) label = s.escaped ? 'Escaped: speed ≥ escape velocity, never returns' : 'Escaping (unbound orbit)';
    else if (Math.abs(s.f - 1) < 0.02) label = 'Circular orbit: gravity exactly supplies the centripetal force';
    else label = 'Elliptical orbit: ' + (s.f < 1 ? 'launched slower than circular, dips inward' : 'launched faster than circular, swings outward');
    readout.innerHTML = `<strong>${label}</strong><br>Speed ${v.toFixed(2)} (circular ${circ.toFixed(2)}, escape ${esc.toFixed(2)}) · distance ${r.toFixed(2)} R · t = ${s.t.toFixed(1)}`;
  };
  const step = (dt) => {
    if (s.crashed) return;
    // sub-steps for accuracy; semi-implicit Euler
    const n = 8; const h = dt * 1.2 / n;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(s.x, s.y);
      if (r < 1) { s.crashed = true; break; }
      const a = -1 / (r * r * r);
      s.vx += a * s.x * h; s.vy += a * s.y * h;
      s.x += s.vx * h; s.y += s.vy * h; s.t += h;
      if (r > 12) s.escaped = true;
    }
    if (!lowBandwidth() || s.trail.length % 2 === 0) s.trail.push([s.x, s.y]);
    if (s.trail.length > (lowBandwidth() ? 150 : 600)) s.trail.shift();
    draw();
  };
  const draw = () => {
    const { w, h } = fit();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, scale = Math.min(w, h) / (2 * (1.6 + parseFloat(alt.input.value)) * 1.35);
    ctx.strokeStyle = css('--line'); ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(cx, cy, s.r0 * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--ink-blue'); ctx.beginPath(); ctx.arc(cx, cy, scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css('--terracotta'); ctx.lineWidth = 1.5; ctx.beginPath();
    s.trail.forEach(([x, y], i) => { const px = cx + x * scale, py = cy + y * scale; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke();
    const px = cx + s.x * scale, py = cy + s.y * scale;
    ctx.fillStyle = s.crashed ? css('--muted') : css('--terracotta'); ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    // gravity arrow toward centre
    const r = Math.hypot(s.x, s.y); if (r > 0.01) { const ux = -s.x / r, uy = -s.y / r; ctx.strokeStyle = css('--olive'); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ux * 22, py + uy * 22); ctx.stroke(); }
    ctx.fillStyle = css('--ink'); ctx.font = '12px system-ui, sans-serif'; ctx.fillText('green arrow: gravity (always toward the centre)', 10, h - 10);
    status();
  };
  const lp = loop(step);
  sp.input.addEventListener('input', () => { sp.val.textContent = parseFloat(sp.input.value).toFixed(2); reset(); draw(); });
  alt.input.addEventListener('input', () => { alt.val.textContent = parseFloat(alt.input.value).toFixed(2) + ' R'; reset(); draw(); });
  const pc = playControls(root, lp, step, reset);
  reset(); draw();
  if (!prefersReducedMotion()) { lp.start(); pc.sync(); }
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  return { destroy() { lp.stop(); window.removeEventListener('resize', onResize); } };
}

// ------------------------------------------------------------ PROJECTILE
export function projectile(root) {
  root.innerHTML = '';
  const { canvas, fit } = makeCanvas(root, 0.55);
  const controls = el('div', { class: 'sim-controls' });
  const u = control('Launch speed u (m/s)', range(5, 40, 1, 20), '20 m/s');
  const th = control('Launch angle θ (degrees)', range(5, 85, 1, 45), '45°');
  const cmp = control('Compare with the complementary angle (90° − θ)', el('input', { type: 'checkbox' }), '');
  controls.append(u.wrap, th.wrap, cmp.wrap);
  root.appendChild(controls);
  const readout = el('div', { class: 'sim-readout', 'aria-live': 'polite' }); root.appendChild(readout);
  const g = 9.8;
  let t = 0;
  const calc = (U, deg) => { const a = deg * Math.PI / 180; const T = 2 * U * Math.sin(a) / g; return { a, T, R: U * U * Math.sin(2 * a) / g, H: U * U * Math.sin(a) ** 2 / (2 * g) }; };
  const reset = () => { t = 0; };
  const step = (dt) => { const { T } = calc(+u.input.value, +th.input.value); t += dt; if (t > T + 0.6) t = 0; draw(); };
  const draw = () => {
    const { w, h } = fit(); const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
    const U = +u.input.value, deg = +th.input.value;
    const main = calc(U, deg), alt = calc(U, 90 - deg);
    const maxR = 40 * 40 / g, maxH = 40 * 40 / (2 * g);
    const pad = 36, sx = (w - pad * 2) / maxR, sy = (h - pad * 2) / maxH;
    const X = (x) => pad + x * sx, Y = (y) => h - pad - y * sy;
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(w - pad, Y(0)); ctx.moveTo(pad, Y(0)); ctx.lineTo(pad, pad); ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
    for (let x = 0; x <= maxR; x += 40) { ctx.fillText(x + ' m', X(x) - 8, Y(0) + 14); }
    for (let y = 20; y <= maxH; y += 20) { ctx.fillText(y + ' m', 4, Y(y) + 4); }
    const path = (c, colour, dashed) => {
      ctx.strokeStyle = colour; ctx.lineWidth = 2; if (dashed) ctx.setLineDash([4, 4]); ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const tt = c.T * i / 60; const x = U * Math.cos(c.a) * tt, y = U * Math.sin(c.a) * tt - 0.5 * g * tt * tt; if (i) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (cmp.input.checked) path(alt, css('--olive'), true);
    path(main, css('--terracotta'), false);
    const tt = Math.min(t, main.T); const bx = U * Math.cos(main.a) * tt, by = U * Math.sin(main.a) * tt - 0.5 * g * tt * tt;
    ctx.fillStyle = css('--ink-blue'); ctx.beginPath(); ctx.arc(X(bx), Y(Math.max(0, by)), 6, 0, Math.PI * 2); ctx.fill();
    // velocity components
    const vx = U * Math.cos(main.a), vy = U * Math.sin(main.a) - g * tt;
    ctx.strokeStyle = css('--ink-blue'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(bx), Y(by)); ctx.lineTo(X(bx) + vx * 1.2, Y(by)); ctx.moveTo(X(bx), Y(by)); ctx.lineTo(X(bx), Y(by) - vy * 1.2); ctx.stroke();
    readout.innerHTML = `<strong>θ = ${deg}°, u = ${U} m/s</strong> (g = 9.8 m/s², no air) · time of flight <b>${main.T.toFixed(2)} s</b> · range <b>${main.R.toFixed(1)} m</b> · max height <b>${main.H.toFixed(1)} m</b>` + (cmp.input.checked ? `<br>Dashed, ${90 - deg}°: T = ${alt.T.toFixed(2)} s, R = ${alt.R.toFixed(1)} m, H = ${alt.H.toFixed(1)} m — same range, different flight.` : '') + `<br>t = ${tt.toFixed(2)} s · v<sub>x</sub> = ${vx.toFixed(1)} (constant) · v<sub>y</sub> = ${vy.toFixed(1)} m/s`;
  };
  const lp = loop(step);
  u.input.addEventListener('input', () => { u.val.textContent = u.input.value + ' m/s'; reset(); draw(); });
  th.input.addEventListener('input', () => { th.val.textContent = th.input.value + '°'; reset(); draw(); });
  cmp.input.addEventListener('change', draw);
  const pc = playControls(root, lp, step, reset);
  draw(); if (!prefersReducedMotion()) { lp.start(); pc.sync(); }
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  return { destroy() { lp.stop(); window.removeEventListener('resize', onResize); } };
}

// ------------------------------------------------------------ REACTION RATE
export function reaction(root) {
  root.innerHTML = '';
  const { canvas, fit } = makeCanvas(root, 0.5);
  const controls = el('div', { class: 'sim-controls' });
  const T = control('Temperature (K)', range(250, 450, 5, 298), '298 K (25 °C)');
  const Ea = control('Activation energy Eₐ (kJ/mol)', range(20, 90, 5, 50), '50 kJ/mol');
  controls.append(T.wrap, Ea.wrap); root.appendChild(controls);
  const readout = el('div', { class: 'sim-readout', 'aria-live': 'polite' }); root.appendChild(readout);
  const R = 8.314;
  const N = lowBandwidth() ? 24 : 40;
  let ps = [], successes = 0, collisions = 0, clock = 0, window_ = [];
  const reset = () => { ps = []; for (let i = 0; i < N; i++) ps.push({ x: Math.random(), y: Math.random(), a: Math.random() * Math.PI * 2, kind: i % 2, flash: 0 }); successes = 0; collisions = 0; clock = 0; window_ = []; };
  const fraction = () => Math.exp(-(+Ea.input.value * 1000) / (R * +T.input.value));
  const ratio = () => Math.exp((+Ea.input.value * 1000 / R) * (1 / 298 - 1 / +T.input.value));
  const step = (dt) => {
    const speed = 0.22 * Math.sqrt(+T.input.value / 298);
    const f = fraction();
    // The Boltzmann fraction is tiny in absolute terms; scale it so successes are visible while keeping the *ratio* between settings exact.
    const pSuccess = Math.min(1, f * 4e5);
    for (const p of ps) {
      p.x += Math.cos(p.a) * speed * dt; p.y += Math.sin(p.a) * speed * dt;
      if (p.x < 0.02 || p.x > 0.98) { p.a = Math.PI - p.a; p.x = Math.min(0.98, Math.max(0.02, p.x)); }
      if (p.y < 0.02 || p.y > 0.98) { p.a = -p.a; p.y = Math.min(0.98, Math.max(0.02, p.y)); }
      if (p.flash > 0) p.flash -= dt;
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]; if (a.kind === b.kind) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 0.035 && a.flash <= 0 && b.flash <= 0) {
        collisions++; const ang = Math.atan2(b.y - a.y, b.x - a.x); a.a = ang + Math.PI; b.a = ang;
        a.flash = 0.25; b.flash = 0.25;
        if (Math.random() < pSuccess) { successes++; a.flash = 0.6; b.flash = 0.6; a.hit = true; b.hit = true; }
      }
    }
    clock += dt; window_.push([clock, successes]); while (window_.length && window_[0][0] < clock - 5) window_.shift();
    draw();
  };
  const draw = () => {
    const { w, h } = fit(); const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = css('--line'); ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    for (const p of ps) {
      ctx.fillStyle = p.flash > 0.3 ? css('--terracotta') : (p.kind ? css('--ink-blue') : css('--olive'));
      ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.flash > 0.3 ? 7 : 5, 0, Math.PI * 2); ctx.fill();
    }
    const perSec = window_.length > 1 ? (successes - window_[0][1]) / Math.max(0.1, clock - window_[0][0]) : 0;
    const tC = +T.input.value - 273.15;
    readout.innerHTML = `<strong>Fraction of collisions with E ≥ Eₐ: e<sup>−Eₐ/RT</sup> = ${fraction().toExponential(2)}</strong><br>Rate constant relative to 25 °C (Arrhenius): <b>×${ratio() >= 100 ? ratio().toFixed(0) : ratio().toFixed(2)}</b> · particle speed ∝ √T<br>In the box: ${collisions} collisions, ${successes} successful (${perSec.toFixed(1)} per s over the last 5 s). Successful collisions flash orange.<br><span class="muted">The absolute number of successes is scaled up so you can see them; the ratio between settings is exact. T = ${tC.toFixed(0)} °C.</span>`;
  };
  const lp = loop(step);
  T.input.addEventListener('input', () => { T.val.textContent = `${T.input.value} K (${(+T.input.value - 273.15).toFixed(0)} °C)`; draw(); });
  Ea.input.addEventListener('input', () => { Ea.val.textContent = Ea.input.value + ' kJ/mol'; draw(); });
  const pc = playControls(root, lp, step, reset);
  reset(); draw(); if (!prefersReducedMotion()) { lp.start(); pc.sync(); }
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  return { destroy() { lp.stop(); window.removeEventListener('resize', onResize); } };
}

// ------------------------------------------------------------ LEVER
export function lever(root) {
  root.innerHTML = '';
  const { canvas, fit } = makeCanvas(root, 0.5);
  const controls = el('div', { class: 'sim-controls' });
  const m1 = control('Left mass (kg)', range(1, 20, 1, 6), '6 kg');
  const d1 = control('Left distance from pivot (m)', range(0.1, 2, 0.05, 1), '1.00 m');
  const m2 = control('Right mass (kg)', range(1, 20, 1, 4), '4 kg');
  const d2 = control('Right distance from pivot (m)', range(0.1, 2, 0.05, 1), '1.00 m');
  controls.append(m1.wrap, d1.wrap, m2.wrap, d2.wrap); root.appendChild(controls);
  const readout = el('div', { class: 'sim-readout', 'aria-live': 'polite' }); root.appendChild(readout);
  const g = 9.8;
  const draw = () => {
    const { w, h } = fit(); const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
    const M1 = +m1.input.value, D1 = +d1.input.value, M2 = +m2.input.value, D2 = +d2.input.value;
    const acw = M1 * g * D1, cw = M2 * g * D2, net = cw - acw;
    const balanced = Math.abs(net) < 0.5;
    const ang = Math.max(-0.25, Math.min(0.25, net / 120));
    const cx = w / 2, cy = h * 0.62, scale = (w * 0.42) / 2;
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = css('--ink-blue'); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-18, 34); ctx.lineTo(18, 34); ctx.closePath(); ctx.fill();
    ctx.rotate(ang);
    ctx.strokeStyle = css('--ink'); ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-2.1 * scale, 0); ctx.lineTo(2.1 * scale, 0); ctx.stroke();
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; for (let d = -2; d <= 2; d += 0.5) { ctx.beginPath(); ctx.moveTo(d * scale, -6); ctx.lineTo(d * scale, 6); ctx.stroke(); }
    const box = (x, m, colour) => { const s = 14 + m * 2; ctx.fillStyle = colour; ctx.fillRect(x - s / 2, -s - 3, s, s); ctx.fillStyle = css('--paper'); ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(m + ' kg', x, -s / 2 + 1); };
    box(-D1 * scale, M1, css('--terracotta')); box(D2 * scale, M2, css('--olive'));
    ctx.restore();
    ctx.fillStyle = css('--ink'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('anticlockwise (left): ' + acw.toFixed(1) + ' N·m', 12, 20); ctx.fillText('clockwise (right): ' + cw.toFixed(1) + ' N·m', 12, 36);
    readout.innerHTML = balanced ? `<strong>Balanced.</strong> ${M1} × ${D1.toFixed(2)} = ${M2} × ${D2.toFixed(2)} (× g on both sides). Net moment ${net.toFixed(1)} N·m.` : `<strong>Not balanced:</strong> the beam tips ${net > 0 ? 'clockwise (right side down)' : 'anticlockwise (left side down)'} by a net moment of ${Math.abs(net).toFixed(1)} N·m. To balance, move the right mass to ${(M1 * D1 / M2).toFixed(2)} m or make it ${(M1 * D1 / D2).toFixed(1)} kg.`;
  };
  [m1, d1, m2, d2].forEach((c, i) => c.input.addEventListener('input', () => { c.val.textContent = i % 2 ? (+c.input.value).toFixed(2) + ' m' : c.input.value + ' kg'; draw(); }));
  draw();
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  return { destroy() { window.removeEventListener('resize', onResize); } };
}

// ------------------------------------------------------------ GRAPHER (safe expression parser, no eval)
const FUNCS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, floor: Math.floor };
const CONSTS = { pi: Math.PI, e: Math.E };
export function parseExpr(src) {
  const toks = []; const s = src.replace(/\s+/g, '').toLowerCase().replace(/\*\*/g, '^');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; }
    else if (/[a-z]/.test(c)) { let j = i; while (j < s.length && /[a-z]/.test(s[j])) j++; toks.push({ t: 'id', v: s.slice(i, j) }); i = j; }
    else if ('+-*/^(),'.includes(c)) { toks.push({ t: c }); i++; }
    else throw new Error('Unexpected character "' + c + '"');
  }
  // implicit multiplication: 2x, 2(x+1), x(x+1), )(  , x sin(x)
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const a = toks[k], b = toks[k + 1];
    out.push(a);
    if (b && ((a.t === 'num' || a.t === ')' || (a.t === 'id' && !FUNCS[a.v])) && (b.t === 'num' || b.t === 'id' || b.t === '('))) out.push({ t: '*' });
  }
  let p = 0;
  const peek = () => out[p], next = () => out[p++];
  function parseAdd() { let n = parseMul(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = parseMul(); const l = n; n = (x) => op === '+' ? l(x) + r(x) : l(x) - r(x); } return n; }
  function parseMul() { let n = parseUnary(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = parseUnary(); const l = n; n = (x) => op === '*' ? l(x) * r(x) : l(x) / r(x); } return n; }
  function parseUnary() { if (peek() && peek().t === '-') { next(); const r = parseUnary(); return (x) => -r(x); } if (peek() && peek().t === '+') { next(); return parseUnary(); } return parsePow(); }
  function parsePow() { const base = parseAtom(); if (peek() && peek().t === '^') { next(); const ex = parseUnary(); return (x) => Math.pow(base(x), ex(x)); } return base; }
  function parseAtom() {
    const tk = next(); if (!tk) throw new Error('Unexpected end of expression');
    if (tk.t === 'num') return () => tk.v;
    if (tk.t === '(') { const inner = parseAdd(); if (!peek() || next().t !== ')') throw new Error('Missing )'); return inner; }
    if (tk.t === 'id') {
      if (tk.v === 'x') return (x) => x;
      if (tk.v in CONSTS) return () => CONSTS[tk.v];
      if (FUNCS[tk.v]) { if (!peek() || next().t !== '(') throw new Error(tk.v + ' needs brackets'); const arg = parseAdd(); if (!peek() || next().t !== ')') throw new Error('Missing )'); const f = FUNCS[tk.v]; return (x) => f(arg(x)); }
      throw new Error('Unknown name "' + tk.v + '"');
    }
    throw new Error('Unexpected "' + tk.t + '"');
  }
  const fn = parseAdd();
  if (p < out.length) throw new Error('Unexpected "' + out[p].t + '"');
  return fn;
}

export function grapher(root) {
  root.innerHTML = '';
  const { canvas, fit } = makeCanvas(root, 0.6);
  const controls = el('div', { class: 'sim-controls' });
  const exprIn = el('input', { type: 'text', value: 'x^2', autocomplete: 'off', spellcheck: 'false' });
  const ex = control('f(x) =', exprIn, '');
  const a = control('Vertical shift a  (y = k·f(x − h) + a)', range(-5, 5, 0.5, 0), '0');
  const hh = control('Horizontal shift h', range(-5, 5, 0.5, 0), '0');
  const k = control('Vertical stretch k', range(-3, 3, 0.25, 1), '1');
  const zoom = control('Axis range ±', range(2, 20, 1, 6), '6');
  const presets = el('div', { class: 'sim-presets' });
  ['x^2', 'x^3 - 3x', 'sin(x)', '2^x', '1/x', 'sqrt(x)', 'abs(x)'].forEach((p) => { const b = el('button', { type: 'button', class: 'chip' }, p); b.addEventListener('click', () => { exprIn.value = p; draw(); }); presets.appendChild(b); });
  controls.append(ex.wrap, presets, a.wrap, hh.wrap, k.wrap, zoom.wrap); root.appendChild(controls);
  const readout = el('div', { class: 'sim-readout', 'aria-live': 'polite' }); root.appendChild(readout);
  const draw = () => {
    const { w, h } = fit(); const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
    let f;
    try { f = parseExpr(exprIn.value || '0'); ex.val.textContent = ''; exprIn.setAttribute('aria-invalid', 'false'); } catch (e) { ex.val.textContent = 'Error: ' + e.message; exprIn.setAttribute('aria-invalid', 'true'); readout.textContent = 'Could not read the expression. Use x, numbers, + − × / ^, brackets, sin cos tan sqrt abs exp ln log, pi and e.'; return; }
    const A = +a.input.value, H = +hh.input.value, K = +k.input.value, Z = +zoom.input.value;
    const X = (x) => (x + Z) / (2 * Z) * w, Y = (y) => h - (y + Z) / (2 * Z) * h;
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
    for (let v = -Z; v <= Z; v++) { ctx.beginPath(); ctx.moveTo(X(v), 0); ctx.lineTo(X(v), h); ctx.moveTo(0, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); }
    ctx.strokeStyle = css('--ink'); ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif'; ctx.fillText(Z.toString(), X(Z) - 14, Y(0) + 14); ctx.fillText((-Z).toString(), X(-Z) + 4, Y(0) + 14); ctx.fillText(Z.toString(), X(0) + 4, Y(Z) + 12);
    const plot = (g, colour, dashed) => {
      ctx.strokeStyle = colour; ctx.lineWidth = 2; if (dashed) ctx.setLineDash([4, 4]); ctx.beginPath(); let pen = false;
      const n = lowBandwidth() ? 120 : Math.min(600, w);
      for (let i = 0; i <= n; i++) { const x = -Z + 2 * Z * i / n; let y; try { y = g(x); } catch (e) { y = NaN; } if (!isFinite(y) || Math.abs(y) > Z * 4) { pen = false; continue; } if (pen) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); pen = true; }
      ctx.stroke(); ctx.setLineDash([]);
    };
    const transformed = (x) => K * f(x - H) + A;
    const isT = A !== 0 || H !== 0 || K !== 1;
    if (isT) plot(f, css('--muted'), true);
    plot(transformed, css('--terracotta'), false);
    const samples = [-2, -1, 0, 1, 2].map((x) => { let y; try { y = transformed(x); } catch (e) { y = NaN; } return `f(${x}) = ${isFinite(y) ? +y.toFixed(3) : '—'}`; }).join(' · ');
    readout.innerHTML = (isT ? `Solid: y = ${K}·f(x − ${H}) + ${A}. Dashed: the original f(x) = ${exprIn.value}.` : `y = ${exprIn.value}.`) + '<br>' + samples;
  };
  exprIn.addEventListener('input', draw);
  [a, hh, k, zoom].forEach((c) => c.input.addEventListener('input', () => { c.val.textContent = c.input.value; draw(); }));
  draw();
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  return { destroy() { window.removeEventListener('resize', onResize); } };
}

// ------------------------------------------------------------ CIRCUIT
export function circuit(root) {
  root.innerHTML = '';
  const { canvas, fit } = makeCanvas(root, 0.5);
  const controls = el('div', { class: 'sim-controls' });
  const V = control('Battery voltage (V)', range(1, 24, 1, 12), '12 V');
  const R1 = control('Resistor R₁ (Ω)', range(1, 50, 1, 6), '6 Ω');
  const R2 = control('Resistor R₂ (Ω)', range(1, 50, 1, 3), '3 Ω');
  const sel = el('select'); sel.innerHTML = '<option value="series">Series</option><option value="parallel">Parallel</option>';
  const mode = control('Connection', sel, '');
  controls.append(V.wrap, R1.wrap, R2.wrap, mode.wrap); root.appendChild(controls);
  const readout = el('div', { class: 'sim-readout', 'aria-live': 'polite' }); root.appendChild(readout);
  const draw = () => {
    const { w, h } = fit(); const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
    const v = +V.input.value, r1 = +R1.input.value, r2 = +R2.input.value, series = sel.value === 'series';
    const Rt = series ? r1 + r2 : (r1 * r2) / (r1 + r2);
    const I = v / Rt, P = v * I;
    const I1 = series ? I : v / r1, I2 = series ? I : v / r2;
    const V1 = series ? I * r1 : v, V2 = series ? I * r2 : v;
    ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = css('--ink');
    const L = w * 0.15, Rr = w * 0.85, T = h * 0.2, B = h * 0.8;
    const zig = (x, y, len, horiz) => { ctx.beginPath(); ctx.moveTo(x, y); for (let i = 1; i <= 8; i++) { const t = i / 8; const off = (i % 2 ? 7 : -7) * (i === 8 ? 0 : 1); if (horiz) ctx.lineTo(x + len * t, y + off); else ctx.lineTo(x + off, y + len * t); } ctx.stroke(); };
    // battery on the left
    ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, h * 0.42); ctx.moveTo(L, h * 0.58); ctx.lineTo(L, B); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L - 14, h * 0.45); ctx.lineTo(L + 14, h * 0.45); ctx.moveTo(L - 7, h * 0.52); ctx.lineTo(L + 7, h * 0.52); ctx.stroke();
    ctx.fillText(v + ' V', L - 44, h * 0.5);
    if (series) {
      ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(w * 0.35, T); ctx.moveTo(w * 0.35 + 60, T); ctx.lineTo(w * 0.6, T); ctx.moveTo(w * 0.6 + 60, T); ctx.lineTo(Rr, T); ctx.lineTo(Rr, B); ctx.lineTo(L, B); ctx.stroke();
      zig(w * 0.35, T, 60, true); zig(w * 0.6, T, 60, true);
      ctx.fillText(`R₁ ${r1} Ω · ${V1.toFixed(1)} V`, w * 0.33, T - 14); ctx.fillText(`R₂ ${r2} Ω · ${V2.toFixed(1)} V`, w * 0.58, T - 14);
    } else {
      const x1 = w * 0.5, x2 = w * 0.72;
      ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(Rr, T); ctx.lineTo(Rr, B); ctx.lineTo(L, B); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, T); ctx.lineTo(x1, h * 0.35); ctx.moveTo(x1, h * 0.35 + 60); ctx.lineTo(x1, B); ctx.moveTo(x2, T); ctx.lineTo(x2, h * 0.35); ctx.moveTo(x2, h * 0.35 + 60); ctx.lineTo(x2, B); ctx.stroke();
      zig(x1, h * 0.35, 60, false); zig(x2, h * 0.35, 60, false);
      ctx.fillText(`R₁ ${r1} Ω`, x1 + 12, h * 0.4); ctx.fillText(`${I1.toFixed(2)} A`, x1 + 12, h * 0.4 + 16); ctx.fillText(`R₂ ${r2} Ω`, x2 + 12, h * 0.4); ctx.fillText(`${I2.toFixed(2)} A`, x2 + 12, h * 0.4 + 16);
    }
    // current arrow on the bottom wire, size ∝ current
    const arrowLen = Math.min(120, 10 + I * 12);
    ctx.strokeStyle = css('--terracotta'); ctx.beginPath(); ctx.moveTo(w * 0.5 + arrowLen / 2, B); ctx.lineTo(w * 0.5 - arrowLen / 2, B); ctx.lineTo(w * 0.5 - arrowLen / 2 + 8, B - 6); ctx.moveTo(w * 0.5 - arrowLen / 2, B); ctx.lineTo(w * 0.5 - arrowLen / 2 + 8, B + 6); ctx.stroke();
    ctx.fillStyle = css('--terracotta'); ctx.fillText(`I = ${I.toFixed(2)} A`, w * 0.5 - 24, B + 20);
    readout.innerHTML = `<strong>${series ? 'Series' : 'Parallel'}:</strong> R<sub>total</sub> = ${series ? `${r1} + ${r2}` : `(${r1} × ${r2}) / (${r1} + ${r2})`} = <b>${Rt.toFixed(2)} Ω</b> · I = V / R = ${v} / ${Rt.toFixed(2)} = <b>${I.toFixed(2)} A</b> · P = V I = <b>${P.toFixed(1)} W</b><br>` + (series ? `Same current through both; voltages add: ${V1.toFixed(1)} V + ${V2.toFixed(1)} V = ${v} V.` : `Same ${v} V across both; currents add: ${I1.toFixed(2)} A + ${I2.toFixed(2)} A = ${I.toFixed(2)} A.`);
  };
  [V, R1, R2].forEach((c) => c.input.addEventListener('input', () => { c.val.textContent = c.input.value + (c === V ? ' V' : ' Ω'); draw(); }));
  sel.addEventListener('change', draw);
  draw();
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  return { destroy() { window.removeEventListener('resize', onResize); } };
}

export function mountSim(key, root) {
  const fn = { orbit, projectile, reaction, lever, grapher, circuit }[key];
  if (!fn) { root.textContent = 'Unknown simulation.'; return { destroy() {} }; }
  return fn(root);
}
