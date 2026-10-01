'use strict';
/* Content storage.
   - Published (live) content: CONTENT_DIR/content.json + CONTENT_DIR/media/  — the files in the Git
     repository, i.e. the single source of truth students see. Each publish also writes the live copy to
     DATA_DIR/live/ (persistent disk), so a server restart without a redeploy keeps the latest version;
     at start-up the newer of the two copies (meta.publishedAt) is used.
   - Draft: DATA_DIR/draft.json — the teacher's work in progress, never shown to students.
   - Uploaded pictures not yet published: DATA_DIR/media/ (served to teachers only).
   - History: DATA_DIR/history/ — draft checkpoints and every published version (Git keeps them too). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateContent, referencedMedia, diffSummary } = require('./validate');

const MAGIC = [
  { type: 'image/jpeg', ext: 'jpg', test: function (b) { return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; } },
  { type: 'image/png', ext: 'png', test: function (b) { return b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); } },
  { type: 'image/gif', ext: 'gif', test: function (b) { return /^GIF8[79]a/.test(b.slice(0, 6).toString('latin1')); } },
  { type: 'image/webp', ext: 'webp', test: function (b) { return b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'; } }
];
const FILE_RE = /^[a-f0-9]{16,64}\.(jpg|png|gif|webp)$/;

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file, d) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return d; } }

function createStore(cfg) {
  const pubFile = path.join(cfg.contentDir, 'content.json');
  const pubMedia = path.join(cfg.contentDir, 'media');
  const draftFile = path.join(cfg.dataDir, 'draft.json');
  const stageMedia = path.join(cfg.dataDir, 'media');
  const histDir = path.join(cfg.dataDir, 'history');
  const liveFile = path.join(cfg.dataDir, 'live', 'content.json');
  const liveMedia = path.join(cfg.dataDir, 'live', 'media');
  const stateFile = path.join(cfg.dataDir, 'state.json');
  fs.mkdirSync(cfg.dataDir, { recursive: true });

  let pubCache = null;
  function published() {
    const a = fs.statSync(pubFile).mtimeMs, b = fs.existsSync(liveFile) ? fs.statSync(liveFile).mtimeMs : 0, key = a + ':' + b;
    if (!pubCache || pubCache.key !== key) {
      let text = fs.readFileSync(pubFile, 'utf8'), json = JSON.parse(text);
      if (b) {
        // The copy on the data disk wins only if it was published later than the repository copy.
        const lt = fs.readFileSync(liveFile, 'utf8'), lj = JSON.parse(lt);
        if (((lj.meta || {}).publishedAt || 0) > ((json.meta || {}).publishedAt || 0)) { text = lt; json = lj; }
      }
      pubCache = { key: key, text: text, json: json, etag: crypto.createHash('sha256').update(text).digest('hex').slice(0, 20) };
    }
    return pubCache;
  }
  function isPublishedMedia(file) { return fs.existsSync(path.join(pubMedia, file)) || fs.existsSync(path.join(liveMedia, file)); }
  function state() { return readJson(stateFile, { publishes: [], lastCheckpoint: 0 }); }
  function setState(s) { writeAtomic(stateFile, JSON.stringify(s, null, 1)); }
  function draft() { return readJson(draftFile, null); }

  function snapshot(kind, content, meta) {
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '_' + kind;
    writeAtomic(path.join(histDir, id + '.json'), JSON.stringify(Object.assign({ id: id, kind: kind, at: Date.now(), content: content }, meta || {})));
    // Keep the newest 60 draft checkpoints; published versions are always kept.
    const drafts = fs.readdirSync(histDir).filter(function (f) { return /_draft\.json$/.test(f); }).sort();
    drafts.slice(0, Math.max(0, drafts.length - 60)).forEach(function (f) { fs.unlinkSync(path.join(histDir, f)); });
    return id;
  }

  function saveDraft(content, baseRev, user, checkpoint) {
    const cur = draft();
    const curRev = cur ? cur.rev : 0;
    if (baseRev !== curRev) return { ok: false, status: 409, error: 'The draft was changed elsewhere (another tab or teacher). Reload to get the latest draft.', rev: curRev };
    const v = validateContent(content, { strict: false });
    if (v.errors.length) return { ok: false, status: 422, error: 'The draft was not saved because some content is invalid.', issues: v.errors };
    const rec = { rev: curRev + 1, savedAt: Date.now(), savedBy: user.name, basePublished: cur ? cur.basePublished : published().etag, content: content };
    writeAtomic(draftFile, JSON.stringify(rec));
    const st = state();
    if (checkpoint || Date.now() - (st.lastCheckpoint || 0) > 10 * 60e3) { snapshot('draft', content, { by: user.name, rev: rec.rev }); st.lastCheckpoint = Date.now(); setState(st); }
    return { ok: true, rev: rec.rev, savedAt: rec.savedAt, warnings: v.warnings };
  }
  function discardDraft(user) {
    const cur = draft();
    if (cur) { snapshot('draft', cur.content, { by: user.name, rev: cur.rev, note: 'before discarding the draft' }); fs.unlinkSync(draftFile); }
    return { ok: true };
  }
  function restoreToDraft(content, user, note) {
    const cur = draft();
    if (cur) snapshot('draft', cur.content, { by: user.name, rev: cur.rev, note: 'before restoring ' + note });
    const v = validateContent(content, { strict: false });
    if (v.errors.length) return { ok: false, status: 422, error: 'That version cannot be restored because it is invalid.', issues: v.errors };
    const rec = { rev: (cur ? cur.rev : 0) + 1, savedAt: Date.now(), savedBy: user.name, basePublished: published().etag, restoredFrom: note, content: content };
    writeAtomic(draftFile, JSON.stringify(rec));
    return { ok: true, rev: rec.rev };
  }
  function history() {
    if (!fs.existsSync(histDir)) return [];
    return fs.readdirSync(histDir).filter(function (f) { return /\.json$/.test(f); }).sort().reverse().slice(0, 100).map(function (f) {
      const j = readJson(path.join(histDir, f), {});
      return { id: j.id, kind: j.kind, at: j.at, by: j.by, rev: j.rev, note: j.note, message: j.message, commit: j.commit };
    });
  }
  function historyContent(id) {
    if (!/^[0-9TZ_a-z-]+$/i.test(id)) return null;
    const j = readJson(path.join(histDir, id + '.json'), null);
    return j && j.content;
  }

  /* ---------- media ---------- */
  function sniff(buf) { return MAGIC.filter(function (m) { return buf.length > 12 && m.test(buf); })[0]; }
  function saveMedia(buf) {
    if (!buf || !buf.length) return { ok: false, status: 400, error: 'Empty file.' };
    if (buf.length > cfg.maxUploadBytes) return { ok: false, status: 413, error: 'The picture is too large (maximum ' + Math.round(cfg.maxUploadBytes / 1048576) + ' MB).' };
    const m = sniff(buf);
    if (!m) return { ok: false, status: 415, error: 'Unsupported file. Use a JPG, PNG, GIF or WebP picture.' };
    const file = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + m.ext;
    const existing = isPublishedMedia(file);
    if (!existing) writeAtomic(path.join(stageMedia, file), buf);
    return { ok: true, file: file, type: m.type, bytes: buf.length, existing: existing };
  }
  function mediaFile(file, includeStaged) {
    if (!FILE_RE.test(file)) return null;
    const p = path.join(pubMedia, file), l = path.join(liveMedia, file);
    if (fs.existsSync(p)) return p;
    if (fs.existsSync(l)) return l;
    const s = path.join(stageMedia, file);
    return includeStaged && fs.existsSync(s) ? s : null;
  }
  function listMedia() {
    const out = [];
    const seen = {};
    [[pubMedia, true], [liveMedia, true], [stageMedia, false]].forEach(function (d) {
      if (!fs.existsSync(d[0])) return;
      fs.readdirSync(d[0]).filter(function (f) { return FILE_RE.test(f); }).forEach(function (f) {
        if (seen[f]) return; seen[f] = 1;
        out.push({ file: f, bytes: fs.statSync(path.join(d[0], f)).size, published: d[1] });
      });
    });
    return out;
  }

  /* ---------- publish ---------- */
  function preview() {
    const d = draft();
    const content = d ? d.content : published().json;
    const v = validateContent(content, { strict: true });
    const missing = referencedMedia(content).filter(function (f) { return !mediaFile(f, true); });
    missing.forEach(function (f) { v.errors.push('Picture file ' + f + ' is missing on the server.'); });
    return { hasDraft: !!d, rev: d ? d.rev : 0, errors: v.errors, warnings: v.warnings, diff: diffSummary(published().json, content), outdatedBase: !!(d && d.basePublished && d.basePublished !== published().etag) };
  }
  let publishing = false;
  function publish(user, message, rev, github) {
    if (publishing) return Promise.resolve({ ok: false, status: 409, error: 'A publish is already in progress. Wait a moment and check the status.' });
    publishing = true;
    return doPublish(user, message, rev, github).then(function (r) { publishing = false; return r; }, function (e) { publishing = false; throw e; });
  }
  function doPublish(user, message, rev, github) {
    const d = draft();
    if (!d) return Promise.resolve({ ok: false, status: 400, error: 'There is no draft to publish.' });
    if (rev !== d.rev) return Promise.resolve({ ok: false, status: 409, error: 'The draft changed after you reviewed it. Review it again before publishing.' });
    const pv = preview();
    if (pv.errors.length) return Promise.resolve({ ok: false, status: 422, error: 'Fix these problems before publishing.', issues: pv.errors });
    const content = JSON.parse(JSON.stringify(d.content));
    content.meta.publishedAt = Date.now();
    const text = JSON.stringify(content, null, 1) + '\n';
    const newMedia = referencedMedia(content).filter(function (f) { return !isPublishedMedia(f); });
    const msg = (String(message || '').trim() || 'Update teaching content').slice(0, 200);
    const files = [{ rel: 'content.json', buffer: Buffer.from(text) }].concat(newMedia.map(function (f) { return { rel: 'media/' + f, buffer: fs.readFileSync(path.join(stageMedia, f)) }; }));
    const remote = github && github.configured ? github.commitFiles(files, msg + '\n\nPublished by ' + user.name + ' from the platform editor.', user) : Promise.resolve(null);
    return remote.then(function (commit) {
      // Only after GitHub accepted the commit does the live copy on this server change.
      fs.mkdirSync(liveMedia, { recursive: true });
      newMedia.forEach(function (f) {
        fs.copyFileSync(path.join(stageMedia, f), path.join(liveMedia, f));
        try { fs.mkdirSync(pubMedia, { recursive: true }); fs.copyFileSync(path.join(stageMedia, f), path.join(pubMedia, f)); } catch (e) { /* read-only app directory: the data-disk copy serves */ }
        fs.unlinkSync(path.join(stageMedia, f));
      });
      writeAtomic(liveFile, text);
      try { writeAtomic(pubFile, text); } catch (e) { /* read-only app directory: the data-disk copy serves */ }
      // Edits saved while the commit was being made stay in the draft; otherwise the draft is now live.
      const cur = draft();
      if (cur && cur.rev === rev) fs.unlinkSync(draftFile);
      const rec = { at: Date.now(), by: user.name, message: msg, commit: commit ? commit.sha : null, url: commit ? commit.url : null, media: newMedia.length };
      snapshot('published', content, { by: user.name, message: msg, commit: rec.commit });
      const st = state(); st.publishes = [rec].concat(st.publishes || []).slice(0, 100); setState(st);
      return { ok: true, publish: rec, github: !!commit };
    }).catch(function (e) {
      return { ok: false, status: 502, error: 'Publishing to GitHub failed — nothing was changed for students. ' + e.message };
    });
  }

  return {
    published: published, draft: draft, saveDraft: saveDraft, discardDraft: discardDraft, restoreToDraft: restoreToDraft,
    history: history, historyContent: historyContent, saveMedia: saveMedia, mediaFile: mediaFile, listMedia: listMedia,
    preview: preview, publish: publish, state: state
  };
}

module.exports = { createStore: createStore };
