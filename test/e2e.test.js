'use strict';
/* Browser tests (Playwright + Chromium) of the GitHub Pages front-end against the REAL Apps Script backend files
   (run in the harness) and a mock GitHub: first-time setup from a connected-edition page, Learn editing, pictures,
   question bank import, assessments, student accounts, publishing (encrypted), the student experience, and the
   security rules. Run: npm run test:e2e  (PW_CHROMIUM=/path/to/chrome to override the browser). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startSite } = require('./site');
const F = require('./fixtures/course');

let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = null; }
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const SKIP = !chromium || !fs.existsSync(EXE) ? 'Playwright/Chromium not available' : false;
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';   // the TEST content key in test/apps-script/Code.core.gs
const TEACHER_PW = 'teacher-pass-1', NEW_STUDENT_PW = 'my-own-pass-9';

let site, browser, studentTempPw = '';
const errors = [];
test.before(async function () {
  if (SKIP) return;
  site = await startSite();
  browser = await chromium.launch({ executablePath: EXE });
});
test.after(async function () { if (SKIP) return; await browser.close(); await site.close(); });

async function page(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', function (e) { errors.push(e.message); });
  p.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  p.on('dialog', function (d) { d.accept(); });
  return p;
}
async function loginTeacher(p) {
  await p.goto(site.url + '/');
  await p.click('.boot-tabs [data-t=admin]');
  await p.fill('#b-pw', TEACHER_PW); await p.click('button[type=submit]');
  await p.waitForSelector('.edbar', { timeout: 15000 });
}
async function loginStudent(p, pw) {
  await p.goto(site.url + '/');
  await p.fill('#b-u', 'S100'); await p.fill('#b-pw', pw); await p.click('button[type=submit]');
}
async function go(p, hash) { await p.evaluate(function (h) { location.hash = h; }, hash); await p.waitForTimeout(300); }
async function waitSaved(p) { await p.waitForFunction(function () { var s = document.querySelector('.ed-status'); return s && /Draft saved/.test(s.textContent); }, null, { timeout: 10000 }); }
async function editMode(p) { if (!(await p.isChecked('.ed-on'))) { await p.check('.ed-on'); await p.waitForTimeout(250); } }
async function panelSave(p) { await p.click('.ed-panel footer .btn.primary'); await p.waitForTimeout(200); }
function teacher() { const t = site.call({ action: 'login', password: TEACHER_PW }); return function (action, extra) { return site.call(Object.assign({ action: action, token: t.token }, extra || {})); }; }
function siteFile(rel) { const f = path.join(site.siteDir, rel); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
async function blobImages(p, sel) {
  await p.waitForFunction(function (s) { var im = document.querySelectorAll(s); return im.length && [].every.call(im, function (i) { return /^blob:/.test(i.src) && i.naturalWidth > 0; }); }, sel, { timeout: 10000 });
}

test('teacher: first-time setup — create the teacher password, import the course from the connected page', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(site.url + '/');
  // students cannot get in without an account
  await p.fill('#b-u', 'nobody'); await p.fill('#b-pw', 'wrong-password'); await p.click('button[type=submit]');
  await p.waitForFunction(function () { return /Incorrect student ID or password/.test(document.querySelector('.boot-err').textContent); });
  await p.click('.boot-tabs [data-t=admin]');
  await p.click('.b-setup');
  await p.fill('#b-pw', TEACHER_PW); await p.fill('#b-pw2', TEACHER_PW); await p.click('button[type=submit]');
  await p.waitForSelector('.boot-note');
  await p.fill('#b-pw', TEACHER_PW); await p.click('button[type=submit]');
  // nothing published anywhere yet → set-up wizard
  await p.waitForSelector('.modal-bg input[type=file]', { state: 'attached', timeout: 15000 });
  await p.setInputFiles('.modal-bg input[type=file]', { name: 'vulva-connected.html', mimeType: 'text/html', buffer: Buffer.from(F.connectedPage(F.course({ withQuestions: true }), KEY)) });
  await p.waitForSelector('.imp-go', { timeout: 15000 });
  assert.match(await p.textContent('.imp-log'), /2 picture\(s\) uploaded/);
  assert.match(await p.textContent('.imp-log'), /NOT put into the content/);
  await Promise.all([p.waitForEvent('load'), p.click('.imp-go')]);
  await p.waitForSelector('.edbar', { timeout: 15000 });
  // the draft is in the spreadsheet: no questions, pictures point to encrypted library files
  const d = teacher()('vulvaAdminContentGet').draft.content;
  assert.ok(!d.questions && !d.practice, 'questions are never put into the content');
  const pics = Object.keys(d.pics).map(function (k) { return d.pics[k].src; });
  assert.strictEqual(pics.length, 2);
  pics.forEach(function (src) {
    assert.match(src, /^media\/[a-f0-9]{32}\.png$/);
    const enc = siteFile('content/' + src + '.enc');
    assert.ok(enc, 'encrypted picture committed: ' + src);
    assert.ok(!enc.includes(Buffer.from('IHDR')), 'the committed picture is encrypted');
  });
  // pictures are decrypted in the browser
  await go(p, '#/lecture/1');
  await blobImages(p, 'details[data-sub="1.1"] figure.pic img');
  await p.context().close();
});

test('teacher portal: import the question bank, publish the assessment, create a student account', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/teacher/import');
  await p.setInputFiles('#app input[type=file]', { name: 'vulva_seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(F.seed())) });
  await p.waitForSelector('.rep .go', { timeout: 10000 });
  assert.match(await p.textContent('.rep'), /Validation report/);
  await p.click('.rep .go');
  await p.waitForFunction(function () { return /Import complete/.test(document.querySelector('.rep').textContent); }, null, { timeout: 10000 });
  await go(p, '#/teacher/assess');
  await p.waitForSelector('#app table.data tbody tr');
  await p.click('#app table.data tbody tr button.primary');   // Publish
  await p.click('.modal-bg .btn.primary');
  await p.waitForFunction(function () { return /published/.test(document.querySelector('#app table.data tbody tr').textContent); }, null, { timeout: 10000 });
  // students
  await go(p, '#/teacher/students');
  await p.waitForSelector('#st-b', { state: 'attached' });
  await p.click('#app details summary');
  await p.fill('#st-b', 'S100, Test Student, s100@example.com');
  await p.click('.st-add');
  await p.waitForSelector('.modal-bg td[style*=monospace]');
  studentTempPw = (await p.textContent('.modal-bg td[style*=monospace]')).trim();
  assert.ok(studentTempPw.length >= 8, 'temporary password shown once');
  // the practice questions now appear in Learn (from the server bank)
  await p.click('.modal-bg .btn.primary');
  await go(p, '#/lecture/1/1/1.1');
  await p.click('details[data-sub="1.1"] details.ty summary');
  await p.waitForSelector('details[data-sub="1.1"] .sba[data-qid="VULVA-PR-001"]');
  await p.context().close();
});

test('teacher: Learn editing, a new picture and a section check are saved to the draft', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/lecture/1');
  await editMode(p);
  await p.click('details[data-sub="1.1"] .md > .ed-blk');
  await p.fill('.ed-panel textarea', '**Definition/overview:** E2E EDITED PARAGRAPH.');
  await panelSave(p);
  assert.ok((await p.textContent('details[data-sub="1.1"]')).includes('E2E EDITED PARAGRAPH'));
  // a new picture in block 1.3 — encrypted and committed by the backend
  const before = site.gh.log.length;
  await p.selectOption('details[data-sub="1.3"] .ed-addrow select', 'img');
  await p.waitForSelector('.picdlg');
  await p.setInputFiles('.pd-file', { name: 'new.png', mimeType: 'image/png', buffer: F.PNG3 });
  await p.waitForSelector('.picprev img[src^="blob:"]', { timeout: 10000 });
  await p.fill('.pd-cap', 'E2E added picture');
  await panelSave(p);
  assert.strictEqual(site.gh.log.length, before + 1, 'one commit for the new picture');
  assert.ok((await p.textContent('details[data-sub="1.3"]')).includes('E2E added picture'));
  // section check: flip a true/false answer
  await go(p, '#/faculty/questions/checks');
  await p.fill('.qb-s', 'TP-CK-002');
  await p.waitForFunction(function () { return document.querySelectorAll('.qrow').length === 1; });
  await p.click('.qrow [data-a=e]');
  await p.click('.qed input[name=tf][value="0"]');
  await p.click('.ed-panel footer .btn.primary');
  await waitSaved(p);
  const d = teacher()('vulvaAdminContentGet').draft.content;
  assert.ok(d.lectures[0].sections[0].subs[0].md.includes('E2E EDITED PARAGRAPH'));
  assert.strictEqual(d.checks.find(function (c) { return c.id === 'TP-CK-002'; }).answer, false);
  assert.ok(Object.keys(d.pics).some(function (k) { return d.pics[k].caption === 'E2E added picture'; }));
  // a practice question from the bank can be edited from Learn Mode (opens the question-bank editor)
  await go(p, '#/lecture/1/1/1.1');
  await p.click('details[data-sub="1.1"] details.ty summary');
  await p.waitForSelector('.sba[data-qid="VULVA-PR-001"] .ed-qbar [data-a=e]');
  await p.click('.sba[data-qid="VULVA-PR-001"] .ed-qbar [data-a=e]');
  await p.waitForSelector('#eq-e');
  await p.fill('#eq-e', 'E2E new explanation.');
  await p.click('.modal-bg .btn.primary');
  await p.waitForFunction(function () { return !document.querySelector('#eq-e'); }, null, { timeout: 10000 });
  const hist = teacher()('vulvaAdminQuestionHistory', { qid: 'VULVA-PR-001' });
  assert.strictEqual(hist.versions[0].version, 2, 'an edit becomes a new version');
  assert.strictEqual(hist.versions[0].explanation, 'E2E new explanation.');
  assert.strictEqual(hist.versions[0].section, '1', 'section stays the section of block 1.1');
  assert.strictEqual(hist.versions[0].sub, '1.1');
  await p.context().close();
});

test('teacher: preview, then publish — the site receives only encrypted content', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/lecture/1');
  await p.click('.ed-prev');
  assert.strictEqual(await p.$('.ed-blk'), null, 'preview shows no edit controls');
  assert.ok((await p.textContent('#app')).includes('E2E EDITED PARAGRAPH'), 'preview shows the draft');
  await p.click('.ed-exitprev');
  await p.click('.ed-pub');
  await p.waitForSelector('.pub-go', { timeout: 10000 });
  assert.match(await p.textContent('.modal-bg'), /first/);
  await p.fill('.pub-msg', 'E2E publish');
  await p.click('.pub-go');
  assert.match(await p.textContent('.pub-err'), /confirm/);
  await p.check('.pub-ok');
  await p.click('.pub-go');
  await p.waitForFunction(function () { return /Published/.test(document.querySelector('.modal-bg .mbody').textContent); }, null, { timeout: 10000 });
  const enc = siteFile('content/content.enc'), ver = JSON.parse(siteFile('content/version.json'));
  assert.ok(enc && enc.length > 100);
  ['E2E EDITED PARAGRAPH', 'BETA-SECRET-PHRASE', 'Alpha definition'].forEach(function (t) { assert.ok(!enc.includes(Buffer.from(t)), 'no readable text on the site: ' + t); });
  assert.strictEqual(ver.module, 'vulva');
  assert.match(site.gh.log[site.gh.log.length - 1].message, /^E2E publish/);
  // history lists the published version
  await go(p, '#/faculty/content');
  await p.waitForFunction(function () { return /E2E publish/.test(document.querySelector('.hist-body').textContent); }, null, { timeout: 10000 });
  await p.context().close();
});

test('student: own account, forced password change, published course, practice, assessment, results', { skip: SKIP }, async function () {
  const p = await page();
  await loginStudent(p, studentTempPw);
  await p.waitForSelector('#b-pw2');                       // must choose an own password first
  await p.fill('#b-pw', NEW_STUDENT_PW); await p.fill('#b-pw2', NEW_STUDENT_PW); await p.click('button[type=submit]');
  await p.waitForSelector('.topbar', { timeout: 15000 });
  assert.strictEqual(await p.$('.edbar'), null, 'no editor bar');
  assert.strictEqual(await p.evaluate(function () { return typeof window.VULVA_EDITOR; }), 'undefined', 'editor code not loaded');
  assert.strictEqual(await p.$('a[href="#/faculty"]'), null, 'no faculty link');
  await go(p, '#/lecture/1');
  assert.ok((await p.textContent('#app')).includes('E2E EDITED PARAGRAPH'), 'students see the published version');
  await blobImages(p, 'details[data-sub="1.1"] figure.pic img');
  assert.strictEqual(await p.$('.ed-blk, .ed-bar2, .pic-tools'), null, 'no edit controls');
  // practice: checked by the server
  await go(p, '#/practice/topic/s1');
  await p.waitForSelector('.sba .opt');
  await (await p.$$('.sba .opt'))[1].click(); await p.click('.sba .chk');
  await p.waitForSelector('.sba .fb.good');
  assert.match(await p.textContent('.sba .fb'), /E2E new explanation/);
  // assessment: answers are graded on the server
  await go(p, '#/tests');
  await p.click('a[href="#/test/MAIN"]');
  await p.click('.go');
  await p.waitForSelector('.exam .opt');
  for (let i = 0; i < 4; i++) {
    await (await p.$$('.exam .opt'))[i === 3 ? 0 : i].click();   // last one wrong on purpose
    if (i < 3) await p.click('.exam .next');
  }
  await p.click('.exam .submit');
  await p.click('.modal-bg .btn.primary');
  await p.waitForFunction(function () { return /Your result: 75%/.test(document.body.textContent); }, null, { timeout: 15000 });
  assert.match(await p.textContent('#app'), /Answer: D\./, 'answers are shown after submission');
  // the student session cannot reach teacher actions, even when calling the backend directly
  const res = await p.evaluate(function () {
    var s = JSON.parse(sessionStorage.getItem('vp_vulva_session') || localStorage.getItem('vp_vulva_session'));
    return Promise.all(['vulvaAdminContentGet', 'vulvaAdminBank', 'vulvaAdminPublish', 'listStudents'].map(function (a) {
      return fetch('/exec', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ module: 'vulva', action: a, stoken: s.stoken, token: s.stoken }) }).then(function (r) { return r.json(); });
    }));
  });
  res.forEach(function (r) { assert.strictEqual(r.ok, false); });
  await go(p, '#/progress');
  await p.waitForFunction(function () { return /Test Exam/.test(document.querySelector('#app').textContent); }, null, { timeout: 10000 });
  await p.context().close();
});

test('teacher portal: the attempt appears in analytics', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/teacher/analytics');
  await p.waitForFunction(function () { return /Test Student/.test(document.querySelector('#app').textContent); }, null, { timeout: 10000 });
  assert.match(await p.textContent('#app'), /75%/);
  await p.context().close();
});

test('teacher: live view, history restore and discard', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/lecture/1');
  await editMode(p);
  await p.click('details[data-sub="1.3"] .md > .ed-blk');
  await p.fill('.ed-panel textarea', 'E2E UNPUBLISHED CHANGE');
  await panelSave(p);
  await waitSaved(p);
  // live view = what students see (decrypted from the site), read-only
  await p.click('.ed-view');
  await p.waitForSelector('.ed-ver.live');
  await go(p, '#/lecture/1');
  assert.ok(!(await p.textContent('#app')).includes('E2E UNPUBLISHED CHANGE'));
  await p.click('.ed-view');
  await p.waitForSelector('.ed-ver.draft');
  // restore the published GitHub-side copy from the spreadsheet history
  await go(p, '#/faculty/content');
  await p.waitForSelector('.hist-body button');
  const rows = await p.$$('.hist-body tr');
  let done = false;
  for (const r of rows) { if (/Published/.test(await r.textContent())) { await (await r.$('button')).click(); done = true; break; } }
  assert.ok(done);
  await Promise.all([p.waitForEvent('load'), p.click('.modal-bg .btn.primary')]);
  await p.waitForSelector('.edbar');
  assert.ok(!teacher()('vulvaAdminContentGet').draft.content.lectures[0].sections[0].subs[2].md.includes('E2E UNPUBLISHED CHANGE'));
  await go(p, '#/faculty/content');
  await p.click('[data-a=discard]');
  await Promise.all([p.waitForEvent('load'), p.click('.modal-bg .btn.danger')]);
  await p.waitForSelector('.edbar');
  assert.strictEqual(teacher()('vulvaAdminContentGet').draft, null);
  await p.context().close();
});

test('responsive: learner pages and the editor fit a phone screen', { skip: SKIP }, async function () {
  const s = await page({ width: 390, height: 844 });
  await loginStudent(s, NEW_STUDENT_PW);
  await s.waitForSelector('.topbar', { timeout: 15000 });
  for (const hsh of ['#/', '#/learn', '#/lecture/1', '#/practice', '#/review/facts', '#/tests']) {
    await go(s, hsh);
    const over = await s.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
    assert.ok(over <= 1, hsh + ' scrolls sideways by ' + over + 'px');
  }
  await s.context().close();
  const t = await page({ width: 390, height: 844 });
  await loginTeacher(t);
  await go(t, '#/lecture/1');
  await editMode(t);
  assert.ok(await t.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'edit mode does not break the layout');
  await t.click('details[data-sub="1.1"] .md > .ed-blk');
  const w = await t.$eval('.ed-panel', function (e) { return e.getBoundingClientRect().width; });
  assert.ok(w >= 380 && w <= 391, 'editor panel is full width on a phone (' + w + ')');
  await t.context().close();
});

test('secrets: the GitHub token never reaches a browser; site files hold no secrets', { skip: SKIP }, function () {
  site.replies.forEach(function (r) { assert.ok(r.indexOf(site.GH_TOKEN) < 0 && !/ghp_/.test(r), 'a backend reply contained the token'); });
  ['index.html', 'assets/boot.js', 'assets/app.js', 'assets/editor.js', 'config.js'].forEach(function (f) {
    const t = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/ghp_|github_pat_|GITHUB_TOKEN\s*[:=]\s*['"][^'"]+/.test(t), f + ' must not contain a token');
    assert.ok(!/(^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{43}=/.test(t), f + ' must not contain a content key');
  });
});

test('no JavaScript errors in any browser test', { skip: SKIP }, function () {
  assert.deepStrictEqual(errors, []);
});
