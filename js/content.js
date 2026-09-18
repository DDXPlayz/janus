// Content access for JANUS.
// The catalogue (content/manifest.json) is part of the app shell and lists
// every lesson with sizes. Full lesson content lives in IndexedDB once a pack
// is installed; the app never reads lesson bodies from the network directly.

import { BASE, getSetting } from './settings.js';
import { db } from './db.js';
import { netFetch } from './net.js';

export const SUBJECTS = ['physics', 'chemistry', 'mathematics', 'engineering'];
export const LEVELS = ['Foundation', 'Standard', 'Advanced'];
export const LEVEL_RANK = { Foundation: 0, Standard: 1, Advanced: 2 };
export const SUBJECT_META = {
  physics: { name: 'Physics', name_hi: 'भौतिकी', colour: 'blue' },
  chemistry: { name: 'Chemistry', name_hi: 'रसायन विज्ञान', colour: 'olive' },
  mathematics: { name: 'Mathematics', name_hi: 'गणित', colour: 'terracotta' },
  engineering: { name: 'Engineering', name_hi: 'अभियांत्रिकी', colour: 'plum' },
};

let catalogue = null;
const subjectCache = new Map();

export async function loadCatalogue() {
  if (catalogue) return catalogue;
  const res = await fetch(BASE + 'content/manifest.json', { cache: 'default' });
  if (!res.ok) throw new Error('Catalogue unavailable (' + res.status + ')');
  catalogue = await res.json();
  return catalogue;
}

export function getCatalogue() { return catalogue; }

export function catalogueLesson(id) {
  return catalogue ? catalogue.lessons.find((l) => l.id === id) : null;
}

/** Fetch a subject's full JSON (network or service-worker cache). Throws when unreachable. */
export async function fetchSubject(subject) {
  if (subjectCache.has(subject)) return subjectCache.get(subject);
  const res = await netFetch(BASE + 'content/' + subject + '.json');
  if (!res.ok) throw new Error(subject + ' content is not available (' + res.status + ')');
  const data = await res.json();
  subjectCache.set(subject, data);
  return data;
}

/** Full content for a subject: from the network/SW cache, else from installed lessons in IndexedDB. */
export async function subjectContent(subject) {
  try { return { source: 'network', data: await fetchSubject(subject) }; } catch (e) { /* fall through */ }
  const lessons = await installedLessonsBySubject(subject);
  if (lessons.length) {
    const meta = SUBJECT_META[subject];
    return { source: 'installed', data: { subject, name: meta.name, name_hi: meta.name_hi, version: lessons[0].version || '1.0.0', lessons: lessons.sort((a, b) => a.order - b.order) } };
  }
  return { source: 'none', data: null };
}

export async function installedLessons() {
  try { return await db.getAll('lessons'); } catch (e) { return []; }
}
export async function installedLessonsBySubject(subject) {
  try { return await db.getAllByIndex('lessons', 'subject', subject); } catch (e) { return []; }
}
export async function installedLessonIds() {
  try { return new Set(await db.getAllKeys('lessons')); } catch (e) { return new Set(); }
}
export async function getLesson(id) {
  try { return (await db.get('lessons', id)) || null; } catch (e) { return null; }
}

// ---------- language / reading-level helpers ----------

export function lessonHasHindi(lesson) { return !!lesson.hindi_full; }

/** Text of a section for the current settings, with honest fallback info. */
export function sectionText(lesson, section, opts = {}) {
  const level = opts.level || getSetting('readingLevel');
  const lang = opts.lang || getSetting('language');
  const wantHi = lang === 'hi';
  const key = level === 'simple' ? 'simple' : 'standard';
  if (wantHi && section[key + '_hi']) return { text: section[key + '_hi'], heading: section.heading_hi || section.heading, lang: 'hi', level, fallback: false };
  return { text: section[key] || section.standard, heading: section.heading, lang: 'en', level, fallback: wantHi };
}

export function lessonTitle(lesson, lang) {
  const l = lang || getSetting('language');
  return l === 'hi' && lesson.title_hi ? lesson.title_hi : lesson.title;
}
export function lessonSummary(lesson, lang) {
  const l = lang || getSetting('language');
  return l === 'hi' && lesson.summary_hi ? lesson.summary_hi : lesson.summary;
}

// ---------- tiny text renderer ----------
// Lesson text uses: blank-line paragraphs, "- " list items, **bold**, `code`.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code class="f">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return out;
}

export function renderText(text) {
  if (!text) return '';
  const blocks = String(text).split(/\n\s*\n/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      return '<ul>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*-\s+/, '')) + '</li>').join('') + '</ul>';
    }
    return '<p>' + lines.map(inline).join('<br>') + '</p>';
  }).join('');
}

/** Plain text (no markup) for text-to-speech. */
export function plainText(text) {
  return String(text || '').replace(/\*\*|`|\*/g, '').replace(/^\s*-\s+/gm, '').replace(/\n+/g, '. ');
}

export function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

export function byteLength(str) {
  try { return new Blob([str]).size; } catch (e) { return unescape(encodeURIComponent(str)).length; }
}
