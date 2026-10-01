'use strict';
/* Runs the real Apps Script backend files (.gs) inside Node with in-memory stand-ins for the Google services they
   use: SpreadsheetApp (sheets/ranges/text finder), CacheService, LockService, PropertiesService, Utilities,
   ContentService, Session and a synchronous UrlFetchApp whose requests go to an injected handler (e.g. the
   GitHub mock below). doPost(payload) behaves like a POST to the deployed web app. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function signed(buf) { return Array.from(buf, function (b) { return b > 127 ? b - 256 : b; }); }
function unsigned(arr) { return Buffer.from(arr.map(function (b) { return b & 0xff; })); }

function makeSheet(name) {
  const rows = [];
  let maxRows = 1000;
  const sh = {
    getName: function () { return name; },
    getLastRow: function () { return rows.length; },
    getLastColumn: function () { return rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    getMaxRows: function () { return Math.max(maxRows, rows.length); },
    insertRowsAfter: function (after, n) { maxRows = Math.max(maxRows, rows.length) + n; },
    appendRow: function (vals) { rows.push(vals.slice()); },
    setFrozenRows: function () {},
    deleteRow: function (r) { rows.splice(r - 1, 1); },
    getRange: function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getRow: function () { return r; },
        getValues: function () {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); }
          return out;
        },
        setValues: function (vals) {
          for (let i = 0; i < vals.length; i++) {
            while (rows.length < r + i) rows.push([]);
            const row = rows[r - 1 + i];
            for (let j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j];
          }
          return rng;
        },
        setValue: function (v) { return rng.setValues([[v]]); },
        setNumberFormats: function () { return rng; },
        createTextFinder: function (text) {
          const tf = {
            matchEntireCell: function () { return tf; },
            findAll: function () {
              const hits = [];
              for (let i = 0; i < nr; i++) { const row = rows[r - 1 + i] || []; for (let j = 0; j < nc; j++) { if (String(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]) === String(text)) hits.push(sh.getRange(r + i, c + j)); } }
              return hits;
            },
            findNext: function () { return tf.findAll()[0] || null; }
          };
          return tf;
        }
      };
      return rng;
    },
    _rows: rows
  };
  return sh;
}

function createBackend(opts) {
  opts = opts || {};
  const sheets = {};
  const ss = {
    getSheetByName: function (n) { return sheets[n] || null; },
    insertSheet: function (n) { sheets[n] = makeSheet(n); return sheets[n]; },
    getSheets: function () { return Object.keys(sheets).map(function (k) { return sheets[k]; }); },
    deleteSheet: function (sh) { delete sheets[sh.getName()]; }
  };
  const cache = new Map();
  const props = new Map(Object.entries(opts.properties || {}));
  const fetchHandler = opts.fetch || function () { throw new Error('UrlFetchApp: no handler configured'); };
  const g = {
    console: { log: function () {}, error: function () { if (opts.verbose) console.error.apply(console, arguments); }, warn: function () {} },
    Logger: { log: function () {} },
    JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, parseInt: parseInt, isNaN: isNaN,
    SpreadsheetApp: { getActiveSpreadsheet: function () { return ss; }, flush: function () {} },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { return cache.has(k) ? cache.get(k) : null; },
      put: function (k, v) { cache.set(k, String(v)); },
      remove: function (k) { cache.delete(k); },
      removeAll: function (ks) { ks.forEach(function (k) { cache.delete(k); }); }
    }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return props.has(k) ? props.get(k) : null; },
      setProperty: function (k, v) { props.set(k, String(v)); },
      deleteProperty: function (k) { props.delete(k); },
      getProperties: function () { return Object.fromEntries(props); }
    }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: function (alg, value) { return signed(crypto.createHash(alg).update(typeof value === 'string' ? Buffer.from(value, 'utf8') : unsigned(value)).digest()); },
      getUuid: function () { return crypto.randomUUID(); },
      base64Encode: function (v) { return (typeof v === 'string' ? Buffer.from(v, 'utf8') : unsigned(v)).toString('base64'); },
      base64Decode: function (s) { return signed(Buffer.from(String(s), 'base64')); },
      newBlob: function (bytes) { return { getBytes: function () { return bytes; } }; },
      sleep: function () {},
      formatDate: function (d) { return new Date(d).toISOString().slice(11, 16); }
    },
    Session: { getScriptTimeZone: function () { return 'UTC'; } },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: function (s) { const o = { content: s, setMimeType: function () { return o; }, getContent: function () { return s; } }; return o; }
    },
    UrlFetchApp: {
      fetch: function (url, o) {
        o = o || {};
        let body = o.payload;
        if (Array.isArray(body)) body = unsigned(body);
        const res = fetchHandler(url, { method: String(o.method || 'get').toUpperCase(), headers: o.headers || {}, contentType: o.contentType, body: body });
        if (!o.muteHttpExceptions && res.code >= 400) throw new Error('Request failed for ' + url + ' returned code ' + res.code);
        return {
          getResponseCode: function () { return res.code; },
          getContentText: function () { return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body == null ? '' : res.body); },
          getContent: function () { return signed(Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.body || ''))); },
          getAllHeaders: function () { return res.headers || {}; }
        };
      }
    },
    ScriptApp: { getOAuthToken: function () { return 'oauth-test'; } }
  };
  const ctx = vm.createContext(g);
  (opts.files || []).forEach(function (f) { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.basename(f) }); });
  if (opts.after) vm.runInContext(opts.after, ctx);
  return {
    ctx: ctx, sheets: sheets, cache: cache, props: props,
    doPost: function (payload) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent()); },
    eval: function (code) { return vm.runInContext(code, ctx); }
  };
}

/* ---------- a synchronous GitHub mock (Git Data API + contents + commit list) ---------- */
function githubMock(opts) {
  opts = opts || {};
  const state = { head: 'base0000000000000000000000000000000000000', commits: {}, trees: {}, blobs: {}, files: {}, log: [], auth: [], fail: null };
  state.commits[state.head] = { sha: state.head, tree: 'tree0', parents: [], message: 'initial', files: Object.assign({}, opts.initialFiles || {}) };
  let n = 0;
  function id(p) { n++; return (p + n.toString(16)).padEnd(40, '0').slice(0, 40); }
  function json(code, o) { return { code: code, body: JSON.stringify(o), headers: {} }; }
  state.handle = function (url, req) {
    state.auth.push(req.headers.Authorization || req.headers.authorization || '');
    if (state.fail) { const f = state.fail; return json(f.code || 500, { message: f.message || 'mock failure' }); }
    const u = new URL(url), p = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const body = req.body ? JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body) : null;
    if (req.method === 'GET' && /^\/git\/ref\/heads\//.test(p)) return json(200, { object: { sha: state.head } });
    if (req.method === 'GET' && /^\/git\/commits\//.test(p)) { const c = state.commits[p.split('/').pop()]; return c ? json(200, { sha: c.sha, tree: { sha: c.tree } }) : json(404, { message: 'Not Found' }); }
    if (req.method === 'POST' && p === '/git/blobs') { const sha = id('b'); state.blobs[sha] = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'); return json(201, { sha: sha }); }
    if (req.method === 'POST' && p === '/git/trees') { const sha = id('t'); state.trees[sha] = body; return json(201, { sha: sha }); }
    if (req.method === 'POST' && p === '/git/commits') {
      const sha = id('c'), parent = state.commits[body.parents[0]], files = Object.assign({}, parent ? parent.files : {});
      (state.trees[body.tree].tree || []).forEach(function (t) { if (t.sha === null) delete files[t.path]; else files[t.path] = state.blobs[t.sha]; });
      state.commits[sha] = { sha: sha, tree: body.tree, parents: body.parents, message: body.message, author: body.author, files: files, date: new Date().toISOString() };
      return json(201, { sha: sha });
    }
    if (req.method === 'PATCH' && /^\/git\/refs\/heads\//.test(p)) {
      if (state.commits[body.sha].parents[0] !== state.head && !body.force) return json(422, { message: 'Update is not a fast forward' });
      state.head = body.sha; state.log.push(state.commits[body.sha]);
      if (opts.onCommit) opts.onCommit(state.commits[body.sha]);
      return json(200, { object: { sha: body.sha } });
    }
    const cm = /^\/contents\/(.+)$/.exec(p);
    if (req.method === 'GET' && cm) { const f = state.commits[u.searchParams.get('ref') && state.commits[u.searchParams.get('ref')] ? u.searchParams.get('ref') : state.head].files[decodeURIComponent(cm[1])]; return f ? json(200, { sha: 'x', size: f.length }) : json(404, { message: 'Not Found' }); }
    if (req.method === 'GET' && p === '/commits') {
      const wantPath = u.searchParams.get('path'), out = [];
      let c = state.commits[state.head];
      while (c) { const par = state.commits[c.parents[0]]; if (!wantPath || !par || String(c.files[wantPath]) !== String(par.files[wantPath])) if (c.files[wantPath]) out.push({ sha: c.sha, html_url: 'https://github.com/o/r/commit/' + c.sha, commit: { message: c.message, author: { name: (c.author || {}).name || 'x', date: c.date } } }); c = par; }
      return json(200, out);
    }
    return json(404, { message: 'Not Found: ' + req.method + ' ' + p });
  };
  return state;
}

module.exports = { createBackend: createBackend, githubMock: githubMock };
