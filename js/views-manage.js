// Management views: content packs, notebook (progress + sync), settings.
import { getSetting, setSettings, resetSettings, APP_VERSION } from './settings.js';
import { db, storageBreakdown, storageEstimate } from './db.js';
import { getCatalogue, installedLessons, SUBJECTS, SUBJECT_META, LEVELS, formatBytes } from './content.js';
import { buildPack, installPack, exportPackFile, importPackFile, listInstalled, removePack, STORAGE_STEPS, SIM_KEYS } from './packs.js';
import { allProgress, lessonCompletion, streaks, exportProgress, importProgress, resetProgress, dayKey } from './progress.js';
import { syncEngine } from './sync.js';
import { getConnection, getSWState, onSWChange, applyUpdate, askVersion } from './net.js';
import { $, $$, el, html, esc, toast, setTitle, fmtDate, fmtAgo, switchRow, confirmDialog, downloadJSON, pickFile, levelBadge, subjectBadge, speech } from './ui.js';

// ------------------------------------------------------------ SYNC PANEL (shared)
export function syncPanel(container) {
  const box = el('<section class="card flat" aria-labelledby="h-sync"><h2 id="h-sync">Sync</h2><div id="sync-body"></div></section>');
  container.appendChild(box);
  const body = box.querySelector('#sync-body');
  let seq = 0;
  const render = async () => {
    const my = ++seq;
    const s = await syncEngine.status();
    if (my !== seq || !body.isConnected) return;
    body.innerHTML = `<p class="notice info"><strong>Target: ${esc(s.targetName)}.</strong> ${esc(s.targetDescription)}</p>
      <div class="grid three">
        <div class="stat card flat"><div class="n">${s.queued}</div><div class="l">queued records</div></div>
        <div class="stat card flat"><div class="n" style="font-size:1.3rem">${s.lastSyncedAt ? esc(fmtAgo(s.lastSyncedAt)) : 'never'}</div><div class="l">last synced</div></div>
        <div class="stat card flat"><div class="n">${s.targetStatus.mirroredRecords}</div><div class="l">records in local mirror</div></div>
      </div>
      <p class="small muted" style="margin-top:.75rem">${s.online ? 'Connection available: queued records are pushed automatically.' : (s.simulated ? 'Offline (simulated): records will be queued until you switch the simulation off.' : 'Offline: records are queued on this device and will sync when the connection returns.')} ${s.lastResult ? `Last run (${esc(s.lastResult.reason)}): pushed ${s.lastResult.pushed}, rejected ${s.lastResult.rejected}, ${esc(fmtDate(s.lastResult.at))}.` : ''} ${s.lastError ? `<span class="badge err">${esc(s.lastError)}</span>` : ''}</p>
      <div class="row"><button type="button" class="btn small" id="sync-now" ${s.syncing ? 'disabled' : ''}>${s.syncing ? 'Syncing…' : 'Sync now'}</button><button type="button" class="btn small ghost" id="sync-view">View mirror (${s.targetStatus.mirroredRecords})</button></div><div id="sync-mirror"></div>`;
    $('#sync-now', body).addEventListener('click', async () => { const r = await syncEngine.syncNow('manual'); toast(r.lastError || `Synced ${r.lastResult ? r.lastResult.pushed : 0} record(s) to the local mirror.`, r.lastError ? 'warn' : 'ok'); });
    $('#sync-view', body).addEventListener('click', async () => {
      const rows = (await db.getAll('synced').catch(() => [])).slice(-15).reverse();
      $('#sync-mirror', body).innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Lesson</th><th>Queued</th><th>Synced</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.type)}</td><td>${esc((r.payload && r.payload.lessonId) || '—')}</td><td>${esc(fmtDate(r.queuedAt))}</td><td>${esc(fmtDate(r.syncedAt))}</td></tr>`).join('')}</tbody></table></div><p class="small muted">Showing the latest ${rows.length} mirrored records.</p>` : '<p class="small muted">The mirror is empty.</p>';
    });
  };
  render();
  return syncEngine.onChange(render);
}

// ------------------------------------------------------------ PACKS
export async function packs(ctx) {
  const { view, query, app } = ctx;
  setTitle('Content packs');
  const cat = getCatalogue();
  const conn = getConnection();
  const sel = { subjects: query.get('subject') ? [query.get('subject')] : [...SUBJECTS], levels: query.get('level') ? [query.get('level')] : [...LEVELS], hindi: true, limitIndex: 7 };
  view.innerHTML = `<div class="view-head"><p class="eyebrow">Content packs</p><h1>Choose what to carry</h1><p class="muted">A pack is a bundle of lessons stored on this device. Pick subjects, levels and languages, set a storage limit, and JANUS measures exactly what fits. ${conn.online ? '' : '<strong>You are offline:</strong> the builder can only use content already cached or installed on this device.'}</p></div>
    <div class="grid two" style="align-items:start">
      <section class="card notebook" aria-labelledby="h-build"><h2 id="h-build">Pack builder</h2>
        <fieldset class="field"><legend class="field-label">Subjects</legend>${SUBJECTS.map((s) => `<label class="check"><input type="checkbox" name="subject" value="${s}" ${sel.subjects.includes(s) ? 'checked' : ''}><span>${esc(SUBJECT_META[s].name)} <span class="hint">${cat.subjects.find((x) => x.id === s).lessonCount} lessons · ${formatBytes(cat.subjects.find((x) => x.id === s).bytes)} full</span></span></label>`).join('')}</fieldset>
        <fieldset class="field"><legend class="field-label">Grade / difficulty</legend>${LEVELS.map((l) => `<label class="check"><input type="checkbox" name="level" value="${l}" ${sel.levels.includes(l) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
        <fieldset class="field"><legend class="field-label">Languages</legend><label class="check"><input type="checkbox" checked disabled><span>English <span class="hint">always included</span></span></label><label class="check"><input type="checkbox" name="hindi" checked><span>Hindi <span class="hint">full text for ${cat.hindi.fullLessons} of ${cat.lessons.length} lessons; titles and summaries for all. Unticking removes the Hindi fields and shrinks the pack.</span></span></label></fieldset>
        <div class="field"><label for="limit">Storage limit: <output id="limit-out">2 MB</output></label><input type="range" id="limit" min="0" max="${STORAGE_STEPS.length - 1}" step="1" value="${sel.limitIndex}" aria-describedby="limit-hint"><span class="hint small muted" id="limit-hint">From 16 KB to 20 MB. Try 64 KB to watch lessons being cut. Foundation lessons are kept first, then Standard, then Advanced.</span></div>
        <div id="pack-preview" aria-live="polite"><p class="muted">Measuring…</p></div>
        <div class="row" style="margin-top:1rem"><button type="button" class="btn primary" id="pack-install" disabled>Download to this device</button><button type="button" class="btn ghost" id="pack-export" disabled>Export pack file</button></div>
      </section>
      <div class="stack">
        <section class="card" aria-labelledby="h-import"><h2 id="h-import">Import a pack file</h2><p>Moving content between devices without internet: export a pack on one device, copy the <code>.janus-pack.json</code> file by USB, Bluetooth or a local share, then import it here.</p><button type="button" class="btn" id="pack-import">Import pack file…</button><p id="import-msg" class="small" aria-live="polite"></p></section>
        <section class="card" aria-labelledby="h-installed"><h2 id="h-installed">Installed packs</h2><div id="installed"></div></section>
      </div>
    </div>`;
  let current = null; let timer = null;
  const readForm = () => { sel.subjects = $$('input[name=subject]:checked', view).map((i) => i.value); sel.levels = $$('input[name=level]:checked', view).map((i) => i.value); sel.hindi = $('input[name=hindi]', view).checked; sel.limitIndex = +$('#limit', view).value; };
  const preview = async () => {
    readForm();
    const limit = STORAGE_STEPS[sel.limitIndex]; $('#limit-out', view).textContent = formatBytes(limit);
    const box = $('#pack-preview', view);
    if (!sel.subjects.length || !sel.levels.length) { box.innerHTML = '<p class="notice warn">Choose at least one subject and one level.</p>'; current = null; $('#pack-install', view).disabled = true; $('#pack-export', view).disabled = true; return; }
    box.innerHTML = '<p class="muted">Measuring…</p>';
    try {
      const r = await buildPack({ subjects: sel.subjects, levels: sel.levels, languages: sel.hindi ? ['en', 'hi'] : ['en'], limitBytes: limit });
      current = r;
      const pctC = Math.min(100, 100 * r.contentBytes / limit), pctS = Math.min(100 - pctC, 100 * r.simBytes / limit), pctH = Math.min(100 - pctC - pctS, 100 * r.headerBytes / limit);
      box.innerHTML = `<p class="pack-size">${formatBytes(r.pack.size)} <span class="small muted" style="font-family:var(--font-body)">of ${formatBytes(limit)} limit · ${r.included.length} lesson${r.included.length === 1 ? '' : 's'}${r.cut.length ? `, ${r.cut.length} cut` : ''}</span></p>
        <div class="storage-bar" role="img" aria-label="Storage used: content ${formatBytes(r.contentBytes)}, simulation code ${formatBytes(r.simBytes)}, pack header ${formatBytes(r.headerBytes)}"><span class="c" style="width:${pctC}%"></span><span class="s" style="width:${pctS}%"></span><span class="h" style="width:${pctH}%"></span></div>
        <div class="legend"><span><i style="background:var(--olive)"></i>Lessons ${formatBytes(r.contentBytes)}</span><span><i style="background:var(--ink-blue)"></i>Simulation code ${formatBytes(r.simBytes)} (${r.pack.sims.length} of ${SIM_KEYS.length}, measured from js/sims.js)</span><span><i style="background:var(--muted)"></i>Header ${formatBytes(r.headerBytes)}</span></div>
        ${r.unavailable.length ? `<p class="notice warn">Not available offline right now: ${r.unavailable.map((s) => esc(SUBJECT_META[s].name)).join(', ')}. Connect once to fetch it, or import a pack file.</p>` : ''}
        ${Object.entries(r.sources).some(([, v]) => v === 'installed') ? `<p class="small muted">Some subjects were measured from lessons already installed on this device (network unavailable).</p>` : ''}
        <h3 class="small" style="margin-top:1rem">Included (${r.included.length})</h3><ul class="pack-list">${r.included.map((c) => `<li><span>${levelBadge(c.lesson.level)} ${esc(c.lesson.title)}${c.lesson.hindi_full ? ' <span lang="hi" class="small">· हिंदी</span>' : ''}</span><span>${formatBytes(c.bytes)}${c.simCost ? ' + sim ' + formatBytes(c.simCost) : ''}</span></li>`).join('') || '<li>Nothing fits under this limit.</li>'}</ul>
        ${r.cut.length ? `<h3 class="small" style="margin-top:1rem">Cut to meet the limit (${r.cut.length})</h3><ul class="pack-list">${r.cut.map((c) => `<li class="cut"><span>${levelBadge(c.lesson.level)} ${esc(c.lesson.title)}</span><span class="why">${formatBytes(c.bytes + c.simCost)} — ${esc(c.reason)}</span></li>`).join('')}</ul>` : ''}`;
      $('#pack-install', view).disabled = !r.included.length; $('#pack-export', view).disabled = !r.included.length;
    } catch (e) { box.innerHTML = `<p class="notice err">Could not build the pack: ${esc(e.message || e)}</p>`; current = null; }
  };
  $$('input', view).forEach((i) => i.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 120); }));
  $('#pack-install', view).addEventListener('click', async () => {
    if (!current) return; const b = $('#pack-install', view); b.disabled = true; b.textContent = 'Installing…';
    try {
      const { meta, cacheResult } = await installPack(current.pack);
      await app.tutor.rebuild(cat.lessons);
      toast(`Installed “${meta.name}”: ${meta.lessonIds.length} lessons, ${formatBytes(meta.size)}. Service worker cached ${cacheResult.cached} asset file(s)${cacheResult.failed ? `, ${cacheResult.failed} could not be cached${cacheResult.reason ? ' (' + cacheResult.reason + ')' : ''}` : ''}.`, 'ok', 6000);
      renderInstalled(); preview();
    } catch (e) { toast('Install failed: ' + (e.message || e), 'err'); }
    b.textContent = 'Download to this device'; b.disabled = false;
  });
  $('#pack-export', view).addEventListener('click', () => { if (!current) return; const r = exportPackFile(current.pack); toast(`Exported ${r.name} (${formatBytes(r.bytes)}).`, 'ok'); });
  $('#pack-import', view).addEventListener('click', async () => {
    const f = await pickFile('.json,application/json'); if (!f) return;
    const msg = $('#import-msg', view); msg.textContent = 'Reading ' + f.name + '…';
    try { const { meta } = await importPackFile(f); await app.tutor.rebuild(cat.lessons); msg.innerHTML = `<span class="badge ok">Imported</span> ${esc(meta.name)}: ${meta.lessonIds.length} lessons, ${formatBytes(meta.size)}.`; renderInstalled(); preview(); }
    catch (e) { msg.innerHTML = `<span class="badge err">Import failed</span> ${esc(e.message || e)}`; }
  });
  const renderInstalled = async () => {
    const list = await listInstalled(); const box = $('#installed', view);
    if (!list.length) { box.innerHTML = '<p class="muted">No packs installed. Lessons show as “Not downloaded” until you install one.</p>'; return; }
    box.innerHTML = list.map((p) => `<div class="card flat tinted" style="margin-bottom:.75rem"><div class="row between"><strong>${esc(p.name)}</strong><span class="badge neutral">v${esc(p.version)}</span></div><p class="small muted" style="margin:.3rem 0">${p.lessonIds.length} lessons · ${formatBytes(p.size)} · installed ${esc(fmtDate(p.installedAt))} · ${esc(p.source)}${p.sims && p.sims.length ? ' · sims: ' + p.sims.join(', ') : ''}</p><div class="row"><a class="btn small ghost" href="#/library?only=installed">Open library</a><button type="button" class="btn small danger" data-remove="${esc(p.id)}">Remove</button></div></div>`).join('');
    $$('[data-remove]', box).forEach((b) => b.addEventListener('click', async () => { if (!confirmDialog('Remove this pack from the device? Lessons only in this pack will be deleted; your progress is kept.')) return; const n = await removePack(b.dataset.remove); await app.tutor.rebuild(cat.lessons); toast(`Pack removed (${n} lesson${n === 1 ? '' : 's'} deleted).`); renderInstalled(); preview(); }));
  };
  renderInstalled(); preview();
}

// ------------------------------------------------------------ NOTEBOOK
export async function notebook(ctx) {
  const { view } = ctx;
  setTitle('My notebook');
  const cat = getCatalogue();
  const [progress, st, installed, results] = await Promise.all([allProgress(), streaks(), installedLessons(), db.getAll('results').catch(() => [])]);
  const byId = Object.fromEntries(progress.map((p) => [p.lessonId, p]));
  const subjRows = SUBJECTS.map((s) => { const ls = cat.lessons.filter((l) => l.subject === s); const pct = Math.round(ls.reduce((a, l) => a + (byId[l.id] ? lessonCompletion(byId[l.id]) : 0), 0) / ls.length); return { s, pct, started: ls.filter((l) => byId[l.id]).length, total: ls.length }; });
  const days = []; for (let i = 27; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(dayKey(d.getTime())); }
  view.innerHTML = `<div class="view-head"><p class="eyebrow">My notebook</p><h1>Progress</h1><p class="muted">Everything here is computed from timestamps stored on this device. Export it before clearing browser data.</p></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="stat card"><div class="n">${st.current}</div><div class="l">day streak</div></div>
      <div class="stat card"><div class="n">${st.longest}</div><div class="l">longest streak</div></div>
      <div class="stat card"><div class="n">${st.totalDays}</div><div class="l">days active</div></div>
      <div class="stat card"><div class="n">${st.totals.sections}</div><div class="l">sections read</div></div>
      <div class="stat card"><div class="n">${st.totals.quizzes}</div><div class="l">quizzes taken</div></div>
      <div class="stat card"><div class="n">${st.totals.problems}</div><div class="l">problems solved</div></div>
    </div>
    <section class="card flat" style="margin-top:1.2rem" aria-labelledby="h-days"><h2 id="h-days" class="small">Last 28 days</h2><div class="streak-days" role="img" aria-label="${st.days.filter((d) => days.includes(d)).length} active days in the last 28">${days.map((d) => `<i class="${st.days.includes(d) ? 'on' : ''}" title="${d}"></i>`).join('')}</div><p class="small muted" style="margin-top:.4rem">A streak counts consecutive days with at least one section read, quiz taken, problem solved or tutor question. It survives until the end of today.</p></section>
    <section class="card" style="margin-top:1.2rem" aria-labelledby="h-subj"><h2 id="h-subj">By subject</h2>${subjRows.map((r) => `<div style="margin-bottom:.8rem"><div class="row between"><span>${subjectBadge(r.s)} <span class="small muted">${r.started} of ${r.total} lessons started</span></span><strong>${r.pct}%</strong></div><div class="meter ${r.s === 'mathematics' ? 'terracotta' : r.s === 'physics' ? 'blue' : ''}" role="progressbar" aria-valuenow="${r.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(SUBJECT_META[r.s].name)} completion"><span style="width:${r.pct}%"></span></div></div>`).join('')}</section>
    <section class="card flat" style="margin-top:1.2rem" aria-labelledby="h-lessons"><h2 id="h-lessons">By lesson</h2>${progress.length ? `<div class="table-wrap"><table><thead><tr><th>Lesson</th><th>Sections</th><th>Best quiz</th><th>Problems</th><th>Last activity</th><th>Overall</th></tr></thead><tbody>${progress.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).map((p) => { const c = cat.lessons.find((l) => l.id === p.lessonId); const isIn = installed.some((l) => l.id === p.lessonId); return `<tr><td>${isIn ? `<a href="#/lesson/${p.lessonId}">${esc(c ? c.title : p.lessonId)}</a>` : esc(c ? c.title : p.lessonId) + ' <span class="small muted">(not downloaded)</span>'}</td><td>${p.sectionsRead.length}/${p.sectionCount || (c ? c.sections : '?')}</td><td>${p.quizBest ? `${p.quizBest.score}/${p.quizBest.total} (${p.quizAttempts}×)` : '—'}</td><td>${p.problemsSolved.length}/${p.problemCount || (c ? c.problems : '?')}</td><td>${esc(fmtAgo(p.lastAt))}</td><td>${lessonCompletion(p)}%</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Nothing recorded yet. Open a lesson and mark a section as read, or take a quiz.</p>'}</section>
    ${results.length ? `<section class="card flat" style="margin-top:1.2rem" aria-labelledby="h-res"><h2 id="h-res">Recent quiz results</h2><ul class="pack-list">${results.slice(-8).reverse().map((r) => { const c = cat.lessons.find((l) => l.id === r.lessonId); return `<li><span>${esc(c ? c.title : r.lessonId)}</span><span>${r.score}/${r.total} · ${esc(fmtDate(r.at))}</span></li>`; }).join('')}</ul></section>` : ''}
    <div id="sync-slot" style="margin-top:1.2rem"></div>
    <section class="card flat" style="margin-top:1.2rem" aria-labelledby="h-exp"><h2 id="h-exp">Export / import progress</h2><p class="small muted">Export writes a JSON file with progress, quiz results, activity days and tutor history. Import merges by default (keeps the higher score and unions sections read).</p><div class="row"><button type="button" class="btn" id="exp">Export progress</button><button type="button" class="btn ghost" id="imp">Import (merge)…</button><button type="button" class="btn ghost" id="imp-replace">Import (replace)…</button><button type="button" class="btn danger small" id="reset">Reset progress</button></div><p id="exp-msg" class="small" aria-live="polite"></p></section>`;
  ctx.cleanup.push(syncPanel($('#sync-slot', view)));
  $('#exp', view).addEventListener('click', async () => { const d = await exportProgress(); const n = downloadJSON(d, 'janus-progress-' + dayKey() + '.json'); $('#exp-msg', view).textContent = `Exported ${formatBytes(n)}.`; });
  const doImport = async (mode) => { const f = await pickFile('.json,application/json'); if (!f) return; try { const n = await importProgress(JSON.parse(await f.text()), mode); $('#exp-msg', view).textContent = `Imported ${n} lesson record(s) (${mode}).`; notebook(ctx); } catch (e) { $('#exp-msg', view).textContent = 'Import failed: ' + (e.message || e); } };
  $('#imp', view).addEventListener('click', () => doImport('merge'));
  $('#imp-replace', view).addEventListener('click', () => { if (confirmDialog('Replace all progress on this device with the file?')) doImport('replace'); });
  $('#reset', view).addEventListener('click', async () => { if (confirmDialog('Delete all progress, results and activity on this device? Export first if you want to keep it.')) { await resetProgress(); toast('Progress reset.'); notebook(ctx); } });
}

// ------------------------------------------------------------ SETTINGS
export async function settings(ctx) {
  const { view, app } = ctx;
  setTitle('Settings');
  const s = getSetting; const cat = getCatalogue();
  view.innerHTML = `<div class="view-head"><p class="eyebrow">Settings</p><h1>Settings</h1><p class="muted">Saved on this device under <code>janus:v1</code>.</p></div>
    <div class="grid two" style="align-items:start">
      <div class="stack">
        <section class="card settings-group" aria-labelledby="h-read"><h2 id="h-read">Reading</h2>
          <div class="field"><span>Reading complexity</span><div class="row"><button type="button" class="chip" data-set="readingLevel" data-v="standard" aria-pressed="${s('readingLevel') === 'standard'}">Standard</button><button type="button" class="chip" data-set="readingLevel" data-v="simple" aria-pressed="${s('readingLevel') === 'simple'}">Simpler</button></div><span class="hint small muted">Every section, worked example and tutor answer has both levels.</span></div>
          <div class="field"><span>Language</span><div class="row"><button type="button" class="chip" data-set="language" data-v="en" aria-pressed="${s('language') === 'en'}">English</button><button type="button" class="chip" data-set="language" data-v="hi" aria-pressed="${s('language') === 'hi'}" lang="hi">हिंदी</button></div><span class="hint small muted">Hindi: ${cat.hindi.fullLessons} of ${cat.lessons.length} lessons fully translated; titles and summaries for all. English is shown where Hindi is missing, with a note.</span></div>
          <div class="field"><label for="tscale">Text size: <output id="tscale-out">${Math.round(s('textScale') * 100)}%</output></label><input type="range" id="tscale" min="0.9" max="1.4" step="0.05" value="${s('textScale')}"></div>
          <div class="field"><label for="tts">Read-aloud speed: <output id="tts-out">${s('ttsRate')}×</output></label><input type="range" id="tts" min="0.6" max="1.6" step="0.1" value="${s('ttsRate')}"><span class="hint small muted">${speech.supported ? 'Speech synthesis is available in this browser.' : 'Speech synthesis is not available in this browser; read-aloud buttons are disabled.'}</span></div>
        </section>
        <section class="card settings-group" aria-labelledby="h-acc"><h2 id="h-acc">Accessibility</h2><div id="acc-switches"></div></section>
        <section class="card settings-group" aria-labelledby="h-net"><h2 id="h-net">Network</h2><div id="net-switches"></div><div id="lb-report" class="small muted" style="margin-top:.5rem"></div></section>
      </div>
      <div class="stack">
        <section class="card settings-group" aria-labelledby="h-sw"><h2 id="h-sw">Offline worker</h2><div id="sw-box"></div></section>
        <div id="sync-slot"></div>
        <section class="card settings-group" aria-labelledby="h-store"><h2 id="h-store">Storage on this device</h2><div id="store-box"><p class="muted">Measuring…</p></div></section>
        <section class="card settings-group" aria-labelledby="h-misc"><h2 id="h-misc">Housekeeping</h2><div class="row"><button type="button" class="btn small ghost" id="clear-tutor">Clear tutor history</button><button type="button" class="btn small danger" id="reset-settings">Reset settings</button></div><p class="small muted" style="margin-top:.5rem">JANUS ${APP_VERSION}. No accounts, no analytics, no third-party requests.</p></section>
      </div>
    </div>`;
  $$('[data-set]', view).forEach((b) => b.addEventListener('click', () => { setSettings({ [b.dataset.set]: b.dataset.v }); $$(`[data-set=${b.dataset.set}]`, view).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $('#tscale', view).addEventListener('input', (e) => { setSettings({ textScale: +e.target.value }); $('#tscale-out', view).textContent = Math.round(e.target.value * 100) + '%'; });
  $('#tts', view).addEventListener('input', (e) => { setSettings({ ttsRate: +e.target.value }); $('#tts-out', view).textContent = e.target.value + '×'; });
  const acc = $('#acc-switches', view);
  acc.append(
    switchRow({ id: 'sw-dys', label: 'Dyslexia-friendly spacing', hint: 'Wider letter and word spacing, taller lines, shorter line length.', checked: s('dyslexia'), onChange: (v) => setSettings({ dyslexia: v }) }),
    switchRow({ id: 'sw-dysf', label: 'Switch to a plain sans-serif font', hint: 'Uses Verdana/system sans instead of the notebook fonts.', checked: s('dyslexiaFont'), onChange: (v) => setSettings({ dyslexiaFont: v }) }),
    switchRow({ id: 'sw-hc', label: 'High contrast', hint: 'Black on white with stronger borders.', checked: s('highContrast'), onChange: (v) => setSettings({ highContrast: v }) }),
    switchRow({ id: 'sw-rm', label: 'Reduce motion', hint: 'Disables animations; simulations start paused. Your system preference is also respected.', checked: s('reducedMotion'), onChange: (v) => setSettings({ reducedMotion: v }) }),
  );
  const net = $('#net-switches', view);
  const lbReport = () => {
    const fb = s('fontBytesMeasured'); const ib = s('illustrationBytesSaved') || 0;
    const fontsSkipped = s('lowBandwidth');
    $('#lb-report', view).innerHTML = fontsSkipped ? `Estimated data saved in low-bandwidth mode: web fonts <strong>${fb ? formatBytes(fb) + ' (measured on this device when they last loaded)' : 'about 90 KB (estimate: two font families, typical woff2 sizes; not yet measured on this device)'}</strong> per fresh load, plus <strong>${formatBytes(ib)}</strong> of inline illustration markup not rendered so far. Simulations run at 12 fps and half resolution. JANUS has no raster images.` : (fb ? `Web fonts measured at ${formatBytes(fb)} on this device; low-bandwidth mode would skip them.` : 'Low-bandwidth mode skips web fonts, hides illustrations and throttles simulations.');
  };
  net.append(
    switchRow({ id: 'sw-lb', label: 'Low-bandwidth mode', hint: 'Text-first: no web fonts, illustrations replaced by descriptions, animations off, simulations throttled.', checked: s('lowBandwidth'), onChange: (v) => { setSettings({ lowBandwidth: v }); lbReport(); toast(v ? 'Low-bandwidth mode on. Web fonts are skipped from the next load.' : 'Low-bandwidth mode off.'); } }),
    switchRow({ id: 'sw-sim', label: 'Simulate offline (testing aid)', hint: 'This is a simulation, not a real disconnection: the header shows OFFLINE (simulated), network fetches are answered from cache only, and sync is held. Use it to test without DevTools.', checked: s('simulateOffline'), onChange: (v) => { setSettings({ simulateOffline: v }); toast(v ? 'Simulated offline: JANUS now behaves as if the network were gone.' : 'Simulation off: real connection state restored.', 'warn'); } }),
  );
  lbReport();
  // service worker box
  const swBox = $('#sw-box', view);
  const renderSW = (st) => { swBox.innerHTML = `<p><span class="badge ${st.status === 'ready' ? 'ok' : st.status === 'updated' ? 'neutral' : st.status === 'installing' || st.status === 'registering' ? 'warn' : 'err'}">${esc(st.status)}</span> ${esc(st.message)}</p><p class="small muted">Worker version: ${st.version ? esc(st.version) : 'unknown'} · this page ${st.controlled ? 'is' : 'is not yet'} controlled by the worker. Caches are named <code>janus-shell-v…</code>, <code>janus-content-v1</code>, <code>janus-fonts-v1</code>; old versions are deleted on activate.</p><div class="row">${st.updateAvailable ? '<button type="button" class="btn small primary" id="sw-update">Reload to update</button>' : ''}<button type="button" class="btn small ghost" id="sw-check">Check for update</button></div>`; const u = $('#sw-update', swBox); if (u) u.addEventListener('click', applyUpdate); $('#sw-check', swBox).addEventListener('click', async () => { try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.update(); askVersion(); toast('Checked for a new version.'); } else toast('No service worker registered.', 'warn'); } catch (e) { toast('Update check failed: ' + e.message, 'err'); } }); };
  renderSW(getSWState()); ctx.cleanup.push(onSWChange(renderSW));
  ctx.cleanup.push(syncPanel($('#sync-slot', view)));
  // storage
  (async () => { const [b, q] = await Promise.all([storageBreakdown(), storageEstimate()]); const total = Object.values(b).reduce((a, x) => a + x.bytes, 0); $('#store-box', view).innerHTML = `<div class="table-wrap"><table><thead><tr><th>IndexedDB store</th><th>Records</th><th>Size (serialised)</th></tr></thead><tbody>${Object.entries(b).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.count}</td><td>${formatBytes(v.bytes)}</td></tr>`).join('')}<tr><th>Total</th><th>${Object.values(b).reduce((a, x) => a + x.count, 0)}</th><th>${formatBytes(total)}</th></tr></tbody></table></div><p class="small muted">${q.supported ? `Browser estimate for this origin: ${formatBytes(q.usage)} used of ${formatBytes(q.quota)} available (includes the service-worker caches).` : 'This browser does not report a storage quota.'}</p>`; })();
  $('#clear-tutor', view).addEventListener('click', async () => { await app.tutor.clearHistory(); app.renderTutorHistory(); toast('Tutor history cleared.'); });
  $('#reset-settings', view).addEventListener('click', () => { if (confirmDialog('Reset all settings to defaults?')) { resetSettings(); settings(ctx); toast('Settings reset.'); } });
}
