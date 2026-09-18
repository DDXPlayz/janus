// Learning views: library, lesson reader, quiz, problem set, simulations.
import { getSetting, setSettings, onSettingsChange } from './settings.js';
import { getCatalogue, getLesson, installedLessonIds, sectionText, lessonTitle, lessonSummary, renderText, SUBJECTS, SUBJECT_META, LEVELS, formatBytes, escapeHtml } from './content.js';
import { getProgress, allProgress, markSectionRead, recordQuiz, markProblemSolved, lessonCompletion, onProgressChange } from './progress.js';
import { illustration, illustrationBytes, ICON } from './illustrations.js';
import { SIMS, mountSim } from './sims.js';
import { $, $$, el, html, esc, toast, setTitle, navigate, levelBadge, subjectBadge, ttsControls, speech } from './ui.js';

// ------------------------------------------------------------ LIBRARY
export async function library(ctx) {
  const { view, query } = ctx;
  const cat = getCatalogue();
  const installed = await installedLessonIds();
  const progress = Object.fromEntries((await allProgress()).map((p) => [p.lessonId, p]));
  const lang = getSetting('language');
  const filt = { subject: query.get('subject') || 'all', level: query.get('level') || 'all', only: query.get('only') === 'installed' };
  setTitle('Library');
  const hindiNote = `Hindi: ${cat.hindi.fullLessons} of ${cat.lessons.length} lessons fully translated; titles and summaries for all ${cat.lessons.length}.`;
  view.innerHTML = `
    <div class="view-head">
      <p class="eyebrow">Library</p>
      <h1>${lang === 'hi' ? 'पाठ पुस्तकालय' : 'All lessons'}</h1>
      <p class="muted">${installed.size} of ${cat.lessons.length} lessons downloaded to this device. ${esc(hindiNote)} ${installed.size < cat.lessons.length ? '<a href="#/packs">Download more in Packs</a>.' : ''}</p>
    </div>
    <div class="filters" role="group" aria-label="Filter lessons">
      <button type="button" class="chip" data-f="subject" data-v="all" aria-pressed="${filt.subject === 'all'}">All subjects</button>
      ${SUBJECTS.map((s) => `<button type="button" class="chip" data-f="subject" data-v="${s}" aria-pressed="${filt.subject === s}">${esc(lang === 'hi' ? SUBJECT_META[s].name_hi : SUBJECT_META[s].name)}</button>`).join('')}
      <span aria-hidden="true" style="width:.5rem"></span>
      ${LEVELS.map((l) => `<button type="button" class="chip" data-f="level" data-v="${l}" aria-pressed="${filt.level === l}">${l}</button>`).join('')}
      <button type="button" class="chip" data-f="only" data-v="installed" aria-pressed="${filt.only}">Downloaded only</button>
    </div>
    <div id="lib-groups"></div>`;
  const groups = $('#lib-groups', view);
  for (const s of SUBJECTS) {
    if (filt.subject !== 'all' && filt.subject !== s) continue;
    const lessons = cat.lessons.filter((l) => l.subject === s && (filt.level === 'all' || l.level === filt.level) && (!filt.only || installed.has(l.id))).sort((a, b) => a.order - b.order);
    if (!lessons.length) continue;
    const installedCount = cat.lessons.filter((l) => l.subject === s && installed.has(l.id)).length;
    groups.appendChild(html(`<div class="subject-head"><h2>${esc(lang === 'hi' ? SUBJECT_META[s].name_hi : SUBJECT_META[s].name)}</h2><span class="badge neutral">${installedCount}/${cat.lessons.filter((l) => l.subject === s).length} downloaded</span></div>`));
    const grid = el('<div class="grid"></div>');
    for (const l of lessons) {
      const isIn = installed.has(l.id);
      const p = progress[l.id];
      const pct = p ? lessonCompletion(p) : 0;
      grid.appendChild(html(`<article class="card lesson-card ${isIn ? '' : 'locked'}">
        <div class="meta">${levelBadge(l.level)}${l.hindi_full ? '<span class="badge neutral" lang="hi">हिंदी ✓</span>' : ''}${l.sim ? '<span class="badge neutral">Simulation</span>' : ''}</div>
        <h3>${isIn ? `<a href="#/lesson/${l.id}">${esc(lang === 'hi' && l.title_hi ? l.title_hi : l.title)}</a>` : `<span>${esc(lang === 'hi' && l.title_hi ? l.title_hi : l.title)}</span>`}</h3>
        <p class="summary">${esc(lang === 'hi' && l.summary_hi ? l.summary_hi : l.summary)}</p>
        ${isIn ? `<div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Lesson completion ${pct}%"><span style="width:${pct}%"></span></div>` : ''}
        <div class="foot">${isIn ? `<span>${pct}% complete · ${l.sections} sections · ${l.quiz}-question quiz</span>` : `<span class="row" style="gap:.3rem">${ICON.lock} Not downloaded · ${formatBytes(l.bytes)}</span><a class="btn small ghost actions" href="#/packs?subject=${l.subject}">Get pack</a>`}</div>
      </article>`));
    }
    groups.appendChild(grid);
  }
  if (!groups.children.length) groups.innerHTML = '<div class="notice">No lessons match these filters.</div>';
  $$('.filters .chip', view).forEach((b) => b.addEventListener('click', () => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    if (b.dataset.f === 'only') { if (q.get('only') === 'installed') q.delete('only'); else q.set('only', 'installed'); }
    else if (b.dataset.v === 'all' || q.get(b.dataset.f) === b.dataset.v) q.delete(b.dataset.f); else q.set(b.dataset.f, b.dataset.v);
    navigate('#/library' + (q.toString() ? '?' + q.toString() : ''));
  }));
}

// ------------------------------------------------------------ LESSON READER
export async function lesson(ctx) {
  const { view, params, fragment, app } = ctx;
  const L = await getLesson(params.id);
  const cat = getCatalogue();
  const c = cat.lessons.find((x) => x.id === params.id);
  if (!L) {
    setTitle(c ? c.title : 'Lesson');
    app.tutor.setCurrentLesson(null);
    view.innerHTML = `<div class="view-head"><p class="crumbs"><a href="#/library">Library</a></p><h1>${esc(c ? c.title : 'Unknown lesson')}</h1></div>
      <div class="card notebook stack"><p class="row" style="gap:.4rem"><strong>${ICON.lock} Not downloaded.</strong></p>
      ${c ? `<p>${esc(c.summary)}</p><p>This ${esc(c.level)} lesson is part of the <strong>${esc(SUBJECT_META[c.subject].name)}</strong> content (${formatBytes(c.bytes)}). Build a pack that includes it, or import a pack file from another device.</p><p><a class="btn primary" href="#/packs?subject=${c.subject}&level=${c.level}">Get the ${esc(SUBJECT_META[c.subject].name)} pack</a> <a class="btn ghost" href="#/library">Back to library</a></p>` : '<p>No lesson with this id exists in the catalogue. <a href="#/library">Back to the library</a>.</p>'}</div>`;
    return;
  }
  app.tutor.setCurrentLesson(L.id);
  setTitle(L.title);
  let level = getSetting('readingLevel');
  let lang = getSetting('language');
  const hasHi = !!L.hindi_full;
  const progress = await getProgress(L.id);
  const siblings = (await installedLessonIds());
  const subjLessons = cat.lessons.filter((x) => x.subject === L.subject).sort((a, b) => a.order - b.order);
  const idx = subjLessons.findIndex((x) => x.id === L.id);
  const prev = subjLessons[idx - 1], next = subjLessons[idx + 1];
  const lbMode = getSetting('lowBandwidth');
  if (lbMode) setSettings({ illustrationBytesSaved: (getSetting('illustrationBytesSaved') || 0) + illustrationBytes(L.illustration) });

  const render = () => {
    const useHi = lang === 'hi' && hasHi;
    view.innerHTML = `
      <div class="view-head reader">
        <p class="crumbs"><a href="#/library">Library</a> › <a href="#/library?subject=${L.subject}">${esc(SUBJECT_META[L.subject].name)}</a> › Lesson ${L.order}</p>
        <div class="row" style="margin-bottom:.5rem">${subjectBadge(L.subject)}${levelBadge(L.level)}${hasHi ? '<span class="badge neutral" lang="hi">हिंदी उपलब्ध</span>' : '<span class="badge neutral">Hindi: title &amp; summary only</span>'}${L.sim ? '<span class="badge neutral">Includes simulation</span>' : ''}</div>
        <h1 ${useHi ? 'lang="hi"' : ''}>${esc(lessonTitle(L, useHi ? 'hi' : 'en'))}</h1>
        <p class="lead" ${useHi ? 'lang="hi"' : ''}>${esc(lessonSummary(L, useHi ? 'hi' : 'en'))}</p>
        ${lang === 'hi' && !hasHi ? '<p class="notice warn">You asked for Hindi. This lesson has a Hindi title and summary only; the sections below are in English. Full Hindi text exists for ' + cat.hindi.fullLessons + ' of ' + cat.lessons.length + ' lessons.</p>' : ''}
      </div>
      <div class="reader">
        <div class="reader-tools" role="toolbar" aria-label="Reading tools">
          <span class="group"><span>Reading level</span><button type="button" class="chip" data-level="standard" aria-pressed="${level === 'standard'}">Standard</button><button type="button" class="chip" data-level="simple" aria-pressed="${level === 'simple'}">Simpler</button></span>
          <span class="group"><span>Language</span><button type="button" class="chip" data-lang="en" aria-pressed="${lang === 'en'}">English</button><button type="button" class="chip" data-lang="hi" aria-pressed="${lang === 'hi'}" lang="hi">हिंदी</button></span>
          <span class="group" id="tts-all"></span>
        </div>
        ${illustration(L.illustration, L.illustration_alt)}<p class="illus-desc">Illustration (not loaded in low-bandwidth mode): ${esc(L.illustration_alt)}</p>
        <div id="sections"></div>
        <section class="card flat" aria-labelledby="h-formulas"><h2 id="h-formulas">Key formulas</h2><div class="formula-list">${L.formulas.map((f) => `<div class="formula"><div class="name">${esc(f.name)}</div><div class="expr">${esc(f.expr)}</div>${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}</div>`).join('')}</div></section>
        <div id="examples" class="stack" style="margin-top:1.4rem"></div>
        <div class="grid two" style="margin:1.4rem 0">
          <section class="card tinted"><h2>Quiz</h2><p>${L.quiz.length} questions: multiple choice and numeric with tolerance.${progress.quizBest ? ` Best so far: <strong>${progress.quizBest.score}/${progress.quizBest.total}</strong> (${progress.quizAttempts} attempt${progress.quizAttempts === 1 ? '' : 's'}).` : ''}</p><a class="btn primary" href="#/quiz/${L.id}">Start quiz</a></section>
          <section class="card tinted"><h2>Problem set</h2><p>${L.problems.length} problems from easy to hard, with step-by-step solutions. Solved: <strong>${progress.problemsSolved.length}/${L.problems.length}</strong>.</p><a class="btn" href="#/problems/${L.id}">Open problems</a></section>
        </div>
        ${L.sim ? `<section class="card" aria-labelledby="h-sim"><h2 id="h-sim">Simulation: ${esc(SIMS[L.sim].title)}</h2><p>${esc(SIMS[L.sim].blurb)}</p><div id="sim-slot"><button type="button" class="btn" id="sim-load">Load simulation</button> <a class="btn ghost" href="#/sim/${L.sim}">Open full page</a></div></section>` : ''}
        <section class="card flat" style="margin-top:1.4rem" aria-labelledby="h-ref"><h2 id="h-ref">Reference</h2>
          <h3>Glossary</h3><dl class="glossary">${L.glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(lang === 'hi' && g.def_hi ? g.def_hi : g.def)}</dd>`).join('')}</dl>
          ${L.constants && L.constants.length ? `<h3>Constants</h3><div class="table-wrap"><table><thead><tr><th>Name</th><th>Symbol</th><th>Value</th><th>Unit</th></tr></thead><tbody>${L.constants.map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.symbol)}</td><td>${esc(k.value)}</td><td>${esc(k.unit)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </section>
        <nav class="row between" style="margin-top:1.5rem" aria-label="Lesson navigation">
          ${prev ? (siblings.has(prev.id) ? `<a class="btn ghost" href="#/lesson/${prev.id}">← ${esc(prev.title)}</a>` : `<span class="muted small">← ${esc(prev.title)} (not downloaded)</span>`) : '<span></span>'}
          ${next ? (siblings.has(next.id) ? `<a class="btn ghost" href="#/lesson/${next.id}">${esc(next.title)} →</a>` : `<span class="muted small">${esc(next.title)} → (not downloaded)</span>`) : ''}
        </nav>
      </div>`;

    // sections
    const secs = $('#sections', view);
    L.sections.forEach((s, i) => {
      const t = sectionText(L, s, { level, lang });
      const read = progress.sectionsRead.includes(s.id);
      const card = el(`<section class="card notebook ruled section-card" id="${s.id}" aria-labelledby="h-${s.id}">
        <h3 id="h-${s.id}" ${t.lang === 'hi' ? 'lang="hi"' : ''}><span class="num">${i + 1} / ${L.sections.length}</span> ${esc(t.heading)}</h3>
        ${t.fallback ? '<p class="small muted">Hindi not available for this section — English shown.</p>' : ''}
        <div class="body" ${t.lang === 'hi' ? 'lang="hi"' : ''}>${renderText(t.text)}</div>
        <div class="sec-foot"><button type="button" class="btn small ${read ? '' : 'ghost'}" data-read="${s.id}" aria-pressed="${read}">${ICON.check}<span>${read ? 'Marked as read' : 'Mark as read'}</span></button></div>
      </section>`);
      card.querySelector('.sec-foot').appendChild(ttsControls(() => t.text, () => t.lang));
      card.querySelector('[data-read]').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget; const now = btn.getAttribute('aria-pressed') !== 'true';
        const p = await markSectionRead(L, s.id, now); progress.sectionsRead = p.sectionsRead;
        btn.setAttribute('aria-pressed', now); btn.classList.toggle('ghost', !now); btn.querySelector('span').textContent = now ? 'Marked as read' : 'Mark as read';
        if (now && p.sectionsRead.length === L.sections.length) toast('All sections read. Try the quiz next.', 'ok');
      });
      secs.appendChild(card);
    });
    $('#tts-all', view).appendChild(ttsControls(() => L.sections.map((s) => { const t = sectionText(L, s, { level, lang }); return t.heading + '. ' + t.text; }).join('\n\n'), () => (lang === 'hi' && hasHi ? 'hi' : 'en')));

    // worked examples with step reveal
    const exWrap = $('#examples', view);
    L.examples.forEach((ex, ei) => {
      const steps = level === 'simple' && ex.steps_simple ? ex.steps_simple : ex.steps;
      const card = el(`<section class="card" aria-labelledby="h-ex-${ei}"><h2 id="h-ex-${ei}">Worked example: ${esc(ex.title)}</h2><blockquote>${renderText(ex.problem)}</blockquote>
        <ol class="steps">${steps.map((st, i) => `<li class="${i ? 'hidden-step' : ''}">${renderText(st)}</li>`).join('')}</ol>
        <div class="row" style="margin-top:.75rem"><button type="button" class="btn small" data-next>Show next step</button><button type="button" class="btn small ghost" data-all>Show all</button><span class="muted small">Stuck on a step? Ask the tutor: <em>"I don't understand step 2"</em>.</span></div>
        <p class="hidden-step answer" style="margin-top:.75rem"><strong>Answer:</strong> ${esc(ex.answer)}</p></section>`);
      const lis = $$('.steps li', card), ans = card.querySelector('.answer');
      let shown = 1;
      const upd = () => { lis.forEach((li, i) => li.classList.toggle('hidden-step', i >= shown)); if (shown >= lis.length) { ans.classList.remove('hidden-step'); card.querySelector('[data-next]').disabled = true; } };
      card.querySelector('[data-next]').addEventListener('click', () => { shown = Math.min(lis.length, shown + 1); upd(); });
      card.querySelector('[data-all]').addEventListener('click', () => { shown = lis.length; upd(); });
      exWrap.appendChild(card);
    });

    // tools
    $$('[data-level]', view).forEach((b) => b.addEventListener('click', () => { level = b.dataset.level; setSettings({ readingLevel: level }); render(); }));
    $$('[data-lang]', view).forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; setSettings({ language: lang }); render(); }));

    // simulation (lazy)
    const loadBtn = $('#sim-load', view);
    if (loadBtn) loadBtn.addEventListener('click', () => { const slot = $('#sim-slot', view); slot.innerHTML = '<div class="sim-wrap"></div>'; ctx.cleanup.push(mountSim(L.sim, slot.firstElementChild).destroy); });

    if (fragment) { const t = document.getElementById(fragment); if (t) { t.scrollIntoView({ block: 'start' }); t.focus && t.setAttribute('tabindex', '-1'); } }
  };
  render();
  ctx.cleanup.push(() => speech.stop());
}

// ------------------------------------------------------------ QUIZ
export async function quiz(ctx) {
  const { view, params, app } = ctx;
  const L = await getLesson(params.id);
  if (!L) { view.innerHTML = `<div class="notice warn">This lesson is not downloaded. <a href="#/lesson/${esc(params.id)}">Details</a></div>`; return; }
  app.tutor.setCurrentLesson(L.id);
  setTitle('Quiz: ' + L.title);
  const qs = L.quiz; let i = 0; const answers = [];
  const head = `<div class="view-head"><p class="crumbs"><a href="#/library">Library</a> › <a href="#/lesson/${L.id}">${esc(L.title)}</a></p><h1>Quiz: ${esc(L.title)}</h1></div>`;
  const renderQ = () => {
    const q = qs[i];
    view.innerHTML = head + `<div class="reader"><div class="card notebook quiz-q"><p class="qnum">QUESTION ${i + 1} OF ${qs.length} · ${q.type === 'mcq' ? 'multiple choice' : 'numeric' + (q.tolerance ? ' (tolerance ±' + q.tolerance + ')' : '')}</p>
      <h2 id="q-text">${esc(q.q)}</h2>
      <form id="q-form">${q.type === 'mcq' ? `<fieldset class="options" aria-labelledby="q-text">${q.options.map((o, k) => `<label class="option"><input type="radio" name="opt" value="${k}" ${k === 0 ? 'required' : ''}> <span>${esc(o)}</span></label>`).join('')}</fieldset>` : `<div class="numeric-in"><label for="num-in" class="visually-hidden">Your answer</label><input type="number" id="num-in" step="any" required inputmode="decimal" autocomplete="off"> <span>${esc(q.unit || '')}</span></div>`}
      <div class="row" style="margin-top:1rem"><button type="submit" class="btn primary">Check answer</button></div></form>
      <div class="feedback" id="feedback" aria-live="polite"></div></div></div>`;
    const form = $('#q-form', view);
    (form.querySelector('input') || form).focus();
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      let correct, given;
      if (q.type === 'mcq') { const sel = form.querySelector('input[name=opt]:checked'); if (!sel) return; given = +sel.value; correct = given === q.answer; $$('.option', form).forEach((o, k) => { if (k === q.answer) o.classList.add('correct'); else if (k === given) o.classList.add('wrong'); }); }
      else { given = parseFloat($('#num-in', form).value); if (Number.isNaN(given)) return; correct = Math.abs(given - q.answer) <= (q.tolerance || 0) + 1e-9; }
      answers.push({ given, correct });
      $$('input, button', form).forEach((x) => { x.disabled = true; });
      $('#feedback', view).innerHTML = `<div class="notice ${correct ? 'ok' : 'err'}"><p><strong>${correct ? 'Correct.' : 'Not quite.'}</strong> ${q.type === 'numeric' ? `Expected ${esc(String(q.answer))}${q.unit ? ' ' + esc(q.unit) : ''}${q.tolerance ? ' (±' + q.tolerance + ')' : ''}; you gave ${esc(String(given))}.` : `The answer is “${esc(q.options[q.answer])}”.`} ${esc(q.explain)}</p><p><button type="button" class="btn small" id="next-q">${i + 1 < qs.length ? 'Next question' : 'See results'}</button></p></div>`;
      $('#next-q', view).focus();
      $('#next-q', view).addEventListener('click', () => { i++; if (i < qs.length) renderQ(); else finish(); });
    });
  };
  const finish = async () => {
    const score = answers.filter((a) => a.correct).length;
    const p = await recordQuiz(L, score, qs.length, answers);
    const pct = Math.round(100 * score / qs.length);
    view.innerHTML = head + `<div class="reader"><div class="card notebook"><p class="eyebrow">Result</p><p class="score-big">${score} / ${qs.length}</p><p>${pct}% — ${pct === 100 ? 'perfect.' : pct >= 75 ? 'good work; review the ones you missed.' : pct >= 50 ? 'a fair start; re-read the sections and try again.' : 'worth another read of the lesson before retrying.'} Best score for this lesson: ${p.quizBest.score}/${p.quizBest.total} over ${p.quizAttempts} attempt${p.quizAttempts === 1 ? '' : 's'}. Saved to your notebook${app.online() ? '' : ' and queued for sync'}.</p>
      <ol class="steps">${qs.map((q, k) => `<li><strong>${answers[k].correct ? '✓' : '✗'}</strong> ${esc(q.q)}<br><span class="small muted">${answers[k].correct ? 'Correct.' : 'Answer: ' + esc(q.type === 'mcq' ? q.options[q.answer] : String(q.answer) + ' ' + (q.unit || ''))}</span></li>`).join('')}</ol>
      <div class="row" style="margin-top:1rem"><button type="button" class="btn primary" id="retry">Try again</button><a class="btn ghost" href="#/lesson/${L.id}">Back to lesson</a><a class="btn ghost" href="#/problems/${L.id}">Problem set</a></div></div></div>`;
    $('#retry', view).addEventListener('click', () => { i = 0; answers.length = 0; renderQ(); });
  };
  renderQ();
}

// ------------------------------------------------------------ PROBLEMS
export async function problems(ctx) {
  const { view, params, app } = ctx;
  const L = await getLesson(params.id);
  if (!L) { view.innerHTML = `<div class="notice warn">This lesson is not downloaded. <a href="#/lesson/${esc(params.id)}">Details</a></div>`; return; }
  app.tutor.setCurrentLesson(L.id);
  setTitle('Problems: ' + L.title);
  const progress = await getProgress(L.id);
  view.innerHTML = `<div class="view-head"><p class="crumbs"><a href="#/library">Library</a> › <a href="#/lesson/${L.id}">${esc(L.title)}</a></p><h1>Problem set: ${esc(L.title)}</h1><p class="muted">Three problems of rising difficulty. Try each on paper first; reveal the solution one step at a time. Mark a problem solved to record it in your notebook.</p></div><div class="reader" id="plist"></div>`;
  const list = $('#plist', view);
  L.problems.forEach((p, i) => {
    const solved = progress.problemsSolved.includes(i);
    const card = el(`<section class="card notebook problem" aria-labelledby="h-p${i}">
      <div class="row between"><span class="diff" aria-label="Difficulty ${p.difficulty} of 3">${[1, 2, 3].map((d) => `<i class="${d <= p.difficulty ? 'on' : ''}"></i>`).join('')} <span class="small muted">${['', 'Easy', 'Medium', 'Hard'][p.difficulty]}</span></span><button type="button" class="btn small ${solved ? '' : 'ghost'}" data-solved aria-pressed="${solved}">${ICON.check}<span>${solved ? 'Solved' : 'Mark solved'}</span></button></div>
      <h2 id="h-p${i}">${i + 1}. ${esc(p.title)}</h2><blockquote>${renderText(p.statement)}</blockquote>
      <ol class="steps" hidden>${p.steps.map((s, k) => `<li class="${k ? 'hidden-step' : ''}">${renderText(s)}</li>`).join('')}</ol>
      <p class="answer hidden-step"><strong>Answer:</strong> ${esc(p.answer)}</p>
      <div class="row" style="margin-top:.75rem"><button type="button" class="btn small" data-step>Reveal step 1 of ${p.steps.length}</button><button type="button" class="btn small ghost" data-all>Reveal all</button><button type="button" class="btn small ghost" data-ask>Ask the tutor about this problem</button></div></section>`);
    const ol = card.querySelector('.steps'), lis = $$('li', ol), ans = card.querySelector('.answer'), nextBtn = card.querySelector('[data-step]');
    let shown = 0;
    const upd = () => { ol.hidden = shown === 0; lis.forEach((li, k) => li.classList.toggle('hidden-step', k >= shown)); if (shown >= lis.length) { ans.classList.remove('hidden-step'); nextBtn.disabled = true; nextBtn.textContent = 'All steps shown'; } else nextBtn.textContent = `Reveal step ${shown + 1} of ${lis.length}`; };
    nextBtn.addEventListener('click', () => { shown++; upd(); });
    card.querySelector('[data-all]').addEventListener('click', () => { shown = lis.length; upd(); });
    card.querySelector('[data-ask]').addEventListener('click', () => { app.openTutor(); app.askTutor('problem: ' + p.title); });
    card.querySelector('[data-solved]').addEventListener('click', async (ev) => { const b = ev.currentTarget; const now = b.getAttribute('aria-pressed') !== 'true'; await markProblemSolved(L, i, now); b.setAttribute('aria-pressed', now); b.classList.toggle('ghost', !now); b.querySelector('span').textContent = now ? 'Solved' : 'Mark solved'; });
    list.appendChild(card);
  });
}

// ------------------------------------------------------------ SIMULATIONS
export async function sims(ctx) {
  const { view } = ctx;
  setTitle('Simulations');
  const installed = await installedLessonIds();
  const cat = getCatalogue();
  view.innerHTML = `<div class="view-head"><p class="eyebrow">Simulations</p><h1>Six things to play with</h1><p class="muted">Canvas simulations that run entirely on this device. Every control is a native slider or select, so they work with the keyboard. In low-bandwidth mode they render at 12 frames per second and half resolution; with reduced motion they start paused.</p></div><div class="grid" id="sim-grid"></div>`;
  const grid = $('#sim-grid', view);
  for (const key of Object.keys(SIMS)) {
    const s = SIMS[key]; const c = cat.lessons.find((l) => l.id === s.lesson);
    grid.appendChild(html(`<article class="card lesson-card"><div class="meta">${c ? subjectBadge(c.subject) : ''}</div><h3><a href="#/sim/${key}">${esc(s.title)}</a></h3><p class="summary">${esc(s.blurb)}</p><div class="foot"><span>Lesson: ${c ? (installed.has(c.id) ? `<a class="actions" href="#/lesson/${c.id}">${esc(c.title)}</a>` : esc(c.title) + ' (not downloaded)') : ''}</span></div></article>`));
  }
}

export async function sim(ctx) {
  const { view, params } = ctx;
  const s = SIMS[params.key];
  if (!s) { view.innerHTML = '<div class="notice warn">Unknown simulation. <a href="#/sims">All simulations</a></div>'; return; }
  setTitle(s.title);
  const cat = getCatalogue(); const c = cat.lessons.find((l) => l.id === s.lesson); const installed = await installedLessonIds();
  view.innerHTML = `<div class="view-head"><p class="crumbs"><a href="#/sims">Simulations</a></p><h1>${esc(s.title)}</h1><p class="muted">${esc(s.blurb)} ${c ? (installed.has(c.id) ? `Read the lesson: <a href="#/lesson/${c.id}">${esc(c.title)}</a>.` : `The related lesson, <em>${esc(c.title)}</em>, is not downloaded — <a href="#/packs?subject=${c.subject}">get the ${esc(SUBJECT_META[c.subject].name)} pack</a>.`) : ''}</p></div><div class="sim-wrap" id="sim-root"></div>`;
  ctx.cleanup.push(mountSim(params.key, $('#sim-root', view)).destroy);
}
