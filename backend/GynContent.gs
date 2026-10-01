/**
 * ==========================================================================
 * GynContent.gs — Learn-content drafts and publishing for the Gynecology Pathology modules (vulva, vagina)
 * Add to the SAME Apps Script project as Code.gs and Gyn.gs (Files → + → Script → "GynContent").
 * ==========================================================================
 * What it adds (teacher-only — every action arrives through Gyn.gs gynTeacher_, i.e. AFTER authed_ has
 * verified a valid TEACHER session of this module; students can never reach these functions):
 *
 *   vulvaAdminContentGet      the teacher's draft of the Learn content (or the last published copy)
 *   vulvaAdminContentSave     save the draft (optimistic concurrency: baseRev must match)
 *   vulvaAdminContentDiscard  throw the draft away (a copy is kept in the history)
 *   vulvaAdminPublish         commit the ENCRYPTED content (+ version.json) to GitHub → GitHub Pages updates
 *   vulvaAdminMediaPut        commit ENCRYPTED pictures to GitHub (one, or up to 40 in one commit; content-addressed names)
 *   vulvaAdminHistory         saved versions on this server + published versions on GitHub
 *   vulvaAdminSnapshot        read one saved version (to restore it into the draft)
 *
 * Privacy
 *  • The site (GitHub Pages) only ever receives ENCRYPTED content and pictures. They are encrypted in the
 *    teacher's browser with the module's content key (CONTENT_KEYS in Code.gs), which the platform releases
 *    only after sign-in. This file never sees the key and never decrypts anything.
 *  • The readable draft and the history live only in this private spreadsheet (sheet GYN_Content).
 *  • Practice and assessment questions are NOT part of this content: they stay in GYN_Questions (Gyn.gs),
 *    so answers never reach a student's browser before submission.
 *
 * GitHub (Script Properties — Project Settings → Script properties; never in code, never sent to a browser):
 *   GITHUB_TOKEN   fine-grained token, this repository only, "Contents: Read and write"
 *   GITHUB_REPO    owner/repository  (e.g. third-year-med/Vulvar-pathology)
 *   GITHUB_BRANCH  branch GitHub Pages publishes from (default: main)
 *   GITHUB_REPO_VAGINA / GITHUB_BRANCH_VAGINA  (optional) a separate repository for the vagina module's site
 *   After adding this file, run gyncAuthorize() once from the editor to grant the external-request permission.
 * ========================================================================== */
var GYNC_SHEET = 'GYN_Content';
var GYNC_COLS = 16;                 // JSON split across 16 cells of ≤45 000 characters (≈720 000 characters per record)
var GYNC_CHUNK = 45000;
var GYNC_HEADERS = ['module', 'kind', 'id', 'rev', 'at', 'by', 'note']
  .concat(Array.from({ length: GYNC_COLS }, function (_, i) { return 'json' + (i + 1); }));
var GYNC_KEEP_DRAFT_SNAPS = 30, GYNC_KEEP_PUBLISHED = 60;
var GYNC_MEDIA_RE = /^content\/media\/[a-f0-9]{32}\.(jpg|png|gif|webp)\.enc$/;
var GYNC_MAX_MEDIA = 12 * 1024 * 1024;

function gynContentAdmin_(module, p, now) {
  switch (p.action) {
    case 'gynAdminContentGet': return gyncGet_(module);
    case 'gynAdminContentSave': return gynLock_(function () { return gyncSave_(module, p, now); });
    case 'gynAdminContentDiscard': return gynLock_(function () { return gyncDiscard_(module, now); });
    case 'gynAdminPublish': return gynLock_(function () { return gyncPublish_(module, p, now); });
    case 'gynAdminMediaPut': return gyncMediaPut_(module, p);
    case 'gynAdminHistory': return gyncHistory_(module);
    case 'gynAdminSnapshot': return gyncSnapshot_(module, p);
    default: return null;
  }
}

/* ---------------- storage ---------------- */
function gyncSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(GYNC_SHEET);
  if (!sh) { sh = ss.insertSheet(GYNC_SHEET); }
  if (sh.getLastRow() === 0) { sh.appendRow(GYNC_HEADERS); sh.setFrozenRows(1); }
  return sh;
}
function gyncRows_(module, kind) {
  var sh = gyncSheet_(), last = sh.getLastRow(); if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, GYNC_HEADERS.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) !== module || (kind && String(vals[i][1]) !== kind)) continue;
    var o = { _row: i + 2 }; GYNC_HEADERS.forEach(function (h, j) { o[h] = vals[i][j]; });
    o.rev = Number(o.rev) || 0; o.at = Number(o.at) || 0; o.id = String(o.id); o.kind = String(o.kind);
    out.push(o);
  }
  return out;
}
function gyncData_(row) { var s = ''; for (var i = 1; i <= GYNC_COLS; i++) s += (row['json' + i] || ''); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }
function gyncRowArray_(rec, data) {
  var s = data === undefined ? '' : JSON.stringify(data);
  if (s.length > GYNC_COLS * GYNC_CHUNK) throw new Error('The content is too large to store (' + s.length + ' characters).');
  var o = { module: rec.module, kind: rec.kind, id: rec.id, rev: rec.rev || 0, at: rec.at || Date.now(), by: rec.by || '', note: String(rec.note || '').slice(0, 300) };
  for (var i = 0; i < GYNC_COLS; i++) o['json' + (i + 1)] = s.slice(i * GYNC_CHUNK, (i + 1) * GYNC_CHUNK);
  return GYNC_HEADERS.map(function (h) { return o[h] === undefined ? '' : o[h]; });
}
function gyncPut_(rec, data) {
  var sh = gyncSheet_(), arr = gyncRowArray_(rec, data);
  var rng;
  if (rec._row) rng = sh.getRange(rec._row, 1, 1, GYNC_HEADERS.length);
  else { var r = sh.getLastRow() + 1; if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1); rng = sh.getRange(r, 1, 1, GYNC_HEADERS.length); rec._row = r; }
  rng.setNumberFormats([GYNC_HEADERS.map(function (h) { return /^(module|kind|id|by|note|json\d+)$/.test(h) ? '@' : 'General'; })]);
  rng.setValues([arr]);
  return rec;
}
function gyncDraft_(module) { var r = gyncRows_(module, 'draft'); return r.length ? r[0] : null; }
function gyncSnap_(module, kind, data, by, note, rev, extra) {
  var id = new Date().toISOString().replace(/[:.]/g, '-') + '_' + randomHex_(3);
  gyncPut_({ module: module, kind: kind, id: id, rev: rev || 0, at: Date.now(), by: by || 'teacher', note: note || (extra ? JSON.stringify(extra) : '') }, data);
  // retention: newest first are kept
  var keep = kind === 'published' ? GYNC_KEEP_PUBLISHED : GYNC_KEEP_DRAFT_SNAPS;
  var all = gyncRows_(module, kind).sort(function (a, b) { return b.at - a.at; });
  var sh = gyncSheet_();
  all.slice(keep).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { sh.deleteRow(row); });
  return id;
}

/* ---------------- validation (structure only; text is free) ---------------- */
function gyncValidate_(c) {
  var errs = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['The content must be an object.'];
  if (!Array.isArray(c.lectures) || !c.lectures.length) errs.push('The content has no lectures.');
  ['meta', 'topics', 'concepts', 'review', 'pics'].forEach(function (k) { if (!c[k] || typeof c[k] !== 'object') errs.push('“' + k + '” is missing.'); });
  if (!Array.isArray(c.checks)) errs.push('The section checks are missing.');
  if (errs.length) return errs;
  if ((c.practice && c.practice.length) || (c.questions && c.questions.length)) errs.push('Practice and assessment questions belong in the question bank, not in the published content (their answers must stay on the server).');
  var ids = {};
  c.lectures.forEach(function (L, li) {
    if (!L || typeof L.num !== 'number' || typeof L.title !== 'string' || !Array.isArray(L.sections)) { errs.push('Lecture ' + (li + 1) + ' is malformed.'); return; }
    L.sections.forEach(function (s) {
      if (!s || !/^[A-Za-z0-9_.:-]{1,64}$/.test(String(s.id)) || typeof s.title !== 'string' || !Array.isArray(s.subs)) { errs.push('A section of lecture ' + L.num + ' is malformed.'); return; }
      if (ids[s.id]) errs.push('Duplicate id ' + s.id + '.'); ids[s.id] = 1;
      s.subs.forEach(function (u) {
        if (!u || !/^[A-Za-z0-9_.:-]{1,64}$/.test(String(u.id)) || typeof u.title !== 'string' || typeof u.md !== 'string') { errs.push('A learning block in section ' + s.id + ' is malformed.'); return; }
        if (ids[u.id]) errs.push('Duplicate id ' + u.id + '.'); ids[u.id] = 1;
      });
    });
  });
  var cids = {};
  c.checks.forEach(function (k) { if (!k || !k.id || cids[k.id]) errs.push('A section check has a missing or duplicate id.'); else cids[k.id] = 1; if (k && !ids[k.sec]) errs.push('Section check ' + k.id + ' points to a section that does not exist.'); });
  Object.keys(c.pics).forEach(function (key) { var p = c.pics[key]; if (p && !/^media\/[a-f0-9]{32}\.(jpg|png|gif|webp)$/.test(String(p.src || ''))) errs.push('Picture ' + key + ' does not point to a library file.'); });
  Object.keys(c.decks || {}).forEach(function (n) { ((c.decks[n] || {}).slides || []).forEach(function (s) { (s.images || []).forEach(function (im) { if (!/^media\/[a-f0-9]{32}\.(jpg|png|gif|webp)$/.test(String(im.src || ''))) errs.push('A slide picture in lecture ' + n + ' does not point to a library file.'); }); }); });
  return errs.slice(0, 30);
}

/* ---------------- GitHub ---------------- */
function gyncGhConfig_(module) {
  // per-module repository first (GITHUB_REPO_VAGINA, …), so each sub-module can publish to its own site
  var pr = PropertiesService.getScriptProperties(), M = String(module || '').split('-')[0].toUpperCase();
  var repo = String(pr.getProperty('GITHUB_REPO_' + M) || pr.getProperty('GITHUB_REPO') || '').trim(), token = pr.getProperty('GITHUB_TOKEN') || '';
  var branch = String(pr.getProperty('GITHUB_BRANCH_' + M) || pr.getProperty('GITHUB_BRANCH') || 'main').trim();
  return { token: token, repo: repo, branch: branch, ok: !!(token && /^[\w.-]+\/[\w.-]+$/.test(repo)) };
}
/** Run this ONCE from the Apps Script editor (select it, press ▶ Run) to grant the "connect to an external
 *  service" permission that publishing needs; it also checks the GitHub settings. It never prints the token. */
function gyncAuthorize() {
  var out = [];
  ['vulva', 'vagina'].forEach(function (m) {
    var cfg = gyncGhConfig_(m);
    if (!cfg.ok) { out.push(m + ': GitHub not configured (GITHUB_TOKEN and GITHUB_REPO' + ' in Script properties).'); return; }
    try { gyncGh_(cfg, 'GET', ''); out.push(m + ': OK — can reach ' + cfg.repo + ' (branch ' + cfg.branch + ').'); }
    catch (e) { out.push(m + ': ' + cfg.repo + ' — ' + (e.status === 404 ? 'not found (check the name, and that the token has access to it)' : e.status === 401 ? 'the token is not valid' : e.message)); }
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}
function gyncGh_(cfg, method, path, body) {
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.repo + path, {
    method: method.toLowerCase(), muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: body ? JSON.stringify(body) : undefined
  });
  var code = res.getResponseCode(), j = null; try { j = JSON.parse(res.getContentText()); } catch (e) { j = null; }
  if (code >= 300) { var err = new Error('GitHub ' + method + ' ' + path.split('?')[0] + ' failed (' + code + ')' + (j && j.message ? ': ' + j.message : '')); err.status = code; throw err; }
  return j;
}
/** One commit with all files; retried once if someone else pushed in between. files: [{ path, base64 }] */
function gyncCommit_(cfg, files, message) {
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var head = gyncGh_(cfg, 'GET', '/git/ref/heads/' + encodeURIComponent(cfg.branch)).object.sha;
      var base = gyncGh_(cfg, 'GET', '/git/commits/' + head).tree.sha;
      var tree = files.map(function (f) { return { path: f.path, mode: '100644', type: 'blob', sha: gyncGh_(cfg, 'POST', '/git/blobs', { content: f.base64, encoding: 'base64' }).sha }; });
      var t = gyncGh_(cfg, 'POST', '/git/trees', { base_tree: base, tree: tree });
      var c = gyncGh_(cfg, 'POST', '/git/commits', { message: message, tree: t.sha, parents: [head], author: { name: 'Pathology platform', email: 'platform@users.noreply.github.com', date: new Date().toISOString() } });
      gyncGh_(cfg, 'PATCH', '/git/refs/heads/' + encodeURIComponent(cfg.branch), { sha: c.sha, force: false });
      return { sha: c.sha, url: 'https://github.com/' + cfg.repo + '/commit/' + c.sha };
    } catch (e) {
      if (attempt === 0 && (e.status === 422 || e.status === 409)) continue;
      throw e;
    }
  }
}

/* ---------------- actions ---------------- */
function gyncInfo_(module) {
  var cfg = gyncGhConfig_(module), key = contentKey_(module);
  var pubs = gyncRows_(module, 'published').sort(function (a, b) { return b.at - a.at; });
  var n = pubs[0] ? gynJ_(pubs[0].note, {}) : {}, last = pubs[0] ? { at: pubs[0].at, by: pubs[0].by, rev: pubs[0].rev, message: n.message || '', commit: n.commit || '', url: n.url || '' } : null;
  return { github: { configured: cfg.ok, repo: cfg.ok ? cfg.repo : '', branch: cfg.branch }, keyOk: /^[A-Za-z0-9+/]{43}=$/.test(String(key || '')), lastPublished: last };
}
function gyncGet_(module) {
  var d = gyncDraft_(module), info = gyncInfo_(module), out = { ok: true, github: info.github, keyOk: info.keyOk, lastPublished: info.lastPublished };
  if (d) { out.draft = { rev: d.rev, at: d.at, by: d.by, note: d.note, content: gyncData_(d) }; return out; }
  var pubs = gyncRows_(module, 'published').sort(function (a, b) { return b.at - a.at; });
  out.draft = null;
  out.live = pubs[0] ? { at: pubs[0].at, content: gyncData_(pubs[0]) } : null;   // the draft starts from the last published version
  return out;
}
function gyncSave_(module, p, now) {
  var d = gyncDraft_(module), cur = d ? d.rev : 0;
  if ((Number(p.baseRev) || 0) !== cur) return { ok: false, code: 'conflict', rev: cur, error: 'The draft was changed elsewhere (another tab or teacher). Reload to get the latest draft.' };
  var errs = gyncValidate_(p.content);
  if (errs.length) return { ok: false, code: 'invalid', issues: errs, error: 'The draft was not saved because some content is invalid.' };
  var rec = d || { module: module, kind: 'draft', id: 'draft' };
  rec.rev = cur + 1; rec.at = now; rec.by = 'teacher'; rec.note = String(p.note || (d && d.note) || '').slice(0, 300);
  gyncPut_(rec, p.content);
  var snaps = gyncRows_(module, 'snapshot');
  var lastSnap = snaps.reduce(function (m, r) { return Math.max(m, r.at); }, 0);
  if (p.checkpoint || now - lastSnap > 10 * 60 * 1000) gyncSnap_(module, 'snapshot', p.content, 'teacher', p.checkpoint ? 'saved by the teacher' : 'automatic', rec.rev);
  return { ok: true, rev: rec.rev, at: now };
}
function gyncDiscard_(module, now) {
  var d = gyncDraft_(module); if (!d) return { ok: true };
  gyncSnap_(module, 'snapshot', gyncData_(d), 'teacher', 'before discarding the draft', d.rev);
  gyncSheet_().deleteRow(d._row);
  gynAudit_(module, 'teacher', 'faculty', 'content draft discarded', '', { rev: d.rev });
  return { ok: true };
}
function gyncPublish_(module, p, now) {
  var cfg = gyncGhConfig_(module);
  if (!cfg.ok) return { ok: false, code: 'nogithub', error: 'Publishing needs GitHub settings in Script Properties (GITHUB_TOKEN, GITHUB_REPO). See SETUP.md.' };
  var d = gyncDraft_(module);
  if (!d) return { ok: false, code: 'nodraft', error: 'There is no draft to publish.' };
  if ((Number(p.rev) || 0) !== d.rev) return { ok: false, code: 'conflict', error: 'The draft changed after you reviewed it. Review it again before publishing.' };
  var content = gyncData_(d), errs = gyncValidate_(content);
  if (errs.length) return { ok: false, code: 'invalid', issues: errs, error: 'Fix these problems before publishing.' };
  var enc = String(p.encrypted || '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(enc) || enc.length < 40) return { ok: false, code: 'badfile', error: 'The encrypted content is missing.' };
  var message = (String(p.message || '').replace(/[\r\n]+/g, ' ').trim() || 'Update teaching content').slice(0, 200);
  var version = { publishedAt: now, rev: d.rev, module: module };
  var commit;
  try {
    commit = gyncCommit_(cfg, [
      { path: 'content/content.enc', base64: enc },
      { path: 'content/version.json', base64: Utilities.base64Encode(JSON.stringify(version)) }
    ], message + '\n\nPublished from the platform editor (' + module + ', draft revision ' + d.rev + ').');
  } catch (e) {
    return { ok: false, code: 'github', error: 'Publishing to GitHub failed — nothing changed for students. ' + (e && e.message || e) };
  }
  gyncSnap_(module, 'published', content, 'teacher', '', d.rev, { message: message, commit: commit.sha, url: commit.url });
  gyncSheet_().deleteRow(d._row);
  gynAudit_(module, 'teacher', 'faculty', 'content published', commit.sha, { rev: d.rev, message: message });
  return { ok: true, commit: commit.sha, url: commit.url, publishedAt: now };
}
function gyncMediaPut_(module, p) {
  var cfg = gyncGhConfig_(module);
  if (!cfg.ok) return { ok: false, code: 'nogithub', error: 'Uploading pictures needs GitHub settings in Script Properties (GITHUB_TOKEN, GITHUB_REPO). See SETUP.md.' };
  // one picture { path, base64 } or several { files: [{ path, base64 }, …] } in ONE commit
  var files = Array.isArray(p.files) ? p.files : [{ path: p.path, base64: p.base64 }], total = 0;
  if (!files.length || files.length > 40) return { ok: false, code: 'badfile', error: 'Send between 1 and 40 pictures at a time.' };
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {}, path = String(f.path || ''), b64 = String(f.base64 || '');
    if (!GYNC_MEDIA_RE.test(path)) return { ok: false, code: 'badpath', error: 'Invalid picture file name.' };
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64) || b64.length < 40) return { ok: false, code: 'badfile', error: 'The picture data is missing.' };
    if (b64.length * 0.75 > GYNC_MAX_MEDIA) return { ok: false, code: 'toolarge', error: 'A picture is too large (maximum 12 MB).' };
    total += b64.length;
  }
  if (total * 0.75 > 30 * 1024 * 1024) return { ok: false, code: 'toolarge', error: 'Too much at once — send fewer pictures per request.' };
  try {
    // content-addressed: files already in the repository are skipped
    var todo = [], existing = [];
    files.forEach(function (f) {
      try { gyncGh_(cfg, 'GET', '/contents/' + f.path + '?ref=' + encodeURIComponent(cfg.branch)); existing.push(f.path); }
      catch (e) { if (e.status !== 404) throw e; todo.push({ path: String(f.path), base64: String(f.base64) }); }
    });
    var c = todo.length ? gyncCommit_(cfg, todo, todo.length === 1 ? 'Add picture ' + todo[0].path.split('/').pop().slice(0, 12) + '… (encrypted)' : 'Add ' + todo.length + ' pictures (encrypted)') : null;
    var out = { ok: true, saved: todo.map(function (f) { return f.path; }), existing: existing, commit: c ? c.sha : '' };
    if (!Array.isArray(p.files)) { out.path = files[0].path; if (existing.length) out.existing = true; }
    return out;
  } catch (e) {
    return { ok: false, code: 'github', error: 'The picture could not be saved to GitHub. ' + (e && e.message || e) };
  }
}
function gyncHistory_(module) {
  var local = gyncRows_(module).filter(function (r) { return r.kind === 'snapshot' || r.kind === 'published'; })
    .sort(function (a, b) { return b.at - a.at; }).slice(0, 100)
    .map(function (r) { var n = r.kind === 'published' ? gynJ_(r.note, {}) : null; return { id: r.id, kind: r.kind, at: r.at, by: r.by, rev: r.rev, note: r.kind === 'published' ? '' : r.note, message: n ? n.message : '', commit: n ? n.commit : '', url: n ? n.url : '' }; });
  var cfg = gyncGhConfig_(module), gh = null;
  if (cfg.ok) {
    try {
      gh = (gyncGh_(cfg, 'GET', '/commits?sha=' + encodeURIComponent(cfg.branch) + '&path=content/content.enc&per_page=30') || []).map(function (c) {
        return { sha: c.sha, message: String(c.commit.message || '').split('\n')[0], date: c.commit.author && c.commit.author.date, url: c.html_url };
      });
    } catch (e) { gh = { error: String(e && e.message || e) }; }
  }
  return { ok: true, local: local, github: gh, repo: cfg.ok ? cfg.repo : '' };
}
function gyncSnapshot_(module, p) {
  var id = String(p.id || ''), rows = gyncRows_(module).filter(function (r) { return r.id === id && (r.kind === 'snapshot' || r.kind === 'published'); });
  if (!rows.length) return { ok: false, code: 'notfound', error: 'That saved version was not found.' };
  return { ok: true, id: id, at: rows[0].at, content: gyncData_(rows[0]) };
}
