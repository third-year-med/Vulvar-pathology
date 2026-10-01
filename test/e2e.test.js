'use strict';
/* Browser tests (Playwright + Chromium): student and teacher workflows end to end, including
   draft → preview → publish to a mock GitHub, and regression checks of Learn, Practice, Assessments
   and Presentation Mode. Run: npm run test:e2e
   Uses playwright-core with an installed Chromium (PW_CHROMIUM=/path/to/chrome to override). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { startServer, mockGitHub, STUDENT_PW, ADMIN_PW } = require('./helpers');

let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = null; }
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const SKIP = !chromium || !fs.existsSync(EXE) ? 'Playwright/Chromium not available' : false;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201e2b1b1cf0000000049454e44ae426082', 'hex');

let app, gh, browser;
const errors = [];
test.before(async function () {
  if (SKIP) return;
  gh = await mockGitHub();
  app = await startServer({ GITHUB_TOKEN: 'ghp_test_token', GITHUB_REPO: 'owner/repo', GITHUB_API_URL: gh.url });
  browser = await chromium.launch({ executablePath: EXE });
});
test.after(async function () { if (SKIP) return; await browser.close(); await app.close(); await gh.close(); });

async function page(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', function (e) { errors.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  return p;
}
async function loginStudent(p) {
  await p.goto(app.url + '/');
  await p.fill('#b-pw', STUDENT_PW); await p.click('button[type=submit]');
  await p.waitForSelector('.topbar');
}
async function loginTeacher(p) {
  await p.goto(app.url + '/');
  await p.click('.boot-tabs [data-t=admin]');
  await p.fill('#b-u', 'teacher'); await p.fill('#b-pw', ADMIN_PW); await p.click('button[type=submit]');
  await p.waitForSelector('.edbar');
}
async function go(p, hash) { await p.evaluate(function (h) { location.hash = h; }, hash); await p.waitForTimeout(250); }
async function draft(p) { return p.evaluate(function () { return fetch('/api/content?version=draft').then(function (r) { return r.json(); }); }); }
async function waitSaved(p) { await p.waitForFunction(function () { var s = document.querySelector('.ed-status'); return s && /Draft saved/.test(s.textContent); }, null, { timeout: 8000 }); }
async function editMode(p) { if (!(await p.isChecked('.ed-on'))) { await p.check('.ed-on'); await p.waitForTimeout(250); } }
async function panelSave(p) { await p.click('.ed-panel footer .btn.primary'); await p.waitForTimeout(150); }

test('student: wrong password rejected, right password opens the learner platform without editing tools', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(app.url + '/');
  await p.fill('#b-pw', 'not-the-password'); await p.click('button[type=submit]');
  await p.waitForFunction(function () { return /Incorrect password/.test(document.querySelector('#b-e').textContent); });
  await p.fill('#b-pw', STUDENT_PW); await p.click('button[type=submit]');
  await p.waitForSelector('.topbar');
  assert.strictEqual(await p.$('.edbar'), null, 'no editor bar');
  assert.strictEqual(await p.evaluate(function () { return typeof window.VULVA_EDITOR; }), 'undefined', 'editor code not loaded');
  assert.strictEqual(await p.$('a[href="#/faculty"]'), null, 'no faculty link');
  await go(p, '#/lecture/1');
  assert.ok((await p.$$('details.sub')).length > 3, 'Learn Mode shows learning blocks');
  assert.strictEqual(await p.$('.ed-blk, .ed-bar2, .pic-tools'), null, 'no edit controls');
  // Practice: answer a question
  await go(p, '#/practice/topic/s1');
  await p.waitForSelector('.sba .opt');
  await p.click('.sba .opt'); await p.click('.sba .chk');
  await p.waitForSelector('.sba .fb');
  // Presentation Mode: open, move to the next slide; no slide editing for students
  await go(p, '#/present');
  assert.strictEqual(await p.$('a[href$="/edit"]'), null);
  await go(p, '#/present/1');
  await p.waitForSelector('.pres .slide h1, .pres .slide h2');
  await p.click('.pres .b-next');
  assert.match(await p.textContent('.pres .cnt'), /^2 \//);
  await p.keyboard.press('e');
  await p.waitForSelector('.modal-bg'); // "Teacher sign-in required"
  assert.match(await p.textContent('.modal-bg'), /Teacher sign-in required/);
  await p.context().close();
});

test('teacher: Learn Mode editing — edit, add, move, delete, headings, lists, tables, undo; saved to draft', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/lecture/1');
  await editMode(p);
  // edit an existing paragraph
  await p.click('details[data-sub="1.1"] .md > .ed-blk');
  await p.fill('.ed-panel textarea', '**Definition/overview:** E2E EDITED PARAGRAPH.');
  await panelSave(p);
  assert.ok((await p.textContent('details[data-sub="1.1"]')).includes('E2E EDITED PARAGRAPH'));
  // add a bulleted list, then edit it
  await p.selectOption('details[data-sub="1.3"] .ed-addrow select', 'ul');
  await panelSave(p);
  const list = await p.$('details[data-sub="1.3"] .md > ul.ed-blk');
  await list.click();
  await p.fill('.ed-panel textarea', '- E2E list item one\n- E2E list item two');
  await panelSave(p);
  assert.ok((await p.textContent('#app')).includes('E2E list item two'));
  // add a table and a heading at the end of block 1.2 via the "Add here" menu
  await p.selectOption('details[data-sub="1.2"] .ed-addrow select', 'table');
  await p.waitForSelector('.ed-panel textarea');
  await panelSave(p);
  assert.ok(await p.$('details[data-sub="1.2"] .tablewrap'));
  await p.selectOption('details[data-sub="1.2"] .ed-addrow select', 'h');
  await p.fill('.ed-panel textarea', '## E2E NEW HEADING');
  await panelSave(p);
  assert.ok((await p.textContent('details[data-sub="1.2"] h3')).includes('E2E NEW HEADING'));
  // move the heading up one place, then undo it
  const lastBefore = await p.$$eval('details[data-sub="1.2"] .md > .ed-blk', function (a) { return a.map(function (b) { return b.tagName; }); });
  await p.click('details[data-sub="1.2"] .md > h3.ed-blk');
  await p.click('.ed-panel .b-up');
  await p.waitForTimeout(200);
  const after = await p.$$eval('details[data-sub="1.2"] .md > .ed-blk', function (a) { return a.map(function (b) { return b.tagName; }); });
  assert.notDeepStrictEqual(after, lastBefore);
  await p.click('.ed-undo'); await p.waitForTimeout(200);
  assert.deepStrictEqual(await p.$$eval('details[data-sub="1.2"] .md > .ed-blk', function (a) { return a.map(function (b) { return b.tagName; }); }), lastBefore);
  // add a new learning block after 1.1
  await p.click('details[data-sub="1.1"] .ed-bar2 [data-a=add]');
  await p.fill('.ed-panel input[data-k=title]', 'E2E New block');
  await p.fill('.ed-panel textarea', 'Text of the E2E block.');
  await panelSave(p);
  assert.ok((await p.textContent('section[data-sec="1"]')).includes('E2E New block'));
  // section heading change
  await p.click('section[data-sec="2"] .ed-bar2 [data-a=edit]');
  await p.fill('.ed-panel input[data-k=title]', 'E2E Section Title');
  await panelSave(p);
  assert.ok((await p.textContent('section[data-sec="2"] h2')).includes('E2E Section Title'));
  // add a section after section 1
  await p.click('section[data-sec="1"] .ed-bar2 [data-a=addsec]');
  await p.fill('.ed-panel input[data-k=title]', 'E2E Added Section');
  await panelSave(p);
  assert.ok((await p.textContent('#app')).includes('E2E Added Section'));
  // reorder: move block 1.2 up one place
  const subOrder = function () { return p.$$eval('section[data-sec="1"] details[data-sub]', function (a) { return a.map(function (d) { return d.dataset.sub; }); }); };
  const o1 = await subOrder();
  await p.click('details[data-sub="1.2"] .ed-bar2 [data-a=up]');
  await p.waitForTimeout(200);
  const o2 = await subOrder();
  assert.strictEqual(o2.indexOf('1.2'), o1.indexOf('1.2') - 1);
  assert.deepStrictEqual(o2.slice().sort(), o1.slice().sort());
  // delete the added block (with confirmation)
  const newId = await p.$$eval('section[data-sec="1"] details[data-sub]', function (a) { return a.filter(function (d) { return /E2E New block/.test(d.textContent); })[0].dataset.sub; });
  await p.click('details[data-sub="' + newId + '"] .ed-bar2 [data-a=del]');
  await p.click('.modal-bg .btn.danger');
  await p.waitForTimeout(200);
  assert.strictEqual(await p.$('details[data-sub="' + newId + '"]'), null);
  await waitSaved(p);
  // persisted in the draft after reload
  await p.reload(); await p.waitForSelector('.edbar');
  await go(p, '#/lecture/1');
  const text = await p.textContent('#app');
  assert.ok(text.includes('E2E EDITED PARAGRAPH') && text.includes('E2E Added Section') && text.includes('E2E NEW HEADING'));
  assert.ok(!text.includes('E2E New block'));
  await p.context().close();
});

test('teacher: questions — edit, change answers and correct answer, add, duplicate, reorder, delete; ids stay stable', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await editMode(p);
  const before = (await draft(p)).content.practice;
  const q0 = before[0];
  await go(p, '#/faculty/questions/practice');
  await p.click('.qrow:first-child .ed-qbar [data-a=e]');
  await p.waitForSelector('.opted-row');
  // reword option B, move option D to the top, make (old) C the correct answer, edit explanation
  const rows = await p.$$('.opted-row .opted-t');
  await rows[1].fill('E2E reworded option B');
  await p.click('.opted-row:nth-child(4) [data-a=up]'); await p.click('.opted-row:nth-child(3) [data-a=up]'); await p.click('.opted-row:nth-child(2) [data-a=up]');
  const cRow = await p.$$('.opted-row');
  await (await cRow[3].$('input[type=radio]')).click(); // old C is now 4th
  await p.fill('.qed .field:nth-of-type(n) .mdf textarea[aria-label="Explanation"]', 'E2E new explanation.');
  await panelSave(p);
  await waitSaved(p);
  let d = (await draft(p)).content.practice;
  const e0 = d.find(function (x) { return x.id === q0.id; });
  assert.ok(e0, 'same question id after editing');
  assert.deepStrictEqual(e0.optionIds.slice().sort(), q0.optionIds.slice().sort(), 'option ids preserved');
  assert.strictEqual(e0.optionIds[0], q0.optionIds[3], 'moved option keeps its id');
  assert.strictEqual(e0.options[e0.optionIds.indexOf(q0.optionIds[1])], 'E2E reworded option B');
  assert.strictEqual(e0.optionIds[e0.answer], q0.optionIds[2], 'correct answer follows the chosen option');
  assert.strictEqual(e0.explanation, 'E2E new explanation.');
  // validation: a question without text cannot be saved
  await p.click('.qb-add');
  await p.click('.ed-panel footer .btn.primary');
  assert.match(await p.textContent('.q-err'), /question text is empty/i);
  // add a new practice question from scratch
  await p.fill('.qed textarea[aria-label="Question text"]', 'E2E brand new question?');
  const opts = await p.$$('.opted-row .opted-t');
  for (let k = 0; k < opts.length; k++) await opts[k].fill('E2E option ' + 'ABCD'[k]);
  await (await (await p.$$('.opted-row'))[1].$('input[type=radio]')).click();
  await p.fill('.qed textarea[aria-label="Explanation"]', 'Because B.');
  await panelSave(p);
  await waitSaved(p);
  d = (await draft(p)).content.practice;
  const added = d.find(function (x) { return x.stem === 'E2E brand new question?'; });
  assert.ok(added && added.answer === 1 && added.optionIds.length === 4);
  // duplicate, reorder, delete
  await p.selectOption('.qb-f', '');
  const n0 = d.length;
  await p.click('.qrow:first-child .ed-qbar [data-a=d]'); await waitSaved(p);
  d = (await draft(p)).content.practice;
  assert.strictEqual(d.length, n0 + 1);
  assert.notStrictEqual(d[1].id, d[0].id, 'duplicate gets its own id');
  const ids = d.map(function (x) { return x.id; });
  await p.click('.qrow:first-child .ed-qbar [data-a=n]'); await waitSaved(p);
  d = (await draft(p)).content.practice;
  assert.strictEqual(d[0].id, ids[1]); assert.strictEqual(d[1].id, ids[0]);
  assert.deepStrictEqual(d.map(function (x) { return x.id; }).sort(), ids.slice().sort(), 'reordering keeps every id');
  const dupId = ids[1];
  await p.click('.qrow:first-child .ed-qbar [data-a=x]');
  await p.click('.modal-bg .btn.danger');
  await waitSaved(p);
  d = (await draft(p)).content.practice;
  assert.ok(!d.some(function (x) { return x.id === dupId; }));
  // graded question: retire instead of delete
  await go(p, '#/faculty/questions/questions');
  const gid = (await draft(p)).content.questions[0].id;
  await p.click('.qrow:first-child .ed-qbar [data-a=x]');
  await p.click('.modal-bg .btn.primary'); // Retire
  await waitSaved(p);
  assert.strictEqual((await draft(p)).content.questions.find(function (q) { return q.id === gid; }).retired, true);
  await p.context().close();
});

test('teacher: pictures — replace, caption, alt text, add new, remove', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/lecture/1');
  await editMode(p);
  const fig = await p.$('details[data-sub="1.1"] figure.ed-blk');
  const desc = await fig.getAttribute('data-desc');
  await fig.click();
  await p.waitForSelector('.picdlg');
  await p.setInputFiles('.pd-file', { name: 'new.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('.picprev img');
  await p.fill('.pd-cap', 'E2E replaced caption');
  await p.fill('.pd-alt', 'E2E alt text');
  await p.selectOption('.pd-al', 'right');
  await panelSave(p);
  const f2 = await p.$('figure[data-desc="' + desc + '"]');
  assert.match(await f2.textContent(), /E2E replaced caption/);
  assert.strictEqual(await f2.$eval('img', function (i) { return i.alt; }), 'E2E alt text');
  assert.ok(await f2.evaluate(function (f) { return f.classList.contains('al-right'); }));
  // add a new picture to block 1.3
  await p.selectOption('details[data-sub="1.3"] .ed-addrow select', 'img');
  await p.waitForSelector('.picdlg');
  await p.setInputFiles('.pd-file', { name: 'add.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('.picprev img');
  await p.fill('.pd-cap', 'E2E added picture');
  await panelSave(p);
  await p.waitForTimeout(200);
  assert.ok((await p.textContent('details[data-sub="1.3"]')).includes('E2E added picture'));
  // remove the picture from a slot (slot stays)
  const fig3 = await p.$('details[data-sub="1.3"] figure.pic.ed-blk');
  const d3 = await fig3.getAttribute('data-desc');
  await fig3.click();
  await p.click('.pd-rm');
  await panelSave(p);
  assert.ok(!(await p.$eval('figure[data-desc="' + d3 + '"]', function (f) { return f.classList.contains('pic'); })));
  await waitSaved(p);
  await p.context().close();
});

test('teacher: Presentation Mode slide editor still works and saves to the draft', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/present/1/edit');
  await p.waitForSelector('.pres .editor:not([hidden]) .ed-title');
  await p.click('.pres .b-next');
  await p.fill('.pres .ed-title', 'E2E slide title');
  await p.waitForFunction(function () { return /Saved to draft/.test(document.querySelector('.pres .saved').textContent); }, null, { timeout: 5000 });
  assert.ok((await p.textContent('.pres .slide')).includes('E2E slide title'));
  await p.click('.pres .b-exit');
  await waitSaved(p);
  const deck = (await draft(p)).content.decks['1'];
  assert.ok(deck && deck.slides.some(function (s) { return s.title === 'E2E slide title'; }));
  await p.context().close();
});

test('teacher: preview, then publish to GitHub; unsaved-changes warning', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await go(p, '#/lecture/1');
  await editMode(p);
  await p.click('.ed-prev');
  assert.ok(await p.evaluate(function () { return document.body.classList.contains('ed-preview'); }));
  assert.strictEqual(await p.$('.ed-blk'), null, 'preview shows no edit controls');
  assert.ok((await p.textContent('#app')).includes('E2E EDITED PARAGRAPH'), 'preview shows the draft');
  await p.click('.ed-exitprev');
  await p.click('.ed-pub');
  await p.waitForSelector('.pub-go', { timeout: 8000 });
  await p.fill('.pub-msg', 'E2E publish');
  await p.click('.pub-go');
  assert.match(await p.textContent('.mbody .pub-err'), /confirm/);
  await p.check('.pub-ok');
  await p.click('.pub-go');
  await p.waitForFunction(function () { return /Published/.test(document.querySelector('.modal-bg .mbody').textContent); }, null, { timeout: 8000 });
  assert.strictEqual(gh.commits.length, 1);
  assert.match(gh.commits[0].message, /^E2E publish/);
  // unsaved-changes warning when leaving with an unsaved edit
  await p.keyboard.press('Escape');
  await p.click('details[data-sub="1.1"] .md > .ed-blk');
  await p.fill('.ed-panel textarea', 'Unsaved…');
  let warned = false;
  p.removeAllListeners('dialog');
  p.on('dialog', function (dl) { if (dl.type() === 'beforeunload') warned = true; dl.dismiss(); });
  await p.close({ runBeforeUnload: true });
  await new Promise(function (r) { setTimeout(r, 300); });
  assert.ok(warned, 'browser warned about unsaved changes');
});

test('students see the published version; practice scoring uses the new key; assessments grade by question id', { skip: SKIP }, async function () {
  const p = await page();
  await loginStudent(p);
  await go(p, '#/lecture/1');
  const text = await p.textContent('#app');
  assert.ok(text.includes('E2E EDITED PARAGRAPH') && text.includes('E2E Added Section') && text.includes('E2E Section Title'));
  assert.ok((await p.textContent('#app')).includes('E2E replaced caption'));
  // the edited practice question: the newly chosen correct answer is marked correct
  const live = await p.evaluate(function () { return fetch('/api/content').then(function (r) { return r.json(); }); });
  const q = live.content.practice.find(function (x) { return x.explanation === 'E2E new explanation.'; });
  assert.ok(q);
  await go(p, '#/practice/concept/' + q.concept);
  await p.waitForSelector('.sba');
  const card = await p.$('.sba[data-qid="' + q.id + '"]') || await (async function () {
    // the concept set may start with other questions — step through until ours
    for (let i = 0; i < 10; i++) { await p.click('.sba .opt'); await p.click('.sba .chk'); await p.click('.runner .row button.primary'); const c = await p.$('.sba[data-qid="' + q.id + '"]'); if (c) return c; }
  })();
  const optBtns = await card.$$('.opt');
  await optBtns[q.answer].click();
  await (await card.$('.chk')).click();
  assert.match(await (await card.$('.fb')).textContent(), /Correct/);
  // a retired graded question is not in new attempts; answers are stored by question/option id
  await go(p, '#/test/MAIN');
  await p.fill('#tn', 'Test Student'); await p.fill('#ti', 'S123'); await p.click('form button[type=submit]');
  await p.waitForSelector('.exam .opt');
  await p.click('.exam .opt');
  const cur = await p.evaluate(function () { var k = Object.keys(localStorage).filter(function (x) { return /cur_MAIN$/.test(x); })[0]; return JSON.parse(localStorage.getItem(k)); });
  assert.ok(Array.isArray(cur.qids) && !Array.isArray(cur.answers));
  const retired = live.content.questions.filter(function (x) { return x.retired; }).map(function (x) { return x.id; });
  assert.ok(retired.length && retired.every(function (id) { return cur.qids.indexOf(id) < 0; }));
  const firstQ = live.content.questions.find(function (x) { return x.id === cur.qids[0]; });
  assert.strictEqual(cur.answers[firstQ.id], firstQ.optionIds[0]);
  await p.click('.exam .submit'); await p.click('.modal-bg .btn.primary');
  await p.waitForSelector('h1');
  await p.waitForFunction(function () { return /Your result/.test(document.querySelector('h1').textContent); });
  const res = await p.evaluate(function () { var k = Object.keys(localStorage).filter(function (x) { return /attempts$/.test(x); })[0]; return JSON.parse(localStorage.getItem(k)); });
  assert.strictEqual(res[0].sigv, 3);
  assert.strictEqual(res[0].total, cur.qids.length);
  assert.strictEqual(res[0].correct, firstQ.answer === 0 ? 1 : 0);
  await p.context().close();
});

test('teacher: section checks of every kind, review items, settings, live/draft switch, history restore, discard', { skip: SKIP }, async function () {
  const p = await page();
  await loginTeacher(p);
  await editMode(p);
  const before = (await draft(p)).content;
  const tf = before.checks.find(function (c) { return c.type === 'tf'; });
  const match = before.checks.find(function (c) { return c.type === 'match'; });
  const fill = before.checks.find(function (c) { return c.type === 'fill'; });
  const sort = before.checks.find(function (c) { return c.type === 'sort'; });
  async function openCheck(id) {
    await go(p, '#/faculty/questions/checks');
    await p.fill('.qb-s', id);
    await p.waitForFunction(function () { return document.querySelectorAll('.qrow').length === 1; });
    await p.click('.qrow [data-a=e]');
    await p.waitForSelector('.qed');
    assert.ok((await p.textContent('.qed')).includes(id), 'opened ' + id);
  }
  async function saveCheck() { await p.click('.ed-panel footer .btn.primary'); await p.waitForSelector('.ed-panel', { state: 'detached' }); }
  // true/false: flip the answer
  await openCheck(tf.id);
  await p.click('.qed input[name=tf][value="' + (tf.answer ? '0' : '1') + '"]');
  await saveCheck();
  // matching: save unchanged → the same item→match pairs (order of matches may be reshuffled)
  await openCheck(match.id); await saveCheck();
  // fill-in: change the accepted answers of blank 1
  await openCheck(fill.id);
  await p.fill('.fe-rows .field:first-child input', 'alpha; beta');
  assert.strictEqual(await p.inputValue('.fe-rows .field:first-child input'), 'alpha; beta');
  await saveCheck();
  // sorting: save unchanged
  await openCheck(sort.id); await saveCheck();
  await waitSaved(p);
  let d = (await draft(p)).content;
  if (JSON.stringify(d.checks.find(function (c) { return c.id === fill.id; }).answers[0]) !== '["alpha","beta"]') {
    // diagnostics for an intermittent failure seen once: what the page holds vs. what the server saved
    console.log('DIAG page:', await p.evaluate(function (id) { return JSON.stringify(window.__vulva.D.checks.find(function (c) { return c.id === id; })); }, fill.id), 'status:', await p.textContent('.ed-status'), 'server rev:', (await draft(p)).rev);
  }
  const tf2 = d.checks.find(function (c) { return c.id === tf.id; });
  assert.strictEqual(tf2.answer, !tf.answer);
  const m2 = d.checks.find(function (c) { return c.id === match.id; });
  const pairs = function (c) { return c.left.map(function (l, i) { return l + '→' + c.right[c.key[i]]; }); };
  assert.deepStrictEqual(pairs(m2), pairs(match));
  assert.deepStrictEqual(d.checks.find(function (c) { return c.id === fill.id; }).answers[0], ['alpha', 'beta']);
  const s2 = d.checks.find(function (c) { return c.id === sort.id; });
  assert.deepStrictEqual(s2.items, sort.items); assert.deepStrictEqual(s2.groups, sort.groups);
  // change a check's type (mcq → select-all) keeps its id and options
  const mcq = d.checks.find(function (c) { return c.type === 'mcq'; });
  await openCheck(mcq.id);
  await p.selectOption('.q-type', 'select');
  // each click re-draws the option list, so look the boxes up again every time
  await (await p.$$('.opted-row input[type=checkbox]'))[0].click();
  await (await p.$$('.opted-row input[type=checkbox]'))[1].click();
  await saveCheck();
  await waitSaved(p);
  const sel = (await draft(p)).content.checks.find(function (c) { return c.id === mcq.id; });
  assert.strictEqual(sel.type, 'select'); assert.deepStrictEqual(sel.optionIds, mcq.optionIds);
  assert.ok(sel.answer.length >= 2);
  // review item: add an exam trap
  await go(p, '#/review/traps');
  await p.click('.ed-bar2 .btn.primary');
  const tas = await p.$$('.ed-panel textarea');
  await tas[0].fill('E2E trap'); await tas[1].fill('E2E remember');
  await panelSave(p);
  assert.ok((await p.textContent('#app')).includes('E2E remember'));
  // course settings
  await go(p, '#/faculty/content');
  await p.click('[data-a=settings]');
  await p.fill('.ed-panel input[data-k=audience]', 'E2E audience');
  await panelSave(p);
  await waitSaved(p);
  assert.strictEqual((await draft(p)).content.meta.audience, 'E2E audience');
  // switching to the live view shows the published version, read-only
  await p.click('.ed-view');
  await p.waitForSelector('.ed-ver.live');
  await go(p, '#/review/traps');
  assert.ok(!(await p.textContent('#app')).includes('E2E remember'), 'live view does not show the draft');
  assert.strictEqual(await p.$('.ed-qbar'), null, 'no editing in the live view');
  await p.click('.ed-view');
  await p.waitForSelector('.ed-ver.draft');
  // history: restore the last published version into the draft, then discard the draft
  await go(p, '#/faculty/content');
  await p.waitForSelector('.hist-body button');
  const pubRow = await p.$$('.hist-body tr');
  let restored = false;
  for (const r of pubRow) { if (/Published/.test(await r.textContent())) { await (await r.$('button')).click(); restored = true; break; } }
  assert.ok(restored);
  await Promise.all([p.waitForEvent('load'), p.click('.modal-bg .btn.primary')]);
  await p.waitForSelector('.edbar');
  d = (await draft(p)).content;
  assert.notStrictEqual(d.meta.audience, 'E2E audience', 'restored version replaces the draft');
  await go(p, '#/faculty/content');
  await p.click('[data-a=discard]');
  await Promise.all([p.waitForEvent('load'), p.click('.modal-bg .btn.danger')]);
  await p.waitForSelector('.edbar');
  assert.strictEqual((await draft(p)).rev, 0);
  await p.context().close();
});

test('teacher portal: result files from the old single-file edition still import and grade correctly', { skip: SKIP }, async function () {
  const crypto = require('crypto');
  const p = await page();
  await loginTeacher(p);
  const live = (await p.evaluate(function () { return fetch('/api/content').then(function (r) { return r.json(); }); })).content;
  const order = live.legacy.questionOrder.MAIN;
  const byId = {}; live.questions.forEach(function (q) { byId[q.id] = q; });
  // old format: answers by position in the original paper; all correct except the last, which is blank
  // (the old edition's option k is the option whose permanent id is "o<k+1>")
  const answers = order.map(function (id, i) { if (i === order.length - 1) return null; const q = byId[id]; return +q.optionIds[q.answer].slice(1) - 1; });
  const a = { id: 'MAIN-legacy1', test: 'MAIN', name: 'Old Student', studentId: 'S9', email: '', sigv: 2, startedAt: 1, submittedAt: 2, durationSec: 60, answers: answers, score: order.length - 1 };
  a.sig = crypto.createHash('sha256').update(['vulva-review-v2', a.id, a.test, a.name, a.studentId, a.email, a.startedAt, a.submittedAt, answers.map(function (x) { return x == null ? '-' : x; }).join(''), a.score].join('|')).digest('hex');
  await go(p, '#/teacher');
  await p.setInputFiles('#app input[type=file]', { name: 'old-result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'vulva-review-results', attempts: [a] })) });
  await p.waitForSelector('tr.click');
  const row = await p.textContent('tr.click');
  assert.match(row, /Old Student/);
  const live2 = live.questions.filter(function (q) { return order.indexOf(q.id) >= 0; }).length;
  assert.ok(row.includes((order.length - 1) + '/' + live2), 'scored ' + (order.length - 1) + '/' + live2 + ': ' + row);
  assert.ok(row.includes('✓'), 'check value verified');
  await p.context().close();
});

test('responsive: learner pages and the editor fit a phone screen', { skip: SKIP }, async function () {
  const s = await page({ width: 390, height: 844 });
  await loginStudent(s);
  for (const hsh of ['#/', '#/learn', '#/lecture/1', '#/practice', '#/review/facts']) {
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

test('no JavaScript errors in any browser test', { skip: SKIP }, function () {
  assert.deepStrictEqual(errors, []);
});
