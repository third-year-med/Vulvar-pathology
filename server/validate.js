'use strict';
/* Content validation, run on the server for every draft save and before every publish.
   Structural rules (always enforced) keep the app from breaking and protect the
   question → options → correct answer relationship. Strict rules (publish) also reject
   required fields that are empty. */

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MEDIA_RE = /^media\/[a-f0-9]{16,64}\.(jpg|png|gif|webp)$/;
const DATA_IMG_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const CHECK_TYPES = ['tf', 'fill', 'match', 'sort', 'select', 'mcq'];

function isStr(x) { return typeof x === 'string'; }
function isInt(x) { return Number.isInteger(x); }
function blank(x) { return !isStr(x) || !x.trim(); }
function stemText(x) { return Array.isArray(x) ? x.filter(function (p) { return p !== '[[IMAGE]]'; }).join(' ') : x; }

function validateContent(c, opts) {
  opts = opts || {};
  const errors = [], warnings = [];
  function err(where, msg) { errors.push(where + ': ' + msg); }
  function warn(where, msg) { warnings.push(where + ': ' + msg); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { errors: ['Content must be an object.'], warnings: warnings };
  ['meta', 'concepts', 'topics', 'tests', 'pics', 'review'].forEach(function (k) { if (!c[k] || typeof c[k] !== 'object' || Array.isArray(c[k])) err(k, 'missing or not an object'); });
  ['lectures', 'questions', 'checks', 'practice'].forEach(function (k) { if (!Array.isArray(c[k])) err(k, 'missing or not a list'); });
  if (errors.length) return { errors: errors, warnings: warnings };

  /* ---- Learn content ---- */
  const secIds = {}, subIds = {};
  c.lectures.forEach(function (L, li) {
    const w = 'Lecture ' + (li + 1);
    if (!L || !isInt(L.num)) return err(w, 'lecture number missing');
    if (!isStr(L.title)) err(w, 'title missing');
    else if (opts.strict && blank(L.title)) err(w, 'title is empty');
    if (!Array.isArray(L.sections)) return err(w, 'sections missing');
    L.sections.forEach(function (s) {
      if (!s || !isStr(s.id) || !ID_RE.test(s.id)) return err(w, 'a section has an invalid id');
      const ws = 'Section ' + s.id;
      if (secIds[s.id] || subIds[s.id]) err(ws, 'duplicate id');
      secIds[s.id] = 1;
      if (!isStr(s.title)) err(ws, 'title missing'); else if (opts.strict && blank(s.title)) err(ws, 'title is empty');
      if (s.intro != null && !isStr(s.intro)) err(ws, 'intro must be text');
      if (!Array.isArray(s.subs)) return err(ws, 'sub-blocks missing');
      s.subs.forEach(function (u) {
        if (!u || !isStr(u.id) || !ID_RE.test(u.id)) return err(ws, 'a block has an invalid id');
        const wu = 'Block ' + u.id;
        if (secIds[u.id] || subIds[u.id]) err(wu, 'duplicate id');
        subIds[u.id] = 1;
        if (!isStr(u.title)) err(wu, 'title missing'); else if (opts.strict && blank(u.title)) err(wu, 'title is empty');
        if (!isStr(u.md)) err(wu, 'text missing');
        if (u.priority != null && [1, 2, 3].indexOf(u.priority) < 0) err(wu, 'priority must be 1, 2 or 3');
      });
    });
  });
  function placeOk(id) { return !!(secIds[id] || subIds[id]); }

  /* ---- questions: stable unique ids across every bank ---- */
  const qids = {};
  function idOk(x, w) {
    if (!x || !isStr(x.id) || !ID_RE.test(x.id)) { err(w, 'invalid or missing question id'); return false; }
    if (qids[x.id]) err('Question ' + x.id, 'duplicate question id');
    qids[x.id] = 1;
    return true;
  }
  function optionsOk(x, w, single) {
    if (!Array.isArray(x.options) || !x.options.every(isStr)) return err(w, 'options must be a list of text');
    if (x.options.length < 2) err(w, 'needs at least two answer options');
    if (x.options.length > 7) err(w, 'at most seven answer options');
    if (!Array.isArray(x.optionIds) || x.optionIds.length !== x.options.length) return err(w, 'option ids do not match the options');
    const seen = {};
    x.optionIds.forEach(function (o) { if (!isStr(o) || !ID_RE.test(o) || seen[o]) err(w, 'option ids must be unique'); seen[o] = 1; });
    if (single) { if (!isInt(x.answer) || x.answer < 0 || x.answer >= x.options.length) err(w, 'the correct answer does not point to an existing option'); }
    else if (!Array.isArray(x.answer) || !x.answer.length || !x.answer.every(function (a) { return isInt(a) && a >= 0 && a < x.options.length; }) || new Set(x.answer).size !== x.answer.length) err(w, 'select-all answers must point to existing options');
    if (opts.strict) x.options.forEach(function (o, k) { if (blank(o)) err(w, 'option ' + 'ABCDEFG'[k] + ' is empty'); });
  }
  function mediaRef(img, w) { if (img != null && (!isStr(img) || !/^pic:[A-Za-z0-9_-]{1,40}$/.test(img))) err(w, 'invalid picture reference'); }

  c.questions.forEach(function (q, i) {
    if (!idOk(q, 'Assessment question ' + (i + 1))) return;
    const w = 'Assessment question ' + (q.code || q.id);
    if (!c.tests[q.test]) err(w, 'belongs to an unknown assessment');
    if (!Array.isArray(q.stem) || !q.stem.every(isStr)) err(w, 'question text missing');
    else if (opts.strict && blank(stemText(q.stem))) err(w, 'question text is empty');
    optionsOk(q, w, true);
    mediaRef(q.image, w);
    if (!c.topics[q.topic]) err(w, 'unknown topic');
    if (!Array.isArray(q.sections) || !q.sections.length) err(w, 'needs a section'); else if (!placeOk(q.sections[0])) (opts.strict ? err : warn)(w, 'linked section ' + q.sections[0] + ' no longer exists');
    if (opts.strict && blank(q.explanation)) warn(w, 'no explanation');
  });
  c.practice.forEach(function (x, i) {
    if (!idOk(x, 'Practice question ' + (i + 1))) return;
    const w = 'Practice question ' + x.id;
    if (!isStr(x.stem)) err(w, 'question text missing'); else if (opts.strict && blank(x.stem)) err(w, 'question text is empty');
    optionsOk(x, w, true);
    mediaRef(x.image, w);
    if (x.sub && !placeOk(x.sub)) (opts.strict ? err : warn)(w, 'linked block ' + x.sub + ' no longer exists');
    if (opts.strict && blank(x.explanation)) warn(w, 'no explanation');
  });
  c.checks.forEach(function (k, i) {
    if (!idOk(k, 'Section check ' + (i + 1))) return;
    const w = 'Section check ' + k.id;
    if (CHECK_TYPES.indexOf(k.type) < 0) return err(w, 'unknown question type');
    if (!placeOk(k.sec)) err(w, 'linked section ' + k.sec + ' does not exist');
    if (!isStr(k.q)) err(w, 'question text missing'); else if (opts.strict && blank(k.q)) err(w, 'question text is empty');
    if (k.type === 'tf' && typeof k.answer !== 'boolean') err(w, 'true/false answer missing');
    if (k.type === 'mcq') optionsOk(k, w, true);
    if (k.type === 'select') optionsOk(k, w, false);
    if (k.type === 'fill') {
      const n = (String(k.q).match(/\[ blank \]/g) || []).length;
      if (!n) err(w, 'fill-in text needs at least one [ blank ]');
      if (!Array.isArray(k.answers) || k.answers.length !== n || !k.answers.every(function (a) { return Array.isArray(a) && a.length && a.every(function (s) { return isStr(s) && s.trim(); }); })) err(w, 'every blank needs at least one accepted answer');
    }
    if (k.type === 'match') {
      if (!Array.isArray(k.left) || !Array.isArray(k.right) || !Array.isArray(k.key) || k.left.length < 2 || k.key.length !== k.left.length || !k.key.every(function (x) { return isInt(x) && x >= 0 && x < k.right.length; })) err(w, 'matching pairs are inconsistent');
    }
    if (k.type === 'sort') {
      if (!Array.isArray(k.groups) || k.groups.length < 2 || !Array.isArray(k.items) || k.items.length < 2 || !k.items.every(function (x) { return Array.isArray(x) && isStr(x[0]) && isInt(x[1]) && x[1] >= 0 && x[1] < k.groups.length; })) err(w, 'sorting items/groups are inconsistent');
    }
  });

  /* ---- pictures ---- */
  function srcOk(s) { return isStr(s) && (MEDIA_RE.test(s) || DATA_IMG_RE.test(s)); }
  Object.keys(c.pics).forEach(function (k) {
    const p = c.pics[k];
    if (!/^p[a-z0-9]{1,20}$/.test(k)) err('Picture ' + k, 'invalid slot key');
    if (p == null) return;
    if (!srcOk(p.src)) err('Picture ' + k, 'invalid picture file');
    if (p.width != null && !(p.width >= 10 && p.width <= 100)) err('Picture ' + k, 'width must be 10–100%');
    if (p.align != null && ['left', 'right', 'center', 'full'].indexOf(p.align) < 0) err('Picture ' + k, 'invalid alignment');
  });
  Object.keys(c.decks || {}).forEach(function (n) {
    const d = c.decks[n];
    if (!d || !Array.isArray(d.slides)) return err('Slides ' + n, 'invalid deck');
    d.slides.forEach(function (s, i) { (s.images || []).forEach(function (im) { if (!srcOk(im.src)) err('Slides ' + n + ' slide ' + (i + 1), 'invalid picture file'); }); });
  });
  return { errors: errors, warnings: warnings };
}

/* Media files referenced anywhere in the content (for publishing new uploads). */
function referencedMedia(c) {
  const out = {};
  function add(s) { const m = /^media\/([a-f0-9]{16,64}\.(jpg|png|gif|webp))$/.exec(s || ''); if (m) out[m[1]] = 1; }
  Object.keys(c.pics || {}).forEach(function (k) { if (c.pics[k]) add(c.pics[k].src); });
  Object.keys(c.decks || {}).forEach(function (n) { ((c.decks[n] || {}).slides || []).forEach(function (s) { (s.images || []).forEach(function (im) { add(im.src); }); }); });
  Object.keys(c.media || {}).forEach(function (f) { add('media/' + f); });
  return Object.keys(out);
}

/* Human-readable summary of what a publish would change. */
function diffSummary(oldC, newC) {
  const out = [];
  oldC = oldC || {};
  function byId(list) { const m = {}; (list || []).forEach(function (x) { m[x.id] = JSON.stringify(x); }); return m; }
  function cmp(label, a, b) {
    let add = 0, del = 0, ch = 0;
    Object.keys(b).forEach(function (k) { if (!(k in a)) add++; else if (a[k] !== b[k]) ch++; });
    Object.keys(a).forEach(function (k) { if (!(k in b)) del++; });
    if (add || del || ch) out.push({ area: label, added: add, removed: del, changed: ch });
  }
  function subsOf(c) { const m = {}; (c.lectures || []).forEach(function (L) { (L.sections || []).forEach(function (s) { m['s' + s.id] = JSON.stringify([s.title, s.intro || '', s.priority || 0]); (s.subs || []).forEach(function (u) { m[u.id] = JSON.stringify(u); }); }); m['L' + L.num] = JSON.stringify([L.title, L.intro || null]); }); return m; }
  function order(c) { return JSON.stringify((c.lectures || []).map(function (L) { return L.sections.map(function (s) { return [s.id, s.subs.map(function (u) { return u.id; })]; }); })); }
  cmp('Learn content (lectures, sections, blocks)', subsOf(oldC), subsOf(newC));
  if (order(oldC) !== order(newC)) out.push({ area: 'Learn content order', added: 0, removed: 0, changed: 1 });
  cmp('Practice questions', byId(oldC.practice), byId(newC.practice));
  cmp('Section checks', byId(oldC.checks), byId(newC.checks));
  cmp('Assessment questions', byId(oldC.questions), byId(newC.questions));
  const ord = function (l) { return (l || []).map(function (x) { return x.id; }).join(','); };
  if (ord(oldC.practice) !== ord(newC.practice) || ord(oldC.checks) !== ord(newC.checks) || ord(oldC.questions) !== ord(newC.questions)) out.push({ area: 'Question order', added: 0, removed: 0, changed: 1 });
  const pics = function (c) { const m = {}; Object.keys(c.pics || {}).forEach(function (k) { if (c.pics[k]) m[k] = JSON.stringify(c.pics[k]); }); return m; };
  cmp('Pictures', pics(oldC), pics(newC));
  const decks = function (c) { const m = {}; Object.keys(c.decks || {}).forEach(function (k) { m[k] = JSON.stringify(c.decks[k]); }); return m; };
  cmp('Presentation slide decks', decks(oldC), decks(newC));
  const rv = function (c) { const m = {}; ['facts', 'traps', 'comparisons', 'morphology', 'review15'].forEach(function (k) { ((c.review || {})[k] || []).forEach(function (x, i) { m[k + ':' + (x.id || i)] = JSON.stringify(x); }); }); return m; };
  cmp('Last-minute review', rv(oldC), rv(newC));
  const misc = function (c) { return { meta: JSON.stringify(c.meta), topics: JSON.stringify(c.topics), concepts: JSON.stringify(c.concepts), tests: JSON.stringify(c.tests) }; };
  cmp('Settings, topics and concepts', misc(oldC), misc(newC));
  // Graded questions removed or retired: students' saved results may refer to them.
  const oldQ = {}; (oldC.questions || []).forEach(function (q) { oldQ[q.id] = q; });
  const gone = Object.keys(oldQ).filter(function (id) { return !(newC.questions || []).some(function (q) { return q.id === id; }); });
  return { changes: out, removedGradedQuestions: gone };
}

module.exports = { validateContent: validateContent, referencedMedia: referencedMedia, diffSummary: diffSummary, MEDIA_RE: MEDIA_RE };
