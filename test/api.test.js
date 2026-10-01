'use strict';
/* Server tests: access control, sessions, CSRF, validation, drafts, media, publishing (mock GitHub), history.
   Run: npm test */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, client, mockGitHub, STUDENT_PW, ADMIN_PW, ROOT } = require('./helpers');

const TOKEN = 'ghp_CANARY_TOKEN_must_never_reach_the_browser_123';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201e2b1b1cf0000000049454e44ae426082', 'hex');

let gh, app;
test.before(async function () {
  gh = await mockGitHub();
  app = await startServer({ GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'owner/repo', GITHUB_BRANCH: 'main', GITHUB_API_URL: gh.url });
});
test.after(async function () { await app.close(); await gh.close(); });

async function student() { const c = client(app.url); const r = await c.login('student', STUDENT_PW); assert.strictEqual(r.status, 200); return c; }
async function teacher() { const c = client(app.url); const r = await c.login('admin', ADMIN_PW, 'teacher'); assert.strictEqual(r.status, 200); return c; }

test('the public page and app code contain no educational content and no secrets', async function () {
  const c = client(app.url);
  for (const p of ['/', '/app.js', '/boot.js', '/app.css']) {
    const r = await c.req('GET', p);
    assert.strictEqual(r.status, 200, p);
    assert.ok(!r.text.includes("Hart's line"), p + ' leaks content');
    assert.ok(!r.text.includes(TOKEN) && !r.text.includes(STUDENT_PW) && !r.text.includes(ADMIN_PW), p + ' leaks a secret');
  }
  assert.strictEqual((await c.req('GET', '/content/content.json')).status, 404);
  assert.strictEqual((await c.req('GET', '/server/config.js')).status, 404);
  assert.strictEqual((await c.req('GET', '/../content/content.json')).status, 404);
});

test('without signing in: no content, no pictures, no editor, no admin API', async function () {
  const c = client(app.url);
  assert.strictEqual((await c.req('GET', '/api/content')).status, 401);
  const media = fs.readdirSync(path.join(ROOT, 'content', 'media'))[0];
  assert.strictEqual((await c.req('GET', '/media/' + media)).status, 401);
  assert.strictEqual((await c.req('GET', '/admin/editor.js')).status, 401);
  assert.strictEqual((await c.req('GET', '/api/admin/status')).status, 401);
  assert.strictEqual((await c.req('PUT', '/api/admin/draft', { content: {}, baseRev: 0 })).status, 401);
  const s = await c.req('GET', '/api/session');
  assert.strictEqual(s.json.authenticated, false);
});

test('student sign-in: wrong password rejected, right password accepted with a secure cookie', async function () {
  const c = client(app.url);
  const bad = await c.login('student', 'wrong-password');
  assert.strictEqual(bad.status, 401);
  assert.ok(!c.cookie);
  const ok = await c.login('student', STUDENT_PW);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.role, 'student');
  assert.deepStrictEqual(ok.json.permissions, ['content:read']);
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  // the student password is not a teacher password
  const t = client(app.url);
  assert.strictEqual((await t.login('admin', STUDENT_PW, 'teacher')).status, 401);
});

test('students can read live content and pictures', async function () {
  const c = await student();
  const r = await c.req('GET', '/api/content');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.version, 'live');
  assert.ok(r.json.content.lectures.length >= 1);
  const pic = Object.values(r.json.content.pics)[0].src;
  const m = await c.req('GET', '/' + pic);
  assert.strictEqual(m.status, 200);
});

test('students cannot use any teacher operation, even by calling the API directly', async function () {
  const c = await student();
  const content = (await c.req('GET', '/api/content')).json.content;
  const checks = [
    ['GET', '/api/content?version=draft'], ['GET', '/admin/editor.js'], ['GET', '/admin/editor.css'], ['GET', '/api/admin/status'],
    ['PUT', '/api/admin/draft', { content: content, baseRev: 0 }], ['DELETE', '/api/admin/draft'], ['GET', '/api/admin/preview'],
    ['POST', '/api/admin/publish', { message: 'x', rev: 1 }], ['GET', '/api/admin/history'], ['POST', '/api/admin/history/restore', { id: 'x' }],
    ['GET', '/api/admin/media']
  ];
  for (const k of checks) {
    const r = await c.req(k[0], k[1], k[2]);
    assert.strictEqual(r.status, 403, k[0] + ' ' + k[1] + ' gave ' + r.status);
  }
  const up = await c.req('POST', '/api/admin/media', PNG, { headers: { 'Content-Type': 'image/png' } });
  assert.strictEqual(up.status, 403);
});

test('no response ever contains the GitHub token or passwords', async function () {
  const s = await student(), t = await teacher();
  const all = [
    await s.req('GET', '/api/session'), await s.req('GET', '/api/content'),
    await t.req('GET', '/api/session'), await t.req('GET', '/api/admin/status'), await t.req('GET', '/api/admin/history'), await t.req('GET', '/admin/editor.js'), await t.req('GET', '/api/admin/preview')
  ];
  all.forEach(function (r) { assert.ok(!r.text.includes(TOKEN) && !r.text.includes(ADMIN_PW) && !r.text.includes(STUDENT_PW)); });
});

test('state-changing requests need the CSRF token and the same origin', async function () {
  const t = await teacher();
  const d = (await t.req('GET', '/api/content?version=draft')).json;
  const noTok = await t.req('PUT', '/api/admin/draft', { content: d.content, baseRev: d.rev }, { noCsrf: true });
  assert.strictEqual(noTok.status, 403);
  const cross = await t.req('PUT', '/api/admin/draft', { content: d.content, baseRev: d.rev }, { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(cross.status, 403);
  const formLogin = await client(app.url).req('POST', '/api/login', Buffer.from('kind=student&password=x'), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(formLogin.status, 415);
});

test('teacher sign-in: wrong username/password rejected; teacher gets editor and draft', async function () {
  assert.strictEqual((await client(app.url).login('admin', ADMIN_PW, 'nobody')).status, 401);
  assert.strictEqual((await client(app.url).login('admin', 'nope', 'teacher')).status, 401);
  const t = await teacher();
  assert.strictEqual((await t.req('GET', '/admin/editor.js')).status, 200);
  const d = await t.req('GET', '/api/content?version=draft');
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.json.version, 'draft');
});

test('draft: save, conflict detection, validation keeps question data consistent, discard', async function () {
  const t = await teacher();
  let d = (await t.req('GET', '/api/content?version=draft')).json;
  const c = d.content;
  c.lectures[0].title = 'Edited lecture title';
  const s1 = await t.req('PUT', '/api/admin/draft', { content: c, baseRev: d.rev });
  assert.strictEqual(s1.status, 200, JSON.stringify(s1.json));
  // stale revision → conflict, nothing overwritten
  const s2 = await t.req('PUT', '/api/admin/draft', { content: c, baseRev: d.rev });
  assert.strictEqual(s2.status, 409);
  // a broken question (option ids out of step with options) is refused
  const bad = JSON.parse(JSON.stringify(c)); bad.practice[0].optionIds.pop();
  const s3 = await t.req('PUT', '/api/admin/draft', { content: bad, baseRev: s1.json.rev });
  assert.strictEqual(s3.status, 422);
  const bad2 = JSON.parse(JSON.stringify(c)); bad2.practice[0].answer = 9;
  assert.strictEqual((await t.req('PUT', '/api/admin/draft', { content: bad2, baseRev: s1.json.rev })).status, 422);
  const bad3 = JSON.parse(JSON.stringify(c)); bad3.questions[1].id = bad3.questions[0].id;
  assert.strictEqual((await t.req('PUT', '/api/admin/draft', { content: bad3, baseRev: s1.json.rev })).status, 422);
  const bad4 = JSON.parse(JSON.stringify(c)); Object.values(bad4.pics)[0].src = 'javascript:alert(1)';
  assert.strictEqual((await t.req('PUT', '/api/admin/draft', { content: bad4, baseRev: s1.json.rev })).status, 422);
  d = (await t.req('GET', '/api/content?version=draft')).json;
  assert.strictEqual(d.content.lectures[0].title, 'Edited lecture title');
  assert.strictEqual(d.rev, s1.json.rev);
  // students still see the live version
  const s = await student();
  assert.notStrictEqual((await s.req('GET', '/api/content')).json.content.lectures[0].title, 'Edited lecture title');
  // discard
  assert.strictEqual((await t.req('DELETE', '/api/admin/draft')).status, 200);
  d = (await t.req('GET', '/api/content?version=draft')).json;
  assert.strictEqual(d.rev, 0);
  assert.notStrictEqual(d.content.lectures[0].title, 'Edited lecture title');
});

test('media upload: images only; unpublished uploads are visible to teachers only', async function () {
  const t = await teacher(), s = await student();
  assert.strictEqual((await t.req('POST', '/api/admin/media', Buffer.from('<svg onload="alert(1)"></svg>'), { headers: { 'Content-Type': 'image/svg+xml' } })).status, 415);
  assert.strictEqual((await t.req('POST', '/api/admin/media', Buffer.from('hello world, not an image'), { headers: { 'Content-Type': 'image/png' } })).status, 415);
  const up = await t.req('POST', '/api/admin/media', PNG, { headers: { 'Content-Type': 'image/png' } });
  assert.strictEqual(up.status, 200, up.text);
  assert.match(up.json.file, /^[a-f0-9]{32}\.png$/);
  assert.strictEqual((await t.req('GET', '/media/' + up.json.file)).status, 200);
  assert.strictEqual((await s.req('GET', '/media/' + up.json.file)).status, 404);
  const list = await t.req('GET', '/api/admin/media');
  assert.ok(list.json.files.some(function (f) { return f.file === up.json.file && f.published === false; }));
});

test('publish: validates, commits to GitHub with the server-side token, then students see the change', async function () {
  const t = await teacher(), s = await student();
  const d = (await t.req('GET', '/api/content?version=draft')).json;
  const up = await t.req('POST', '/api/admin/media', PNG, { headers: { 'Content-Type': 'image/png' } });
  const c = d.content;
  c.lectures[0].sections[0].subs[0].md = 'PUBLISHED TEXT\n\n**Image:** pic:test1';
  // same slot-key function as the app (public/app.js picKey)
  function picKey(desc) { let x = 5381; for (let i = 0; i < desc.length; i++) x = ((x * 33) ^ desc.charCodeAt(i)) >>> 0; return 'p' + x.toString(36) + desc.length.toString(36); }
  c.pics[picKey('pic:test1')] = { src: 'media/' + up.json.file, caption: 'Test picture', alt: 'A test' };
  // an empty question stem blocks publishing
  const badQ = JSON.parse(JSON.stringify(c)); badQ.practice[0].stem = '   ';
  let r = await t.req('PUT', '/api/admin/draft', { content: badQ, baseRev: d.rev });
  assert.strictEqual(r.status, 200);
  let pv = await t.req('GET', '/api/admin/preview');
  assert.ok(pv.json.errors.some(function (e) { return /question text is empty/.test(e); }));
  let pub = await t.req('POST', '/api/admin/publish', { message: 'should fail', rev: r.json.rev });
  assert.strictEqual(pub.status, 422);
  assert.strictEqual(gh.commits.length, 0);
  // fix and publish; a stale revision is refused first
  r = await t.req('PUT', '/api/admin/draft', { content: c, baseRev: r.json.rev });
  assert.strictEqual((await t.req('POST', '/api/admin/publish', { message: 'x', rev: r.json.rev - 1 })).status, 409);
  pv = await t.req('GET', '/api/admin/preview');
  assert.deepStrictEqual(pv.json.errors, []);
  assert.ok(pv.json.diff.changes.some(function (ch) { return /Learn content/.test(ch.area); }));
  pub = await t.req('POST', '/api/admin/publish', { message: 'Update block 1.1', rev: r.json.rev });
  assert.strictEqual(pub.status, 200, pub.text);
  assert.strictEqual(pub.json.github, true);
  assert.strictEqual(gh.commits.length, 1);
  const commit = gh.commits[0];
  assert.match(commit.message, /^Update block 1\.1/);
  const paths = commit.tree.tree.map(function (x) { return x.path; }).sort();
  assert.deepStrictEqual(paths, ['content/content.json', 'content/media/' + up.json.file].sort());
  assert.ok(gh.auth.every(function (a) { return a === 'Bearer ' + TOKEN; }));
  const live = (await s.req('GET', '/api/content')).json.content;
  assert.ok(live.lectures[0].sections[0].subs[0].md.startsWith('PUBLISHED TEXT'));
  assert.strictEqual((await s.req('GET', '/media/' + up.json.file)).status, 200, 'published picture is now visible to students');
  // the draft is now the live version
  assert.strictEqual((await t.req('GET', '/api/content?version=draft')).json.rev, 0);
  const st = await t.req('GET', '/api/admin/status');
  assert.strictEqual(st.json.published.commit, commit.sha);
});

test('history: restore a saved version or a GitHub version into the draft (never straight to students)', async function () {
  const t = await teacher(), s = await student();
  const h = await t.req('GET', '/api/admin/history');
  assert.ok(h.json.local.some(function (x) { return x.kind === 'published'; }));
  assert.ok(Array.isArray(h.json.github) && h.json.github.length >= 1);
  // GitHub version → draft
  const r = await t.req('POST', '/api/admin/history/restore', { commit: h.json.github[0].sha });
  assert.strictEqual(r.status, 200, r.text);
  const d = (await t.req('GET', '/api/content?version=draft')).json;
  assert.ok(d.content.lectures[0].sections[0].subs[0].md.startsWith('PUBLISHED TEXT'));
  // a local snapshot → draft
  const snap = h.json.local[h.json.local.length - 1];
  assert.strictEqual((await t.req('POST', '/api/admin/history/restore', { id: snap.id })).status, 200);
  assert.strictEqual((await t.req('POST', '/api/admin/history/restore', { id: '../../etc/passwd' })).status, 404);
  // live content unchanged by restoring
  assert.ok((await s.req('GET', '/api/content')).json.content.lectures[0].sections[0].subs[0].md.startsWith('PUBLISHED TEXT'));
  await t.req('DELETE', '/api/admin/draft');
});

test('publishing fails safely if GitHub rejects the commit (live content unchanged)', async function () {
  const bad = await startServer({ GITHUB_TOKEN: 'x', GITHUB_REPO: 'owner/repo', GITHUB_API_URL: 'http://127.0.0.1:9' });
  try {
    const t = client(bad.url); await t.login('admin', ADMIN_PW, 'teacher');
    const d = (await t.req('GET', '/api/content?version=draft')).json;
    d.content.lectures[0].title = 'Not published';
    const r = await t.req('PUT', '/api/admin/draft', { content: d.content, baseRev: d.rev });
    const p = await t.req('POST', '/api/admin/publish', { message: 'x', rev: r.json.rev });
    assert.strictEqual(p.status, 502);
    const s = client(bad.url); await s.login('student', STUDENT_PW);
    assert.notStrictEqual((await s.req('GET', '/api/content')).json.content.lectures[0].title, 'Not published');
    assert.strictEqual((await t.req('GET', '/api/content?version=draft')).json.content.lectures[0].title, 'Not published', 'the draft is kept');
  } finally { await bad.close(); }
});

test('sign-out ends the session; repeated wrong passwords are rate-limited', async function () {
  const s = await student();
  assert.strictEqual((await s.req('POST', '/api/logout', {})).status, 200);
  assert.strictEqual((await s.req('GET', '/api/content')).status, 401);
  const c = client(app.url); let last;
  for (let i = 0; i < 9; i++) last = await c.login('admin', 'wrong' + i, 'teacher');
  assert.strictEqual(last.status, 429);
});

test('changing the student password on the server signs out everyone who used the old one', async function () {
  const a = await startServer();
  const s = client(a.url); await s.login('student', STUDENT_PW);
  assert.strictEqual((await s.req('GET', '/api/content')).status, 200);
  await new Promise(function (r) { setTimeout(r, 400); }); // sessions are written to disk
  await a.close();
  const b = await startServer({ DATA_DIR: a.cfg.dataDir, CONTENT_DIR: a.cfg.contentDir, STUDENT_PASSWORD: 'a-brand-new-password' });
  try {
    const s2 = client(b.url); s2.cookie = s.cookie;
    assert.strictEqual((await s2.req('GET', '/api/content')).status, 401);
  } finally { await b.close(); }
});

test('a restart without a redeploy keeps the latest published version (live copy on the data disk)', async function () {
  const a = await startServer();
  const t = client(a.url); await t.login('admin', ADMIN_PW, 'teacher');
  const d = (await t.req('GET', '/api/content?version=draft')).json;
  d.content.lectures[0].title = 'Published before restart';
  const up = await t.req('POST', '/api/admin/media', PNG, { headers: { 'Content-Type': 'image/png' } });
  d.content.media = d.content.media || {}; d.content.media[up.json.file] = { title: 'kept' };
  const r = await t.req('PUT', '/api/admin/draft', { content: d.content, baseRev: d.rev });
  assert.strictEqual((await t.req('POST', '/api/admin/publish', { message: 'x', rev: r.json.rev })).status, 200);
  await a.close();
  // new server process: same data disk, but the application files are the original ones (old image)
  const b = await startServer({ DATA_DIR: a.cfg.dataDir });
  try {
    const s = client(b.url); await s.login('student', STUDENT_PW);
    const live = (await s.req('GET', '/api/content')).json.content;
    assert.strictEqual(live.lectures[0].title, 'Published before restart');
    assert.strictEqual((await s.req('GET', '/media/' + up.json.file)).status, 200);
  } finally { await b.close(); }
});
