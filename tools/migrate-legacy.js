#!/usr/bin/env node
/* One-off migration: the legacy single-file platform (index.html with embedded JSON + base64 pictures)
   → content/content.json (structured, editable content) + content/media/<sha256>.<ext> (pictures).
   Usage: node tools/migrate-legacy.js <legacy-index.html> [outDir=content]
   The legacy file is in Git history (commit 2e8d5c7):  git show 2e8d5c7:index.html > /tmp/legacy.html */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const src = process.argv[2], out = process.argv[3] || path.join(__dirname, '..', 'content');
if (!src) { console.error('usage: node tools/migrate-legacy.js <legacy-index.html> [outDir]'); process.exit(1); }
const html = fs.readFileSync(src, 'utf8');
function jsonTag(id) {
  const open = '<script type="application/json" id="' + id + '">', a = html.indexOf(open);
  if (a < 0) return null;
  const b = html.indexOf('</script>', a);
  return JSON.parse(html.slice(a + open.length, b));
}
const D = jsonTag('cvs-data');
if (!D) throw new Error('No cvs-data block found in ' + src);
Object.assign(D.pics = D.pics || {}, jsonTag('cvs-pics') || {});
const decks = jsonTag('cvs-decks') || {};

fs.mkdirSync(path.join(out, 'media'), { recursive: true });
const media = {};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
function saveDataUri(uri, title) {
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(uri || '');
  if (!m || !EXT[m[1]]) return uri;
  const buf = Buffer.from(m[2], 'base64');
  const file = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + EXT[m[1]];
  fs.writeFileSync(path.join(out, 'media', file), buf);
  if (!media[file]) media[file] = { title: title || '', alt: '', description: '', type: m[1], bytes: buf.length, uploadedAt: 0 };
  return 'media/' + file;
}
Object.keys(D.pics).forEach(function (k) {
  const p = D.pics[k]; if (!p) { delete D.pics[k]; return; }
  p.src = saveDataUri(p.src, p.caption);
  p.alt = p.alt || ''; p.title = p.title || '';
});
Object.keys(decks).forEach(function (n) { (decks[n].slides || []).forEach(function (s) { (s.images || []).forEach(function (im) { im.src = saveDataUri(im.src, im.caption); }); }); });

// Stable option identities: option k (in the original order) gets id "o<k+1>". Grading stores option ids, never positions.
function addOptionIds(x) { if (Array.isArray(x.options) && !x.optionIds) x.optionIds = x.options.map(function (_, k) { return 'o' + (k + 1); }); }
D.questions.forEach(addOptionIds); D.practice.forEach(addOptionIds);
D.checks.forEach(function (c) { if (c.type === 'mcq' || c.type === 'select') addOptionIds(c); });
// Review items get ids so per-student marks ("I knew it") survive reordering.
['facts', 'traps', 'morphology'].forEach(function (k) { (D.review[k] || []).forEach(function (x, i) { if (!x.id) x.id = k.slice(0, 2) + (i + 1); }); });
if (!D.review.review15) D.review.review15 = [];
// Original question order per test, so result files from the old single-file edition (answers stored by position) can still be read.
const order = {}; D.questions.forEach(function (q) { (order[q.test] = order[q.test] || []).push(q.id); });

D.schema = 1;
D.decks = decks;
D.media = media;
D.legacy = { questionOrder: order };
D.meta.edition = 'server';
fs.writeFileSync(path.join(out, 'content.json'), JSON.stringify(D, null, 1) + '\n');
console.log('content.json written; ' + Object.keys(media).length + ' media files; ' + D.questions.length + ' questions, ' + D.practice.length + ' practice, ' + D.checks.length + ' checks.');
