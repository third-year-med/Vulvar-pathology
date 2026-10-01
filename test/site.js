'use strict';
/* Test stand-in for the production setup, all in one Node process:
   • GitHub Pages: serves the repository's site files (index.html, assets/…), with a test config.js;
     content/… is served from a temporary folder that receives every commit the backend makes to the mock GitHub.
   • The Apps Script web app: POST /exec runs the REAL backend files (Code.gs core excerpt, Gyn.gs, GynContent.gs)
     in the harness, exactly as a text/plain POST from the browser would reach doPost.
   Nothing here talks to the internet. */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBackend, githubMock } = require('./apps-script/harness');

const ROOT = path.join(__dirname, '..');
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(ROOT, 'backend', 'Gyn.gs'), path.join(ROOT, 'backend', 'GynContent.gs')];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.enc': 'application/octet-stream' };
const GH_TOKEN = 'ghp_E2E_CANARY_token_must_never_reach_a_browser';

function startSite(opts) {
  opts = opts || {};
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-site-'));
  const gh = githubMock({ onCommit: function (c) {
    Object.keys(c.files).forEach(function (p) { if (!/^content\//.test(p)) return; const f = path.join(siteDir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c.files[p]); });
  } });
  const backend = createBackend({ files: FILES, fetch: gh.handle, properties: opts.noGithub ? {} : { GITHUB_TOKEN: GH_TOKEN, GITHUB_REPO: 'owner/repo', GITHUB_BRANCH: 'main' } });
  const replies = [];
  const server = http.createServer(function (req, res) {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/exec') {
      let body = ''; req.on('data', function (d) { body += d; });
      req.on('end', function () {
        let out;
        try { out = backend.ctx.doPost({ postData: { contents: body } }).getContent(); } catch (e) { out = JSON.stringify({ ok: false, error: String(e) }); }
        replies.push(out);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out);
      });
      return;
    }
    if (u.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      res.end('window.VULVA_CONFIG = ' + JSON.stringify({ backendUrl: '/exec', module: 'vulva', repo: '', branch: 'main', title: 'Test Pathology' }) + ';');
      return;
    }
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    if (rel.indexOf('..') >= 0) { res.writeHead(400); res.end(); return; }
    const file = /^content\//.test(rel) ? path.join(siteDir, rel) : /^(index\.html|assets\/)/.test(rel) ? path.join(ROOT, rel) : null;
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      const url = 'http://127.0.0.1:' + server.address().port;
      resolve({
        url: url, backend: backend, gh: gh, siteDir: siteDir, replies: replies, GH_TOKEN: GH_TOKEN,
        call: function (payload) { return backend.doPost(Object.assign({ module: 'vulva' }, payload)); },
        close: function () { return new Promise(function (r) { server.close(r); fs.rmSync(siteDir, { recursive: true, force: true }); }); }
      });
    });
  });
}
module.exports = { startSite: startSite };
