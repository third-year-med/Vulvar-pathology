'use strict';
/* Test helpers: start a server on a free port with a temporary data directory and a copy of the content,
   a cookie-aware HTTP client, and a mock GitHub API (records commits; never touches the real GitHub). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { load } = require('../server/config');
const { createServer } = require('../server/server');

const ROOT = path.join(__dirname, '..');
const STUDENT_PW = 'class-password-2026';
const ADMIN_PW = 'teacher-secret-2026';

function tmpDir(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function copyContent() {
  const dir = tmpDir('vp-content-');
  fs.copyFileSync(path.join(ROOT, 'content', 'content.json'), path.join(dir, 'content.json'));
  fs.mkdirSync(path.join(dir, 'media'));
  fs.readdirSync(path.join(ROOT, 'content', 'media')).forEach(function (f) { fs.copyFileSync(path.join(ROOT, 'content', 'media', f), path.join(dir, 'media', f)); });
  return dir;
}

function startServer(extraEnv) {
  const env = Object.assign({
    STUDENT_PASSWORD: STUDENT_PW, ADMIN_USERNAME: 'teacher', ADMIN_PASSWORD: ADMIN_PW,
    DATA_DIR: tmpDir('vp-data-'), CONTENT_DIR: copyContent(), PORT: '0', COOKIE_SECURE: '0'
  }, extraEnv || {});
  const cfg = load(env);
  const app = createServer(cfg);
  return new Promise(function (res) {
    app.server.listen(0, '127.0.0.1', function () {
      app.url = 'http://127.0.0.1:' + app.server.address().port;
      app.close = function () { return new Promise(function (r) { app.server.close(r); app.server.closeAllConnections && app.server.closeAllConnections(); }); };
      res(app);
    });
  });
}

/* Minimal cookie-jar client. */
function client(base) {
  let cookie = '', csrf = '';
  function req(method, p, body, opts) {
    opts = opts || {};
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (cookie) headers.Cookie = cookie;
    if (csrf && !opts.noCsrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let payload;
    if (Buffer.isBuffer(body)) { payload = body; headers['Content-Type'] = headers['Content-Type'] || 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
    return fetch(base + p, { method: method, headers: headers, body: payload, redirect: 'manual' }).then(function (r) {
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return r.text().then(function (t) { let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { status: r.status, json: j, text: t, headers: r.headers }; });
    });
  }
  return {
    req: req,
    login: function (kind, password, username) {
      return req('POST', '/api/login', { kind: kind, password: password, username: username }).then(function (r) { if (r.json && r.json.csrf) csrf = r.json.csrf; return r; });
    },
    get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    get csrf() { return csrf; }, set csrf(v) { csrf = v; }
  };
}

/* Mock GitHub REST API (Git Data endpoints used by the publisher). */
function mockGitHub() {
  const state = { commits: [], blobs: {}, head: 'a'.repeat(40), trees: {}, files: {}, auth: [] };
  let n = 0;
  const server = http.createServer(function (req, res) {
    let body = ''; req.on('data', function (c) { body += c; });
    req.on('end', function () {
      state.auth.push(req.headers.authorization || '');
      const u = new URL(req.url, 'http://x'), p = u.pathname, j = body ? JSON.parse(body) : null;
      function send(code, obj, raw) { res.writeHead(code, { 'Content-Type': raw ? 'text/plain' : 'application/json' }); res.end(raw ? obj : JSON.stringify(obj)); }
      if (req.method === 'GET' && /\/git\/ref\/heads\//.test(p)) return send(200, { object: { sha: state.head } });
      if (req.method === 'GET' && /\/git\/commits\//.test(p)) return send(200, { sha: state.head, tree: { sha: 't-' + state.head } });
      if (req.method === 'POST' && /\/git\/blobs$/.test(p)) { const sha = 'b' + (++n); state.blobs[sha] = Buffer.from(j.content, 'base64'); return send(201, { sha: sha }); }
      if (req.method === 'POST' && /\/git\/trees$/.test(p)) { const sha = 't' + (++n); state.trees[sha] = j; return send(201, { sha: sha }); }
      if (req.method === 'POST' && /\/git\/commits$/.test(p)) { const sha = String(++n).padStart(40, 'c'); state.commits.push({ sha: sha, message: j.message, tree: state.trees[j.tree], parents: j.parents, author: j.author }); return send(201, { sha: sha }); }
      if (req.method === 'PATCH' && /\/git\/refs\/heads\//.test(p)) {
        state.head = j.sha;
        const c = state.commits.filter(function (x) { return x.sha === j.sha; })[0];
        c.tree.tree.forEach(function (t) { state.files[t.path] = state.files[t.path] || {}; state.files[t.path][j.sha] = state.blobs[t.sha]; });
        return send(200, { object: { sha: j.sha } });
      }
      if (req.method === 'GET' && /\/commits$/.test(p)) return send(200, state.commits.slice().reverse().map(function (c) { return { sha: c.sha, commit: { message: c.message, author: { date: new Date().toISOString(), name: c.author.name } }, html_url: 'https://github.com/x/y/commit/' + c.sha }; }));
      const cm = /\/contents\/(.+)$/.exec(p);
      if (req.method === 'GET' && cm) { const f = (state.files[decodeURIComponent(cm[1])] || {})[u.searchParams.get('ref')]; return f ? send(200, f.toString('utf8'), true) : send(404, { message: 'Not Found' }); }
      send(404, { message: 'Not Found' });
    });
  });
  return new Promise(function (res) { server.listen(0, '127.0.0.1', function () { state.url = 'http://127.0.0.1:' + server.address().port; state.close = function () { return new Promise(function (r) { server.close(r); }); }; res(state); }); });
}

module.exports = { startServer: startServer, client: client, mockGitHub: mockGitHub, STUDENT_PW: STUDENT_PW, ADMIN_PW: ADMIN_PW, ROOT: ROOT };
