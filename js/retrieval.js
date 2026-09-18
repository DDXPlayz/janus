// Retrieval for the local tutor: tokenise → light stemming → BM25 over
// passages built from the installed lessons (sections, formulas, glossary,
// worked examples, problems). Everything runs on-device; nothing is sent
// anywhere. This is search, not a language model.

const STOP = new Set(('a an the and or of to in on for with is are was were be been by at from as it its this that these those ' +
  'what which who how why when where do does did can could would should i you we they he she me my your our their us them ' +
  'about into than then so if not no yes please tell explain show give find mean means meaning define definition ' +
  'is there some any all very just also more most much many such like get got').split(' '));

export function tokenize(text) {
  return String(text || '').toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && t.length > 1 && !STOP.has(t))
    .map(stem);
}

/** Very light English stemmer — enough to match "forces"/"force", "orbiting"/"orbit", "equations"/"equation". */
export function stem(w) {
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ness')) return w.slice(0, -4);
  if (w.endsWith('ing') && w.length > 5) { const s = w.slice(0, -3); return s.endsWith('t') && /[aeiou]t$/.test(s) && s.length > 3 ? s : s; }
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4 && /[sxz]es$|[cs]hes$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

export class BM25Index {
  constructor(k1 = 1.4, b = 0.7) {
    this.k1 = k1; this.b = b;
    this.docs = [];        // {id, tokens, len, meta}
    this.df = new Map();
    this.avgLen = 0;
  }
  add(meta, text, weightText = '') {
    const tokens = tokenize(text);
    const boost = tokenize(weightText);
    const all = tokens.concat(boost, boost); // titles/terms count triple
    const tf = new Map();
    for (const t of all) tf.set(t, (tf.get(t) || 0) + 1);
    this.docs.push({ meta, tf, len: all.length || 1 });
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
  }
  finalize() {
    const N = this.docs.length || 1;
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / N;
  }
  idf(t) {
    const n = this.df.get(t) || 0; const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }
  search(query, k = 5, filter = null) {
    const q = Array.from(new Set(tokenize(query)));
    if (!q.length || !this.docs.length) return { hits: [], queryTokens: q, matchedTokens: [] };
    const scored = [];
    const matchedGlobal = new Set();
    for (const d of this.docs) {
      if (filter && !filter(d.meta)) continue;
      let s = 0; let matched = 0;
      for (const t of q) {
        const f = d.tf.get(t); if (!f) continue;
        matched++; matchedGlobal.add(t);
        const idf = this.idf(t);
        s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * d.len / this.avgLen));
      }
      if (s > 0) scored.push({ score: s, matched, meta: d.meta });
    }
    scored.sort((a, b) => b.score - a.score || b.matched - a.matched);
    return { hits: scored.slice(0, k), queryTokens: q, matchedTokens: Array.from(matchedGlobal) };
  }
}

/** Build the tutor index from an array of full lessons. */
export function buildIndex(lessons) {
  const idx = new BM25Index();
  for (const L of lessons) {
    const base = { lessonId: L.id, subject: L.subject, lessonTitle: L.title, level: L.level };
    L.sections.forEach((s, i) => {
      idx.add({ ...base, type: 'section', sectionIndex: i, sectionId: s.id, heading: s.heading, text: s.standard, simple: s.simple, text_hi: s.standard_hi, simple_hi: s.simple_hi },
        s.standard + ' ' + (s.simple || ''), s.heading + ' ' + L.title);
    });
    (L.formulas || []).forEach((f, i) => {
      idx.add({ ...base, type: 'formula', index: i, heading: f.name, expr: f.expr, note: f.note }, (f.note || '') + ' ' + f.expr, f.name + ' ' + f.name + ' formula');
    });
    (L.glossary || []).forEach((g, i) => {
      idx.add({ ...base, type: 'glossary', index: i, term: g.term, def: g.def, def_hi: g.def_hi }, g.def, g.term + ' ' + g.term + ' ' + g.term);
    });
    (L.examples || []).forEach((ex, i) => {
      idx.add({ ...base, type: 'example', index: i, heading: ex.title, problem: ex.problem, steps: ex.steps, steps_simple: ex.steps_simple, answer: ex.answer },
        ex.problem + ' ' + ex.steps.join(' '), ex.title + ' worked example');
    });
    (L.problems || []).forEach((p, i) => {
      idx.add({ ...base, type: 'problem', index: i, heading: p.title, difficulty: p.difficulty, statement: p.statement, steps: p.steps, answer: p.answer },
        p.statement + ' ' + p.steps.join(' '), p.title + ' problem');
    });
    (L.constants || []).forEach((c, i) => {
      idx.add({ ...base, type: 'constant', index: i, heading: c.name, symbol: c.symbol, value: c.value, unit: c.unit }, c.name + ' ' + c.symbol + ' constant value', c.name);
    });
  }
  idx.finalize();
  return idx;
}

/** Index of the catalogue (titles + summaries) so the tutor can point at lessons that are NOT downloaded. */
export function buildCatalogueIndex(catalogueLessons) {
  const idx = new BM25Index();
  for (const c of catalogueLessons) idx.add({ type: 'catalogue', lessonId: c.id, subject: c.subject, lessonTitle: c.title, level: c.level }, c.summary + ' ' + (c.keywords || []).join(' '), c.title + ' ' + c.title);
  idx.finalize();
  return idx;
}
