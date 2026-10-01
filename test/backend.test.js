'use strict';
/* Backend tests: the real Apps Script files (Code.gs core excerpt, Gyn.gs, GynContent.gs) running in the harness,
   with a simulated GitHub. Run: npm test */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createBackend, githubMock } = require('./apps-script/harness');

const ROOT = path.join(__dirname, '..');
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(ROOT, 'backend', 'Gyn.gs'), path.join(ROOT, 'backend', 'GynContent.gs')];
const TOKEN = 'ghp_CANARY_never_in_a_response_42';
const TEACHER_PW = 'teacher-secret-1', STUDENT_PW = 'student-secret-1';

function sample() {
  return {
    meta: { title: 'Vulvar Pathology', short: 'Vulva' }, topics: { s1: { name: 'Normal', sections: ['1'] } }, concepts: {}, tests: {},
    review: { facts: [], traps: [], comparisons: [], morphology: [], review15: [] }, pics: {}, decks: {}, media: {},
    lectures: [{ num: 1, title: 'Lecture one', sections: [{ id: '1', title: 'Section one', subs: [{ id: '1.1', title: 'Block', md: 'Hello' }] }] }],
    checks: [{ id: 'CK-1', sec: '1.1', type: 'tf', q: 'True?', answer: true, expl: '', ref: '' }]
  };
}
function setup(withGithub) {
  const gh = githubMock();
  const b = createBackend({ files: FILES, fetch: gh.handle, properties: withGithub ? { GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'owner/repo', GITHUB_BRANCH: 'main' } : {} });
  assert.ok(b.doPost({ module: 'vulva', action: 'setup', password: TEACHER_PW }).ok);
  const t = b.doPost({ module: 'vulva', action: 'login', password: TEACHER_PW });
  b.doPost({ module: 'vulva', action: 'bulkAddStudents', token: t.token, students: [{ username: 'S1', name: 'Student One', password: STUDENT_PW, mustChange: false }] });
  const s = b.doPost({ module: 'vulva', action: 'studentLogin', username: 's1', password: STUDENT_PW });
  return { b: b, gh: gh, tok: t.token, stok: s.token, call: function (action, extra) { return b.doPost(Object.assign({ module: 'vulva', action: action, token: t.token }, extra || {})); } };
}

test('students cannot reach any content-admin action, with or without a teacher token', function () {
  const S = setup(true);
  ['vulvaAdminContentGet', 'vulvaAdminContentSave', 'vulvaAdminContentDiscard', 'vulvaAdminPublish', 'vulvaAdminMediaPut', 'vulvaAdminHistory', 'vulvaAdminSnapshot'].forEach(function (a) {
    const r = S.b.doPost({ module: 'vulva', action: a, stoken: S.stok, content: sample(), baseRev: 0 });
    assert.strictEqual(r.ok, false, a); assert.strictEqual(r.code, 'auth', a);
    const r2 = S.b.doPost({ module: 'vulva', action: a, token: 'forged-token-forged-token-forged' });
    assert.strictEqual(r2.ok, false, a);
    const r3 = S.b.doPost({ module: 'vulva', action: a });
    assert.strictEqual(r3.ok, false, a);
  });
  assert.strictEqual(S.gh.log.length, 0);
});

test('a teacher session of another module cannot edit this one', function () {
  const S = setup(true);
  assert.ok(S.b.doPost({ module: 'vagina', action: 'setup', password: 'other-module-pw' }).ok);
  const other = S.b.doPost({ module: 'vagina', action: 'login', password: 'other-module-pw' });
  const r = S.b.doPost({ module: 'vulva', action: 'vulvaAdminContentGet', token: other.token });
  assert.strictEqual(r.ok, false);
});

test('draft: save with revision check, structural validation, discard keeps a copy', function () {
  const S = setup(false);
  let g = S.call('vulvaAdminContentGet');
  assert.ok(g.ok); assert.strictEqual(g.draft, null); assert.strictEqual(g.live, null);
  assert.strictEqual(g.github.configured, false); assert.strictEqual(g.keyOk, true);
  const c = sample();
  let r = S.call('vulvaAdminContentSave', { content: c, baseRev: 0 });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.rev, 1);
  assert.strictEqual(S.call('vulvaAdminContentSave', { content: c, baseRev: 0 }).code, 'conflict');
  const withAnswers = Object.assign(sample(), { practice: [{ id: 'x', options: ['a', 'b'], answer: 0 }] });
  r = S.call('vulvaAdminContentSave', { content: withAnswers, baseRev: 1 });
  assert.strictEqual(r.code, 'invalid'); assert.ok(r.issues.some(function (e) { return /question bank/.test(e); }));
  const badPic = sample(); badPic.pics.p1 = { src: 'javascript:alert(1)' };
  assert.strictEqual(S.call('vulvaAdminContentSave', { content: badPic, baseRev: 1 }).code, 'invalid');
  const badCheck = sample(); badCheck.checks[0].sec = '9.9';
  assert.strictEqual(S.call('vulvaAdminContentSave', { content: badCheck, baseRev: 1 }).code, 'invalid');
  c.lectures[0].title = 'Edited';
  r = S.call('vulvaAdminContentSave', { content: c, baseRev: 1, checkpoint: true });
  assert.strictEqual(r.rev, 2);
  g = S.call('vulvaAdminContentGet');
  assert.strictEqual(g.draft.rev, 2); assert.strictEqual(g.draft.content.lectures[0].title, 'Edited');
  assert.ok(S.call('vulvaAdminContentDiscard').ok);
  g = S.call('vulvaAdminContentGet');
  assert.strictEqual(g.draft, null);
  const h = S.call('vulvaAdminHistory');
  assert.ok(h.local.some(function (x) { return x.note === 'before discarding the draft'; }));
  const snap = S.call('vulvaAdminSnapshot', { id: h.local[0].id });
  assert.ok(snap.ok); assert.strictEqual(snap.content.lectures[0].title, 'Edited');
});

test('publishing needs GitHub settings; with them it commits only encrypted files and the draft becomes live', function () {
  const S0 = setup(false);
  S0.call('vulvaAdminContentSave', { content: sample(), baseRev: 0 });
  assert.strictEqual(S0.call('vulvaAdminPublish', { rev: 1, encrypted: 'QUJD'.repeat(20) }).code, 'nogithub');

  const S = setup(true);
  S.call('vulvaAdminContentSave', { content: sample(), baseRev: 0 });
  assert.strictEqual(S.call('vulvaAdminPublish', { rev: 1 }).code, 'badfile');
  assert.strictEqual(S.call('vulvaAdminPublish', { rev: 7, encrypted: 'QUJD'.repeat(20) }).code, 'conflict');
  const enc = Buffer.from('pretend-this-is-AES-GCM-ciphertext-'.repeat(4)).toString('base64');
  const r = S.call('vulvaAdminPublish', { rev: 1, encrypted: enc, message: 'First publish' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(S.gh.log.length, 1);
  const files = S.gh.commits[r.commit].files;
  assert.strictEqual(files['content/content.enc'].toString('base64'), enc);
  assert.strictEqual(JSON.parse(files['content/version.json']).rev, 1);
  assert.match(S.gh.commits[r.commit].message, /^First publish/);
  assert.ok(S.gh.auth.every(function (a) { return a === 'Bearer ' + TOKEN; }));
  const g = S.call('vulvaAdminContentGet');
  assert.strictEqual(g.draft, null);
  assert.strictEqual(g.live.content.lectures[0].title, 'Lecture one');
  assert.strictEqual(g.lastPublished.note.commit, r.commit);
  const h = S.call('vulvaAdminHistory');
  assert.ok(h.local.some(function (x) { return x.kind === 'published' && x.commit === r.commit; }));
  assert.ok(Array.isArray(h.github) && h.github[0].sha === r.commit);
  // GitHub failure → nothing changes, draft kept
  S.call('vulvaAdminContentSave', { content: sample(), baseRev: 0 });
  S.gh.fail = { code: 500, message: 'boom' };
  const f = S.call('vulvaAdminPublish', { rev: 1, encrypted: enc });
  assert.strictEqual(f.code, 'github');
  S.gh.fail = null;
  assert.ok(S.call('vulvaAdminContentGet').draft, 'draft kept after a failed publish');
});

test('pictures: only encrypted, content-addressed files under content/media; existing files are not re-committed', function () {
  const S = setup(true);
  const b64 = Buffer.from('encrypted-picture-bytes-'.repeat(5)).toString('base64');
  assert.strictEqual(S.call('vulvaAdminMediaPut', { path: 'index.html', base64: b64 }).code, 'badpath');
  assert.strictEqual(S.call('vulvaAdminMediaPut', { path: 'content/media/../../x.jpg.enc', base64: b64 }).code, 'badpath');
  const p = 'content/media/' + 'a'.repeat(32) + '.jpg.enc';
  // the mock serves no /contents endpoint → 404 → commit
  const r = S.call('vulvaAdminMediaPut', { path: p, base64: b64 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(S.gh.commits[S.gh.head].files[p].toString('base64'), b64);
  const commits = S.gh.log.length;
  const again = S.call('vulvaAdminMediaPut', { path: p, base64: b64 });
  assert.ok(again.ok && again.existing);
  assert.strictEqual(S.gh.log.length, commits, 'no second commit for the same picture');
});

test('no response ever contains the GitHub token', function () {
  const S = setup(true);
  S.call('vulvaAdminContentSave', { content: sample(), baseRev: 0 });
  [S.call('vulvaAdminContentGet'), S.call('vulvaAdminHistory'), S.call('vulvaAdminPublish', { rev: 1, encrypted: 'QUJD'.repeat(20) }),
    S.b.doPost({ module: 'vulva', action: 'vulvaBootstrap', stoken: S.stok })].forEach(function (r) { assert.ok(!JSON.stringify(r).includes(TOKEN)); });
});

test('question bank (Gyn.gs) still works unchanged: import, versioned edit, server grading', function () {
  const S = setup(true);
  const q = function (i, kind) { return { qid: kind === 'assess' ? 'VULVA-MAIN-Q00' + i : 'VULVA-PR-00' + i, kind: kind, code: 'Q' + i, lecture: 'L1', section: '1', sub: '1.1', topic: 's1', concept: 'c', objective: 'o', difficulty: 'Basic', stem: 'Stem ' + i, options: ['A' + i, 'B' + i, 'C' + i, 'D' + i], answer: 1, explanation: 'Because' }; };
  const imp = S.call('vulvaAdminImport', { questions: [q(1, 'assess'), q(2, 'assess'), q(1, 'practice')], assessments: [{ id: 'MAIN', title: 'Exam', pool: ['VULVA-MAIN-Q001', 'VULVA-MAIN-Q002'], durationMin: 10 }], topics: { s1: {} } });
  assert.ok(imp.ok); assert.strictEqual(imp.report.imported, 3);
  const a = S.call('vulvaAdminSaveAssessment', { assessment: { id: 'MAIN', title: 'Exam', pool: ['VULVA-MAIN-Q001', 'VULVA-MAIN-Q002'], questionCount: 2, durationMin: 10, status: 'published', randomizeOptions: false } });
  assert.ok(a.ok, JSON.stringify(a));
  const st = S.b.doPost({ module: 'vulva', action: 'vulvaStart', stoken: S.stok, assessmentId: 'MAIN' });
  assert.ok(st.ok); assert.ok(!JSON.stringify(st).includes('Because'), 'no explanations in the paper');
  const sub = S.b.doPost({ module: 'vulva', action: 'vulvaSubmit', stoken: S.stok, attemptId: st.attempt.id, responses: { 0: 1, 1: 0 } });
  assert.ok(sub.ok); assert.strictEqual(sub.result.score, 1);
  const ed = S.call('vulvaAdminSaveQuestion', { mode: 'edit', question: Object.assign(q(1, 'assess'), { answer: 2 }) });
  assert.strictEqual(ed.version, 2);
  const res = S.b.doPost({ module: 'vulva', action: 'vulvaResult', stoken: S.stok, attemptId: st.attempt.id });
  assert.strictEqual(res.result.score, 1, 'an edited key does not change a submitted result');
});
