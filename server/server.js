'use strict';
/* Pathology teaching platform — server.
   Serves the app shell, signs users in, delivers content only to signed-in users, and exposes the
   teacher/admin API (draft, media, preview, publish, history). Every admin route checks the
   session's role on the server; hiding buttons in the browser is only cosmetic. No dependencies. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./config');
const { createAuth, can } = require('./auth');
const { createStore } = require('./content-store');
const { createGitHub } = require('./github');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const COOKIE = 'vp_sid';

function createServer(cfg) {
  cfg = cfg || load();
  const auth = createAuth(cfg);
  const store = createStore(cfg);
  const github = createGitHub(cfg.github);

  function headers(res, extra) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    Object.keys(extra || {}).forEach(function (k) { res.setHeader(k, extra[k]); });
  }
  function send(req, res, status, body, type, extra) {
    let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const h = Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra || {});
    if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /json|javascript|css|html/.test(type)) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
    h['Content-Length'] = buf.length;
    headers(res, h);
    res.writeHead(status);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
  function json(req, res, status, obj) { send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }
  function deny(req, res, status, msg) { json(req, res, status, { ok: false, error: msg }); }

  function cookies(req) { const out = {}; String(req.headers.cookie || '').split(';').forEach(function (c) { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return out; }
  function isHttps(req) { return !!req.socket.encrypted || (cfg.trustProxy && /^https/i.test(String(req.headers['x-forwarded-proto'] || ''))); }
  function setCookie(req, res, value, maxAge) {
    const secure = cfg.cookieSecure === '1' || cfg.cookieSecure === 'true' || (cfg.cookieSecure === 'auto' && isHttps(req));
    res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : ''));
  }
  function ip(req) { return (cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?'; }
  function sameOrigin(req) {
    // Reject cross-site requests: the browser always sends Origin on cross-origin POST/PUT/DELETE.
    const o = req.headers.origin; if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
  }
  function body(req, limit, raw) {
    return new Promise(function (resolve, reject) {
      const chunks = []; let n = 0;
      req.on('data', function (c) { n += c.length; if (n > limit) { reject(Object.assign(new Error('Request too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', function () {
        const buf = Buffer.concat(chunks);
        if (raw) return resolve(buf);
        try { resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }
  function staticFile(req, res, file, extra) {
    fs.readFile(file, function (e, buf) {
      if (e) return send(req, res, 404, 'Not found', 'text/plain; charset=utf-8');
      send(req, res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream', Object.assign({ 'Cache-Control': 'no-cache' }, extra || {}));
    });
  }

  /* ---------- routes ---------- */
  const routes = [];
  function route(method, pattern, opts, fn) { routes.push({ method: method, re: pattern, opts: opts, fn: fn }); }

  route('POST', /^\/api\/login$/, { public: true }, function (req, res, ctx) {
    return body(req, 10e3).then(function (b) {
      const r = auth.login(b.kind, b.username, b.password, ip(req));
      if (!r.ok) return deny(req, res, r.status, r.error);
      setCookie(req, res, r.session.token, r.session.maxAge);
      const s = auth.getSession(r.session.token);
      json(req, res, 200, sessionInfo(s));
    });
  });
  route('POST', /^\/api\/logout$/, { public: true }, function (req, res, ctx) {
    auth.destroySession(ctx.token); setCookie(req, res, '', 0); json(req, res, 200, { ok: true });
  });
  route('GET', /^\/api\/session$/, { public: true }, function (req, res, ctx) {
    json(req, res, 200, ctx.session ? sessionInfo(ctx.session) : { ok: true, authenticated: false, configured: auth.configured });
  });
  function sessionInfo(s) {
    return { ok: true, authenticated: true, role: s.role, name: s.name, shared: s.shared, csrf: s.csrf, expires: s.expires,
      permissions: ['content:read', 'content:edit', 'media:write', 'draft:write', 'publish', 'admin'].filter(function (p) { return can(s.role, p); }) };
  }

  // Educational content: any signed-in user gets the live version; only editors may read the draft.
  route('GET', /^\/api\/content$/, { perm: 'content:read' }, function (req, res, ctx) {
    const want = ctx.url.searchParams.get('version');
    if (want === 'draft') {
      if (!can(ctx.session.role, 'content:edit')) return deny(req, res, 403, 'Only teachers can open the draft.');
      const d = store.draft();
      if (d) return json(req, res, 200, { ok: true, version: 'draft', rev: d.rev, savedAt: d.savedAt, savedBy: d.savedBy, content: d.content });
      return send(req, res, 200, '{"ok":true,"version":"draft","rev":0,"fromLive":true,"content":' + store.published().text + '}', 'application/json; charset=utf-8');
    }
    const p = store.published();
    if (req.headers['if-none-match'] === '"' + p.etag + '"') { headers(res, { ETag: '"' + p.etag + '"', 'Cache-Control': 'private, no-cache' }); res.writeHead(304); return res.end(); }
    send(req, res, 200, '{"ok":true,"version":"live","content":' + p.text + '}', 'application/json; charset=utf-8', { ETag: '"' + p.etag + '"', 'Cache-Control': 'private, no-cache' });
  });
  route('GET', /^\/media\/([a-f0-9]{16,64}\.(?:jpg|png|gif|webp))$/, { perm: 'content:read' }, function (req, res, ctx, m) {
    const f = store.mediaFile(m[1], can(ctx.session.role, 'content:edit'));
    if (!f) return send(req, res, 404, 'Not found', 'text/plain; charset=utf-8');
    // Content-addressed file names: a file never changes, so it can be cached privately for long.
    staticFile(req, res, f, { 'Cache-Control': 'private, max-age=31536000, immutable' });
  });

  /* ----- teacher / admin API ----- */
  route('GET', /^\/api\/admin\/status$/, { perm: 'admin' }, function (req, res) {
    const d = store.draft(), st = store.state();
    json(req, res, 200, { ok: true, draft: d ? { rev: d.rev, savedAt: d.savedAt, savedBy: d.savedBy, restoredFrom: d.restoredFrom || null } : null, published: st.publishes[0] || null, publishes: (st.publishes || []).slice(0, 20), github: { configured: github.configured, repo: github.info.repo, branch: github.info.branch } });
  });
  route('PUT', /^\/api\/admin\/draft$/, { perm: 'draft:write' }, function (req, res, ctx) {
    return body(req, 12e6).then(function (b) {
      const r = store.saveDraft(b.content, b.baseRev | 0, ctx.session, !!b.checkpoint);
      json(req, res, r.ok ? 200 : r.status, r);
    });
  });
  route('DELETE', /^\/api\/admin\/draft$/, { perm: 'draft:write' }, function (req, res, ctx) { json(req, res, 200, store.discardDraft(ctx.session)); });
  route('GET', /^\/api\/admin\/preview$/, { perm: 'publish' }, function (req, res) { json(req, res, 200, Object.assign({ ok: true, github: github.configured }, store.preview())); });
  route('POST', /^\/api\/admin\/publish$/, { perm: 'publish' }, function (req, res, ctx) {
    return body(req, 10e3).then(function (b) { return store.publish(ctx.session, b.message, b.rev | 0, github); }).then(function (r) { json(req, res, r.ok ? 200 : r.status, r); });
  });
  route('GET', /^\/api\/admin\/history$/, { perm: 'admin' }, function (req, res) {
    const local = store.history();
    const remote = github.configured ? github.listContentCommits(30).catch(function (e) { return { error: e.message }; }) : Promise.resolve(null);
    return remote.then(function (commits) { json(req, res, 200, { ok: true, local: local, github: commits }); });
  });
  route('POST', /^\/api\/admin\/history\/restore$/, { perm: 'draft:write' }, function (req, res, ctx) {
    return body(req, 10e3).then(function (b) {
      if (b.commit) {
        if (!github.configured) return deny(req, res, 400, 'GitHub is not configured.');
        return github.contentAt(String(b.commit)).then(function (c) { const r = store.restoreToDraft(c, ctx.session, 'GitHub version ' + String(b.commit).slice(0, 7)); json(req, res, r.ok ? 200 : r.status, r); });
      }
      const c = store.historyContent(String(b.id || ''));
      if (!c) return deny(req, res, 404, 'That version was not found.');
      const r = store.restoreToDraft(c, ctx.session, 'saved version ' + b.id);
      json(req, res, r.ok ? 200 : r.status, r);
    });
  });
  route('POST', /^\/api\/admin\/media$/, { perm: 'media:write' }, function (req, res) {
    return body(req, cfg.maxUploadBytes + 1, true).then(function (buf) { const r = store.saveMedia(buf); json(req, res, r.ok ? 200 : r.status, r); });
  });
  route('GET', /^\/api\/admin\/media$/, { perm: 'admin' }, function (req, res) { json(req, res, 200, { ok: true, files: store.listMedia() }); });

  // The editor code itself is only delivered to teachers.
  route('GET', /^\/admin\/(editor\.js|editor\.css)$/, { perm: 'content:edit', page: true }, function (req, res, ctx, m) { staticFile(req, res, path.join(cfg.root, 'server', 'admin', m[1])); });

  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const token = cookies(req)[COOKIE];
    const ctx = { url: url, token: token, session: auth.getSession(token) };
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i], m = r.re.exec(p);
      if (!m || r.method !== method) continue;
      if (method !== 'GET') {
        if (!sameOrigin(req)) return deny(req, res, 403, 'Cross-site request refused.');
        if (!r.opts.public && (!ctx.session || req.headers['x-csrf-token'] !== ctx.session.csrf)) return deny(req, res, ctx.session ? 403 : 401, ctx.session ? 'Security token missing — reload the page.' : 'Please sign in.');
        if (r.re.source.indexOf('login') >= 0 && !/^application\/json/.test(req.headers['content-type'] || '')) return deny(req, res, 415, 'JSON expected.');
      }
      if (r.opts.perm) {
        if (!ctx.session) return r.opts.page ? send(req, res, 401, 'Sign in required', 'text/plain; charset=utf-8') : deny(req, res, 401, 'Please sign in.');
        if (!can(ctx.session.role, r.opts.perm)) return r.opts.page ? send(req, res, 403, 'Forbidden', 'text/plain; charset=utf-8') : deny(req, res, 403, 'You do not have permission to do this.');
      }
      return Promise.resolve().then(function () { return r.fn(req, res, ctx, m); }).catch(function (e) {
        if (!res.headersSent) deny(req, res, e.status || 500, e.status ? e.message : 'Server error.');
        if (!e.status) console.error(new Date().toISOString(), req.method, p, e && e.stack || e);
      });
    }
    if (p.indexOf('/api/') === 0) return deny(req, res, 404, 'Unknown API.');
    if (method !== 'GET') return send(req, res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
    // Public app shell: code and styles only — no educational content is in these files.
    const rel = p === '/' ? 'index.html' : p.slice(1);
    if (!/^[a-z0-9_-]+\.(html|js|css|svg|png|ico)$/i.test(rel)) return send(req, res, 404, 'Not found', 'text/plain; charset=utf-8');
    staticFile(req, res, path.join(cfg.publicDir, rel));
  }

  const server = http.createServer(handle);
  server.headersTimeout = 30e3;
  return { server: server, auth: auth, store: store, github: github, cfg: cfg };
}

if (require.main === module) {
  const app = createServer();
  if (!app.auth.configured.student) console.warn('WARNING: no student password configured (STUDENT_PASSWORD_HASH). Students cannot sign in.');
  if (!app.auth.configured.admin) console.warn('WARNING: no teacher/admin account configured (ADMIN_PASSWORD_HASH). Nobody can edit.');
  if (!app.github.configured) console.warn('Note: GitHub publishing is not configured; publishing updates this server only.');
  app.server.listen(app.cfg.port, app.cfg.host, function () { console.log('Pathology platform on http://' + app.cfg.host + ':' + app.cfg.port); });
}

module.exports = { createServer: createServer };
