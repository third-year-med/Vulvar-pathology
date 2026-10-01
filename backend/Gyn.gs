/**
 * ==========================================================================
 * Gyn.gs — Gynecology Pathology Exam Review module (GYN 1.0)
 * for the shared Pathology Teaching Platform backend (Code.gs 1.7 + the GYN hook, i.e. 1.8)
 * ==========================================================================
 * Add this file to the SAME Apps Script project as Code.gs (Files → + → Script → "Gyn").
 * All .gs files of one project share one global scope, so this module reuses the platform's
 * own authentication (teacher sessions, student accounts/sessions, gateRequest_, authed_),
 * crypto helpers and locking — it does NOT add a second login system or a second backend.
 *
 * Isolation
 *  • Every GYN request carries {module:"gyn"} (or a cohort "gyn-B"); gynHook_ (called from route_)
 *    lets a Gynecology Pathology review module use ONLY: sign-in/out, student-account administration and the gyn* actions.
 *    Legacy actions (e.g. submitQuizResult, which trusts a browser score) are refused for GYN.
 *  • GYN data lives in its own sheets (GYN_Questions, GYN_Assessments, GYN_Attempts, GYN_Progress,
 *    GYN_Audit), each row tagged with the module key. No existing sheet is modified.
 *
 * Security model (all enforced here, server-side)
 *  • The authoritative question bank (answers, explanations, sources) exists only in GYN_Questions.
 *  • Students never receive an answer key before submission: a paper contains stems + options only
 *    (option order optionally shuffled per attempt; no question ids).
 *  • Scoring, timing (deadline = startedAt + duration, 60 s network grace) and expiry are server-side.
 *  • Questions are versioned; an attempt records question id + version + option mapping, so results
 *    are reproducible and never change when a question is edited later.
 *  • Submission is idempotent (one attempt id, state machine started → submitted | expired | abandoned).
 *  • Faculty/admin actions (gynAdmin*) require a valid TEACHER session of this module (authed_).
 *
 * 1.0.1 — one addition only: unknown gynAdmin* actions are offered to GynContent.gs (Learn-content
 *         drafts and publishing) before being refused. See the "default:" case of gynTeacher_.
 * ========================================================================== */
var GYN_VERSION = '1.0';
var GYN_GRACE_MS = 60 * 1000;              // network grace after the deadline
var GYN_RATE_PER_MIN = 150;                // per student, all gyn* actions together
var GYN_WEAK_PCT = 60;                     // a topic below this % is "weak"
var GYN_SRS_DAYS = [0, 1, 3, 7, 14, 30];   // revision queue intervals (box 0 = due now)
/** Gynecology Pathology review keeps its own student accounts. If Cvs.gs (account aliasing) is installed, its acctModule_ is honoured. */
function gynAcct_(module) { return typeof acctModule_ === 'function' ? acctModule_(module) : module; }

/* ---------------------------------------------------------------------- *
 * Hook called by Code.gs route_ right after the sign-in gate.
 * Returns a response to short-circuit, or null to continue normal routing.
 * ---------------------------------------------------------------------- */
var GYN_ALLOWED_PLATFORM = { ping: 1, setup: 1, login: 1, logout: 1, changePassword: 1, studentLogin: 1, studentLogout: 1, studentSession: 1,
  studentChangePassword: 1, listStudents: 1, saveStudent: 1, bulkAddStudents: 1, setStudentActive: 1, resetStudentPassword: 1, deleteStudent: 1, unlockStudent: 1 };
var GYN_ACCOUNT_ADMIN = { saveStudent: 1, bulkAddStudents: 1, setStudentActive: 1, resetStudentPassword: 1, deleteStudent: 1, unlockStudent: 1 };
/** Gyn.gs is ONE backend module shared by BOTH Gynecology Pathology sub-modules: "vulva" (this release) and
 *  "vagina" (a future release — the routing below already accepts it so vagina needs zero backend changes,
 *  only new content imported under module:"vagina"). Rows in every GYN_* sheet are tagged with the real
 *  module key ("vulva" or "vagina"), so the two keep entirely separate question banks, assessments and — by
 *  default — student accounts (gynAcct_ below), exactly like the Cvs/Cirev precedent kept separate accounts
 *  unless ACCOUNT_MODULE aliasing says otherwise. */
var GYN_SUBMODULES = { vulva: 1, vagina: 1 };
function gynIsModule_(module) { return !!GYN_SUBMODULES[String(module || '').split('-')[0]]; }
/** Wire actions are namespaced per sub-module ("vulvaBootstrap", "vaginaStart", …) so two independent front-ends
 *  can share this one file; internally every action is handled under its generic "gyn…" name. */
function gynNormalizeAction_(module, action) {
  var m = /^(vulva|vagina)([A-Z][A-Za-z]*)$/.exec(String(action || ''));
  return m ? 'gyn' + m[2] : action;
}
function gynHook_(module, p) {
  var a = String(p.action || '');
  if (/^(vulva|vagina)[A-Z]/.test(a)) {
    if (!gynIsModule_(module)) return { ok: false, code: 'badaction', error: 'Gynecology Pathology review actions are only available in a Gynecology Pathology review module.' };
    var p2 = {}; for (var k in p) if (p.hasOwnProperty(k)) p2[k] = p[k];
    p2.action = gynNormalizeAction_(module, a);
    return gynRoute_(module, p2);
  }
  if (GYN_ACCOUNT_ADMIN[a] && gynAcct_(module) !== module) return { ok: false, code: 'accounts', error: 'Student accounts for this module are managed in the “' + gynAcct_(module) + '” module.' };
  if (gynIsModule_(module) && !GYN_ALLOWED_PLATFORM[a]) return { ok: false, code: 'badaction', error: 'This action is not available in the Gynecology Pathology review module.' };
  return null;
}

/* ---------------------------------------------------------------------- *
 * Sheets (own tables, created on first use)
 * ---------------------------------------------------------------------- */
var GYN_SHEETS = { Q: 'GYN_Questions', A: 'GYN_Assessments', T: 'GYN_Attempts', P: 'GYN_Progress', L: 'GYN_Audit' };
var GYN_HEADERS = {};
GYN_HEADERS.GYN_Questions = ['module', 'qid', 'version', 'kind', 'active', 'legacyId', 'code', 'lecture', 'section', 'sub', 'topic', 'concept', 'objective',
  'difficulty', 'priority', 'label', 'previousExam', 'imageBased', 'integrated', 'image', 'stem', 'optionsJson', 'answer', 'explanation', 'trap', 'ref',
  'createdAt', 'createdBy', 'contentHash'];
GYN_HEADERS.GYN_Assessments = ['module', 'id', 'title', 'subtitle', 'lecture', 'durationMin', 'questionCount', 'poolJson', 'randomizeQuestions', 'randomizeOptions',
  'status', 'passPct', 'attemptsAllowed', 'review', 'createdAt', 'updatedAt', 'publishedAt', 'closedAt'];
GYN_HEADERS.GYN_Attempts = ['module', 'id', 'username', 'name', 'assessmentId', 'assessmentTitle', 'attemptNo', 'status', 'startedAt', 'deadlineAt', 'submittedAt',
  'durationSec', 'score', 'total', 'percent', 'correct', 'incorrect', 'unanswered', 'auto', 'itemsJson', 'byTopicJson', 'savedJson', 'lastSavedAt', 'submitKey'];
GYN_HEADERS.GYN_Progress = ['module', 'username', 'kind', 'valueJson', 'updatedAt'];
GYN_HEADERS.GYN_Audit = ['module', 'at', 'actor', 'role', 'event', 'ref', 'detail'];
/** columns kept as text (student IDs such as "00123" must not become numbers) */
var GYN_TEXT = {
  GYN_Questions: ['module', 'qid', 'kind', 'legacyId', 'code', 'lecture', 'section', 'sub', 'topic', 'concept', 'objective', 'difficulty', 'label', 'image', 'stem', 'optionsJson', 'explanation', 'trap', 'ref', 'createdBy', 'contentHash'],
  GYN_Assessments: ['module', 'id', 'title', 'subtitle', 'lecture', 'poolJson', 'status', 'review'],
  GYN_Attempts: ['module', 'id', 'username', 'name', 'assessmentId', 'assessmentTitle', 'status', 'itemsJson', 'byTopicJson', 'savedJson', 'submitKey'],
  GYN_Progress: ['module', 'username', 'kind', 'valueJson'],
  GYN_Audit: ['module', 'actor', 'role', 'event', 'ref', 'detail']
};
var GYN_NUM = { version: 1, answer: 1, createdAt: 1, durationMin: 1, questionCount: 1, passPct: 1, attemptsAllowed: 1, updatedAt: 1, publishedAt: 1, closedAt: 1,
  attemptNo: 1, startedAt: 1, deadlineAt: 1, submittedAt: 1, durationSec: 1, score: 1, total: 1, percent: 1, correct: 1, incorrect: 1, unanswered: 1, lastSavedAt: 1, at: 1 };
var GYN_BOOL = { active: 1, previousExam: 1, imageBased: 1, integrated: 1, randomizeQuestions: 1, randomizeOptions: 1, auto: 1 };

function gynEnsure_() {
  var cache = CacheService.getScriptCache(), key = 'gyn_sheets_ok:' + GYN_VERSION;
  if (cache.get(key)) return;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.keys(GYN_HEADERS).forEach(function (name) {
      var sh = ss.getSheetByName(name), H = GYN_HEADERS[name];
      if (!sh) { sh = ss.insertSheet(name); }
      if (sh.getLastRow() === 0) { sh.appendRow(H); sh.setFrozenRows(1); }
      else if (sh.getLastColumn() < H.length) sh.getRange(1, 1, 1, H.length).setValues([H]);
    });
    cache.put(key, '1', 21600);
  } finally { lock.releaseLock(); }
}
function gynSheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function gynRowObj_(name, vals, rowIndex) {
  var H = GYN_HEADERS[name], o = { _row: rowIndex }, tc = GYN_TEXT[name] || [];
  H.forEach(function (h, j) {
    var v = vals[j];
    if (tc.indexOf(h) >= 0) v = v == null ? '' : String(v);
    else if (GYN_BOOL[h]) v = v === true || v === 'TRUE' || v === 'true';
    else if (GYN_NUM[h]) v = v === '' || v == null ? null : Number(v);
    o[h] = v;
  });
  return o;
}
function gynReadAll_(name, module) {
  var sh = gynSheet_(name), last = sh.getLastRow(), H = GYN_HEADERS[name];
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, H.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    if (module && String(vals[i][0]) !== module) continue;
    out.push(gynRowObj_(name, vals[i], i + 2));
  }
  return out;
}
/** Rows whose column `col` equals `value` exactly — located with a TextFinder so large sheets are not read whole. */
function gynFind_(name, col, value, module) {
  var sh = gynSheet_(name), last = sh.getLastRow(), H = GYN_HEADERS[name], c = H.indexOf(col) + 1;
  if (last < 2 || !value) return [];
  var hits = sh.getRange(2, c, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findAll();
  var out = [];
  hits.forEach(function (r) {
    var row = r.getRow(), vals = sh.getRange(row, 1, 1, H.length).getValues()[0];
    if (module && String(vals[0]) !== module) return;
    if (String(vals[c - 1]) !== String(value)) return;
    out.push(gynRowObj_(name, vals, row));
  });
  return out;
}
function gynToArray_(name, o) {
  return GYN_HEADERS[name].map(function (h) {
    var v = o[h];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string' && v.length > 49000) throw new Error('A value is too large to store in one cell (' + h + ').');
    return v;
  });
}
function gynFormats_(name) { var tc = GYN_TEXT[name] || []; return [GYN_HEADERS[name].map(function (h) { return tc.indexOf(h) >= 0 ? '@' : 'General'; })]; }
function gynAppend_(name, o) {
  var sh = gynSheet_(name), r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  var rng = sh.getRange(r, 1, 1, GYN_HEADERS[name].length);
  rng.setNumberFormats(gynFormats_(name)); rng.setValues([gynToArray_(name, o)]);
  o._row = r; return o;
}
function gynAppendMany_(name, list) {
  if (!list.length) return;
  var sh = gynSheet_(name), start = sh.getLastRow() + 1, n = list.length, W = GYN_HEADERS[name].length;
  var need = start + n - 1 - sh.getMaxRows(); if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  var rng = sh.getRange(start, 1, n, W), f = gynFormats_(name)[0], fm = [];
  for (var i = 0; i < n; i++) fm.push(f);
  rng.setNumberFormats(fm); rng.setValues(list.map(function (o) { return gynToArray_(name, o); }));
}
function gynUpdate_(name, o) {
  var rng = gynSheet_(name).getRange(o._row, 1, 1, GYN_HEADERS[name].length);
  rng.setNumberFormats(gynFormats_(name)); rng.setValues([gynToArray_(name, o)]);
}
function gynJ_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function gynLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { l.releaseLock(); } }
function gynId_(prefix) { return prefix + '_' + Date.now().toString(36) + randomHex_(5); }
function gynRand_() { return parseInt(randomHex_(6), 16) / 281474976710656; } // 48-bit, cryptographically strong
function gynOrder_(n, shuffle) { var o = []; for (var i = 0; i < n; i++) o.push(i); return shuffle ? gynShuffle_(o) : o; }
function gynShuffle_(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(gynRand_() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function gynAudit_(module, actor, role, event, ref, detail) {
  try { gynAppend_(GYN_SHEETS.L, { module: module, at: Date.now(), actor: String(actor || ''), role: role || '', event: event, ref: String(ref || ''), detail: detail ? String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000) : '' }); }
  catch (e) { console.error('GYN audit failed: ' + (e && e.message || e)); }
}
function gynErr_(msg, code) { return { ok: false, error: msg, code: code || 'bad' }; }

/* ---------------------------------------------------------------------- *
 * Question bank (versioned)
 * ---------------------------------------------------------------------- */
var GYN_CONTENT_FIELDS = ['kind', 'legacyId', 'code', 'lecture', 'section', 'sub', 'topic', 'concept', 'objective', 'difficulty', 'priority', 'label',
  'previousExam', 'imageBased', 'integrated', 'image', 'stem', 'options', 'answer', 'explanation', 'trap', 'ref'];
function gynHashQ_(q) { var o = {}; GYN_CONTENT_FIELDS.forEach(function (f) { o[f] = q[f] === undefined ? null : q[f]; }); return sha256Hex_(JSON.stringify(o)); }
function gynRowToQ_(r) {
  return { qid: r.qid, version: r.version, kind: r.kind, active: r.active, legacyId: r.legacyId, code: r.code, lecture: r.lecture, section: r.section, sub: r.sub,
    topic: r.topic, concept: r.concept, objective: r.objective, difficulty: r.difficulty, priority: r.priority == null ? null : Number(r.priority), label: r.label,
    previousExam: r.previousExam, imageBased: r.imageBased, integrated: r.integrated, image: r.image, stem: r.stem, options: gynJ_(r.optionsJson, []), answer: r.answer,
    explanation: r.explanation, trap: r.trap, ref: r.ref, createdAt: r.createdAt, createdBy: r.createdBy, contentHash: r.contentHash, _row: r._row };
}
/** { qid: { latest: q, versions: {n: q} } } — memoised per request */
var GYN_MEMO = {};
function gynBank_(module) {
  var k = 'bank:' + module; if (GYN_MEMO[k]) return GYN_MEMO[k];
  var bank = {};
  gynReadAll_(GYN_SHEETS.Q, module).forEach(function (r) {
    var q = gynRowToQ_(r), e = bank[q.qid] || (bank[q.qid] = { latest: null, versions: {} });
    e.versions[q.version] = q;
    if (!e.latest || q.version > e.latest.version) e.latest = q;
  });
  GYN_MEMO[k] = bank; return bank;
}
function gynValidateQ_(q, topics) {
  var miss = [];
  if (!q || typeof q !== 'object') return { error: 'Empty record.' };
  if (!/^(VULVA|VAGINA)-[A-Z0-9]{2,8}-[A-Z]?\d{2,4}$/.test(String(q.qid || ''))) return { error: 'Missing or invalid question ID (' + (q.qid || '—') + ').' };
  if (q.kind !== 'assess' && q.kind !== 'practice') return { error: 'kind must be "assess" or "practice".' };
  var stem = Array.isArray(q.stem) ? q.stem.join('\n\n') : String(q.stem || '');
  if (!stem.trim()) return { error: 'Stem is empty.' };
  // Stricter than the Cvs/Cirev precedent (which allowed 2-6 options): every Gynecology Pathology SBA
  // (vulva AND the future vagina module) must have EXACTLY 4 options (A-D).
  if (!Array.isArray(q.options) || q.options.length !== 4) return { error: 'A Gynecology Pathology SBA needs exactly 4 options (A-D), found ' + (q.options ? q.options.length : 0) + '.' };
  if (q.options.some(function (o) { return !String(o || '').trim(); })) return { error: 'An option is empty.' };
  var seen = {}; if (q.options.some(function (o) { var k = String(o).trim().toLowerCase(); if (seen[k]) return true; seen[k] = 1; return false; })) return { error: 'Two options are identical.' };
  if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3 || q.answer % 1) return { error: 'The correct answer must be one of the options (A-D).' };
  if (!q.topic) return { error: 'Topic is missing.' };
  if (topics && !topics[q.topic]) return { error: 'Unknown topic “' + q.topic + '”.' };
  if (!/^[A-Z][A-Z0-9]{0,11}(\+[A-Z][A-Z0-9]{0,11})?$/.test(String(q.lecture || ''))) return { error: 'Lecture/unit code is missing or malformed.' };
  if (!String(q.explanation || '').trim()) return { error: 'Explanation is missing.' };
  ['section', 'concept', 'objective', 'difficulty'].forEach(function (f) { if (!String(q[f] || '').trim()) miss.push(f); });
  if (q.kind === 'assess' && !q.code) miss.push('code');
  return { ok: true, missing: miss, stem: stem };
}
function gynNormQ_(q, stem) {
  return { qid: String(q.qid), kind: q.kind, legacyId: String(q.legacyId || '').slice(0, 40), code: String(q.code || '').slice(0, 40), lecture: String(q.lecture),
    section: String(q.section || '').slice(0, 20), sub: String(q.sub || '').slice(0, 20), topic: String(q.topic).slice(0, 40), concept: String(q.concept || '').slice(0, 60),
    objective: String(q.objective || '').slice(0, 300), difficulty: String(q.difficulty || '').slice(0, 30), priority: q.priority == null ? '' : Number(q.priority),
    label: String(q.label || '').slice(0, 40), previousExam: !!q.previousExam, imageBased: !!(q.imageBased || q.image), integrated: !!q.integrated,
    image: String(q.image || '').slice(0, 1500), stem: stem.slice(0, 6000), options: q.options.map(function (o) { return String(o).slice(0, 600); }), answer: q.answer,
    explanation: String(q.explanation || '').slice(0, 5000), trap: String(q.trap || '').slice(0, 2000), ref: String(q.ref || '').slice(0, 300) };
}
function gynQRow_(module, q, version, active, by) {
  return { module: module, qid: q.qid, version: version, kind: q.kind, active: active, legacyId: q.legacyId, code: q.code, lecture: q.lecture, section: q.section, sub: q.sub,
    topic: q.topic, concept: q.concept, objective: q.objective, difficulty: q.difficulty, priority: q.priority, label: q.label, previousExam: q.previousExam, imageBased: q.imageBased,
    integrated: q.integrated, image: q.image, stem: q.stem, optionsJson: JSON.stringify(q.options), answer: q.answer, explanation: q.explanation, trap: q.trap, ref: q.ref,
    createdAt: Date.now(), createdBy: by || 'teacher', contentHash: gynHashQ_(q) };
}
function gynStemParts_(stem) { return String(stem || '').split(/\n\s*\n/).filter(function (x) { return x.trim(); }); }

/* ---------------------------------------------------------------------- *
 * Assessments
 * ---------------------------------------------------------------------- */
function gynRowToA_(r) {
  return { id: r.id, title: r.title, subtitle: r.subtitle, lecture: r.lecture, durationMin: r.durationMin, questionCount: r.questionCount, pool: gynJ_(r.poolJson, []),
    randomizeQuestions: r.randomizeQuestions, randomizeOptions: r.randomizeOptions, status: r.status, passPct: r.passPct, attemptsAllowed: r.attemptsAllowed || 0,
    review: r.review || 'after_submit', createdAt: r.createdAt, updatedAt: r.updatedAt, publishedAt: r.publishedAt, closedAt: r.closedAt, _row: r._row };
}
function gynAssessments_(module) {
  var k = 'asm:' + module; if (GYN_MEMO[k]) return GYN_MEMO[k];
  var out = gynReadAll_(GYN_SHEETS.A, module).map(gynRowToA_); GYN_MEMO[k] = out; return out;
}
function gynAssessment_(module, id) { var all = gynAssessments_(module); for (var i = 0; i < all.length; i++) if (all[i].id === String(id)) return all[i]; return null; }
function gynARow_(module, a) {
  return { module: module, id: a.id, title: a.title, subtitle: a.subtitle || '', lecture: a.lecture || '', durationMin: a.durationMin, questionCount: a.questionCount,
    poolJson: JSON.stringify(a.pool || []), randomizeQuestions: !!a.randomizeQuestions, randomizeOptions: !!a.randomizeOptions, status: a.status, passPct: a.passPct,
    attemptsAllowed: a.attemptsAllowed || 0, review: a.review || 'after_submit', createdAt: a.createdAt || Date.now(), updatedAt: Date.now(),
    publishedAt: a.publishedAt || '', closedAt: a.closedAt || '', _row: a._row };
}
/** May a student see correct answers/explanations for attempts of this assessment now? */
function gynReviewOpen_(a) { if (!a) return false; if (a.review === 'never') return false; if (a.review === 'after_close') return a.status === 'closed' || a.status === 'archived'; return true; }
function gynPublicA_(a) { return { id: a.id, title: a.title, subtitle: a.subtitle, lecture: a.lecture, durationMin: a.durationMin, questionCount: a.questionCount, status: a.status, attemptsAllowed: a.attemptsAllowed, passPct: a.passPct, review: a.review }; }

/* ---------------------------------------------------------------------- *
 * Attempts
 * ---------------------------------------------------------------------- */
function gynRowToT_(r) {
  var t = {}; for (var k in r) t[k] = r[k];
  t.items = gynJ_(r.itemsJson, []); t.byTopic = gynJ_(r.byTopicJson, {}); t.saved = gynJ_(r.savedJson, {});
  return t;
}
function gynTRow_(t) {
  var o = {}; GYN_HEADERS.GYN_Attempts.forEach(function (h) { o[h] = t[h]; });
  o.itemsJson = JSON.stringify(t.items || []); o.byTopicJson = JSON.stringify(t.byTopic || {}); o.savedJson = JSON.stringify(t.saved || {}); o._row = t._row;
  return o;
}
function gynMyAttempts_(module, username) { return gynFind_(GYN_SHEETS.T, 'username', username, module).map(gynRowToT_); }
function gynAllAttempts_(module) { return gynReadAll_(GYN_SHEETS.T, module).map(gynRowToT_); }
function gynCleanResponses_(att, raw) {
  var out = {}; raw = raw && typeof raw === 'object' ? raw : {};
  (att.items || []).forEach(function (it, i) { var r = raw[i]; if (typeof r === 'number' && r >= 0 && r < ((it.o && it.o.length) || 5) && r % 1 === 0) out[i] = r; });
  return out;
}
/** Grades an attempt against the frozen question VERSIONS it was built from. */
function gynGrade_(module, att, responses, now, how) {
  var bank = gynBank_(module), c = 0, w = 0, u = 0, by = {};
  att.items.forEach(function (it, i) {
    var q = bank[it.q] && bank[it.q].versions[it.v];
    var r = responses[i]; var orig = (r === undefined || r === null) ? null : it.o[r];
    it.r = r === undefined ? null : r; it.a = orig; it.k = !!(q && orig !== null && orig === q.answer);
    var t = by[it.t] = by[it.t] || [0, 0]; t[1]++;
    if (orig === null) u++; else if (it.k) { c++; t[0]++; } else w++;
  });
  att.correct = c; att.incorrect = w; att.unanswered = u; att.score = c; att.total = att.items.length;
  att.percent = att.total ? Math.round(1000 * c / att.total) / 10 : 0; att.byTopic = by;
  var end = Math.min(now, att.deadlineAt || now);
  att.submittedAt = how === 'expired' ? (att.deadlineAt || now) : now; att.durationSec = Math.max(0, Math.round((end - att.startedAt) / 1000));
  att.status = how === 'expired' ? 'expired' : 'submitted'; att.auto = how === 'expired';
  att.saved = responses;
  return att;
}
function gynIsFinal_(t) { return t.status === 'submitted' || t.status === 'expired'; }
/** Lazily finalises a started attempt whose time (plus grace) is over, using the last autosaved answers. */
function gynMaybeExpire_(module, t, now) {
  if (t.status === 'started' && t.deadlineAt && now > t.deadlineAt + GYN_GRACE_MS) {
    gynGrade_(module, t, t.saved || {}, now, 'expired'); gynUpdate_(GYN_SHEETS.T, gynTRow_(t));
    gynAudit_(module, t.username, 'system', 'assessment expired', t.id, { percent: t.percent });
    gynSrsFromAttempt_(module, t);
    return true;
  }
  return false;
}
function gynPaper_(module, t) {
  var bank = gynBank_(module);
  return t.items.map(function (it, i) {
    var q = bank[it.q].versions[it.v];
    return { n: i + 1, stem: gynStemParts_(q.stem), image: q.image || '', options: it.o.map(function (k) { return q.options[k]; }) };
  });
}
function gynAttemptSummary_(t) {
  return { id: t.id, assessmentId: t.assessmentId, assessmentTitle: t.assessmentTitle, attemptNo: t.attemptNo, status: t.status, startedAt: t.startedAt, deadlineAt: t.deadlineAt,
    submittedAt: t.submittedAt, durationSec: t.durationSec, score: t.score, total: t.total, percent: t.percent, correct: t.correct, incorrect: t.incorrect,
    unanswered: t.unanswered, auto: !!t.auto };
}
/** Topic performance + revision priorities for one or more FINAL attempts (server-side weak-topic analysis). */
function gynTopicAnalysis_(module, attempts, n) {
  var bank = gynBank_(module), rows = {};
  attempts.forEach(function (t) {
    t.items.forEach(function (it) {
      var q = bank[it.q] && bank[it.q].versions[it.v];
      var r = rows[it.t] = rows[it.t] || { topic: it.t, attempted: 0, correct: 0, incorrect: 0, unanswered: 0, sections: {}, concepts: {}, attempts: {} };
      r.attempted++;
      if (it.k) r.correct++;
      else { if (it.a === null || it.a === undefined) r.unanswered++; else r.incorrect++; if (q) { r.sections[q.section] = 1; r.concepts[q.concept] = 1; } r.attempts[t.id] = 1; }
    });
  });
  var list = Object.keys(rows).map(function (k) { var r = rows[k]; return { topic: r.topic, score: r.attempted ? Math.round(1000 * r.correct / r.attempted) / 10 : 0,
    questions_attempted: r.attempted, questions_correct: r.correct, questions_incorrect: r.incorrect, questions_unanswered: r.unanswered,
    missed: r.incorrect + r.unanswered, weak: r.attempted > 0 && 100 * r.correct / r.attempted < GYN_WEAK_PCT,
    sections: Object.keys(r.sections).sort(), concepts: Object.keys(r.concepts), attemptIds: Object.keys(r.attempts) }; })
    .sort(function (a, b) { return a.score - b.score || b.missed - a.missed; });
  return { topics: list, priorities: list.filter(function (r) { return r.missed > 0; }).slice(0, n || 3) };
}
function gynResultView_(module, t, withReview) {
  var a = gynAssessment_(module, t.assessmentId), bank = gynBank_(module);
  var out = gynAttemptSummary_(t); out.byTopic = t.byTopic; out.passPct = a ? a.passPct : null;
  var ana = gynTopicAnalysis_(module, [t], 3); out.topics = ana.topics; out.priorities = ana.priorities;
  out.reviewAvailable = !!(withReview && gynReviewOpen_(a));
  if (out.reviewAvailable) out.review = t.items.map(function (it, i) {
    var q = bank[it.q].versions[it.v];
    return { n: i + 1, code: q.code, topic: q.topic, section: q.section, concept: q.concept, objective: q.objective, difficulty: q.difficulty, stem: gynStemParts_(q.stem), image: q.image,
      options: it.o.map(function (k) { return q.options[k]; }), response: it.r, correctOption: it.o.indexOf(q.answer), correct: it.k, explanation: q.explanation, trap: q.trap, ref: q.ref };
  });
  else if (a && a.review !== 'never') out.reviewMessage = 'Answers and explanations for this assessment are released when your teacher closes it.';
  return out;
}

/* ---------------------------------------------------------------------- *
 * Progress & revision queue (one row per student per kind)
 * ---------------------------------------------------------------------- */
var GYN_PROGRESS_KINDS = { studied: 1, facts: 1, checks: 1, last: 1, legacy: 1, practice: 0, srs: 0 }; // 0 = server-written only
function gynProgressRows_(module, username) { var out = {}; gynFind_(GYN_SHEETS.P, 'username', username, module).forEach(function (r) { out[r.kind] = r; }); return out; }
function gynProgressGet_(module, username) {
  var rows = gynProgressRows_(module, username), o = {};
  Object.keys(rows).forEach(function (k) { o[k] = gynJ_(rows[k].valueJson, {}); });
  return { values: o, rows: rows };
}
function gynProgressPut_(module, username, kind, value, rows) {
  var s = JSON.stringify(value); if (s.length > 45000) throw new Error('Progress data too large.');
  var r = rows && rows[kind];
  if (r) { r.valueJson = s; r.updatedAt = Date.now(); gynUpdate_(GYN_SHEETS.P, r); }
  else { var nr = gynAppend_(GYN_SHEETS.P, { module: module, username: username, kind: kind, valueJson: s, updatedAt: Date.now() }); if (rows) rows[kind] = nr; }
}
function gynSrsApply_(srs, results, now) {
  Object.keys(results).forEach(function (k) {
    if (!k) return;
    var e = srs[k];
    if (results[k]) { if (!e) return; e.box = Math.min(GYN_SRS_DAYS.length - 1, (e.box || 0) + 1); }
    else { e = e || { box: 0, n: 0, wrong: 0 }; e.box = 0; e.wrong = (e.wrong || 0) + 1; }
    e.n = (e.n || 0) + 1; e.last = now; e.lastOk = !!results[k]; e.due = now + GYN_SRS_DAYS[e.box] * 86400000;
    srs[k] = e;
  });
  return srs;
}
function gynSrsFromAttempt_(module, t) {
  var bank = gynBank_(module), res = {};
  t.items.forEach(function (it) { var q = bank[it.q] && bank[it.q].versions[it.v]; var c = q && q.concept; if (!c) return; res[c] = (res[c] !== false) && !!it.k; });
  var P = gynProgressGet_(module, t.username);
  gynProgressPut_(module, t.username, 'srs', gynSrsApply_(P.values.srs || {}, res, Date.now()), P.rows);
}
function gynDue_(srs, now) { return Object.keys(srs || {}).filter(function (k) { return srs[k].due <= now; }).sort(function (a, b) { return srs[a].due - srs[b].due; }); }

/* ---------------------------------------------------------------------- *
 * Router
 * ---------------------------------------------------------------------- */
function gynRoute_(module, p) {
  GYN_MEMO = {};
  gynEnsure_();
  var a = p.action;
  if (/^gynAdmin/.test(a)) return authed_(module, p, function () { return gynTeacher_(module, p); });
  if (a === 'gynInfo') return { ok: true, version: GYN_VERSION, serverTime: Date.now(), role: p.__role || '' };
  var st = p.__student;
  if (p.__role !== 'student' || !st) {
    if (p.__role === 'teacher' && (a === 'gynPracticeItems' || a === 'gynPracticeCheck' || a === 'gynBootstrap')) return gynTeacherPreview_(module, p);
    return gynErr_('Please sign in as a student.', 'studentauth');
  }
  var user = st.username, now = Date.now();
  // rate limiting (per student, per minute) — generous for normal use, stops scripted hammering
  var c = CacheService.getScriptCache(), rk = 'gynrl:' + module + ':' + user + ':' + Math.floor(now / 60000), n = Number(c.get(rk) || 0) + 1;
  c.put(rk, String(n), 120);
  if (n > GYN_RATE_PER_MIN) return gynErr_('Too many requests — please wait a minute and try again.', 'ratelimit');
  switch (a) {
    case 'gynBootstrap': return gynBootstrap_(module, st, now);
    case 'gynPracticeItems': return gynPracticeItems_(module, st, p);
    case 'gynPracticeCheck': return gynPracticeCheck_(module, st, p, now);
    case 'gynStart': return gynStart_(module, st, p, now);
    case 'gynSave': return gynSave_(module, st, p, now);
    case 'gynSubmit': return gynSubmit_(module, st, p, now);
    case 'gynResult': return gynResult_(module, st, p, now);
    case 'gynMyResults': return gynMyResults_(module, st, now);
    case 'gynRetrySet': return gynRetrySet_(module, st, p, now);
    case 'gynProgressSave': return gynProgressSave_(module, st, p);
    default: return gynErr_('Unknown action: ' + a, 'badaction');
  }
}

/* ---------------------------------------------------------------------- *
 * Student actions
 * ---------------------------------------------------------------------- */
/** Past-paper practice items carry their source in the objective: "Past paper: Midterm Q5". */
function gynPastLabel_(q) { var m = /^Past paper: (.+)$/.exec(String(q.objective || '')); return m ? m[1] : ''; }
function gynPracticeIndex_(module) {
  var bank = gynBank_(module), out = [];
  Object.keys(bank).forEach(function (id) { var q = bank[id].latest; if (q.kind === 'practice' && q.active) out.push({ id: q.qid, sub: q.sub, section: q.section, concept: q.concept, prev: q.previousExam, img: !!q.image, past: gynPastLabel_(q) }); });
  out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  return out;
}
function gynBootstrap_(module, st, now) {
  var mine = gynMyAttempts_(module, st.username);
  if (mine.some(function (t) { return t.status === 'started' && t.deadlineAt && now > t.deadlineAt + GYN_GRACE_MS; })) gynLock_(function () { mine.forEach(function (t) { gynMaybeExpire_(module, t, now); }); });
  var list = gynAssessments_(module).filter(function (a) { return a.status === 'published' || a.status === 'closed'; }).map(function (a) {
    var ts = mine.filter(function (t) { return t.assessmentId === a.id; }).sort(function (x, y) { return x.startedAt - y.startedAt; });
    var fin = ts.filter(gynIsFinal_), act = ts.filter(function (t) { return t.status === 'started'; })[0];
    var o = gynPublicA_(a);
    o.attempts = fin.length; o.active = act ? { id: act.id, deadlineAt: act.deadlineAt } : null;
    o.last = fin.length ? gynAttemptSummary_(fin[fin.length - 1]) : null;
    o.best = fin.length ? Math.max.apply(null, fin.map(function (t) { return t.percent; })) : null;
    o.canStart = a.status === 'published' && (!!act || !a.attemptsAllowed || fin.length < a.attemptsAllowed);
    return o;
  });
  var P = gynProgressGet_(module, st.username).values;
  var latest = gynLatestFinal_(mine);
  var ana = gynTopicAnalysis_(module, latest, 3);
  return { ok: true, serverTime: now, version: GYN_VERSION, me: { username: st.username, name: st.name }, assessments: list,
    progress: { studied: P.studied || {}, facts: P.facts || {}, checks: P.checks || {}, last: P.last || null, legacy: P.legacy ? { at: P.legacy.at, count: (P.legacy.attempts || []).length } : null, practice: P.practice || {} },
    srs: P.srs || {}, due: gynDue_(P.srs, now), priorities: ana.priorities, topics: ana.topics, practiceIndex: gynPracticeIndex_(module) };
}
function gynLatestFinal_(mine) {
  var by = {}; mine.filter(gynIsFinal_).forEach(function (t) { if (!by[t.assessmentId] || t.submittedAt > by[t.assessmentId].submittedAt) by[t.assessmentId] = t; });
  return Object.keys(by).map(function (k) { return by[k]; });
}
/** assessment question ids whose answers this student may already see (reviewable submitted attempts) */
function gynRevealed_(module, st) {
  var ok = {};
  gynMyAttempts_(module, st.username).forEach(function (t) { if (gynIsFinal_(t) && gynReviewOpen_(gynAssessment_(module, t.assessmentId))) t.items.forEach(function (it) { ok[it.q] = 1; }); });
  return ok;
}
function gynPublicItem_(q) {
  return { id: q.qid, kind: q.kind, code: q.kind === 'assess' ? q.code : '', sub: q.sub, section: q.section, concept: q.concept, topic: q.topic, previousExam: q.kind === 'practice' ? q.previousExam : false,
    past: q.kind === 'practice' ? gynPastLabel_(q) : '', stem: gynStemParts_(q.stem), image: q.image, options: q.options };
}
function gynPracticeItems_(module, st, p) {
  var bank = gynBank_(module), ids = (p.ids || []).slice(0, 150).map(String), rev = null, out = [], refused = 0;
  ids.forEach(function (id) {
    var e = bank[id]; if (!e || !e.latest.active) { refused++; return; }
    if (e.latest.kind === 'assess') { if (!rev) rev = st ? gynRevealed_(module, st) : {}; if (!rev[id]) { refused++; return; } }
    out.push(gynPublicItem_(e.latest));
  });
  var pr = st ? (gynProgressGet_(module, st.username).values.practice || {}) : {};
  return { ok: true, items: out, refused: refused, state: pr };
}
function gynPracticeCheck_(module, st, p, now) {
  var e = gynBank_(module)[String(p.id || '')];
  if (!e || !e.latest.active) return gynErr_('Question not available.', 'notfound');
  var q = e.latest;
  if (q.kind === 'assess' && !(st && gynRevealed_(module, st)[q.qid])) return gynErr_('This question is not available for practice.', 'forbidden');
  var ans = Number(p.answer); if (!(ans >= 0 && ans < q.options.length && ans % 1 === 0)) return gynErr_('Choose an answer.');
  var ok = ans === q.answer;
  if (st) gynLock_(function () {
    var P = gynProgressGet_(module, st.username), pr = P.values.practice || {};
    pr[q.qid] = { ok: ok, at: now }; gynProgressPut_(module, st.username, 'practice', pr, P.rows);
    var r = {}; if (q.concept) r[q.concept] = ok;
    gynProgressPut_(module, st.username, 'srs', gynSrsApply_(P.values.srs || {}, r, now), P.rows);
  });
  return { ok: true, correct: ok, answer: q.answer, explanation: q.explanation, trap: q.kind === 'assess' ? q.trap : '', ref: q.ref, sub: q.sub, section: q.section, concept: q.concept };
}
function gynStart_(module, st, p, now) {
  return gynLock_(function () {
    var a = gynAssessment_(module, p.assessmentId);
    if (!a || (a.status !== 'published' && a.status !== 'closed')) return gynErr_('This assessment is not available.', 'notfound');
    var mine = gynMyAttempts_(module, st.username).filter(function (t) { return t.assessmentId === a.id; });
    mine.forEach(function (t) { gynMaybeExpire_(module, t, now); });
    var act = mine.filter(function (t) { return t.status === 'started'; })[0];
    if (act) return { ok: true, resumed: true, attempt: gynStartView_(module, act, a, now) };
    if (a.status !== 'published') return gynErr_('This assessment is closed.', 'closed');
    var fin = mine.filter(gynIsFinal_).length;
    if (a.attemptsAllowed && fin >= a.attemptsAllowed) return gynErr_('You have used all ' + a.attemptsAllowed + ' allowed attempt(s).', 'noattempts');
    var bank = gynBank_(module);
    var pool = a.pool.filter(function (id) { return bank[id] && bank[id].latest.active && bank[id].latest.kind === 'assess'; });
    var count = Math.min(Number(a.questionCount) || pool.length, pool.length);
    if (!count) return gynErr_('This assessment has no questions yet.', 'empty');
    var ids = count < pool.length ? gynShuffle_(pool).slice(0, count) : pool.slice();
    if (a.randomizeQuestions) ids = gynShuffle_(ids); else { var pos = {}; pool.forEach(function (id, i) { pos[id] = i; }); ids.sort(function (x, y) { return pos[x] - pos[y]; }); }
    var items = ids.map(function (id) { var q = bank[id].latest; return { q: id, v: q.version, o: gynOrder_(q.options.length, a.randomizeOptions), t: q.topic, r: null, a: null, k: false }; });
    var t = { module: module, id: gynId_('gynatt'), username: st.username, name: st.name, assessmentId: a.id, assessmentTitle: a.title, attemptNo: mine.length + 1,
      status: 'started', startedAt: now, deadlineAt: now + Math.max(1, Number(a.durationMin) || 30) * 60000, submittedAt: '', durationSec: '', score: '', total: items.length,
      percent: '', correct: '', incorrect: '', unanswered: '', auto: false, items: items, byTopic: {}, saved: {}, lastSavedAt: now, submitKey: '' };
    gynAppend_(GYN_SHEETS.T, gynTRow_(t)); t._row = gynSheet_(GYN_SHEETS.T).getLastRow();
    gynAudit_(module, st.username, 'student', 'assessment started', t.id, { assessment: a.id, attemptNo: t.attemptNo });
    gynAudit_(module, st.username, 'system', 'question set generated', t.id, items.map(function (it) { return it.q + '@' + it.v + ':' + it.o.join(''); }).join(' '));
    return { ok: true, resumed: false, attempt: gynStartView_(module, t, a, now) };
  });
}
function gynStartView_(module, t, a, now) {
  return { id: t.id, assessmentId: a.id, title: a.title, subtitle: a.subtitle, durationMin: a.durationMin, startedAt: t.startedAt, deadlineAt: t.deadlineAt, serverTime: now,
    graceMs: GYN_GRACE_MS, paper: gynPaper_(module, t), responses: t.saved || {} };
}
function gynOwnAttempt_(module, st, id) {
  var list = gynFind_(GYN_SHEETS.T, 'id', String(id || ''), module);
  if (!list.length) return null;
  var t = gynRowToT_(list[0]);
  return t.username === st.username ? t : null;   // never another student's attempt
}
function gynSave_(module, st, p, now) {
  return gynLock_(function () {
    var t = gynOwnAttempt_(module, st, p.attemptId); if (!t) return gynErr_('Attempt not found.', 'notfound');
    if (gynMaybeExpire_(module, t, now)) return { ok: false, code: 'expired', error: 'Time is up — your last saved answers were submitted automatically.', attemptId: t.id };
    if (t.status !== 'started') return { ok: false, code: 'final', error: 'This attempt has already been submitted.', attemptId: t.id };
    t.saved = gynCleanResponses_(t, p.responses); t.lastSavedAt = now; gynUpdate_(GYN_SHEETS.T, gynTRow_(t));
    return { ok: true, savedAt: now, serverTime: now, deadlineAt: t.deadlineAt };
  });
}
function gynSubmit_(module, st, p, now) {
  return gynLock_(function () {
    var t = gynOwnAttempt_(module, st, p.attemptId); if (!t) return gynErr_('Attempt not found.', 'notfound');
    if (gynIsFinal_(t) || t.status === 'abandoned') return { ok: true, already: true, result: gynResultView_(module, t, true) };  // idempotent: double click, refresh, retry after timeout
    var late = t.deadlineAt && now > t.deadlineAt + GYN_GRACE_MS;
    var resp = late ? (t.saved || {}) : gynCleanResponses_(t, p.responses);
    gynGrade_(module, t, resp, now, late ? 'expired' : 'submit');
    t.submitKey = String(p.submitKey || '').slice(0, 64);
    gynUpdate_(GYN_SHEETS.T, gynTRow_(t));
    gynAudit_(module, st.username, 'student', late ? 'assessment expired' : 'assessment submitted', t.id, { assessment: t.assessmentId });
    gynAudit_(module, st.username, 'system', 'result calculated', t.id, { score: t.score, total: t.total, percent: t.percent });
    gynSrsFromAttempt_(module, t);
    var out = { ok: true, result: gynResultView_(module, t, true) };
    if (late) out.expired = true;
    return out;
  });
}
function gynResult_(module, st, p, now) {
  var t = gynOwnAttempt_(module, st, p.attemptId); if (!t) return gynErr_('Result not found.', 'notfound');
  if (t.status === 'started') { if (!gynLock_(function () { return gynMaybeExpire_(module, t, now); })) return gynErr_('This attempt has not been submitted yet.', 'notfinal'); }
  if (t.status === 'abandoned') return gynErr_('This attempt was cancelled by your teacher.', 'abandoned');
  return { ok: true, result: gynResultView_(module, t, true) };
}
function gynMyResults_(module, st, now) {
  var mine = gynMyAttempts_(module, st.username);
  gynLock_(function () { mine.forEach(function (t) { gynMaybeExpire_(module, t, now); }); });
  var fin = mine.filter(gynIsFinal_).sort(function (a, b) { return b.submittedAt - a.submittedAt; });
  var ana = gynTopicAnalysis_(module, gynLatestFinal_(mine), 5);
  var P = gynProgressGet_(module, st.username).values;
  return { ok: true, attempts: fin.map(gynAttemptSummary_), topics: ana.topics, priorities: ana.priorities, srs: P.srs || {}, due: gynDue_(P.srs, now),
    legacy: P.legacy || null, serverTime: now };
}
/** Retry my mistakes: the missed/unanswered questions of reviewable attempts + up to 3 NEW practice questions on the same concepts. */
function gynRetrySet_(module, st, p, now) {
  var bank = gynBank_(module), mine = gynMyAttempts_(module, st.username).filter(gynIsFinal_);
  var ids = (p.attemptIds || []).map(String), topic = p.topic ? String(p.topic) : '';
  var src = ids.length ? mine.filter(function (t) { return ids.indexOf(t.id) >= 0; }) : gynLatestFinal_(mine);
  var missed = [], seen = {}, concepts = [], hidden = 0;
  src.forEach(function (t) {
    var open = gynReviewOpen_(gynAssessment_(module, t.assessmentId));
    t.items.forEach(function (it) {
      if (it.k || seen[it.q]) return; if (topic && it.t !== topic) return;
      var q = bank[it.q] && bank[it.q].latest; if (!q || !q.active) return;
      seen[it.q] = 1;
      if (q.concept && concepts.indexOf(q.concept) < 0) concepts.push(q.concept);
      if (open) missed.push(gynPublicItem_(q)); else hidden++;
    });
  });
  var pr = gynProgressGet_(module, st.username).values.practice || {};
  var pool = Object.keys(bank).map(function (k) { return bank[k].latest; }).filter(function (q) { return q.kind === 'practice' && q.active && (concepts.indexOf(q.concept) >= 0 || (topic && q.topic === topic)); });
  function rank(q) { var s = pr[q.qid]; return (concepts.indexOf(q.concept) >= 0 ? 0 : 10) + (s ? (s.ok ? 2 : 1) : 0); }
  pool.sort(function (a, b) { return rank(a) - rank(b) || (a.qid < b.qid ? -1 : 1); });
  var fresh = pool.slice(0, missed.length || hidden ? 3 : 0).map(gynPublicItem_);
  return { ok: true, missed: missed, fresh: fresh, hiddenUntilClose: hidden, concepts: concepts };
}
function gynProgressSave_(module, st, p) {
  var items = (p.items || []).slice(0, 40);
  return gynLock_(function () {
    var P = gynProgressGet_(module, st.username), n = 0;
    items.forEach(function (it) {
      var kind = String(it && it.kind || '');
      if (GYN_PROGRESS_KINDS[kind] !== 1) return;                       // practice/srs are written only by the server
      var v = it.value;
      if (kind === 'last') v = { label: String(v && v.label || '').slice(0, 160), href: String(v && v.href || '').slice(0, 200), at: Date.now() };
      else if (kind === 'legacy') {
        if (P.values.legacy) return;                                     // imported once; never overwritten
        v = { at: Date.now(), verified: false, attempts: (v && v.attempts || []).slice(0, 100).map(function (x) { return { test: String(x.test || '').slice(0, 10), pct: Number(x.pct) || 0, score: Number(x.score) || 0, total: Number(x.total) || 0, submittedAt: Number(x.submittedAt) || 0 }; }) };
        gynAudit_(module, st.username, 'student', 'local progress imported (unverified)', '', { attempts: v.attempts.length });
      } else {
        if (!v || typeof v !== 'object') return;
        var clean = {}; Object.keys(v).slice(0, 200).forEach(function (k) { clean[String(k).slice(0, 30)] = typeof v[k] === 'object' ? { ok: !!(v[k] && v[k].ok), at: Number(v[k] && v[k].at) || 0 } : !!v[k]; });
        v = clean;
      }
      gynProgressPut_(module, st.username, kind, v, P.rows); n++;
    });
    return { ok: true, saved: n };
  });
}
function gynTeacherPreview_(module, p) {
  if (p.action === 'gynBootstrap') return { ok: true, serverTime: Date.now(), version: GYN_VERSION, teacher: true, me: { username: 'teacher', name: 'Teacher preview' },
    assessments: gynAssessments_(module).filter(function (a) { return a.status === 'published' || a.status === 'closed'; }).map(function (a) { var o = gynPublicA_(a); o.attempts = 0; o.canStart = false; o.last = null; o.best = null; o.active = null; return o; }),
    progress: { studied: {}, facts: {}, checks: {}, last: null, practice: {} }, srs: {}, due: [], priorities: [], topics: [], practiceIndex: gynPracticeIndex_(module) };
  if (p.action === 'gynPracticeItems') return gynPracticeItems_(module, null, p);
  if (p.action === 'gynPracticeCheck') { var e = gynBank_(module)[String(p.id || '')]; if (!e || e.latest.kind !== 'practice') return gynErr_('Teachers preview practice questions only.', 'forbidden'); return gynPracticeCheck_(module, null, p, Date.now()); }
  return gynErr_('Not available.', 'forbidden');
}

/* ---------------------------------------------------------------------- *
 * Faculty / administrator actions (valid TEACHER session of this module)
 * ---------------------------------------------------------------------- */
function gynTeacher_(module, p) {
  var a = p.action, now = Date.now();
  switch (a) {
    case 'gynAdminOverview': {
      var bank = gynBank_(module), qs = Object.keys(bank).map(function (k) { return bank[k].latest; });
      var atts = gynAllAttempts_(module);
      return { ok: true, serverTime: now, version: GYN_VERSION, assessments: gynAssessments_(module).map(function (x) { var o = gynPublicA_(x); o.pool = x.pool; o.randomizeQuestions = x.randomizeQuestions; o.randomizeOptions = x.randomizeOptions;
          var mine = atts.filter(function (t) { return t.assessmentId === x.id; }); o.started = mine.length; o.finished = mine.filter(gynIsFinal_).length; o.updatedAt = x.updatedAt; o.publishedAt = x.publishedAt; o.closedAt = x.closedAt; return o; }),
        bank: { assess: qs.filter(function (q) { return q.kind === 'assess'; }).length, practice: qs.filter(function (q) { return q.kind === 'practice'; }).length,
          inactive: qs.filter(function (q) { return !q.active; }).length, versions: gynReadAll_(GYN_SHEETS.Q, module).length } };
    }
    case 'gynAdminBank': {
      var bk = gynBank_(module), used = {};
      gynAllAttempts_(module).forEach(function (t) { t.items.forEach(function (it) { used[it.q + '@' + it.v] = (used[it.q + '@' + it.v] || 0) + 1; }); });
      return { ok: true, questions: Object.keys(bk).sort().map(function (k) { var q = bk[k].latest; var o = {}; for (var f in q) if (f !== '_row') o[f] = q[f];
        o.versions = Object.keys(bk[k].versions).length; o.usedInAttempts = Object.keys(bk[k].versions).reduce(function (s, v) { return s + (used[k + '@' + v] || 0); }, 0); return o; }) };
    }
    case 'gynAdminQuestionHistory': {
      var e = gynBank_(module)[String(p.qid)]; if (!e) return gynErr_('Question not found.', 'notfound');
      return { ok: true, versions: Object.keys(e.versions).map(Number).sort(function (x, y) { return y - x; }).map(function (v) { var q = e.versions[v]; var o = {}; for (var f in q) if (f !== '_row') o[f] = q[f]; return o; }) };
    }
    case 'gynAdminSaveQuestion': return gynLock_(function () { return gynSaveQuestion_(module, p, now); });
    case 'gynAdminSetActive': return gynLock_(function () {
      var e = gynBank_(module)[String(p.qid)]; if (!e) return gynErr_('Question not found.', 'notfound');
      var r = e.latest; var row = gynQRowFromQ_(module, r); row.active = !!p.active; gynUpdate_(GYN_SHEETS.Q, row);
      gynAudit_(module, 'teacher', 'faculty', p.active ? 'question activated' : 'question deactivated', r.qid, '');
      return { ok: true };
    });
    case 'gynAdminSaveAssessment': return gynLock_(function () { return gynSaveAssessment_(module, p, now); });
    case 'gynAdminAnalytics': return gynAnalytics_(module, p, now);
    case 'gynAdminAttempt': {
      var list = gynFind_(GYN_SHEETS.T, 'id', String(p.attemptId || ''), module); if (!list.length) return gynErr_('Attempt not found.', 'notfound');
      var t = gynRowToT_(list[0]); var v = gynResultView_(module, t, false);
      var bank2 = gynBank_(module);
      v.review = t.items.map(function (it, i) { var q = bank2[it.q].versions[it.v]; return { n: i + 1, qid: it.q, version: it.v, code: q.code, topic: q.topic, stem: gynStemParts_(q.stem), image: q.image,
        options: it.o.map(function (k) { return q.options[k]; }), optionMap: it.o, response: it.r, correctOption: it.o.indexOf(q.answer), correct: it.k, explanation: q.explanation }; });
      v.username = t.username; v.name = t.name; v.reviewAvailable = true;
      return { ok: true, result: v };
    }
    case 'gynAdminAbandon': return gynLock_(function () {
      var l = gynFind_(GYN_SHEETS.T, 'id', String(p.attemptId || ''), module); if (!l.length) return gynErr_('Attempt not found.', 'notfound');
      var t = gynRowToT_(l[0]); if (t.status !== 'started') return gynErr_('Only an attempt in progress can be cancelled.');
      t.status = 'abandoned'; t.submittedAt = now; gynUpdate_(GYN_SHEETS.T, gynTRow_(t)); gynAudit_(module, 'teacher', 'faculty', 'attempt abandoned', t.id, t.username);
      return { ok: true };
    });
    case 'gynAdminImport': return gynLock_(function () { return gynImport_(module, p, now); });
    case 'gynAdminAudit': {
      var rows = gynReadAll_(GYN_SHEETS.L, module).sort(function (x, y) { return y.at - x.at; }).slice(0, Math.min(1000, Number(p.limit) || 300));
      return { ok: true, events: rows.map(function (r) { return { at: r.at, actor: r.actor, role: r.role, event: r.event, ref: r.ref, detail: r.detail }; }) };
    }
    default:
      // 1.0.1: Learn-content drafts and publishing live in GynContent.gs (same project). Same teacher check (authed_) already passed.
      if (typeof gynContentAdmin_ === 'function') { var cr = gynContentAdmin_(module, p, now); if (cr) return cr; }
      return gynErr_('Unknown action: ' + a, 'badaction');
  }
}
function gynQRowFromQ_(module, q) {
  var row = { module: module, qid: q.qid, version: q.version, kind: q.kind, active: q.active, legacyId: q.legacyId, code: q.code, lecture: q.lecture, section: q.section, sub: q.sub,
    topic: q.topic, concept: q.concept, objective: q.objective, difficulty: q.difficulty, priority: q.priority, label: q.label, previousExam: q.previousExam, imageBased: q.imageBased,
    integrated: q.integrated, image: q.image, stem: q.stem, optionsJson: JSON.stringify(q.options), answer: q.answer, explanation: q.explanation, trap: q.trap, ref: q.ref,
    createdAt: q.createdAt, createdBy: q.createdBy, contentHash: q.contentHash, _row: q._row };
  return row;
}
/** Edits never overwrite a version: every content change becomes version n+1 (historic attempts keep theirs). */
function gynSaveQuestion_(module, p, now) {
  var bank = gynBank_(module), q = p.question || {}, mode = p.mode || 'edit';
  if (mode === 'new' || mode === 'duplicate') {
    var modPre = gynIsModule_(module) && String(module).split('-')[0] === 'vagina' ? 'VAGINA' : 'VULVA';
    var pre = modPre + '-' + (q.kind === 'practice' ? 'PR-' : 'MAIN-Q');
    var nmax = 0; Object.keys(bank).forEach(function (k) { if (k.indexOf(pre) === 0) nmax = Math.max(nmax, Number(k.slice(pre.length)) || 0); });
    q = JSON.parse(JSON.stringify(q)); q.qid = pre + ('00' + (nmax + 1)).slice(-3);
    if (q.kind === 'assess') q.code = q.qid;
  }
  var v = gynValidateQ_(q, null); if (!v.ok) return gynErr_(v.error, 'invalid');
  var nq = gynNormQ_(q, v.stem), e = bank[nq.qid];
  if (mode === 'edit' && !e) return gynErr_('Question not found.', 'notfound');
  if (mode !== 'edit' && e) return gynErr_('That question ID already exists.', 'exists');
  if (e && gynHashQ_(nq) === e.latest.contentHash) return { ok: true, unchanged: true, qid: nq.qid, version: e.latest.version };
  var ver = e ? e.latest.version + 1 : 1;
  gynAppend_(GYN_SHEETS.Q, gynQRow_(module, nq, ver, e ? e.latest.active : true, 'teacher'));
  gynAudit_(module, 'teacher', 'faculty', e ? 'question modified (new version)' : 'question created', nq.qid, { version: ver, mode: mode });
  return { ok: true, qid: nq.qid, version: ver };
}
function gynSaveAssessment_(module, p, now) {
  var x = p.assessment || {}, prev = x.id ? gynAssessment_(module, x.id) : null;
  var id = prev ? prev.id : (/^[A-Z0-9_-]{2,20}$/.test(String(x.id || '')) ? String(x.id) : gynId_('asm'));
  if (!prev && gynAssessment_(module, id)) return gynErr_('An assessment with this ID already exists.', 'exists');
  var bank = gynBank_(module);
  var a = { id: id, title: String(x.title || '').trim().slice(0, 120), subtitle: String(x.subtitle || '').slice(0, 200), lecture: String(x.lecture || '').slice(0, 20),
    durationMin: Math.max(1, Math.min(300, Number(x.durationMin) || 30)), pool: (x.pool || []).map(String).filter(function (q, i, arr) { return bank[q] && bank[q].latest.kind === 'assess' && arr.indexOf(q) === i; }).slice(0, 300),
    questionCount: Math.max(1, Number(x.questionCount) || 0), randomizeQuestions: !!x.randomizeQuestions, randomizeOptions: x.randomizeOptions !== false,
    status: ['draft', 'published', 'closed', 'archived'].indexOf(x.status) >= 0 ? x.status : 'draft', passPct: Math.max(0, Math.min(100, Number(x.passPct) || 50)),
    attemptsAllowed: Math.max(0, Math.min(20, Number(x.attemptsAllowed) || 0)), review: ['after_submit', 'after_close', 'never'].indexOf(x.review) >= 0 ? x.review : 'after_submit',
    createdAt: prev ? prev.createdAt : now, publishedAt: prev ? prev.publishedAt : '', closedAt: prev ? prev.closedAt : '', _row: prev ? prev._row : null };
  if (!a.title) return gynErr_('Give the assessment a title.');
  if (a.questionCount > a.pool.length) a.questionCount = a.pool.length;
  if (a.status === 'published') {
    var active = a.pool.filter(function (q) { return bank[q].latest.active; });
    if (!active.length) return gynErr_('Add questions before publishing.');
    if (active.length < a.questionCount) return gynErr_('Only ' + active.length + ' active question(s) in the pool — lower the question count or activate questions.');
    if (!prev || prev.status !== 'published') a.publishedAt = now;
  }
  if (a.status === 'closed' && (!prev || prev.status !== 'closed')) a.closedAt = now;
  var row = gynARow_(module, a);
  if (prev) { row._row = prev._row; gynUpdate_(GYN_SHEETS.A, row); } else gynAppend_(GYN_SHEETS.A, row);
  var ev = !prev ? 'assessment created' : prev.status !== a.status ? 'assessment ' + a.status : 'assessment settings changed';
  gynAudit_(module, 'teacher', 'faculty', ev, a.id, { status: a.status, questionCount: a.questionCount, durationMin: a.durationMin });
  GYN_MEMO = {};
  return { ok: true, assessment: gynPublicA_(gynAssessment_(module, a.id)) };
}
/** Assessment-, topic- and question-level analytics + item analysis. scope: 'first' (each student's first
 *  finished attempt — recommended for item analysis), 'best', 'latest' or 'all'. */
function gynAnalytics_(module, p, now) {
  var a = gynAssessment_(module, p.assessmentId); if (!a) return gynErr_('Assessment not found.', 'notfound');
  var all = gynAllAttempts_(module).filter(function (t) { return t.assessmentId === a.id; });
  gynLock_(function () { all.forEach(function (t) { gynMaybeExpire_(module, t, now); }); });
  var fin = all.filter(gynIsFinal_), scope = ['first', 'best', 'latest', 'all'].indexOf(p.scope) >= 0 ? p.scope : 'first';
  var by = {};
  fin.forEach(function (t) {
    var cur = by[t.username];
    if (scope === 'all') return;
    if (!cur || (scope === 'first' && t.startedAt < cur.startedAt) || (scope === 'latest' && t.submittedAt > cur.submittedAt) || (scope === 'best' && t.percent > cur.percent)) by[t.username] = t;
  });
  var set = scope === 'all' ? fin : Object.keys(by).map(function (k) { return by[k]; });
  var ps = set.map(function (t) { return t.percent; }).sort(function (x, y) { return x - y; });
  var mean = ps.length ? Math.round(10 * ps.reduce(function (s, x) { return s + x; }, 0) / ps.length) / 10 : null;
  var med = ps.length ? (ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2) : null;
  var students = {}; all.forEach(function (t) { students[t.username] = 1; });
  var stats = { attempts: set.length, allFinished: fin.length, started: all.length, students: Object.keys(students).length, mean: mean, median: med,
    highest: ps.length ? ps[ps.length - 1] : null, lowest: ps.length ? ps[0] : null, passPct: a.passPct,
    passRate: ps.length ? Math.round(1000 * ps.filter(function (x) { return x >= a.passPct; }).length / ps.length) / 10 : null,
    completionRate: all.length ? Math.round(1000 * fin.length / all.length) / 10 : null,
    inProgress: all.filter(function (t) { return t.status === 'started'; }).length, expired: fin.filter(function (t) { return t.status === 'expired'; }).length };
  var bank = gynBank_(module), ana = gynTopicAnalysis_(module, set, 100);
  // item analysis in ORIGINAL option space (so shuffled papers are comparable)
  var sorted = set.slice().sort(function (x, y) { return y.score - x.score; }), n = set.length, k = Math.max(1, Math.round(n * 0.27));
  var upper = {}, lower = {}; sorted.slice(0, k).forEach(function (t) { upper[t.id] = 1; }); sorted.slice(n - k).forEach(function (t) { lower[t.id] = 1; });
  var items = {};
  set.forEach(function (t) {
    t.items.forEach(function (it) {
      var key = it.q + '@' + it.v, q = bank[it.q].versions[it.v];
      var s = items[key] || (items[key] = { qid: it.q, version: it.v, code: q.code, topic: q.topic, concept: q.concept, stem: gynStemParts_(q.stem).join(' ').slice(0, 220), options: q.options,
        answer: q.answer, n: 0, correct: 0, unanswered: 0, dist: q.options.map(function () { return 0; }), up: 0, upN: 0, lo: 0, loN: 0 });
      s.n++; if (it.k) s.correct++; if (it.a === null || it.a === undefined) s.unanswered++; else s.dist[it.a]++;
      if (upper[t.id]) { s.upN++; if (it.k) s.up++; } if (lower[t.id]) { s.loN++; if (it.k) s.lo++; }
    });
  });
  var itemList = Object.keys(items).map(function (key) {
    var s = items[key];
    s.pctCorrect = Math.round(1000 * s.correct / s.n) / 10; s.pctUnanswered = Math.round(1000 * s.unanswered / s.n) / 10; s.pctIncorrect = Math.round(10 * (100 - s.pctCorrect - s.pctUnanswered)) / 10;
    s.distPct = s.dist.map(function (x) { return Math.round(1000 * x / s.n) / 10; }); s.difficultyIndex = Math.round(100 * s.correct / s.n) / 100;
    s.discrimination = n >= 10 && s.upN && s.loN ? Math.round(100 * (s.up / s.upN - s.lo / s.loN)) / 100 : null;
    s.nonFunctioning = s.dist.map(function (x, j) { return j !== s.answer && x === 0; }).reduce(function (c, b) { return c + (b ? 1 : 0); }, 0);
    delete s.up; delete s.upN; delete s.lo; delete s.loN; return s;
  }).sort(function (x, y) { return x.pctCorrect - y.pctCorrect; });
  return { ok: true, serverTime: now, assessment: gynPublicA_(a), scope: scope, stats: stats, topics: ana.topics, items: itemList,
    attempts: all.map(function (t) { var o = gynAttemptSummary_(t); o.username = t.username; o.name = t.name; return o; }).sort(function (x, y) { return (y.submittedAt || y.startedAt) - (x.submittedAt || x.startedAt); }),
    answers: p.withAnswers ? set.map(function (t) { return { id: t.id, username: t.username, name: t.name, items: t.items.map(function (it) { var q = bank[it.q].versions[it.v]; return [q.code || it.q, it.v, it.a, q.answer, it.k ? 1 : 0]; }) }; }) : undefined };
}
/** Migration: validates EVERY record first, then imports. dryRun returns the report only. */
function gynImport_(module, p, now) {
  var qs = p.questions || [], asms = p.assessments || [], topics = p.topics || null;
  var bank = gynBank_(module), seen = {}, rep = { questionsFound: qs.length, imported: 0, newVersions: 0, unchanged: 0, rejected: 0, duplicates: 0, missingMetadata: 0, problems: [], assessments: [] };
  var toAdd = [];
  qs.forEach(function (q, i) {
    var id = q && q.qid;
    if (id && seen[id]) { rep.duplicates++; rep.rejected++; rep.problems.push({ index: i, qid: id, error: 'Duplicate ID in the import file.' }); return; }
    if (id) seen[id] = 1;
    var v = gynValidateQ_(q, topics);
    if (!v.ok) { rep.rejected++; rep.problems.push({ index: i, qid: id || '', error: v.error }); return; }
    if (v.missing.length) { rep.missingMetadata++; rep.problems.push({ index: i, qid: id, warning: 'Missing metadata: ' + v.missing.join(', ') }); }
    var nq = gynNormQ_(q, v.stem), e = bank[nq.qid];
    if (e && gynHashQ_(nq) === e.latest.contentHash) { rep.unchanged++; return; }
    toAdd.push(gynQRow_(module, nq, e ? e.latest.version + 1 : 1, e ? e.latest.active : true, 'import'));
    if (e) rep.newVersions++; else rep.imported++;
  });
  asms.forEach(function (x) {
    var ex = gynAssessment_(module, x.id);
    var poolOk = (x.pool || []).filter(function (id) { return bank[id] || seen[id]; }).length;
    rep.assessments.push({ id: x.id, title: x.title, action: ex ? 'kept (already exists — settings not overwritten)' : 'created as draft', pool: (x.pool || []).length, poolFound: poolOk });
  });
  if (p.dryRun) return { ok: true, dryRun: true, report: rep };
  gynAppendMany_(GYN_SHEETS.Q, toAdd);
  GYN_MEMO = {};
  asms.forEach(function (x) {
    if (gynAssessment_(module, x.id)) return;
    var row = gynARow_(module, { id: String(x.id), title: String(x.title || x.id), subtitle: x.subtitle || '', lecture: x.lecture || '', durationMin: Number(x.durationMin) || 30,
      pool: (x.pool || []).map(String), questionCount: Number(x.questionCount) || (x.pool || []).length, randomizeQuestions: !!x.randomizeQuestions, randomizeOptions: x.randomizeOptions !== false,
      status: 'draft', passPct: Number(x.passPct) || 50, attemptsAllowed: Number(x.attemptsAllowed) || 0, review: x.review || 'after_submit', createdAt: now });
    gynAppend_(GYN_SHEETS.A, row); GYN_MEMO = {};
  });
  gynAudit_(module, 'teacher', 'faculty', 'question bank imported', '', { imported: rep.imported, newVersions: rep.newVersions, unchanged: rep.unchanged, rejected: rep.rejected });
  return { ok: true, dryRun: false, report: rep };
}
