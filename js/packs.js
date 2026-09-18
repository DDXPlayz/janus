// Content packs: build (with a storage limit), install to IndexedDB, export
// as a real .json file, import from a file, list and remove.

import { BASE, APP_VERSION } from './settings.js';
import { db } from './db.js';
import { subjectContent, LEVEL_RANK, SUBJECTS, byteLength, SUBJECT_META, getCatalogue } from './content.js';
import { cacheUrls, uncacheUrls, netFetch } from './net.js';

export const SIM_KEYS = ['orbit', 'projectile', 'reaction', 'lever', 'grapher', 'circuit'];
export const STORAGE_STEPS = [16 * 1024, 32 * 1024, 64 * 1024, 128 * 1024, 256 * 1024, 512 * 1024, 1024 * 1024, 2 * 1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024];

let simsBytesCache = null;
/** Measured size of the simulation code (js/sims.js), shared between all six simulations. */
export async function simsBytes() {
  if (simsBytesCache) return simsBytesCache;
  try {
    const res = await netFetch(BASE + 'js/sims.js');
    if (res.ok) { simsBytesCache = byteLength(await res.text()); return simsBytesCache; }
  } catch (e) { /* offline and not cached */ }
  const cat = getCatalogue();
  simsBytesCache = cat && cat.simsBytes ? cat.simsBytes : 0;
  return simsBytesCache;
}

function stripHindi(lesson) {
  const out = JSON.parse(JSON.stringify(lesson));
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) { if (k.endsWith('_hi')) delete o[k]; else walk(o[k]); }
    }
  };
  walk(out);
  out.hindi_full = false;
  out.hindi_stripped = true;
  return out;
}

/**
 * Build a pack. Returns the pack object plus a report of what fits and what was cut.
 * Lessons are prioritised by level (Foundation first) then subject order then lesson order.
 */
export async function buildPack({ subjects, levels, languages, limitBytes }) {
  const sources = {};
  const candidates = [];
  const perSim = (await simsBytes()) / SIM_KEYS.length;
  for (const subject of SUBJECTS) {
    if (!subjects.includes(subject)) continue;
    const { source, data } = await subjectContent(subject);
    sources[subject] = source;
    if (!data) continue;
    for (const L of data.lessons) {
      if (!levels.includes(L.level)) continue;
      const lesson = { ...L, subject, version: data.version };
      const stored = languages.includes('hi') ? lesson : stripHindi(lesson);
      candidates.push({ lesson: stored, bytes: byteLength(JSON.stringify(stored)), simBytes: stored.sim ? perSim : 0, subjectIndex: SUBJECTS.indexOf(subject) });
    }
  }
  candidates.sort((a, b) => LEVEL_RANK[a.lesson.level] - LEVEL_RANK[b.lesson.level] || a.subjectIndex - b.subjectIndex || a.lesson.order - b.lesson.order);

  const header = { format: 'janus-pack', formatVersion: 1, app: APP_VERSION, id: 'pack-' + Date.now().toString(36), name: '', createdAt: new Date().toISOString(), subjects, levels, languages, lessons: [], sims: [] };
  const headerBytes = byteLength(JSON.stringify(header)) + 64;
  let total = headerBytes;
  const included = [], cut = [];
  const simsIncluded = new Set();
  for (const c of candidates) {
    const simCost = c.lesson.sim && !simsIncluded.has(c.lesson.sim) ? c.simBytes : 0;
    if (total + c.bytes + simCost <= limitBytes) {
      total += c.bytes + simCost; included.push({ ...c, simCost });
      if (c.lesson.sim) simsIncluded.add(c.lesson.sim);
    } else {
      cut.push({ ...c, simCost, reason: 'over the ' + fmt(limitBytes) + ' limit' });
    }
  }
  const pack = { ...header, lessons: included.map((c) => c.lesson), sims: Array.from(simsIncluded) };
  pack.name = packName(pack);
  pack.size = byteLength(JSON.stringify(pack));
  return { pack, included, cut, totalBytes: total, contentBytes: included.reduce((a, c) => a + c.bytes, 0), simBytes: included.reduce((a, c) => a + c.simCost, 0), headerBytes, limitBytes, sources, unavailable: subjects.filter((s) => sources[s] === 'none') };
}

export function packName(pack) {
  const subj = pack.subjects.map((s) => SUBJECT_META[s].name).join(' + ');
  const lv = pack.levels.length === 3 ? 'all levels' : pack.levels.join('/');
  return `${subj} · ${lv} · ${pack.languages.map((l) => l.toUpperCase()).join('+')}`;
}

function fmt(n) { return n >= 1048576 ? (n / 1048576).toFixed(n % 1048576 ? 1 : 0) + ' MB' : Math.round(n / 1024) + ' KB'; }

export async function installPack(pack) {
  validatePack(pack);
  const installedAt = Date.now();
  const lessons = pack.lessons.map((l) => ({ ...l, packId: pack.id, installedAt }));
  await db.putMany('lessons', lessons);
  const meta = { id: pack.id, name: pack.name || packName(pack), subjects: pack.subjects, levels: pack.levels, languages: pack.languages, lessonIds: lessons.map((l) => l.id), sims: pack.sims || [], size: pack.size || byteLength(JSON.stringify(pack)), version: pack.app || APP_VERSION, formatVersion: pack.formatVersion, createdAt: pack.createdAt, installedAt, source: pack.source || 'built on this device' };
  await db.put('packs', meta);
  // Ask the service worker to cache the assets related to this pack (subject files + simulation code).
  const urls = pack.subjects.map((s) => BASE + 'content/' + s + '.json');
  if ((pack.sims || []).length) urls.push(BASE + 'js/sims.js');
  const cacheResult = await cacheUrls(urls);
  return { meta, cacheResult };
}

export function validatePack(pack) {
  if (!pack || pack.format !== 'janus-pack') throw new Error('This file is not a JANUS content pack (missing format: "janus-pack").');
  if (!Array.isArray(pack.lessons) || !pack.lessons.length) throw new Error('The pack contains no lessons.');
  for (const l of pack.lessons) {
    if (!l.id || !l.title || !Array.isArray(l.sections) || !l.subject) throw new Error('Lesson "' + (l.id || '?') + '" is malformed.');
  }
  if (!Array.isArray(pack.subjects)) pack.subjects = Array.from(new Set(pack.lessons.map((l) => l.subject)));
  if (!Array.isArray(pack.levels)) pack.levels = Array.from(new Set(pack.lessons.map((l) => l.level)));
  if (!Array.isArray(pack.languages)) pack.languages = pack.lessons.some((l) => l.hindi_full) ? ['en', 'hi'] : ['en'];
  if (!pack.id) pack.id = 'pack-' + Date.now().toString(36);
  return true;
}

export function exportPackFile(pack) {
  const json = JSON.stringify(pack);
  const blob = new Blob([json], { type: 'application/json' });
  const name = (pack.name || 'janus-pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.janus-pack.json';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { name, bytes: blob.size };
}

export async function importPackFile(file) {
  const text = await file.text();
  let pack;
  try { pack = JSON.parse(text); } catch (e) { throw new Error('The file is not valid JSON.'); }
  validatePack(pack);
  pack.source = 'imported from ' + file.name;
  pack.size = byteLength(text);
  return installPack(pack);
}

export async function listInstalled() {
  try { return (await db.getAll('packs')).sort((a, b) => b.installedAt - a.installedAt); } catch (e) { return []; }
}

export async function removePack(id) {
  const packs = await listInstalled();
  const target = packs.find((p) => p.id === id);
  if (!target) return;
  const keepIds = new Set(packs.filter((p) => p.id !== id).flatMap((p) => p.lessonIds));
  const toDelete = target.lessonIds.filter((l) => !keepIds.has(l));
  if (toDelete.length) await db.deleteMany('lessons', toDelete);
  await db.delete('packs', id);
  // Un-cache subject files no other pack needs.
  const stillNeeded = new Set(packs.filter((p) => p.id !== id).flatMap((p) => p.subjects));
  const urls = target.subjects.filter((s) => !stillNeeded.has(s)).map((s) => BASE + 'content/' + s + '.json');
  if (urls.length) uncacheUrls(urls);
  return toDelete.length;
}
