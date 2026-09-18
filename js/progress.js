// Progress tracking for JANUS: per-lesson progress, quiz results, daily
// activity (for streaks) and export/import. Every write also goes to the sync
// queue so it can be pushed when a connection is available.

import { db } from './db.js';
import { syncEngine } from './sync.js';

const listeners = new Set();
function emit(lessonId) { for (const fn of listeners) { try { fn(lessonId); } catch (e) { console.error(e); } } }
export function onProgressChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function touchActivity(kind) {
  const day = dayKey();
  let rec = null;
  try { rec = await db.get('activity', day); } catch (e) { /* ignore */ }
  rec = rec || { day, sections: 0, quizzes: 0, problems: 0, tutor: 0, first: Date.now(), last: Date.now() };
  rec[kind] = (rec[kind] || 0) + 1; rec.last = Date.now();
  try { await db.put('activity', rec); } catch (e) { /* ignore */ }
}

export async function getProgress(lessonId) {
  try { return (await db.get('progress', lessonId)) || blank(lessonId); } catch (e) { return blank(lessonId); }
}
export async function allProgress() {
  try { return await db.getAll('progress'); } catch (e) { return []; }
}
function blank(lessonId) {
  return { lessonId, sectionsRead: [], sectionCount: 0, quizBest: null, quizAttempts: 0, problemsSolved: [], problemCount: 0, firstAt: null, lastAt: null };
}

async function save(p, type) {
  p.lastAt = Date.now(); if (!p.firstAt) p.firstAt = p.lastAt;
  try { await db.put('progress', p); } catch (e) { /* ignore */ }
  await syncEngine.enqueue(type, { lessonId: p.lessonId, snapshot: p });
  emit(p.lessonId);
  return p;
}

export async function markSectionRead(lesson, sectionId, read = true) {
  const p = await getProgress(lesson.id);
  p.sectionCount = lesson.sections.length; p.problemCount = (lesson.problems || []).length;
  const has = p.sectionsRead.includes(sectionId);
  if (read && !has) p.sectionsRead.push(sectionId);
  if (!read && has) p.sectionsRead = p.sectionsRead.filter((s) => s !== sectionId);
  if (read && !has) await touchActivity('sections');
  return save(p, 'progress.section');
}

export async function recordQuiz(lesson, score, total, answers) {
  const p = await getProgress(lesson.id);
  p.sectionCount = lesson.sections.length; p.problemCount = (lesson.problems || []).length;
  p.quizAttempts += 1;
  const pct = total ? Math.round(100 * score / total) : 0;
  if (!p.quizBest || pct > p.quizBest.pct) p.quizBest = { score, total, pct, at: Date.now() };
  try { await db.add('results', { lessonId: lesson.id, score, total, pct, answers, at: Date.now() }); } catch (e) { /* ignore */ }
  await touchActivity('quizzes');
  await syncEngine.enqueue('quiz.result', { lessonId: lesson.id, score, total, pct, at: Date.now() });
  return save(p, 'progress.quiz');
}

export async function markProblemSolved(lesson, index, solved = true) {
  const p = await getProgress(lesson.id);
  p.sectionCount = lesson.sections.length; p.problemCount = (lesson.problems || []).length;
  const has = p.problemsSolved.includes(index);
  if (solved && !has) { p.problemsSolved.push(index); await touchActivity('problems'); }
  if (!solved && has) p.problemsSolved = p.problemsSolved.filter((i) => i !== index);
  return save(p, 'progress.problem');
}

export async function noteTutorUse() { await touchActivity('tutor'); }

export function lessonCompletion(p) {
  if (!p) return 0;
  const parts = [];
  if (p.sectionCount) parts.push(p.sectionsRead.length / p.sectionCount);
  parts.push(p.quizBest ? p.quizBest.pct / 100 : 0);
  if (p.problemCount) parts.push(p.problemsSolved.length / p.problemCount);
  if (!parts.length) return 0;
  return Math.round(100 * parts.reduce((a, b) => a + b, 0) / parts.length);
}

/** Streak computed from the activity store: consecutive days ending today or yesterday. */
export async function streaks() {
  let days = [];
  try { days = await db.getAll('activity'); } catch (e) { /* ignore */ }
  const set = new Set(days.map((d) => d.day));
  const totalDays = set.size;
  let current = 0;
  const cursor = new Date();
  if (!set.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1); // a streak survives until the end of today
  while (set.has(dayKey(cursor.getTime()))) { current++; cursor.setDate(cursor.getDate() - 1); }
  // longest streak
  const sorted = Array.from(set).sort();
  let longest = 0, run = 0, prev = null;
  for (const d of sorted) {
    if (prev) { const gap = (new Date(d) - new Date(prev)) / 86400000; run = Math.round(gap) === 1 ? run + 1 : 1; } else run = 1;
    longest = Math.max(longest, run); prev = d;
  }
  const totals = days.reduce((a, d) => ({ sections: a.sections + (d.sections || 0), quizzes: a.quizzes + (d.quizzes || 0), problems: a.problems + (d.problems || 0), tutor: a.tutor + (d.tutor || 0) }), { sections: 0, quizzes: 0, problems: 0, tutor: 0 });
  return { current, longest, totalDays, totals, days: sorted };
}

export async function exportProgress() {
  const [progress, results, activity, tutor] = await Promise.all([
    db.getAll('progress').catch(() => []), db.getAll('results').catch(() => []), db.getAll('activity').catch(() => []), db.getAll('tutor').catch(() => []),
  ]);
  return { format: 'janus-progress', version: 1, exportedAt: new Date().toISOString(), progress, results: results.map(({ id, ...r }) => r), activity, tutorHistory: tutor.map(({ id, ...r }) => r) };
}

export async function importProgress(data, mode = 'merge') {
  if (!data || data.format !== 'janus-progress') throw new Error('Not a JANUS progress file');
  if (mode === 'replace') { for (const s of ['progress', 'results', 'activity']) await db.clear(s).catch(() => {}); }
  let n = 0;
  for (const p of data.progress || []) {
    const existing = mode === 'merge' ? await db.get('progress', p.lessonId).catch(() => null) : null;
    const merged = existing ? {
      ...existing,
      sectionsRead: Array.from(new Set([...(existing.sectionsRead || []), ...(p.sectionsRead || [])])),
      problemsSolved: Array.from(new Set([...(existing.problemsSolved || []), ...(p.problemsSolved || [])])),
      quizAttempts: (existing.quizAttempts || 0) + (p.quizAttempts || 0),
      quizBest: (!existing.quizBest || (p.quizBest && p.quizBest.pct > existing.quizBest.pct)) ? p.quizBest : existing.quizBest,
      firstAt: Math.min(existing.firstAt || Infinity, p.firstAt || Infinity) || null,
      lastAt: Math.max(existing.lastAt || 0, p.lastAt || 0) || null,
    } : p;
    await db.put('progress', merged); n++;
  }
  for (const r of data.results || []) { await db.add('results', r).catch(() => {}); }
  for (const a of data.activity || []) {
    const ex = mode === 'merge' ? await db.get('activity', a.day).catch(() => null) : null;
    await db.put('activity', ex ? { ...ex, sections: ex.sections + (a.sections || 0), quizzes: ex.quizzes + (a.quizzes || 0), problems: ex.problems + (a.problems || 0), tutor: ex.tutor + (a.tutor || 0) } : a).catch(() => {});
  }
  emit(null);
  return n;
}

export async function resetProgress() {
  for (const s of ['progress', 'results', 'activity']) await db.clear(s).catch(() => {});
  emit(null);
}
