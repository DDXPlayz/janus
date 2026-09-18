// The JANUS local tutor. Not an AI model: it is intent matching plus BM25
// retrieval over the knowledge base installed on this device. Every answer
// links to the lesson it came from, and weak matches say so.

import { db } from './db.js';
import { getSetting } from './settings.js';
import { installedLessons, getLesson, renderText, escapeHtml, SUBJECT_META, catalogueLesson } from './content.js';
import { buildIndex, buildCatalogueIndex, tokenize, stem } from './retrieval.js';
import { noteTutorUse } from './progress.js';

const INTENTS = [
  { name: 'simpler', re: /\b(simpler|simplify|simple(r)? (words|language|terms|version)|easier (words|language|terms|explanation)|explain (it |this |that )?(more )?simply|eli5|plain (english|language)|in simpler)/i },
  { name: 'hindi', re: /\b(hindi|हिंदी|हिन्दी|hindi me|in hindi)\b/i },
  { name: 'step', re: /\b(step)\s*(\d+)|(\d+)(st|nd|rd|th)\s+step|\bstep\s+(one|two|three|four|five|six)\b/i },
  { name: 'harder', re: /\b(harder|more difficult|tougher|more challenging|challenge me|difficult(er)? problem|next level)\b/i },
  { name: 'easier', re: /\b(easier|less difficult|simpler problem|easy problem|too hard|something easier)\b/i },
  { name: 'quiz', re: /\b(quiz me|test me|start (a |the )?quiz|give me a quiz|quiz)\b/i },
  { name: 'problem', re: /\b(give me a problem|practice problem|a problem to (solve|try)|problem set|let me practi[sc]e|exercise)\b/i },
  { name: 'define', re: /^\s*(what is|what's|whats|what are|define|definition of|meaning of|what does .+ mean|explain the term)\s+(.+?)\??\s*$/i },
  { name: 'help', re: /^\s*(help|what can you do|how do (you|i) (work|use this)|\?)\s*\??$/i },
];
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

/** The numeric result a solution step arrives at: the first number after its last "=" (handles "4.265 × 10¹³"). */
export function resultOfStep(step) {
  const eq = step.lastIndexOf('=');
  if (eq < 0) return null;
  const tail = step.slice(eq + 1).replace(/\s+/g, ' ');
  const m = tail.match(/-?\d+(?:[ \u202f\u2009]\d{3})*(?:[.,]\d+)?(?:\s*[×x]\s*10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+))?/);
  if (!m) return null;
  let v = parseFloat(m[0].split(/[×x]/)[0].replace(/[ \u202f\u2009]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(/,/g, '.'));
  if (m[1]) v *= Math.pow(10, parseInt(m[1].split('').map((c) => SUP[c] || '').join(''), 10));
  return Number.isFinite(v) ? v : null;
}

export class Tutor {
  constructor() {
    this.index = null; this.catIndex = null; this.installed = new Set();
    this.lessons = new Map();
    this.state = { lessonId: null, last: null, problem: null, example: null, pendingCheck: null };
    this.ready = this.rebuild();
  }

  async rebuild(catalogueLessons) {
    const lessons = await installedLessons();
    this.lessons = new Map(lessons.map((l) => [l.id, l]));
    this.installed = new Set(lessons.map((l) => l.id));
    this.index = buildIndex(lessons);
    if (catalogueLessons) this.catIndex = buildCatalogueIndex(catalogueLessons);
    this.catalogueLessons = catalogueLessons || this.catalogueLessons || [];
    return this;
  }

  setCurrentLesson(id) { this.state.lessonId = id || null; }

  async history() { try { return await db.getAll('tutor'); } catch (e) { return []; } }
  async remember(role, entry) { try { await db.add('tutor', { role, ...entry, ts: Date.now() }); } catch (e) { /* ignore */ } }
  async clearHistory() { try { await db.clear('tutor'); } catch (e) { /* ignore */ } }

  async ask(raw) {
    await this.ready;
    const text = String(raw || '').trim();
    if (!text) return this.reply({ kind: 'help', html: '<p>Ask about a topic, a formula or a term from your downloaded lessons.</p>' });
    noteTutorUse();
    await this.remember('user', { text });

    // A pending numeric check from "I don't understand step N".
    if (this.state.pendingCheck && /^-?[\d.,\s]+(?:e-?\d+)?$/i.test(text)) {
      const chk = this.state.pendingCheck; this.state.pendingCheck = null;
      const val = parseFloat(text.replace(/[,\s]/g, ''));
      const ok = Math.abs(val - chk.answer) <= Math.max(Math.abs(chk.answer) * 0.02, 0.01);
      return this.reply({ kind: 'check', html: ok ? `<p><strong>Yes — ${escapeHtml(String(chk.answer))}.</strong> That is what step ${chk.step} produces. Carry on to step ${chk.step + 1}, or ask about it.</p>` : `<p>Not quite. Step ${chk.step} arrives at <strong>${escapeHtml(String(chk.answer))}</strong>. Re-read the step above; ask <em>"explain step ${chk.step} simpler"</em> if it still does not click.</p>`, source: chk.source });
    }

    let m;
    for (const it of INTENTS) {
      if ((m = it.re.exec(text))) {
        const r = await this['intent_' + it.name](text, m);
        if (r) return this.reply(r);
      }
    }
    return this.reply(await this.searchAnswer(text));
  }

  async reply(r) {
    r.confidence = r.confidence || 'high';
    await this.remember('tutor', { html: r.html, text: r.text || '', source: r.source || null, confidence: r.confidence, note: r.note || '' });
    return r;
  }

  // ---------- intents ----------

  intent_help() {
    return { kind: 'help', html: `<p>I am the local tutor: I search the lessons downloaded to this device and quote them back with a link to the source. I cannot answer about anything that is not in an installed pack.</p><p>Try: <em>"why does a satellite stay in orbit"</em>, <em>"what is a mole"</em>, <em>"explain this in simpler language"</em>, <em>"explain in Hindi"</em>, <em>"give me a harder problem"</em>, <em>"I don't understand step 2"</em>, <em>"quiz me"</em>.</p>` };
  }

  async intent_simpler() {
    const last = this.state.last;
    if (!last) return { kind: 'info', html: '<p>Ask me about a topic first, then I can re-explain it at the simpler reading level.</p>', confidence: 'medium' };
    const lang = getSetting('language');
    if (last.type === 'section') {
      const useHi = lang === 'hi' && last.simple_hi;
      const body = useHi ? last.simple_hi : last.simple;
      return this.passageReply(last, { level: 'simple', lang: useHi ? 'hi' : 'en', intro: 'Simpler version of <em>' + escapeHtml(last.heading) + '</em>:', bodyOverride: body });
    }
    if (last.type === 'example' && last.steps_simple) {
      return { kind: 'passage', source: this.src(last), html: `<p>Simpler walk-through of <em>${escapeHtml(last.heading)}</em>:</p><ol>${last.steps_simple.map((s) => '<li>' + renderText(s) + '</li>').join('')}</ol>`, text: last.steps_simple.join(' ') };
    }
    if (last.type === 'glossary') return { kind: 'passage', source: this.src(last), html: `<p><strong>${escapeHtml(last.term)}</strong> — in plain words: ${renderText(last.def)}</p><p>This glossary entry has only one reading level. Ask about the topic itself for a longer, simpler explanation.</p>` };
    return { kind: 'info', html: '<p>That passage has only one version. Ask about the topic itself and I will pick the section with a simpler reading level.</p>', confidence: 'medium' };
  }

  async intent_hindi(text) {
    const last = this.state.last;
    const hindiLessons = Array.from(this.lessons.values()).filter((l) => l.hindi_full);
    const list = hindiLessons.length ? hindiLessons.map((l) => `<a href="#/lesson/${l.id}">${escapeHtml(l.title_hi || l.title)}</a>`).join(', ') : 'none of the installed lessons';
    const stripped = text.replace(/\b(in |explain (this |it )?in )?(hindi|हिंदी|हिन्दी)\b/ig, '').replace(/\bme\b/ig, '').trim();
    if (stripped.length > 3 && !last) {
      const r = await this.searchAnswer(stripped, { lang: 'hi' });
      return r;
    }
    if (!last) return { kind: 'info', html: `<p>Ask me about a topic first. Full Hindi text exists for: ${list}. Every lesson has a Hindi title and summary.</p>`, confidence: 'medium' };
    if (last.type === 'section' && last.text_hi) {
      const level = getSetting('readingLevel');
      const body = level === 'simple' && last.simple_hi ? last.simple_hi : last.text_hi;
      return this.passageReply(last, { lang: 'hi', level, intro: 'हिंदी में:', bodyOverride: body });
    }
    if (last.type === 'glossary' && last.def_hi) return { kind: 'passage', source: this.src(last), html: `<p lang="hi"><strong>${escapeHtml(last.term)}</strong> — ${escapeHtml(last.def_hi)}</p>`, text: last.def_hi };
    return { kind: 'info', html: `<p>Honest answer: <em>${escapeHtml(last.lessonTitle)}</em> has a Hindi title and summary but its full text is English-only in this release. Full Hindi text is available for: ${list}.</p>` };
  }

  async intent_step(text, m) {
    const n = parseInt(m[2] || m[3], 10) || WORD_NUM[(m[5] || '').toLowerCase()] || 0;
    const ctx = this.state.example || this.state.problem || (this.state.last && this.state.last.steps ? this.state.last : null);
    if (!ctx || !ctx.steps) return { kind: 'info', confidence: 'medium', html: '<p>Which solution? Open a worked example or ask for a problem first, then tell me the step number you are stuck on.</p>' };
    if (n < 1 || n > ctx.steps.length) return { kind: 'info', confidence: 'medium', html: `<p><em>${escapeHtml(ctx.heading)}</em> has ${ctx.steps.length} steps. Which one, 1–${ctx.steps.length}?</p>` };
    const simple = ctx.steps_simple && ctx.steps_simple[n - 1];
    const original = ctx.steps[n - 1];
    const answer = resultOfStep(original);
    let check = '';
    if (answer !== null) {
      this.state.pendingCheck = { answer, step: n, source: this.src(ctx) };
      check = `<p class="tutor-check"><strong>Quick check:</strong> what value does step ${n} arrive at? Type just the number and I will compare it.</p>`;
    } else {
      check = `<p class="tutor-check"><strong>Quick check:</strong> in one sentence, what does step ${n} change compared with step ${Math.max(1, n - 1)}? (Say "step ${n + 1}" when you are ready to move on.)</p>`;
    }
    const prev = n > 1 ? `<p class="muted">Step ${n - 1} left us with: ${renderText(ctx.steps[n - 2])}</p>` : '';
    return { kind: 'passage', source: this.src(ctx), html: `<p>Step ${n} of <em>${escapeHtml(ctx.heading)}</em>, explained again${simple ? ' at the simpler level' : ''}:</p>${prev}<blockquote>${renderText(simple || original)}</blockquote>${simple ? '<p class="muted">Original wording: ' + renderText(original) + '</p>' : ''}${check}`, text: simple || original };
  }

  async intent_harder() { return this.pickProblem(+1); }
  async intent_easier() { return this.pickProblem(-1); }
  async intent_problem() { return this.pickProblem(0); }

  async pickProblem(direction) {
    const lessonId = (this.state.problem && this.state.problem.lessonId) || this.state.lessonId || (this.state.last && this.state.last.lessonId);
    const L = lessonId ? this.lessons.get(lessonId) : null;
    if (!L) return { kind: 'info', confidence: 'medium', html: '<p>Open a lesson (or ask me about a topic) first so I know which problem set to draw from.</p>' };
    const problems = L.problems || [];
    const cur = this.state.problem && this.state.problem.lessonId === L.id ? this.state.problem.difficulty : 0;
    let pick;
    if (direction > 0) pick = problems.filter((p) => p.difficulty > cur).sort((a, b) => a.difficulty - b.difficulty)[0];
    else if (direction < 0) pick = problems.filter((p) => p.difficulty < cur).sort((a, b) => b.difficulty - a.difficulty)[0];
    else pick = problems.find((p) => p.difficulty === 1) || problems[0];
    if (!pick) {
      const msg = direction > 0 ? `That was already the hardest problem in <em>${escapeHtml(L.title)}</em> (difficulty ${cur} of ${Math.max(...problems.map((p) => p.difficulty))}).` : `That was already the easiest problem in <em>${escapeHtml(L.title)}</em>.`;
      const next = direction > 0 ? this.nextLesson(L) : null;
      return { kind: 'info', confidence: 'medium', html: `<p>${msg}${next ? ` For more of a challenge, try <a href="#/lesson/${next.id}">${escapeHtml(next.title)}</a> (${next.level}).` : ''}</p>` };
    }
    const index = problems.indexOf(pick);
    const meta = { type: 'problem', lessonId: L.id, lessonTitle: L.title, subject: L.subject, index, heading: pick.title, difficulty: pick.difficulty, steps: pick.steps, statement: pick.statement, answer: pick.answer };
    this.state.problem = meta; this.state.example = null; this.state.last = meta;
    const lead = direction > 0 && cur ? 'Harder' : direction < 0 ? 'Easier' : direction > 0 ? 'Starting with the first' : 'A';
    return { kind: 'problem', source: this.src(meta), html: `<p>${lead} problem from <em>${escapeHtml(L.title)}</em> — <strong>${escapeHtml(pick.title)}</strong> (difficulty ${pick.difficulty} of 3):</p><blockquote>${renderText(pick.statement)}</blockquote><details><summary>Reveal the ${pick.steps.length}-step solution</summary><ol>${pick.steps.map((s) => '<li>' + renderText(s) + '</li>').join('')}</ol><p><strong>Answer:</strong> ${escapeHtml(pick.answer)}</p></details><p class="muted">Stuck? Say <em>"I don't understand step 2"</em>. Want to record it? Open it in <a href="#/problems/${L.id}">the problem set</a>.</p>`, text: pick.statement };
  }

  nextLesson(L) {
    const all = Array.from(this.lessons.values()).filter((x) => x.subject === L.subject).sort((a, b) => a.order - b.order);
    return all.find((x) => x.order > L.order) || null;
  }

  async intent_quiz() {
    const lessonId = this.state.lessonId || (this.state.last && this.state.last.lessonId);
    const L = lessonId ? this.lessons.get(lessonId) : null;
    if (!L) return { kind: 'info', confidence: 'medium', html: '<p>Open a lesson first, or ask me about a topic, and then say "quiz me" to start that lesson\'s quiz.</p>' };
    return { kind: 'action', source: this.src({ lessonId: L.id, lessonTitle: L.title }), navigate: '#/quiz/' + L.id, html: `<p>Starting the ${L.quiz.length}-question quiz for <em>${escapeHtml(L.title)}</em>. <a href="#/quiz/${L.id}">Open the quiz</a> if it did not open automatically.</p>` };
  }

  async intent_define(text, m) {
    const termRaw = (m[2] || '').replace(/^(a|an|the)\s+/i, '').replace(/[?.!]+$/, '').trim();
    if (!termRaw) return null;
    const hit = this.findGlossary(termRaw);
    if (hit) {
      this.state.last = hit;
      const lang = getSetting('language');
      const def = lang === 'hi' && hit.def_hi ? hit.def_hi : hit.def;
      return { kind: 'passage', source: this.src(hit), html: `<p><strong>${escapeHtml(hit.term)}</strong> — ${escapeHtml(def)}</p>${lang === 'hi' && !hit.def_hi ? '<p class="muted">No Hindi definition for this term yet; showing English.</p>' : ''}`, text: def };
    }
    return this.searchAnswer(termRaw, { defineFallback: termRaw });
  }

  findGlossary(term) {
    const q = tokenize(term).join(' ');
    const norm = term.toLowerCase().trim();
    let best = null;
    for (const L of this.lessons.values()) {
      for (let i = 0; i < (L.glossary || []).length; i++) {
        const g = L.glossary[i];
        const t = g.term.toLowerCase();
        const ts = tokenize(g.term).join(' ');
        if (t === norm || ts === q) return { type: 'glossary', lessonId: L.id, lessonTitle: L.title, subject: L.subject, index: i, term: g.term, def: g.def, def_hi: g.def_hi };
        if (!best && (norm.includes(t) || t.includes(norm)) && Math.abs(t.length - norm.length) <= 6) best = { type: 'glossary', lessonId: L.id, lessonTitle: L.title, subject: L.subject, index: i, term: g.term, def: g.def, def_hi: g.def_hi };
      }
    }
    return best;
  }

  // ---------- retrieval ----------

  async searchAnswer(query, opts = {}) {
    const res = this.index ? this.index.search(query, 4) : { hits: [], queryTokens: [], matchedTokens: [] };
    const cat = this.catIndex ? this.catIndex.search(query, 3, (m) => !this.installed.has(m.lessonId)) : { hits: [] };
    const coverage = res.queryTokens.length ? res.matchedTokens.length / res.queryTokens.length : 0;
    const top = res.hits[0];
    const catTop = cat.hits[0];
    const suggestion = catTop ? this.packSuggestion(catTop.meta) : '';

    if (!this.installed.size) {
      return { kind: 'none', confidence: 'none', html: `<p>No content packs are installed on this device yet, so I have nothing to search. <a href="#/packs">Build and download a pack</a> first.</p>${suggestion}`, note: 'No packs installed.' };
    }
    if (!top || coverage < 0.34 || (catTop && catTop.score > top.score * 1.6)) {
      const partial = top ? `<p>The closest thing I have is <em>${escapeHtml(top.meta.heading || top.meta.term || top.meta.lessonTitle)}</em> in <a href="#/lesson/${top.meta.lessonId}">${escapeHtml(top.meta.lessonTitle)}</a>, but it only matches ${Math.round(coverage * 100)}% of your words.</p>` : '';
      return { kind: 'none', confidence: top ? 'low' : 'none', html: `<p>I couldn't find this in your downloaded packs.</p>${partial}${suggestion || '<p>Try different words, or check the <a href="#/library">library</a> to see which lessons are installed.</p>'}`, note: 'Weak match: ' + Math.round(coverage * 100) + '% of query terms found.' };
    }
    const meta = top.meta;
    this.state.last = meta;
    if (meta.type === 'example') this.state.example = meta;
    if (meta.type === 'problem') this.state.problem = meta;
    const confidence = coverage >= 0.66 && top.score >= 2.5 ? 'high' : 'medium';
    const note = confidence === 'medium' ? `Partial match (${Math.round(coverage * 100)}% of your words appear in this passage). If this is not what you meant, try other words.` : '';
    const alt = res.hits.slice(1, 3).filter((h) => h.score > top.score * 0.45).map((h) => `<a href="${this.hash(h.meta)}">${escapeHtml(h.meta.heading || h.meta.term || h.meta.lessonTitle)}</a>`);
    const extra = (alt.length ? `<p class="muted">Also relevant: ${alt.join(' · ')}</p>` : '') + (catTop && catTop.score > top.score * 0.8 ? suggestion : '');
    const r = this.passageReply(meta, { lang: opts.lang, extra });
    r.confidence = confidence; r.note = note;
    return r;
  }

  packSuggestion(catMeta) {
    const c = catalogueLesson(catMeta.lessonId) || catMeta;
    const subj = SUBJECT_META[c.subject] ? SUBJECT_META[c.subject].name : c.subject;
    return `<p class="tutor-suggest">The lesson <em>${escapeHtml(c.title || c.lessonTitle)}</em> (${escapeHtml(subj)}, ${escapeHtml(c.level)}) covers this but is not downloaded — <a href="#/packs?subject=${c.subject}">download the ${escapeHtml(subj)} pack</a> to cover it.</p>`;
  }

  passageReply(meta, opts = {}) {
    const lang = opts.lang || getSetting('language');
    const level = opts.level || getSetting('readingLevel');
    let html = opts.intro ? `<p>${opts.intro}</p>` : '';
    let text = '';
    if (meta.type === 'section') {
      let body = opts.bodyOverride;
      let fallback = '';
      if (!body) {
        const wantHi = lang === 'hi';
        const hiText = level === 'simple' ? meta.simple_hi : meta.text_hi;
        if (wantHi && hiText) body = hiText;
        else { body = level === 'simple' ? (meta.simple || meta.text) : meta.text; if (wantHi) fallback = '<p class="muted">Hindi text is not available for this section; showing English.</p>'; }
      }
      html += `<p class="tutor-from">From <em>${escapeHtml(meta.heading)}</em> in <a href="#/lesson/${meta.lessonId}#${meta.sectionId}">${escapeHtml(meta.lessonTitle)}</a> (${level === 'simple' ? 'simpler' : 'standard'} level${opts.lang === 'hi' || (lang === 'hi' && body === (meta.text_hi || meta.simple_hi)) ? ', Hindi' : ''}):</p>${fallback}<blockquote${lang === 'hi' && (body === meta.text_hi || body === meta.simple_hi) ? ' lang="hi"' : ''}>${renderText(body)}</blockquote>`;
      text = body;
    } else if (meta.type === 'formula') {
      html += `<p><strong>${escapeHtml(meta.heading)}</strong></p><p class="formula-big"><code class="f">${escapeHtml(meta.expr)}</code></p>${meta.note ? '<p>' + escapeHtml(meta.note) + '</p>' : ''}`;
      text = meta.heading + ': ' + meta.expr + '. ' + (meta.note || '');
    } else if (meta.type === 'glossary') {
      const def = lang === 'hi' && meta.def_hi ? meta.def_hi : meta.def;
      html += `<p><strong>${escapeHtml(meta.term)}</strong> — ${escapeHtml(def)}</p>`; text = def;
    } else if (meta.type === 'example') {
      const steps = level === 'simple' && meta.steps_simple ? meta.steps_simple : meta.steps;
      html += `<p>Worked example <em>${escapeHtml(meta.heading)}</em>:</p><blockquote>${renderText(meta.problem)}</blockquote><ol>${steps.map((s) => '<li>' + renderText(s) + '</li>').join('')}</ol><p><strong>Answer:</strong> ${escapeHtml(meta.answer)}</p><p class="muted">Say <em>"I don't understand step 2"</em> for a re-explanation with a check question.</p>`;
      text = meta.problem + ' ' + steps.join(' ');
    } else if (meta.type === 'problem') {
      html += `<p>Problem <em>${escapeHtml(meta.heading)}</em> (difficulty ${meta.difficulty} of 3):</p><blockquote>${renderText(meta.statement)}</blockquote><details><summary>Reveal solution</summary><ol>${meta.steps.map((s) => '<li>' + renderText(s) + '</li>').join('')}</ol><p><strong>Answer:</strong> ${escapeHtml(meta.answer)}</p></details>`;
      text = meta.statement;
    } else if (meta.type === 'constant') {
      html += `<p><strong>${escapeHtml(meta.heading)}</strong>${meta.symbol ? ' (' + escapeHtml(meta.symbol) + ')' : ''} = <code class="f">${escapeHtml(meta.value)} ${escapeHtml(meta.unit || '')}</code></p>`;
      text = meta.heading + ' equals ' + meta.value + ' ' + (meta.unit || '');
    }
    html += opts.extra || '';
    return { kind: 'passage', html, text, source: this.src(meta) };
  }

  src(meta) {
    if (!meta || !meta.lessonId) return null;
    return { lessonId: meta.lessonId, title: meta.lessonTitle, hash: this.hash(meta), type: meta.type };
  }
  hash(meta) {
    if (meta.type === 'problem') return '#/problems/' + meta.lessonId;
    if (meta.type === 'section') return '#/lesson/' + meta.lessonId + '#' + meta.sectionId;
    return '#/lesson/' + meta.lessonId;
  }
}

export const tutor = new Tutor();
