/* Vulvar Pathology Exam Review — learner app.
   main(D, CX) is started by boot.js after sign-in. D = the educational content delivered by the server
   (live version for students; the draft for teachers who are editing). CX = the server connection:
   { role: 'student' | 'admin', name, api(method, url, body), logout() }.
   Practice progress and results stay in this browser (the shared student login has no personal identity).
   Teacher editing tools live in a separate file (/admin/editor.js) that the server sends to teachers only;
   it plugs in through the HOOKS object below. */
(function () {
'use strict';
function main(D, CX) {
var P = D.meta.storagePrefix + (CX.role === 'admin' ? 't_' : '');
// Extension points used by the teacher editor (absent for students: all no-ops).
var HOOKS = { afterRender: null, contentChanged: null, uploadImage: null, route: null, faculty: null, figTools: null, editing: function () { return false; } };
var APP_VERSION = D.meta.version;
var STORAGE_OK = true;
try { localStorage.setItem(P + '__t', '1'); localStorage.removeItem(P + '__t'); } catch (e) { STORAGE_OK = false; }
var mem = {};
var store = {
  get: function (k, d) { try { var v = STORAGE_OK ? localStorage.getItem(P + k) : mem[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { var s = JSON.stringify(v); try { if (STORAGE_OK) localStorage.setItem(P + k, s); else mem[k] = s; } catch (e) { mem[k] = s; toast('Browser storage is full or blocked — results may not be saved.'); } },
  del: function (k) { try { if (STORAGE_OK) localStorage.removeItem(P + k); delete mem[k]; } catch (e) {} }
};

/* ---------------- helpers ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function toast(msg) { var t = h('<div class="toast" role="status">' + esc(msg) + '</div>'); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
function fmtDate(ts) { if (!ts) return '—'; var d = new Date(ts); return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
function pct(a, b) { return b ? Math.round(1000 * a / b) / 10 : 0; }
function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
var LETTERS = 'ABCDEFG';
function settings() { var s = store.get('settings', {}); var base = {}; Object.keys(D.tests).forEach(function (t) { base[t] = D.tests[t].minutes; }); return { pass: s.pass || 50, minutes: Object.assign(base, s.minutes || {}) }; }
function sha256(text) {
  if (!(window.crypto && crypto.subtle)) return Promise.resolve('nocrypto');
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  });
}
function download(name, text, mime) {
  var blob = new Blob([text], { type: mime || 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function csv(rows) { return '﻿' + rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n;]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

function modal(title, bodyHtml, buttons) {
  var prev = document.activeElement;
  var bg = h('<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3><div class="mbody"></div><div class="row" style="justify-content:flex-end;margin-top:16px"></div></div></div>');
  $('.mbody', bg).innerHTML = bodyHtml;
  var bar = $('.row', bg);
  function close() { bg.remove(); document.removeEventListener('keydown', onk); if (prev && prev.focus) prev.focus(); }
  function onk(e) { if (e.key === 'Escape') close(); }
  (buttons || [{ label: 'Close' }]).forEach(function (b) {
    var el = h('<button class="btn ' + (b.cls || '') + '">' + esc(b.label) + '</button>');
    el.onclick = function () { if (b.busy) { if (el.disabled) return; el.disabled = true; } var r = b.onClick ? b.onClick(bg) : undefined; if (r !== false) close(); else el.disabled = false; };
    bar.appendChild(el);
  });
  bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
  document.addEventListener('keydown', onk);
  document.body.appendChild(bg);
  var f = $('input,button', $('.mbody', bg)) || $('button', bar); if (f) f.focus();
  return { el: bg, close: close };
}
function confirmBox(title, text, okLabel, cb, danger) {
  modal(title, '<p>' + esc(text) + '</p>', [{ label: 'Cancel' }, { label: okLabel, cls: danger ? 'danger' : 'primary', busy: true, onClick: function () { cb(); } }]);
}

/* ---------------- markdown ---------------- */
var LABELS = { 'COURSE + EXAM': 'b-ce', 'COURSE THRESHOLD': 'b-thr', 'COURSE': 'b-c', 'CLARIFICATION': 'b-clar', 'SUPP': 'b-supp' };
var LABEL_TEXT = { 'COURSE + EXAM': '🟢 EXAM ESSENTIAL', 'COURSE THRESHOLD': 'COURSE-SPECIFIC EXAM FACT', 'COURSE': '🔵 COURSE CORE', 'CLARIFICATION': '🟣 CLARIFICATION', 'SUPP': '⚪ SUPPLEMENTARY' };
var LABEL_HELP = { 'COURSE + EXAM': 'Taught in the faculty lecture and examined before', 'COURSE THRESHOLD': 'A faculty number kept for this exam where current definitions differ', 'COURSE': 'Taught in the faculty lecture', 'CLARIFICATION': 'Standard pathology added to prevent a misunderstanding or update a term', 'SUPP': 'Additional note, not assessable' };
function badge(l) { return '<span class="badge ' + LABELS[l] + '" title="' + esc(LABEL_HELP[l]) + '">' + esc(LABEL_TEXT[l]) + '</span>'; }
var STARS = { 3: ['★★★', 'MUST KNOW', 'p3'], 2: ['★★', 'HIGH-YIELD', 'p2'], 1: ['★', 'SUPPORTING', 'p1'] };
function stars(p) { var x = STARS[p]; return x ? '<span class="prio ' + x[2] + '" title="Priority: ' + x[1] + '"><span aria-hidden="true">' + x[0] + '</span> ' + x[1] + '</span>' : ''; }
var SUPP_RE = /^\[SUPP\]\s+(?!—)/;
function suppHtml(t) { return '<details class="supp"><summary>⚪ Additional pathology note <span class="small muted">(supplementary — not assessable)</span></summary><div>' + inl(t.replace(SUPP_RE, '')) + '</div></details>'; }
function inl(s) {
  var t = esc(s);
  t = t.replace(/\[(COURSE \+ EXAM|COURSE THRESHOLD|COURSE|CLARIFICATION|SUPP)\]/g, function (m, l) { return badge(l); });
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  return t;
}
var MICRO = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="10" fill="#e3f3f2"/><path d="M18 10h8v4h-2v10a8 8 0 1 1-4 0V14h-2z" fill="none" stroke="#0e7c7b" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 38h24" stroke="#0f2a4a" stroke-width="2.6" stroke-linecap="round"/><circle cx="22" cy="31" r="3" fill="#0e7c7b"/></svg>';
function figCard(desc) {
  // Picture slot. Identified by its description (e.g. "pic:vu012"), so the same slot shows the same picture in the lecture, questions and slides.
  var key = picKey(desc), p = PICS[key], E = HOOKS.editing();
  var tools = E && HOOKS.figTools ? HOOKS.figTools(key, p) : '';
  var attrs = ' data-pic="' + key + '" data-desc="' + esc(desc) + '"' + (E ? ' tabindex="0"' : '');
  if (p) {
    var al = p.align && p.align !== 'center' ? ' al-' + p.align : '', w = p.width && p.width < 100 && p.align !== 'full' ? ' style="--w:' + (+p.width) + '%"' : '';
    return '<figure class="fig pic' + al + (w ? ' sized' : '') + '"' + attrs + w + '>' + (p.title ? '<div class="fig-t">' + inl(p.title) + '</div>' : '') + '<img src="' + esc(p.src) + '" alt="' + esc(p.alt || p.caption || desc) + '" title="Click to enlarge" loading="lazy"><figcaption class="cap">' + inl(p.caption || desc) + (p.description ? '<div class="small">' + inl(p.description) + '</div>' : '') + (p.credit ? '<div class="small muted">' + inl(p.credit) + '</div>' : '') + '</figcaption>' + tools + '</figure>';
  }
  return '<figure class="fig"' + attrs + '>' + MICRO + '<figcaption class="cap"><b>Image:</b> ' + inl(desc) + (E ? '<div class="small muted">No picture added yet.</div>' : '') + '</figcaption>' + tools + '</figure>';
}
function renderList(items, i, indent) {
  var ordered = items[i].ordered, start = items[i].num;
  var html = ordered ? '<ol' + (start && start !== 1 ? ' start="' + start + '"' : '') + '>' : '<ul>';
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) { var r0 = renderList(items, i, items[i].indent); html += r0[0]; i = r0[1]; continue; }
    html += '<li>' + (SUPP_RE.test(items[i].text) ? suppHtml(items[i].text) : inl(items[i].text)); i++;
    if (i < items.length && items[i].indent > indent) { var r = renderList(items, i, items[i].indent); html += r[0]; i = r[1]; }
    html += '</li>';
  }
  return [html + (ordered ? '</ol>' : '</ul>'), i];
}
function md(src, opts) {
  opts = opts || {};
  var lines = String(src || '').replace(/\r/g, '').split('\n'), i = 0, blocks = [];
  function isList(l) { return /^\s*(- |\d+\. )/.test(l); }
  function isTable(l) { return /^\s*\|/.test(l); }
  while (i < lines.length) {
    var ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    var b0 = blocks.length, l0 = i;
    parseBlock();
    if (blocks.length > b0) { blocks[b0].l0 = l0; blocks[b0].l1 = i; }
  }
  function parseBlock() {
    var ln = lines[i];
    var hm = ln.match(/^(#{2,4}) (.*)$/);
    if (hm) { var lv = Math.min(4, hm[1].length + 1); blocks.push({ t: 'h', html: '<h' + lv + '>' + inl(hm[2]) + '</h' + lv + '>' }); i++; return; }
    if (isTable(ln)) {
      var rows = [];
      while (i < lines.length && isTable(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); })); i++; }
      var hdr = rows.shift(); if (rows.length && rows[0].every(function (c) { return /^:?-{2,}:?$/.test(c); })) rows.shift();
      var th = '<tr>' + hdr.map(function (c) { return '<th>' + inl(c) + '</th>'; }).join('') + '</tr>';
      var tb = rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inl(c) + '</td>'; }).join('') + '</tr>'; }).join('');
      blocks.push({ t: 'table', html: '<div class="tablewrap"><table><thead>' + th + '</thead><tbody>' + tb + '</tbody></table></div>' }); return;
    }
    if (isList(ln)) {
      var items = [];
      while (i < lines.length && lines[i].trim() && (isList(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        var l = lines[i], m = l.match(/^(\s*)(- |(\d+)\. )(.*)$/);
        if (m) items.push({ indent: m[1].length, ordered: !!m[3], num: m[3] ? +m[3] : 0, text: m[4] });
        else if (items.length) items[items.length - 1].text += ' ' + l.trim();
        i++;
      }
      blocks.push({ t: 'list', html: renderList(items, 0, items[0].indent)[0] }); return;
    }
    var buf = [];
    while (i < lines.length && lines[i].trim() && !isList(lines[i]) && !isTable(lines[i]) && !/^#{2,4} /.test(lines[i])) { buf.push(lines[i].trim()); i++; }
    var text = buf.join(' ');
    var im = text.match(/^\*\*Image:\*\*\s*(.*)$/);
    if (im) { blocks.push({ t: 'fig', html: figCard(im[1]) }); return; }
    if (/^\*Source: .*\*$/.test(text)) { blocks.push({ t: 'src', html: '<p class="src">' + inl(text.slice(1, -1)) + '</p>', text: text.slice(1, -1) }); return; }
    if (SUPP_RE.test(text)) { blocks.push({ t: 'supp', html: suppHtml(text) }); return; }
    var cls = /^\*\*HIGH-YIELD FACT/.test(text) ? 'hy' : /^\*\*EXAM TRAPS?:?\*\*/.test(text) ? 'trap' : /^\*\*Remember:?\*\*/.test(text) ? 'rem' : /^\[CLARIFICATION\]/.test(text) ? 'clar' : /^\*\*Why\b/.test(text) ? 'why' : '';
    blocks.push({ t: 'p', cls: cls, html: '<p>' + inl(text) + '</p>', text: text });
  }
  var out = [];
  // opts.lines: tag each top-level block with the source lines it came from (used by the teacher editor).
  function tag(html, a, z) { return opts.lines ? html.replace(/^<([a-z0-9]+)/, '<$1 data-l="' + a + '-' + z + '"') : html; }
  for (var k = 0; k < blocks.length; k++) {
    var b = blocks[k];
    if (opts.noSource && b.t === 'src') continue;
    if (b.t === 'p' && b.cls) {
      var inner = b.html, end = b.l1;
      if ((b.cls === 'trap' || b.cls === 'hy' || b.cls === 'clar' || b.cls === 'rem') && blocks[k + 1] && blocks[k + 1].t === 'list' && /:\*\*$|:$/.test(b.text.trim())) { inner += blocks[k + 1].html; k++; end = blocks[k].l1; }
      out.push(tag('<div class="co ' + (b.cls === 'hy' ? '' : b.cls) + '">' + inner + '</div>', b.l0, end));
    } else out.push(tag(b.html, b.l0, b.l1));
  }
  return '<div class="md">' + out.join('') + '</div>';
}

/* ---------------- data indexes ---------------- */
var SECTIONS, SUBS, ORDER, NUM, QBY, QID, CHECKS_BY_SEC, CHECK_ID, PR, PID, PBY_SUB, PBY_CONCEPT, CONCEPTS, QBY_CONCEPT, SEC_TOPIC, RV;
function reindex() {
  // Lookup tables built from D. Called again by the teacher editor after every structural change.
  // Ids never change; NUM holds the displayed numbers, which follow the current order.
  SECTIONS = {}; SUBS = {}; ORDER = []; NUM = {};
  var sn = 0;
  D.lectures.forEach(function (L) {
    L.sections.forEach(function (s) {
      s.lecture = L.num; SECTIONS[s.id] = s; ORDER.push(s.id); NUM[s.id] = String(++sn);
      s.subs.forEach(function (u, j) { u.section = s.id; u.lecture = L.num; SUBS[u.id] = u; NUM[u.id] = sn + '.' + (j + 1); });
    });
  });
  // Graded questions: QID keeps retired ones (old results still show them); QBY only has the current paper.
  QBY = {}; Object.keys(D.tests).forEach(function (t) { QBY[t] = []; }); QID = {};
  D.questions.forEach(function (q) { QID[q.id] = q; if (!q.retired) (QBY[q.test] = QBY[q.test] || []).push(q); });
  CHECKS_BY_SEC = {}; CHECK_ID = {}; D.checks.forEach(function (c) { CHECK_ID[c.id] = c; (CHECKS_BY_SEC[c.sec] = CHECKS_BY_SEC[c.sec] || []).push(c); });
  PR = D.practice; PID = {}; PBY_SUB = {}; PBY_CONCEPT = {}; CONCEPTS = D.concepts;
  PR.forEach(function (x) { PID[x.id] = x; (PBY_SUB[x.sub] = PBY_SUB[x.sub] || []).push(x); (PBY_CONCEPT[x.concept] = PBY_CONCEPT[x.concept] || []).push(x); });
  QBY_CONCEPT = {}; D.questions.forEach(function (q) { (QBY_CONCEPT[q.concept] = QBY_CONCEPT[q.concept] || []).push(q); });
  SEC_TOPIC = {}; Object.keys(D.topics).forEach(function (k) { D.topics[k].sections.forEach(function (sid) { SEC_TOPIC[sid] = k; }); });
  RV = D.review; ['facts', 'traps', 'comparisons', 'morphology', 'review15'].forEach(function (k) { RV[k] = RV[k] || []; });
  PICS = D.pics || (D.pics = {});
}
function num(id) { return NUM[id] || id; }
function conceptName(k) { return CONCEPTS[k] ? CONCEPTS[k].name : k; }
function conceptLink(k) { var c = CONCEPTS[k]; if (!c) return '#/learn'; var s = c.subs[0] || c.sections[0]; return subLink(s); }
function subLink(id) { if (SECTIONS[id]) return secLink(id); var u = SUBS[id]; return u ? '#/lecture/' + u.lecture + '/' + u.section + '/' + u.id : '#/learn'; }
function subTitle(id) { var u = SUBS[id]; return u ? num(id) + ' ' + u.title : secTitle(id); }
function secTitle(id) { var s = SECTIONS[id]; return s ? num(id) + ' ' + s.title : id; }
function secLink(id) { var s = SECTIONS[id]; return s ? '#/lecture/' + s.lecture + '/' + id : '#/'; }

/* ---------------- routing & shell ---------------- */
var app, navEls = {};
var NAV = [
  ['home', '#/', '🏠', 'Home'], ['learn', '#/learn', '📖', 'Learn'], ['practice', '#/practice', '🧩', 'Practice'],
  ['tests', '#/tests', '📝', 'Assessments'], ['progress', '#/progress', '📊', 'My Progress'], ['review', '#/review', '⚡', 'Last-Minute Review'],
  CX.role === 'admin' ? ['faculty', '#/faculty', '🎓', 'Faculty tools'] : ['faculty', '#/present', '🖥️', 'Present']
];
function shell() {
  var logo = '<svg class="brand-logo" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#0e7c7b"/><path d="M20 10a6 6 0 0 1 6 6c0 3-2 5-4 6.5V26h2a1.6 1.6 0 0 1 0 3.2h-8A1.6 1.6 0 0 1 16 26h2v-3.5c-2-1.5-4-3.5-4-6.5a6 6 0 0 1 6-6z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><circle cx="20" cy="16" r="2.1" fill="#fff"/></svg>';
  document.body.insertBefore(h('<header class="topbar"><div class="topbar-in"><a class="brand" href="#/">' + logo + '<span><div class="brand-t">' + esc(D.meta.short) + '</div></span></a>' +
    '<nav class="nav" aria-label="Main">' + NAV.map(function (n) { return '<a href="' + n[1] + '" data-k="' + n[0] + '"><span class="ico" aria-hidden="true">' + n[2] + '</span><span class="lbl">' + n[3] + '</span></a>'; }).join('') + '</nav>' +
    '<form class="searchbox" role="search"><label class="sr-only" for="gsearch">Search lectures, facts and comparisons</label><input id="gsearch" type="search" placeholder="Search…"></form>' +
    '<div class="userchip"><button class="btn uc" type="button" aria-haspopup="true" aria-expanded="false">👤 <span class="lbl">' + esc(CX.name || (CX.role === 'admin' ? 'Teacher' : 'Student')) + '</span></button><div class="ucm" hidden><button type="button" class="lo">Sign out</button></div></div></div></header>'), document.body.firstChild);
  var uc = $('.userchip .uc'), ucm = $('.userchip .ucm');
  uc.onclick = function (e) { e.stopPropagation(); ucm.hidden = !ucm.hidden; uc.setAttribute('aria-expanded', !ucm.hidden); };
  document.addEventListener('click', function () { ucm.hidden = true; uc.setAttribute('aria-expanded', 'false'); });
  $('.userchip .lo').onclick = function () { if (HOOKS.beforeLogout && HOOKS.beforeLogout() === false) return; CX.logout(); };
  $$('.nav a').forEach(function (a) { navEls[a.dataset.k] = a; });
  $('.searchbox').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#gsearch').value.trim(); if (v.length > 1) location.hash = '#/search/' + encodeURIComponent(v); });
  app = $('#app');
  document.body.appendChild(h('<footer class="footer">' + esc(D.meta.title) + ' · ' + esc(D.meta.author) + ', ' + esc(D.meta.role) + ' · ' + esc(D.meta.dept) + '<br>Content: ' + esc(D.meta.contentNote) + ' Practice progress and results stay in this browser and are not official assessment results. Version ' + esc(APP_VERSION) + '.</footer>'));
}
function setNav(k) { Object.keys(navEls).forEach(function (x) { navEls[x].classList.toggle('active', x === k); if (x === k) navEls[x].setAttribute('aria-current', 'page'); else navEls[x].removeAttribute('aria-current'); }); }
var cleanup = null;
function route() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  $$('.modal-bg').forEach(function (m) { m.remove(); });
  var hsh = decodeURIComponent(location.hash.replace(/^#\/?/, '')), parts = hsh.split('/');
  var v = parts[0] || '';
  window.scrollTo(0, 0);
  app.innerHTML = '';
  if (!STORAGE_OK) app.appendChild(h('<div class="note" style="margin-bottom:14px">This browser is blocking local storage (for example, a private window). You can use everything, but progress and results will be lost when the page closes.</div>'));
  var cur = activeAttempts();
  if (cur.length && v !== 'test') app.appendChild(h('<div class="note noprint" style="margin-bottom:14px">⏱ You have an assessment in progress: <a href="#/test/' + cur[0].test + '">return to ' + esc(D.tests[cur[0].test].title) + '</a>. The timer keeps running.</div>'));
  if (HOOKS.route && HOOKS.route(v, parts)) { setNav('faculty'); }
  else if (v === '' ) { setNav('home'); viewHome(); }
  else if (v === 'learn') { setNav('learn'); viewLearn(); }
  else if (v === 'lecture') { setNav('learn'); viewLecture(+parts[1] || 1, parts[2], parts[3]); touch('Lecture ' + (+parts[1] || 1) + (parts[2] ? ', section ' + parts[2] : ''), location.hash); }
  else if (v === 'practice' || v === 'revision') { setNav('practice'); viewPractice(v === 'revision' ? 'checks' : parts[1], parts.slice(2)); }
  else if (v === 'tests') { setNav('tests'); viewTests(); }
  else if (v === 'test') { setNav('tests'); viewTest(parts[1]); }
  else if (v === 'result') { setNav('progress'); viewResult(parts[1]); }
  else if (v === 'progress' || v === 'results') { setNav('progress'); viewProgress(parts[1]); }
  else if (v === 'review' || v === 'facts') { setNav('review'); viewReview(v === 'facts' ? 'facts' : parts[1]); }
  else if (v === 'faculty') { setNav('faculty'); viewFaculty(); }
  else if (v === 'present') { setNav('faculty'); viewPresentHub(); if (parts[1]) startPresentation(+parts[1], parts[2] === 'edit'); }
  else if (v === 'search') { setNav(''); viewSearch(parts.slice(1).join('/')); }
  else if (v === 'teacher') { setNav('faculty'); viewTeacher(); }
  else { setNav('home'); viewHome(); }
  var h1 = $('h1', app); if (h1) document.title = h1.textContent + ' — ' + D.meta.short;
  if (HOOKS.afterRender) HOOKS.afterRender(v, parts);
}

/* ---------------- progress state ---------------- */
function studied() { return store.get('studied', {}); }
function lectureProgress(n) { var L = D.lectures[n - 1], st = studied(); var done = L.sections.filter(function (s) { return st[s.id]; }).length; return { done: done, total: L.sections.length }; }
function attempts() { return store.get('attempts', []).map(normAttempt).filter(Boolean); }
function activeAttempts() { return Object.keys(D.tests).map(function (t) { return store.get('cur_' + t, null); }).filter(Boolean); }
function bestFor(test) { var a = attempts().filter(function (x) { return x.test === test; }); if (!a.length) return null; return a.reduce(function (b, x) { return x.pct > b.pct ? x : b; }); }
function lastFor(test) { var a = attempts().filter(function (x) { return x.test === test; }); return a.length ? a[a.length - 1] : null; }

/* ---------------- activity, revision queue, priorities ---------------- */
function touch(label, href) { store.set('last', { label: label, href: href, at: Date.now() }); }
var SRS_DAYS = [0, 1, 3, 7, 14, 30];
function srs() { return store.get('srs', {}); }
function recordConcepts(results, source) {
  // results: {concept: true/false}; wrong → due now (box 0); right → next box, later due date
  var S = srs(), now = Date.now();
  Object.keys(results).forEach(function (k) {
    if (!CONCEPTS[k]) return;
    var e = S[k] || { box: 0, n: 0, wrong: 0 };
    e.n++; e.last = now; e.lastOk = !!results[k]; e.src = source || e.src;
    if (results[k]) { if (!S[k]) { return; } e.box = Math.min(SRS_DAYS.length - 1, (e.box || 0) + 1); }
    else { e.box = 0; e.wrong++; }
    e.due = now + SRS_DAYS[e.box] * 86400000;
    S[k] = e;
  });
  store.set('srs', S);
}
function dueConcepts() { var S = srs(), now = Date.now(); return Object.keys(S).filter(function (k) { return S[k].due <= now; }).sort(function (a, b) { return S[a].due - S[b].due; }); }
function latestAttempts() { var latest = {}; attempts().forEach(function (a) { latest[a.test] = a; }); return Object.keys(latest).map(function (t) { return latest[t]; }); }
function combinedByTopic(list) { var by = {}; list.forEach(function (a) { var bt = a.byTopic; Object.keys(bt).forEach(function (k) { by[k] = by[k] || [0, 0]; by[k][0] += bt[k][0]; by[k][1] += bt[k][1]; }); }); return by; }
function priorities(list, n) {
  // Revision priority = topics with missed questions, lowest score first (§18)
  var rows = {};
  list.forEach(function (a) {
    attemptQs(a).forEach(function (q) {
      var r = rows[q.topic] = rows[q.topic] || { topic: q.topic, right: 0, total: 0, missed: [], secs: {}, concepts: {}, attempts: {} };
      r.total++;
      if (isRight(a, q)) r.right++;
      else { r.missed.push(q.id); r.secs[q.section] = 1; r.concepts[q.concept] = 1; r.attempts[a.id] = 1; }
    });
  });
  return Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) { return r.missed.length; })
    .sort(function (a, b) { return a.right / a.total - b.right / b.total || b.missed.length - a.missed.length; }).slice(0, n || 3);
}
function priorityCards(list, n) {
  var P = priorities(list, n), box = h('<div class="prios"></div>');
  if (!P.length) { box.appendChild(h('<p class="muted">No weak topic yet' + (list.length ? ' — every question in your latest attempts was correct.' : '. Take an assessment and your revision priorities will appear here.') + '</p>')); return box; }
  P.forEach(function (r, i) {
    var secs = Object.keys(r.secs).sort();
    box.appendChild(h('<div class="prio-card"><div class="pn">Revision Priority ' + (i + 1) + '</div><h3>' + esc(D.topics[r.topic].name) + '</h3>' +
      '<p class="small"><b>' + r.right + '/' + r.total + '</b> (' + pct(r.right, r.total) + '%) · <b>' + r.missed.length + '</b> missed</p>' +
      '<p class="small">Review: ' + secs.map(function (x) { return '<a href="' + subLink(x) + '">' + esc(subTitle(x)) + '</a>'; }).join('; ') + '</p>' +
      '<div class="row"><a class="btn" href="' + subLink(secs[0]) + '">📖 Review topic</a><a class="btn primary" href="#/practice/retry/' + encodeURIComponent(Object.keys(r.attempts).join(',')) + '/' + r.topic + '">🔁 Retry weak questions</a></div></div>'));
  });
  return box;
}
function nextSection() { var st = studied(); for (var i = 0; i < ORDER.length; i++) if (!st[ORDER[i]] && SECTIONS[ORDER[i]].subs.length + (SECTIONS[ORDER[i]].intro ? 1 : 0)) return ORDER[i]; return null; }
function nextAction() {
  var cur = activeAttempts(); if (cur.length) return ['#/test/' + cur[0].test, 'Resume your ' + D.tests[cur[0].test].title, 'The timer is still running.'];
  var due = dueConcepts();
  if (due.length && attempts().length) return ['#/progress/queue', 'Revise ' + due.length + ' concept(s) due for revision', 'Short targeted practice on what you missed.'];
  for (var i = 0; i < D.lectures.length; i++) {
    var p = lectureProgress(i + 1);
    if (p.done < p.total) { var ns = nextSection(); return [secLink(ns), 'Continue learning: ' + secTitle(ns), p.done + ' of ' + p.total + ' ' + D.lectures[i].title + ' sections studied.']; }
  }
  var testKeys = Object.keys(D.tests);
  for (var j = 0; j < testKeys.length; j++) {
    var tk = testKeys[j];
    if (!lastFor(tk)) return ['#/test/' + tk, 'Take the ' + D.tests[tk].title, (QBY[tk] || []).length + ' SBAs, ' + settings().minutes[tk] + ' minutes.'];
  }
  var P = priorities(latestAttempts(), 1);
  if (P.length) return ['#/practice/retry/' + encodeURIComponent(Object.keys(P[0].attempts).join(',')) + '/' + P[0].topic, 'Retry your weak questions: ' + D.topics[P[0].topic].name, 'Your lowest-scoring topic in the latest attempts.'];
  return ['#/review', 'Last-minute review', 'Key facts, comparisons, traps and the 15-minute review.'];
}

/* ---------------- HOME ---------------- */
function viewHome() {
  var na = nextAction(), last = store.get('last', null);
  app.appendChild(h('<section class="hero"><div style="flex:1;min-width:260px"><div class="pill" style="background:rgba(255,255,255,.18);color:#fff">' + esc(D.meta.audience) + ' · Exam review</div><h1>' + esc(D.meta.title) + '</h1>' +
    '<p class="goal"><b>Goal:</b> master the examinable ' + esc(D.meta.subject) + ' concepts from the faculty lectures, practise at exam level, find your weak topics and fix them before the exam.</p>' +
    '<p class="who">' + esc(D.meta.author) + ' · ' + esc(D.meta.role) + ' · ' + esc(D.meta.dept) + '</p></div>' +
    '<div class="next-box"><div class="small" style="opacity:.85">Next recommended action</div><a class="btn primary" style="font-size:16px;padding:12px 18px;margin-top:6px" href="' + na[0] + '">' + esc(na[1]) + ' →</a><div class="small" style="margin-top:6px;opacity:.85">' + esc(na[2]) + '</div></div></section>'));
  var cyc = [['LEARN', '#/learn'], ['PRACTICE', '#/practice'], ['ASSESS', '#/tests'], ['ANALYZE', '#/progress'], ['TARGETED REVISION', '#/progress/queue'], ['RETRY', '#/practice/mistakes']];
  app.appendChild(h('<nav class="cycle" aria-label="Learning cycle">' + cyc.map(function (c, i) { return '<a href="' + c[1] + '">' + (i ? '<span class="arr" aria-hidden="true">→</span>' : '') + '<b>' + c[0] + '</b></a>'; }).join('') + '</nav>'));
  var g = h('<div class="grid g2" style="margin-top:14px"></div>');
  var ns = nextSection();
  g.appendChild(h('<div class="card"><h2 style="margin-top:0">📖 Continue learning</h2>' +
    D.lectures.map(function (L, i) { var pp = lectureProgress(i + 1); return '<div class="row small" style="margin:6px 0"><a href="#/lecture/' + L.num + '" style="min-width:90px"><b>' + esc(L.title) + '</b></a><span class="progress" style="flex:1" role="img" aria-label="' + pct(pp.done, pp.total) + '% studied"><i style="width:' + pct(pp.done, pp.total) + '%"></i></span><span>' + pp.done + '/' + pp.total + '</span></div>'; }).join('') +
    (ns ? '<a class="btn" href="' + secLink(ns) + '">Next: ' + esc(secTitle(ns)) + ' →</a>' : '<p class="small">✓ Every section is marked as studied.</p>') + '</div>'));
  g.appendChild(h('<div class="card"><h2 style="margin-top:0">📝 Assessments</h2><table class="data"><tbody>' + Object.keys(D.tests).map(function (t) { var l = lastFor(t), b = bestFor(t); return '<tr><td><a href="#/test/' + t + '">' + esc(D.tests[t].title) + '</a></td><td>' + (l ? 'Last <b>' + l.pct + '%</b> · best ' + b.pct + '%' : '<span class="muted">Not attempted</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>'));
  app.appendChild(g);
  var pr = h('<div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">🎯 Top 3 revision priorities</h2><div class="spacer"></div><a class="small" href="#/progress">All results →</a></div><p class="small muted" style="margin:4px 0 10px">From your latest attempt at each assessment.</p></div>');
  pr.appendChild(priorityCards(latestAttempts(), 3)); app.appendChild(pr);
  var due = dueConcepts();
  app.appendChild(h('<div class="grid g2" style="margin-top:16px"><div class="card"><h2 style="margin-top:0">🔁 Due for revision</h2><p>' + (due.length ? '<b>' + due.length + '</b> concept(s) are due. <a href="#/progress/queue">Open the revision queue →</a>' : 'Nothing is due. Concepts you miss in practice or assessments are added automatically.') + '</p></div>' +
    '<div class="card"><h2 style="margin-top:0">🕒 Last activity</h2><p>' + (last ? '<a href="' + esc(last.href) + '">' + esc(last.label) + '</a> <span class="small muted">· ' + fmtDate(last.at) + '</span>' : 'No activity recorded in this browser yet.') + '</p></div></div>'));
  app.appendChild(h('<div class="card" style="margin-top:16px"><h2 style="margin-top:0">How to read the lectures</h2><div class="grid g2"><div><p>' + badge('COURSE + EXAM') + ' Taught in a faculty lecture <b>and</b> examined before.</p><p>' + badge('COURSE') + ' Taught in the faculty lecture.</p><p>' + badge('CLARIFICATION') + ' Standard pathology added only to prevent a misunderstanding or update a term.</p><p>' + badge('SUPP') + ' An additional note, collapsed and not assessable.</p><p>' + badge('COURSE THRESHOLD') + ' A faculty number kept for this exam where current definitions differ.</p></div>' +
    '<div><p>' + stars(3) + ' — the core of the exam</p><p>' + stars(2) + ' — frequently examined</p><p>' + stars(1) + ' — supporting detail</p><div class="md"><div class="co trap"><p><strong>EXAM TRAP</strong> — kept only for genuine confusions.</p></div><div class="co rem"><p><strong>Remember</strong> — how a point was asked before.</p></div></div></div></div></div>'));
}
function viewLearn() {
  app.appendChild(h('<h1>Learn</h1>'));
  app.appendChild(h('<p class="muted">One learning block per examinable concept. Each block has a priority, a label, and a <b>Test yourself</b> question. Each section ends with a section check.</p>'));
  var g = h('<div class="grid g2"></div>');
  D.lectures.forEach(function (L) {
    var pg = lectureProgress(L.num), must = 0, n = 0;
    L.sections.forEach(function (s) { s.subs.forEach(function (u) { n++; if (u.priority === 3) must++; }); });
    g.appendChild(h('<a class="card step" href="#/lecture/' + L.num + '"><div class="n">' + L.num + '</div><div style="flex:1"><h2 style="margin:0 0 4px">Lecture ' + L.num + '</h2><p style="margin:0">' + esc(L.title) + '</p><p class="small muted" style="margin:6px 0">' + L.sections.length + ' sections · ' + n + ' learning blocks · ' + must + ' marked ★★★ MUST KNOW</p><span class="progress" role="img" aria-label="' + pct(pg.done, pg.total) + '% studied"><i style="width:' + pct(pg.done, pg.total) + '%"></i></span><p class="small" style="margin:4px 0 0"><b>' + pg.done + '/' + pg.total + '</b> sections studied</p></div></a>'));
  });
  app.appendChild(g);
}

/* ---------------- LECTURE ---------------- */
var searchHighlight = null;
function viewLecture(n, target, sub2) {
  var L = D.lectures[n - 1]; if (!L) { location.hash = '#/'; return; }
  var st = studied(), prog = lectureProgress(n);
  var wrap = h('<div class="lec"></div>');
  var toc = h('<aside class="card toc" aria-label="Contents"><h4>Lecture ' + n + '</h4><div class="progress" aria-label="Progress"><i style="width:' + pct(prog.done, prog.total) + '%"></i></div><p class="small muted" style="margin:6px 0 10px">' + prog.done + ' of ' + prog.total + ' sections studied</p><ol></ol></aside>');
  var ol = $('ol', toc);
  L.sections.forEach(function (s) {
    ol.appendChild(h('<li><a href="#/lecture/' + n + '/' + s.id + '"><b>' + num(s.id) + '</b> ' + esc(s.title) + (st[s.id] ? '<span class="tick" aria-label="studied">✓</span>' : '') + '</a></li>'));
    s.subs.forEach(function (u) { ol.appendChild(h('<li class="sub"><a href="#/lecture/' + n + '/' + s.id + '/' + u.id + '">' + num(u.id) + ' ' + esc(u.title) + (u.priority === 3 ? ' <span class="tstar" title="MUST KNOW">★★★</span>' : '') + '</a></li>')); });
  });
  var main = h('<div></div>');
  var E = HOOKS.editing();
  main.appendChild(h('<div class="card lec-head" data-lec="' + n + '"><div class="row"><div><div class="pill">Lecture ' + n + '</div><h1 style="margin-top:6px">' + esc(L.title) + '</h1></div><div class="spacer"></div><div class="row noprint"><button class="btn" data-a="expand">Expand all</button><button class="btn" data-a="collapse">Collapse all</button><button class="btn" data-a="print">🖨 Print</button><a class="btn navy" href="#/present/' + n + '">🖥️ Present</a></div></div>' +
    (L.intro ? '<details class="sub" style="margin-bottom:0"><summary>How to use this lecture</summary><div class="body">' + md(L.intro.intro, { lines: E }) + '</div></details>' : '') + '</div>'));
  L.sections.forEach(function (s) {
    var sec = h('<section class="card sec" id="s-' + s.id + '" data-sec="' + esc(s.id) + '"><h2><span class="num">' + num(s.id) + '</span>' + esc(s.title) + (s.priority ? ' ' + stars(s.priority) : '') + '</h2></section>');
    if (s.intro) { var si = h(md(s.intro, { imgQuery: s.title, lines: E })); si.setAttribute('data-intro', s.id); sec.appendChild(si); }
    if (!s.subs.length && PBY_SUB[s.id]) sec.appendChild(testYourself(s.id));
    if (!s.subs.length && (CHECKS_BY_SEC[s.id] || []).length) sec.appendChild(challengeBox(CHECKS_BY_SEC[s.id]));
    s.subs.forEach(function (u) {
      var d = h('<details class="sub" open id="u-' + u.id + '" data-sub="' + esc(u.id) + '"><summary><span class="sid">' + num(u.id) + '</span><span class="st">' + esc(u.title) + '</span><span class="tags">' + stars(u.priority) + (u.label ? badge(u.label) : badge('COURSE')) + '</span></summary><div class="body"></div></details>');
      $('.body', d).innerHTML = md(u.md, { imgQuery: u.title, lines: E });
      if (PBY_SUB[u.id]) $('.body', d).appendChild(testYourself(u.id));
      if ((CHECKS_BY_SEC[u.id] || []).length) $('.body', d).appendChild(challengeBox(CHECKS_BY_SEC[u.id]));
      sec.appendChild(d);
    });
    var done = !!st[s.id];
    var mb = h('<div class="row noprint" style="margin-top:14px"><button class="btn ' + (done ? '' : 'primary') + '">' + (done ? '✓ Studied — click to undo' : 'Mark section ' + num(s.id) + ' as studied') + '</button>' + nextLink(n, s.id) + '</div>');
    $('button', mb).onclick = function () { var x = studied(); x[s.id] = !x[s.id]; store.set('studied', x); route(); setTimeout(function () { var e = document.getElementById('s-' + s.id); if (e) e.scrollIntoView({ behavior: 'instant', block: 'start' }); }, 0); };
    sec.appendChild(mb);
    main.appendChild(sec);
  });
  if (n === D.lectures.length) { var tk0 = Object.keys(D.tests)[0]; main.appendChild(h('<div class="card"><h2 style="margin-top:0">⭐ Finished all the teaching sections?</h2><p>Take the <a href="#/test/' + tk0 + '">' + esc(D.tests[tk0].title) + '</a>, then finish with the <a href="#/review">Last-Minute Review</a> (key facts as active recall, plus traps and the 15-minute review).</p></div>')); }
  wrap.appendChild(toc); wrap.appendChild(main); app.appendChild(wrap);
  $('[data-a=expand]', main).onclick = function () { $$('details.sub', main).forEach(function (d) { d.open = true; }); };
  $('[data-a=collapse]', main).onclick = function () { $$('details.sub', main).forEach(function (d) { d.open = false; }); };
  $('[data-a=print]', main).onclick = function () { $$('details.sub', main).forEach(function (d) { d.open = true; }); window.print(); };
  if (searchHighlight) { highlight(main, searchHighlight); searchHighlight = null; }
  var tgt = sub2 ? document.getElementById('u-' + sub2) : target ? document.getElementById('s-' + target) : null;
  if (tgt) { if (tgt.tagName === 'DETAILS') tgt.open = true; setTimeout(function () { tgt.scrollIntoView({ behavior: 'instant', block: 'start' }); }, 0); }
}
function nextLink(n, id) {
  var i = ORDER.indexOf(id), nx = ORDER[i + 1];
  if (!nx) { var tk1 = Object.keys(D.tests)[0]; return '<a class="btn primary" href="#/test/' + tk1 + '">Next: ' + esc(D.tests[tk1].title) + ' →</a>'; }
  return '<a class="btn ghost" href="' + secLink(nx) + '">Next: ' + esc(secTitle(nx)) + ' →</a>';
}
function highlight(root, q) {
  var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
  while (walker.nextNode()) { if (re.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode); re.lastIndex = 0; }
  nodes.forEach(function (tn) { var span = document.createElement('span'); span.innerHTML = esc(tn.nodeValue).replace(re, '<mark>$1</mark>'); tn.parentNode.replaceChild(span, tn); });
}

/* ---------------- SEARCH ---------------- */
function plain(s) { return String(s).replace(/\*\*|\*|\||#/g, ' ').replace(/\s+/g, ' '); }
function viewSearch(q) {
  $('#gsearch').value = q;
  var ql = q.toLowerCase(), hits = [];
  function add(kind, where, title, text, href, sub) {
    var t = plain(text), idx = t.toLowerCase().indexOf(ql), inTitle = plain(title).toLowerCase().indexOf(ql) >= 0;
    if (idx >= 0 || inTitle) hits.push({ kind: kind, where: where, title: title, href: href, hl: sub, snip: idx >= 0 ? t.slice(Math.max(0, idx - 70), idx + ql.length + 90) : t.slice(0, 150) });
  }
  function topicOf(sec) { var k = SEC_TOPIC[sec] || SEC_TOPIC[String(sec).split('.').slice(0, 2).join('.')]; return k ? D.topics[k].name : ''; }
  D.lectures.forEach(function (L) {
    L.sections.forEach(function (s) {
      add('Lecture', 'Lecture ' + L.num + ' · Section ' + num(s.id) + (topicOf(s.id) ? ' · ' + topicOf(s.id) : ''), num(s.id) + ' ' + s.title, s.intro || '', secLink(s.id), true);
      s.subs.forEach(function (u) { add('Lecture', 'Lecture ' + L.num + ' · Section ' + num(s.id) + (topicOf(s.id) ? ' · ' + topicOf(s.id) : ''), num(u.id) + ' ' + u.title, u.md, subLink(u.id), true); });
    });
  });
  RV.facts.forEach(function (f, i) { add('Fact', 'Key fact · ' + subTitle(f.sub), 'Fact ' + (i + 1) + ': ' + f.q, f.a + ' ' + f.why, '#/review/facts'); });
  RV.comparisons.forEach(function (c) { add('Comparison', 'Comparisons · ' + subTitle(c.sub), c.title, c.md, '#/review/compare'); });
  RV.morphology.forEach(function (m) { add('Morphology', 'Morphology · ' + subTitle(m.sub), m.finding, m.dx + ' ' + m.how, '#/review/morph'); });
  RV.traps.forEach(function (t) { add('Exam trap', 'Exam traps · ' + subTitle(t.sub), t.trap, t.remember, '#/review/traps'); });
  app.appendChild(h('<h1>Search: “' + esc(q) + '”</h1>'));
  var kinds = {}; hits.forEach(function (x) { kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
  app.appendChild(h('<p class="muted">' + hits.length + ' result(s)' + (hits.length ? ': ' + Object.keys(kinds).map(function (k) { return kinds[k] + ' ' + k.toLowerCase() + (kinds[k] > 1 ? 's' : ''); }).join(', ') : '') + '. Searched the lectures, key facts, comparisons, morphology associations and exam traps.</p>'));
  var list = h('<div class="grid"></div>'), re = new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  hits.forEach(function (x) {
    var a = h('<a class="card" style="text-decoration:none;color:inherit" href="' + x.href + '"><div class="small muted"><span class="pill">' + esc(x.kind) + '</span> ' + esc(x.where) + '</div><b style="color:var(--navy)">' + esc(plain(x.title)) + '</b><div class="small">…' + esc(x.snip).replace(re, '<mark>$1</mark>') + '…</div></a>');
    if (x.hl) a.addEventListener('click', function () { searchHighlight = q; });
    list.appendChild(a);
  });
  if (!hits.length) list.appendChild(h('<div class="card">Nothing found. Try a shorter word (for example “Kawasaki”, “troponin”, “Aschoff”).</div>'));
  app.appendChild(list);
}

/* ---------------- SECTION CHECKS ---------------- */
function checkState() { return store.get('checks', {}); }
function saveCheck(id, ok) { var s = checkState(); s[id] = { ok: ok, at: Date.now() }; store.set('checks', s); }
function shuffleIdx(n, seed) { var a = []; for (var i = 0; i < n; i++) a.push(i); var x = 0; for (var j = 0; j < seed.length; j++) x = (x * 31 + seed.charCodeAt(j)) >>> 0; for (var k = n - 1; k > 0; k--) { x = (x * 1103515245 + 12345) >>> 0; var r = x % (k + 1); var t = a[k]; a[k] = a[r]; a[r] = t; } return a; }
var TYPE_NAMES = { tf: 'True / False', fill: 'Fill in the blanks', match: 'Matching', sort: 'Sort into groups', select: 'Select all that apply', mcq: 'Single best answer' };
function challengeBox(cks) {
  var box = h('<div style="margin-top:14px"><h3 style="margin:0 0 4px;font-size:17px">🧩 Pathology Challenge</h3><p class="small muted" style="margin:0">Quick self-test — not scored for the teacher.</p></div>');
  cks.forEach(function (c) { box.appendChild(renderCheck(c)); });
  return box;
}
function renderCheck(c) {
  var prev = checkState()[c.id];
  var box = h('<div class="check" id="c-' + slug(c.id) + '" data-qid="' + esc(c.id) + '" data-bank="checks"><div class="hd"><b>' + esc(c.id) + '</b> · ' + TYPE_NAMES[c.type] + (prev ? ' · <span class="pill ' + (prev.ok ? 'good' : 'bad') + '">' + (prev.ok ? 'answered correctly before' : 'try again') + '</span>' : '') + '</div><div class="qb"></div><div class="row" style="margin-top:10px"><button class="btn primary chk">Check answer</button><button class="btn ghost rst">Reset</button></div><div class="fbx"></div></div>');
  var qb = $('.qb', box), fbx = $('.fbx', box), sel = [];
  function feedback(ok, extra) {
    saveCheck(c.id, ok);
    fbx.innerHTML = '<div class="fb ' + (ok ? 'good' : 'bad') + '"><span class="mark">' + (ok ? '✓ Correct.' : '✗ Not quite.') + '</span> ' + (extra || '') + ' ' + inl(c.expl) + ' <span class="small muted">(' + esc(c.ref) + ')</span></div>';
  }
  if (c.type === 'tf' || c.type === 'mcq' || c.type === 'select') {
    var opts = c.type === 'tf' ? ['True', 'False'] : c.options;
    qb.innerHTML = '<p style="margin:.2em 0"><b>' + inl(c.q) + '</b></p><div class="opts" role="' + (c.type === 'select' ? 'group' : 'radiogroup') + '"></div>';
    var og = $('.opts', qb);
    opts.forEach(function (o, i) {
      var b = h('<button class="opt" type="button" aria-pressed="false"><span class="L">' + (c.type === 'tf' ? (i ? 'F' : 'T') : LETTERS[i]) + '</span><span>' + inl(o) + '</span></button>');
      b.onclick = function () {
        if (box.dataset.done) return;
        if (c.type === 'select') { var k = sel.indexOf(i); if (k >= 0) sel.splice(k, 1); else sel.push(i); }
        else sel = [i];
        $$('.opt', og).forEach(function (x, j) { var on = sel.indexOf(j) >= 0; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on); });
      };
      og.appendChild(b);
    });
    $('.chk', box).onclick = function () {
      if (!sel.length) { toast('Choose an answer first.'); return; }
      var right = c.type === 'tf' ? [c.answer ? 0 : 1] : c.type === 'mcq' ? [c.answer] : c.answer;
      var ok = sel.length === right.length && sel.every(function (x) { return right.indexOf(x) >= 0; });
      $$('.opt', og).forEach(function (x, j) { x.classList.remove('sel'); if (right.indexOf(j) >= 0) x.classList.add('right'); else if (sel.indexOf(j) >= 0) x.classList.add('wrong'); x.disabled = true; });
      box.dataset.done = 1; feedback(ok, ok ? '' : 'Correct: ' + right.map(function (r) { return c.type === 'tf' ? (r ? 'False' : 'True') : LETTERS[r]; }).join(', ') + '.');
    };
  } else if (c.type === 'fill') {
    var n = 0;
    qb.innerHTML = '<p style="line-height:2.1">' + inl(c.q).replace(/\[ blank \]/g, function () { var i = n++; return '<label class="sr-only" for="' + slug(c.id) + '-b' + i + '">Blank ' + (i + 1) + '</label><input class="blank" id="' + slug(c.id) + '-b' + i + '" autocomplete="off">'; }) + '</p>';
    $('.chk', box).onclick = function () {
      var ins = $$('input', qb), allOk = true;
      ins.forEach(function (inp, i) {
        var v = inp.value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, '');
        var ok = c.answers[i].some(function (a) { return a.toLowerCase() === v; });
        inp.classList.remove('ok', 'no'); inp.classList.add(ok ? 'ok' : 'no'); if (!ok) allOk = false;
      });
      feedback(allOk, allOk ? '' : 'Expected: ' + c.answers.map(function (a) { return a[0]; }).join('; ') + '.');
    };
  } else if (c.type === 'match' || c.type === 'sort') {
    var left = c.type === 'match' ? c.left : c.items.map(function (x) { return x[0]; });
    var right = c.type === 'match' ? c.right : c.groups;
    var key = c.type === 'match' ? c.key : c.items.map(function (x) { return x[1]; });
    qb.innerHTML = '<p style="margin:.2em 0"><b>' + inl(c.q) + '</b></p>';
    var order = c.type === 'match' ? right.map(function (_, i) { return i; }) : right.map(function (_, i) { return i; });
    left.forEach(function (l, i) {
      var id = slug(c.id) + '-m' + i;
      qb.appendChild(h('<div class="matchrow"><label for="' + id + '">' + (i + 1) + '. ' + inl(l) + '</label><select id="' + id + '"><option value="">— choose —</option>' + order.map(function (j) { return '<option value="' + j + '">' + (c.type === 'match' ? LETTERS[j].toLowerCase() + '. ' : '') + esc(right[j]) + '</option>'; }).join('') + '</select></div>'));
    });
    $('.chk', box).onclick = function () {
      var rows = $$('.matchrow', qb), allOk = true, miss = false;
      rows.forEach(function (r, i) { var v = $('select', r).value; if (v === '') miss = true; var ok = v !== '' && +v === key[i]; r.classList.remove('ok', 'no'); r.classList.add(ok ? 'ok' : 'no'); if (!ok) allOk = false; });
      if (miss && !allOk) { toast('Some rows are still empty.'); }
      feedback(allOk, allOk ? '' : 'Answer: ' + left.map(function (l, i) { return (i + 1) + '–' + (c.type === 'match' ? LETTERS[key[i]].toLowerCase() : right[key[i]]); }).join(', ') + '.');
    };
  }
  $('.rst', box).onclick = function () { var nb = renderCheck(c); box.replaceWith(nb); };
  return box;
}

/* ---------------- PRACTICE (formative SBAs, retry, section checks) ---------------- */
function pstate() { return store.get('pstate', {}); }
function itemStemHtml(x) {
  if (Array.isArray(x.stem)) return stemHtml(x);
  return '<p>' + inl(x.stem) + '</p>' + (x.image ? figCard(x.image) : '');
}
function itemRef(x) { return x.ref || x.source || ''; }
function itemSec(x) { return x.sub || x.section || (x.sections && x.sections[0]); }
function sbaCard(x, onDone, opts) {
  opts = opts || {};
  var isQ = !!x.test, prev = !isQ && pstate()[x.id];
  var el = h('<div class="sba" data-qid="' + esc(x.id) + '" data-bank="' + (isQ ? 'questions' : 'practice') + '"><div class="row small muted"><b style="color:var(--navy)">' + esc(isQ ? (x.code + ' · from ' + D.tests[x.test].title) : 'Practice ' + x.id) + '</b>' +
    (x.previousExam ? '<span class="pill">previous-exam concept</span>' : '') + (opts.newItem ? '<span class="pill good">new question</span>' : '') +
    (prev ? '<span class="pill ' + (prev.ok ? 'good' : 'bad') + '">' + (prev.ok ? 'correct last time' : 'missed last time') + '</span>' : '') +
    '</div><div class="stem md">' + itemStemHtml(x) + '</div><div class="opts" role="radiogroup" aria-label="Options"></div><div class="row"><button class="btn primary chk" type="button">Check answer</button></div><div class="fbx" aria-live="polite"></div></div>');
  var og = $('.opts', el), sel = null, done = false;
  x.options.forEach(function (o, i) {
    var b = h('<button class="opt" type="button" role="radio" aria-checked="false"><span class="L">' + LETTERS[i] + '</span><span>' + inl(o) + '</span></button>');
    b.onclick = function () { if (done) return; sel = i; $$('.opt', og).forEach(function (y, j) { y.classList.toggle('sel', j === i); y.setAttribute('aria-checked', j === i); }); };
    og.appendChild(b);
  });
  $('.chk', el).onclick = function () {
    if (done) return;
    if (sel == null) { toast('Choose an answer first.'); return; }
    done = true;
    var ok = sel === x.answer;
    $$('.opt', og).forEach(function (y, j) { y.disabled = true; if (j === x.answer) y.classList.add('right'); else if (j === sel) y.classList.add('wrong'); });
    $('.chk', el).remove();
    var sec = itemSec(x);
    $('.fbx', el).innerHTML = '<div class="fb ' + (ok ? 'good' : 'bad') + ' md"><p><span class="mark">' + (ok ? '✓ Correct.' : '✗ Not quite — the answer is ' + LETTERS[x.answer] + '.') + '</span> ' + inl(x.explanation) + '</p>' + (x.trap ? '<p><strong>Exam trap:</strong> ' + inl(x.trap) + '</p>' : '') +
      '<p class="src">' + esc(itemRef(x)) + (sec ? ' · <a href="' + subLink(sec) + '">Review ' + esc(subTitle(sec)) + '</a>' : '') + '</p></div>';
    if (!isQ) { var st = pstate(); st[x.id] = { ok: ok, at: Date.now() }; store.set('pstate', st); }
    var r = {}; r[x.concept] = ok; recordConcepts(r, 'practice');
    if (onDone) onDone(ok);
  };
  return el;
}
function testYourself(subId) {
  var items = PBY_SUB[subId] || [];
  var d = h('<details class="ty noprint"><summary>🧠 Test yourself <span class="small muted">(' + items.length + ' question' + (items.length > 1 ? 's' : '') + ' · not sent to the teacher)</span></summary><div class="tyb"></div></details>');
  d.addEventListener('toggle', function () { if (d.open && !d.dataset.r) { d.dataset.r = 1; items.forEach(function (x) { $('.tyb', d).appendChild(sbaCard(x)); }); } });
  return d;
}
function runSet(title, sub, items, opts) {
  opts = opts || {};
  app.appendChild(h('<div class="row"><div><div class="pill">' + esc(opts.kicker || 'Practice') + '</div><h1 style="margin-top:6px">' + esc(title) + '</h1>' + (sub ? '<p class="muted" style="margin:0">' + sub + '</p>' : '') + '</div><div class="spacer"></div><a class="btn" href="#/practice">← Practice</a></div>'));
  if (!items.length) { app.appendChild(h('<div class="card" style="margin-top:14px">' + (opts.empty || 'No questions here yet.') + '</div>')); return; }
  var box = h('<div class="card runner" style="margin-top:14px"></div>'); app.appendChild(box);
  var i = 0, res = [];
  function draw() {
    box.innerHTML = '';
    if (i >= items.length) return summary();
    box.appendChild(h('<div class="row small"><b>Question ' + (i + 1) + ' of ' + items.length + '</b><span class="progress" style="flex:1;max-width:260px" role="img" aria-label="progress"><i style="width:' + pct(i, items.length) + '%"></i></span><span class="muted">' + res.filter(Boolean).length + ' correct so far</span></div>'));
    var card = sbaCard(items[i], function (ok) {
      res[i] = ok;
      var nx = h('<div class="row" style="margin-top:12px"><button class="btn primary" type="button">' + (i === items.length - 1 ? 'See summary' : 'Next question →') + '</button></div>');
      $('button', nx).onclick = function () { i++; draw(); window.scrollTo(0, box.offsetTop - 80); };
      card.appendChild(nx); $('button', nx).focus();
    }, { newItem: opts.newIds && opts.newIds[items[i].id] });
    box.appendChild(card);
  }
  function summary() {
    var right = res.filter(Boolean).length, missed = items.filter(function (x, k) { return !res[k]; });
    var cons = {}; missed.forEach(function (x) { cons[x.concept] = 1; });
    box.appendChild(h('<h2 style="margin-top:0">Summary: ' + right + ' / ' + items.length + ' (' + pct(right, items.length) + '%)</h2>'));
    if (!missed.length) box.appendChild(h('<p>✓ All correct. These concepts move further back in your revision queue.</p>'));
    else box.appendChild(h('<div><p>Missed concepts (added to your <a href="#/progress/queue">revision queue</a>):</p><ul>' + Object.keys(cons).map(function (k) { return '<li><a href="' + conceptLink(k) + '">' + esc(conceptName(k)) + '</a></li>'; }).join('') + '</ul></div>'));
    var r = h('<div class="row"><button class="btn" type="button">↺ Do this set again</button>' + (missed.length ? '<button class="btn primary" type="button">Retry only the ' + missed.length + ' missed</button>' : '') + '<a class="btn ghost" href="#/progress">My Progress →</a></div>');
    var bs = $$('button', r);
    bs[0].onclick = function () { i = 0; res = []; draw(); };
    if (bs[1]) bs[1].onclick = function () { items = missed; i = 0; res = []; draw(); };
    box.appendChild(r);
  }
  draw();
}
function missedFrom(attemptIds, topic) {
  var list = [], seen = {};
  attemptIds.forEach(function (id) {
    var a = attempts().filter(function (x) { return x.id === id; })[0]; if (!a) return;
    attemptQs(a).forEach(function (q) { if (!isRight(a, q) && (!topic || q.topic === topic) && !seen[q.id]) { seen[q.id] = 1; list.push(q); } });
  });
  return list;
}
function newOnConcepts(concepts, topic, max) {
  // §19: 2–3 NEW questions on the same concepts (practice bank, never assessment items)
  var out = [], seen = {}, st = pstate();
  var pool = [];
  concepts.forEach(function (k) { (PBY_CONCEPT[k] || []).forEach(function (x) { pool.push(x); }); });
  if (topic) PR.forEach(function (x) { if (SEC_TOPIC[x.section] === topic) pool.push(x); });
  function rank(x) { var sx = st[x.id]; return (concepts.indexOf(x.concept) >= 0 ? 0 : 10) + (sx ? (sx.ok ? 2 : 1) : 0); }
  pool.sort(function (a, b) { return rank(a) - rank(b); });
  pool.forEach(function (x) { if (out.length < max && !seen[x.id]) { seen[x.id] = 1; out.push(x); } });
  return out;
}
function viewPractice(mode, args) {
  args = args || [];
  if (mode === 'retry') {
    var ids = (args[0] || '').split(',').filter(Boolean), topic = args[1] || null;
    if (!ids.length) ids = latestAttempts().map(function (a) { return a.id; });
    var miss = missedFrom(ids, topic), cons = [];
    miss.forEach(function (q) { if (cons.indexOf(q.concept) < 0) cons.push(q.concept); });
    var fresh = miss.length ? newOnConcepts(cons, topic, 3) : [], nid = {}; fresh.forEach(function (x) { nid[x.id] = 1; });
    touch('Retry my mistakes' + (topic ? ': ' + D.topics[topic].name : ''), location.hash);
    return runSet(topic ? 'Retry weak questions: ' + D.topics[topic].name : 'Retry my mistakes', miss.length + ' question(s) you got wrong or left blank, plus ' + fresh.length + ' new question(s) on the same concepts. Answers are revealed only because the assessment was already submitted.', miss.concat(fresh), { kicker: 'Retry', newIds: nid, empty: 'No missed questions found for this selection. <a href="#/tests">Take an assessment</a> first.' });
  }
  if (mode === 'topic' && args[0] && D.topics[args[0]]) {
    touch('Topic practice: ' + D.topics[args[0]].name, location.hash);
    return runSet('Topic practice: ' + D.topics[args[0]].name, 'New single-best-answer questions written from the lectures (not the assessment questions).', PR.filter(function (x) { return SEC_TOPIC[x.section] === args[0]; }));
  }
  if (mode === 'concept' && args[0]) {
    touch('Practice: ' + conceptName(args[0]), location.hash);
    return runSet(conceptName(args[0]), 'Practice questions on this concept. <a href="' + conceptLink(args[0]) + '">Review the learning block</a>.', PBY_CONCEPT[args[0]] || [], { empty: 'No practice question on this concept yet — <a href="' + conceptLink(args[0]) + '">review the learning block</a>.' });
  }
  if (mode === 'prev') { touch('Previous-exam concepts', location.hash); return runSet('Previous-exam concepts', 'New questions that re-test concepts examined in previous papers (QZ, CQ, VR, VL references). They are not copies of the original questions.', PR.filter(function (x) { return x.previousExam; }), { kicker: 'Practice' }); }
  if (mode === 'image') { touch('Morphology Challenge', location.hash); return runSet('Morphology Challenge', 'Identify the lesion from the embedded gross and microscopic images. Click any image to zoom.', PR.filter(function (x) { return x.image; })); }
  if (mode === 'queue') {
    var due = dueConcepts(), items = [];
    due.forEach(function (k) { var c = newOnConcepts([k], null, 1); if (c.length) items.push(c[0]); });
    touch('Revision queue', location.hash);
    return runSet('Due for revision', due.length + ' concept(s) due; one question each. Correct answers push a concept further back; wrong answers bring it back tomorrow.', items, { kicker: 'Revision queue', empty: 'Nothing is due. Missed concepts from practice and assessments are added automatically.' });
  }
  app.appendChild(h('<h1>Practice</h1>'));
  app.appendChild(h('<p class="muted">Formative practice with instant feedback. Nothing here is sent to the teacher. Practice questions are separate from the assessment questions.</p>'));
  var tabs = h('<div class="tabs" role="tablist"><button data-f="home">Overview</button><button data-f="checks">Pathology Challenge</button><button data-f="mistakes">My mistakes</button><button data-f="weak">Retry weak topics</button></div>');
  var body = h('<div></div>'); app.appendChild(tabs); app.appendChild(body);
  function show(f) {
    $$('button', tabs).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); b.setAttribute('aria-selected', b.dataset.f === f); });
    body.innerHTML = '';
    if (f === 'checks') return body.appendChild(checksPanel());
    if (f === 'mistakes') return body.appendChild(mistakesPanel());
    if (f === 'weak') return body.appendChild(weakPanel());
    var st = pstate(), done = Object.keys(st).length, ok = Object.keys(st).filter(function (k) { return st[k].ok; }).length;
    body.appendChild(h('<div class="grid g4" style="margin:4px 0 14px"><div class="card kpi"><div class="v">' + PR.length + '</div><div class="l">Practice questions</div></div><div class="card kpi"><div class="v">' + done + '</div><div class="l">Attempted</div></div><div class="card kpi"><div class="v">' + ok + '</div><div class="l">Correct at last try</div></div><div class="card kpi"><div class="v">' + dueConcepts().length + '</div><div class="l">Concepts due for revision</div></div></div>'));
    var g = h('<div class="grid g3"></div>');
    [['#/practice/prev', '📜 Previous-exam concepts', PR.filter(function (x) { return x.previousExam; }).length + ' new questions on concepts examined before'], ['#/practice/image', '🔬 Morphology Challenge', PR.filter(function (x) { return x.image; }).length + ' image-based lesion-recognition questions'], ['#/progress/queue', '🔁 Due for revision', dueConcepts().length + ' concept(s) due now']].forEach(function (c) { g.appendChild(h('<a class="card step" href="' + c[0] + '"><div><h3>' + c[1] + '</h3><p class="small">' + esc(c[2]) + '</p></div></a>')); });
    body.appendChild(g);
    var t = h('<div class="card" style="margin-top:16px"><h2 style="margin-top:0">Topic practice</h2><div class="topics"></div></div>');
    Object.keys(D.topics).forEach(function (k) {
      var its = PR.filter(function (x) { return SEC_TOPIC[x.section] === k; }); if (!its.length) return;
      var ok2 = its.filter(function (x) { return st[x.id] && st[x.id].ok; }).length;
      $('.topics', t).appendChild(h('<a class="topic-row" href="#/practice/topic/' + k + '"><span>' + esc(D.topics[k].name) + '</span><span class="small muted">' + ok2 + '/' + its.length + ' correct</span></a>'));
    });
    body.appendChild(t);
  }
  $$('button', tabs).forEach(function (b) { b.onclick = function () { show(b.dataset.f); }; });
  show(['checks', 'mistakes', 'weak'].indexOf(mode) >= 0 ? mode : 'home');
}
function weakPanel() {
  var box = h('<div></div>');
  box.appendChild(h('<p class="muted">Your weakest topics from the latest attempt at each assessment. “Retry weak questions” gives you the questions you missed plus new questions on the same concepts.</p>'));
  box.appendChild(priorityCards(latestAttempts(), 5));
  return box;
}
function checksPanel() {
  var wrap = h('<div></div>');
  var st = checkState(), done = D.checks.filter(function (c) { return st[c.id]; }), ok = done.filter(function (c) { return st[c.id].ok; });
  wrap.appendChild(h('<p class="muted">Short self-tests for every section (true/false, fill-in, matching, sorting, select-all and single best answer).</p>'));
  wrap.appendChild(h('<div class="grid g4" style="margin:14px 0"><div class="card kpi"><div class="v">' + D.checks.length + '</div><div class="l">Pathology Challenge</div></div><div class="card kpi"><div class="v">' + done.length + '</div><div class="l">Attempted</div></div><div class="card kpi"><div class="v">' + ok.length + '</div><div class="l">Correct at last try</div></div><div class="card kpi"><div class="v">' + (done.length - ok.length) + '</div><div class="l">To try again</div></div></div>'));
  var tabs = h('<div class="tabs"><button class="on" data-f="all">All</button>' + D.lectures.map(function (L) { return '<button data-f="' + L.num + '">Lecture ' + L.num + '</button>'; }).join('') + '<button data-f="wrong">To try again</button></div>');
  var body = h('<div></div>');
  wrap.appendChild(tabs); wrap.appendChild(body);
  function show(f) {
    $$('button', tabs).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
    body.innerHTML = '';
    var list = D.checks.filter(function (c) { var L = (SECTIONS[c.sec] || SUBS[c.sec] || {}).lecture; var s = checkState()[c.id]; return f === 'all' || (f === 'wrong' ? s && !s.ok : String(L) === f); });
    if (!list.length) body.appendChild(h('<div class="card">Nothing here yet.</div>'));
    var lastSec = null;
    list.forEach(function (c) {
      if (c.sec !== lastSec) { body.appendChild(h('<h3 style="margin:18px 0 4px"><a href="' + subLink(c.sec) + '">' + esc(subTitle(c.sec)) + '</a></h3>')); lastSec = c.sec; }
      body.appendChild(renderCheck(c));
    });
    body.appendChild(h('<div class="row" style="margin-top:14px"><button class="btn danger">Reset all section-check records</button></div>'));
    $('button.danger', body).onclick = function () { confirmBox('Reset section checks', 'This clears your section-check history in this browser. Assessment results are not affected.', 'Reset', function () { store.set('checks', {}); route(); }, true); };
  }
  $$('button', tabs).forEach(function (b) { b.onclick = function () { show(b.dataset.f); }; });
  show('all');
  return wrap;
}
function mistakesPanel() {
  var box = h('<div></div>'), seen = {};
  latestAttempts().forEach(function (a) {
    attemptQs(a).forEach(function (q) { if (!isRight(a, q) && !seen[q.id]) seen[q.id] = { q: q, a: givenIdx(a, q), at: a }; });
  });
  var ids = Object.keys(seen), st = pstate(), pw = PR.filter(function (x) { return st[x.id] && !st[x.id].ok; });
  box.appendChild(h('<div class="row"><p class="muted" style="flex:1;margin:0">Assessment questions you got wrong or left blank in your latest submitted attempts (' + ids.length + '), and practice questions you missed at your last try (' + pw.length + ').</p>' + (ids.length ? '<a class="btn primary" href="#/practice/retry">🔁 Retry my mistakes</a>' : '') + (pw.length ? '<button class="btn pwr" type="button">Retry missed practice (' + pw.length + ')</button>' : '') + '</div>'));
  if (pw.length) $('.pwr', box).onclick = function () { app.innerHTML = ''; runSet('Missed practice questions', 'Practice questions you got wrong at your last try.', pw); };
  if (!ids.length && !pw.length) box.appendChild(h('<div class="card" style="margin-top:10px">No mistakes recorded yet.</div>'));
  ids.forEach(function (id) { var x = seen[id]; var c = h('<div class="card" style="margin:10px 0"></div>'); c.appendChild(reviewItem(x.q, x.a, true)); box.appendChild(c); });
  return box;
}

/* ---------------- QUESTIONS ---------------- */
function stemHtml(q) {
  return q.stem.map(function (p) { return p === '[[IMAGE]]' ? figCard(q.image) : '<p>' + inl(p) + '</p>'; }).join('');
}
function reviewItem(q, given, showTopic) {
  var ok = given === q.answer;
  var el = h('<div class="q" data-qid="' + esc(q.id) + '" data-bank="questions"><div class="row small muted"><b style="color:var(--navy)">' + esc(q.code) + '</b>' + (showTopic ? '<span>· ' + esc(D.topics[q.topic].name) + '</span>' : '') + '<span>· ' + esc(q.difficulty) + '</span>' + '<span class="pill ' + (given == null ? 'warn' : ok ? 'good' : 'bad') + '">' + (given == null ? 'Unanswered' : ok ? 'Correct' : 'Incorrect') + '</span></div><div class="stem md">' + stemHtml(q) + '</div><div class="opts"></div><div class="fb ' + (ok ? 'good' : 'bad') + ' md"></div></div>');
  var og = $('.opts', el);
  q.options.forEach(function (o, i) {
    var cls = i === q.answer ? 'right' : i === given ? 'wrong' : '';
    og.appendChild(h('<div class="opt ' + cls + '"><span class="L">' + LETTERS[i] + '</span><span>' + inl(o) + (i === given ? ' <span class="small muted">(your answer)</span>' : '') + '</span></div>'));
  });
  $('.fb', el).innerHTML = '<p><span class="mark">Answer: ' + LETTERS[q.answer] + '.</span> ' + inl(q.explanation) + '</p>' + (q.trap ? '<p><strong>Exam trap:</strong> ' + inl(q.trap) + '</p>' : '') + '<p class="small"><b>Learning objective:</b> ' + esc(q.objective) + '</p><p class="src">' + esc(q.source) + ' · <a href="' + secLink(q.sections[0]) + '">Revise section ' + esc(q.sections[0]) + '</a> · <a href="#/practice/concept/' + q.concept + '">Practise this concept</a></p>';
  return el;
}

/* ---------------- ASSESSMENTS ---------------- */
/* An attempt identifies questions and options by their permanent ids — a.qids (the paper as it was taken) and
   a.answers = { questionId: optionId } — never by position. Editing, reordering, adding or removing questions or
   answer options later cannot change how a saved attempt is read. */
function attemptQs(a) { return (a.qids || []).map(function (id) { return QID[id]; }).filter(Boolean); }
function givenIdx(a, q) { var o = a.answers[q.id]; return o == null ? null : (q.optionIds || []).indexOf(o); } // -1 = option since removed
function isRight(a, q) { var o = a.answers[q.id]; return o != null && o === q.optionIds[q.answer]; }
function answeredN(a) { return attemptQs(a).filter(function (q) { return a.answers[q.id] != null; }).length; }
function normAttempt(a) {
  // Result files from the original single-file edition stored answers by position; read them with the
  // question order and option ids that edition used (kept in D.legacy).
  if (!a || !Array.isArray(a.answers)) return a;
  var order = ((D.legacy || {}).questionOrder || {})[a.test] || [];
  if (order.length !== a.answers.length) return null;
  var ans = {}; a.answers.forEach(function (x, i) { if (x != null) ans[order[i]] = 'o' + (x + 1); });
  return Object.assign({}, a, { qids: order.slice(), answers: ans, legacyAnswers: a.answers, flags: [] });
}
function viewTests() {
  app.appendChild(h('<h1>Assessments</h1>'));
  app.appendChild(h('<p class="muted">Formal, timed single-best-answer papers. Answers and explanations are shown only after you submit. You may retake them; every attempt is saved in this browser and can be sent to your teacher.</p>'));
  app.appendChild(h('<div class="note" style="margin-bottom:14px"><b>Formative revision and practice — not a secure high-stakes examination system.</b> Results are kept in this browser, and the shared class login does not identify individual students. Official examinations need server-side delivery and scoring with authenticated users.</div>'));
  var g = h('<div class="grid g3"></div>');
  Object.keys(D.tests).forEach(function (t) {
    var T = D.tests[t], last = lastFor(t), best = bestFor(t), cur = store.get('cur_' + t, null);
    g.appendChild(h('<div class="card"><div class="pill">' + QBY[t].length + ' questions · ' + settings().minutes[t] + ' min</div><h2 style="margin:8px 0 4px">' + esc(T.title) + '</h2><p class="muted" style="margin-top:0">' + esc(T.sub) + '</p>' +
      '<p class="small">' + (last ? 'Last: <b>' + last.pct + '%</b> (' + fmtDate(last.submittedAt) + ')<br>Best: <b>' + best.pct + '%</b> · ' + attempts().filter(function (a) { return a.test === t; }).length + ' attempt(s)' : 'Not attempted yet') + '</p>' +
      '<div class="row"><a class="btn primary" href="#/test/' + t + '">' + (cur ? 'Resume' : last ? 'Retake' : 'Start') + '</a>' + (last ? '<a class="btn" href="#/result/' + last.id + '">Last result</a>' : '') + '</div></div>'));
  });
  app.appendChild(g);
}
function newAttempt(t, name, sid, email) {
  var now = Date.now();
  return { id: uid(t), test: t, name: name, studentId: sid, email: email, startedAt: now, deadline: now + settings().minutes[t] * 60000, qids: QBY[t].map(function (q) { return q.id; }), answers: {}, flags: [], cur: 0, v: APP_VERSION };
}
function viewTest(t) {
  var T = D.tests[t]; if (!T) { location.hash = '#/tests'; return; }
  var cur = store.get('cur_' + t, null);
  if (cur && Date.now() > cur.deadline) { submitAttempt(t, true); return; }
  if (!cur) return testGate(t);
  runExam(t);
}
function testGate(t) {
  var T = D.tests[t], prof = store.get('profile', {});
  var c = h('<div class="card" style="max-width:660px;margin:0 auto"><div class="pill">' + QBY[t].length + ' questions · ' + settings().minutes[t] + ' minutes</div><h1 style="margin-top:8px">' + esc(T.title) + '</h1><p class="muted">' + esc(T.sub) + '</p>' +
    '<ul class="small"><li>Single best answer. Letter keys (A, B, C…) answer; ← → move between questions.</li><li>Answers and explanations are <b>not</b> shown until you submit.</li><li>The timer keeps running if you leave the page; the paper is submitted automatically when time runs out.</li><li>Your result is saved in this browser. Download the result file afterwards if your teacher asks for it.</li></ul>' +
    '<form novalidate><div class="grid g2"><div class="field"><label for="tn">Full name <span aria-hidden="true">*</span></label><input id="tn" required autocomplete="name" value="' + esc(prof.name || '') + '"><span class="err" id="tn-e" aria-live="polite"></span></div>' +
    '<div class="field"><label for="ti">Student ID <span aria-hidden="true">*</span></label><input id="ti" required autocomplete="off" value="' + esc(prof.studentId || '') + '"><span class="err" id="ti-e" aria-live="polite"></span></div></div>' +
    '<div class="field"><label for="te">Email address <span class="muted">(optional)</span></label><input id="te" type="email" autocomplete="email" value="' + esc(prof.email || '') + '" aria-describedby="te-h"><span class="small muted" id="te-h">Only so your teacher can contact you about this result. It is not used to verify who you are.</span><span class="err" id="te-e" aria-live="polite"></span></div>' +
    '<p class="small muted">Name and Student ID label your result for the teacher. The platform cannot verify identity (shared class login): <b>formative revision and practice — not a secure high-stakes examination system.</b></p>' +
    '<button class="btn primary" type="submit" style="margin-top:6px">Start the assessment</button></form></div>');
  $('form', c).onsubmit = function (e) {
    e.preventDefault();
    var n = $('#tn').value.trim().replace(/\s+/g, ' '), sid = $('#ti').value.trim(), m = $('#te').value.trim(), bad = false;
    $('#tn-e').textContent = n.length < 3 ? 'Please enter your full name.' : ''; if (n.length < 3) bad = true;
    var oki = /^[A-Za-z0-9][A-Za-z0-9\-\/ ]{1,29}$/.test(sid);
    $('#ti-e').textContent = oki ? '' : 'Please enter your Student ID (letters and numbers).'; if (!oki) bad = true;
    var okm = !m || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m);
    $('#te-e').textContent = okm ? '' : 'This email address does not look valid (or leave it empty).'; if (!okm) bad = true;
    if (bad) { var f = $('.err:not(:empty)', c); if (f && f.previousElementSibling) f.previousElementSibling.focus(); return; }
    store.set('profile', { name: n, studentId: sid, email: m });
    store.set('cur_' + t, newAttempt(t, n, sid, m));
    touch(D.tests[t].title, '#/test/' + t);
    route();
  };
  app.appendChild(c);
}
function runExam(t) {
  var T = D.tests[t];
  var A = normAttempt(store.get('cur_' + t, null)), qs = attemptQs(A);
  A.cur = Math.min(A.cur || 0, Math.max(0, qs.length - 1));
  function save() { store.set('cur_' + t, A); }
  var wrap = h('<div class="exam"><div><div class="card"><div class="row"><div><div class="small muted">' + esc(T.title) + ' · ' + esc(A.name) + (A.studentId ? ' (' + esc(A.studentId) + ')' : '') + '</div><div class="qcount" style="font-weight:700;color:var(--navy)"></div></div><div class="spacer"></div><button class="btn flagb" type="button">⚑ Flag</button></div><div class="qbody"></div><div class="row" style="margin-top:14px"><button class="btn prev">← Previous</button><button class="btn clear ghost">Clear answer</button><div class="spacer"></div><button class="btn primary next">Next →</button></div></div></div>' +
    '<aside class="card exam-side"><div class="small muted">Time remaining</div><div class="timer" aria-live="off">--:--</div><div class="progress" style="margin:8px 0"><i class="tp"></i></div><div class="small ansd"></div><div class="qnav" aria-label="Question navigator"></div><div class="legend"><span><i style="background:var(--teal)"></i>answered</span><span><i style="background:#fff;border:1px solid #ccc"></i>blank</span><span><i style="background:#f0b429;border-radius:50%"></i>flagged</span></div><button class="btn primary submit" style="width:100%;justify-content:center;margin-top:14px">Submit paper</button></aside></div>');
  app.appendChild(wrap);
  var qnav = $('.qnav', wrap);
  qs.forEach(function (q, i) { var b = h('<button type="button" aria-label="Question ' + (i + 1) + '">' + (i + 1) + '</button>'); b.onclick = function () { A.cur = i; save(); draw(); }; qnav.appendChild(b); });
  function draw() {
    var i = A.cur, q = qs[i];
    $('.qcount', wrap).textContent = 'Question ' + (i + 1) + ' of ' + qs.length;
    var body = $('.qbody', wrap);
    body.innerHTML = '<div class="q"><div class="stem md">' + stemHtml(q) + '</div><div class="opts" role="radiogroup" aria-label="Options"></div></div>';
    var og = $('.opts', body);
    q.options.forEach(function (o, j) {
      var on = A.answers[q.id] === q.optionIds[j];
      var b = h('<button class="opt' + (on ? ' sel' : '') + '" type="button" role="radio" aria-checked="' + on + '"><span class="L">' + LETTERS[j] + '</span><span>' + inl(o) + '</span></button>');
      b.onclick = function () { A.answers[q.id] = q.optionIds[j]; save(); draw(); };
      og.appendChild(b);
    });
    $('.flagb', wrap).textContent = A.flags.indexOf(q.id) >= 0 ? '⚑ Flagged' : '⚑ Flag';
    $('.prev', wrap).disabled = i === 0; $('.next', wrap).textContent = i === qs.length - 1 ? 'Review & submit' : 'Next →';
    $$('button', qnav).forEach(function (b, j) { b.classList.toggle('ans', A.answers[qs[j].id] != null); b.classList.toggle('cur', j === i); b.classList.toggle('flag', A.flags.indexOf(qs[j].id) >= 0); });
    var n = answeredN(A);
    $('.ansd', wrap).textContent = n + ' of ' + qs.length + ' answered';
  }
  $('.prev', wrap).onclick = function () { if (A.cur > 0) { A.cur--; save(); draw(); } };
  $('.next', wrap).onclick = function () { if (A.cur < qs.length - 1) { A.cur++; save(); draw(); } else confirmSubmit(); };
  $('.clear', wrap).onclick = function () { delete A.answers[qs[A.cur].id]; save(); draw(); };
  $('.flagb', wrap).onclick = function () { var id = qs[A.cur].id, k = A.flags.indexOf(id); if (k >= 0) A.flags.splice(k, 1); else A.flags.push(id); save(); draw(); };
  function confirmSubmit() {
    var blank = qs.length - answeredN(A), fl = A.flags.length;
    confirmBox('Submit your paper?', (blank ? blank + ' question(s) are unanswered. ' : 'All questions answered. ') + (fl ? fl + ' question(s) are flagged. ' : '') + 'After submission you will see your score, the answers and the explanations. You cannot change your answers after this.', 'Submit now', function () { submitAttempt(t, false); });
  }
  $('.submit', wrap).onclick = confirmSubmit;
  function tick() {
    var left = (A.deadline - Date.now()) / 1000, tot = settings().minutes[t] * 60;
    var tm = $('.timer', wrap); if (!tm) return;
    tm.textContent = fmtDur(left); tm.classList.toggle('low', left < 300);
    $('.tp', wrap).style.width = Math.max(0, 100 * left / tot) + '%';
    if (left <= 0) { clearInterval(iv); toast('Time is up — your paper has been submitted.'); submitAttempt(t, true); }
  }
  var iv = setInterval(tick, 1000); tick(); draw();
  function onKey(e) {
    if (document.querySelector('.modal-bg') || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName)) return;
    var k = e.key.toUpperCase();
    var q = qs[A.cur], j = LETTERS.indexOf(k);
    if (k.length === 1 && j >= 0 && j < q.options.length) { A.answers[q.id] = q.optionIds[j]; save(); draw(); }
    else if (e.key === 'ArrowRight' && A.cur < qs.length - 1) { A.cur++; save(); draw(); }
    else if (e.key === 'ArrowLeft' && A.cur > 0) { A.cur--; save(); draw(); }
  }
  document.addEventListener('keydown', onKey);
  cleanup = function () { clearInterval(iv); document.removeEventListener('keydown', onKey); };
}
function gradeAttempt(a) {
  var qs = attemptQs(a), c = 0, w = 0, u = 0, by = {};
  qs.forEach(function (q) {
    var t = by[q.topic] = by[q.topic] || [0, 0]; t[1]++;
    if (a.answers[q.id] == null) u++; else if (isRight(a, q)) { c++; t[0]++; } else w++;
  });
  return { score: c, total: qs.length, pct: pct(c, qs.length), correct: c, incorrect: w, unanswered: u, byTopic: by };
}
function sigPayload(a) {
  if (a.sigv === 3) return ['vulva-review-v3', a.id, a.test, a.name, a.studentId || '', a.email || '', a.startedAt, a.submittedAt, a.qids.map(function (id) { return id + '=' + (a.answers[id] || '-'); }).join(','), a.score].join('|');
  var ans = (a.legacyAnswers || a.answers).map(function (x) { return x == null ? '-' : x; }).join('');
  if (a.sigv === 2) return ['vulva-review-v2', a.id, a.test, a.name, a.studentId || '', a.email || '', a.startedAt, a.submittedAt, ans, a.score].join('|');
  return ['vulva-review-v1', a.id, a.test, a.name, a.email, a.startedAt, a.submittedAt, ans, a.score].join('|');
}
function submitAttempt(t, auto) {
  var A = normAttempt(store.get('cur_' + t, null)); if (!A) { location.hash = '#/tests'; return; }
  var now = Date.now();
  var g = gradeAttempt(A);
  var rec = { id: A.id, test: t, name: A.name, studentId: A.studentId || '', email: A.email || '', sigv: 3, qids: A.qids, startedAt: A.startedAt, submittedAt: Math.min(now, A.deadline + 5000), durationSec: Math.round((Math.min(now, A.deadline) - A.startedAt) / 1000),
    answers: A.answers, auto: !!auto, v: APP_VERSION };
  Object.keys(g).forEach(function (k) { rec[k] = g[k]; });
  sha256(sigPayload(rec)).then(function (sig) {
    rec.sig = sig;
    var all = attempts(); if (!all.some(function (x) { return x.id === rec.id; })) all.push(rec);
    store.set('attempts', all); store.del('cur_' + t);
    var cr = {}; attemptQs(rec).forEach(function (q) { cr[q.concept] = (cr[q.concept] !== false) && isRight(rec, q); }); recordConcepts(cr, t);
    touch('Result: ' + D.tests[t].title + ' (' + rec.pct + '%)', '#/result/' + rec.id);
    if (location.hash === '#/result/' + rec.id) route(); else location.hash = '#/result/' + rec.id;
  });
}
function topicBars(by) {
  var box = h('<div></div>');
  Object.keys(D.topics).filter(function (k) { return by[k]; }).map(function (k) { return [k, by[k][0], by[k][1]]; })
    .sort(function (a, b) { return a[1] / a[2] - b[1] / b[2]; })
    .forEach(function (x) {
      var p = pct(x[1], x[2]), col = p >= 75 ? 'var(--good)' : p >= 50 ? '#c98a00' : 'var(--bad)';
      box.appendChild(h('<div class="bar"><span>' + esc(D.topics[x[0]].name) + '</span><span class="track" role="img" aria-label="' + p + '%"><i style="width:' + p + '%;background:' + col + '"></i></span><b>' + x[1] + '/' + x[2] + '</b></div>'));
    });
  return box;
}
function weakAreas(by) {
  return Object.keys(by).filter(function (k) { return by[k][0] / by[k][1] < 0.6; }).sort(function (a, b) { return by[a][0] / by[a][1] - by[b][0] / by[b][1]; });
}
function recommendations(by) {
  var weak = weakAreas(by), box = h('<div></div>');
  if (!weak.length) { box.appendChild(h('<p>✓ No weak topic in this attempt (every topic ≥60%). Keep it fresh with the <a href="#/facts">30 high-yield facts</a> and the <a href="#/revision">section checks</a>.</p>')); return box; }
  box.appendChild(h('<p>Revise these topics first (below 60% in this attempt):</p>'));
  var ul = h('<ul></ul>');
  weak.forEach(function (k) {
    var T = D.topics[k];
    ul.appendChild(h('<li><b>' + esc(T.name) + '</b> (' + by[k][0] + '/' + by[k][1] + ') — re-read ' + T.sections.map(function (s) { return '<a href="' + secLink(s) + '">' + esc(secTitle(s)) + '</a>'; }).join(' and ') + ', then do its section checks.</li>'));
  });
  box.appendChild(ul);
  return box;
}
function viewResult(id) {
  var a = attempts().filter(function (x) { return x.id === id; })[0];
  if (!a) { app.appendChild(h('<div class="card">Result not found in this browser. <a href="#/results">See all results</a>.</div>')); return; }
  var T = D.tests[a.test], S = settings();
  app.appendChild(h('<div class="row"><div><div class="pill">' + esc(T.title) + '</div><h1 style="margin-top:6px">Your result: ' + a.pct + '%</h1><p class="muted" style="margin:0">' + esc(a.name) + (a.studentId ? ' · ID ' + esc(a.studentId) : '') + (a.email ? ' · ' + esc(a.email) : '') + ' · submitted ' + fmtDate(a.submittedAt) + (a.auto ? ' (automatically, time ran out)' : '') + '</p></div><div class="spacer"></div><div class="row noprint"><button class="btn dl">⬇ Download result file</button><button class="btn pr">🖨 Print</button><a class="btn" href="#/test/' + a.test + '">Retake</a>' + (a.correct < a.total ? '<a class="btn primary" href="#/practice/retry/' + a.id + '">🔁 Retry my mistakes</a>' : '') + '</div></div>'));
  app.appendChild(h('<div class="grid g4" style="margin:16px 0">' +
    [['Score', a.score + ' / ' + a.total], ['Percentage', a.pct + '%'], ['Correct', a.correct], ['Incorrect', a.incorrect], ['Unanswered', a.unanswered], ['Time used', fmtDur(a.durationSec)], ['Date', fmtDate(a.submittedAt)], ['Band', a.pct >= S.pass ? 'At or above the ' + S.pass + '% mark' : 'Below the ' + S.pass + '% mark']]
      .map(function (k) { return '<div class="card kpi"><div class="v" style="font-size:' + (String(k[1]).length > 12 ? 15 : 24) + 'px">' + esc(k[1]) + '</div><div class="l">' + esc(k[0]) + '</div></div>'; }).join('') + '</div>'));
  var pc = h('<div class="card" style="margin-bottom:16px"><h2 style="margin-top:0">🎯 Revision priorities</h2><p class="small muted" style="margin-top:0">Your three weakest topics in this attempt, with the exact sections to review. “Retry weak questions” gives you the questions you missed plus 2–3 new questions on the same concepts.</p></div>');
  pc.appendChild(priorityCards([a], 3)); app.appendChild(pc);
  var g = h('<div class="card"><h2 style="margin-top:0">Topic performance</h2></div>');
  g.appendChild(topicBars(a.byTopic));
  app.appendChild(g);
  var rv = h('<div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">Review every question</h2><div class="spacer"></div><div class="tabs" style="margin:0;border:0"><button class="on" data-f="all">All</button><button data-f="wrong">Incorrect</button><button data-f="blank">Unanswered</button></div></div><div class="rvl"></div></div>');
  function fill(f) {
    $$('.tabs button', rv).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
    var l = $('.rvl', rv); l.innerHTML = '';
    attemptQs(a).forEach(function (q, i) {
      var gv = givenIdx(a, q);
      if (f === 'wrong' && (gv == null || isRight(a, q))) return;
      if (f === 'blank' && gv != null) return;
      var it = h('<div class="review-item"><div class="small muted">Question ' + (i + 1) + '</div></div>'); it.appendChild(reviewItem(q, gv, true)); l.appendChild(it);
    });
    if (!l.children.length) l.appendChild(h('<p class="muted">None.</p>'));
  }
  $$('.tabs button', rv).forEach(function (b) { b.onclick = function () { fill(b.dataset.f); }; });
  fill('all'); app.appendChild(rv);
  $('.dl', app).onclick = function () { exportAttempts([a], 'vulva-result_' + slug(a.name) + '_' + a.test + '_' + new Date(a.submittedAt).toISOString().slice(0, 10) + '.json'); };
  $('.pr', app).onclick = function () { window.print(); };
}
function exportAttempts(list, name) {
  var bundle = { kind: 'vulva-review-results', app: D.meta.short, version: APP_VERSION, exportedAt: Date.now(), attempts: list };
  download(name, JSON.stringify(bundle, null, 1));
  toast('Result file downloaded. Send it to your teacher if asked.');
}
function viewProgress(tab) {
  app.appendChild(h('<h1>My Progress</h1>'));
  var tabs = h('<div class="tabs" role="tablist"><button data-f="results">Results</button><button data-f="weak">Weak topics</button><button data-f="queue">Revision queue</button></div>');
  var body = h('<div></div>'); app.appendChild(tabs); app.appendChild(body);
  function show(f) {
    $$('button', tabs).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); b.setAttribute('aria-selected', b.dataset.f === f); });
    body.innerHTML = '';
    ({ results: progResults, weak: progWeak, queue: progQueue })[f](body);
  }
  $$('button', tabs).forEach(function (b) { b.onclick = function () { show(b.dataset.f); }; });
  show(['weak', 'queue'].indexOf(tab) >= 0 ? tab : 'results');
}
function progResults(body) {
  var all = attempts(), P = store.get('profile', {});
  body.appendChild(h('<p class="muted">Every submitted attempt in this browser' + (P.name ? ' (' + esc(P.name) + (P.studentId ? ', ID ' + esc(P.studentId) : '') + ')' : '') + '. Results are not sent anywhere automatically. Use “Download” to send a file to your teacher.</p>'));
  var lecKpis2 = D.lectures.map(function (L, i) { var s = lectureProgress(i + 1); return '<div class="card kpi"><div class="v">' + pct(s.done, s.total) + '%</div><div class="l">' + esc(L.title) + ' studied</div></div>'; }).join('');
  body.appendChild(h('<div class="grid g4" style="margin:4px 0 14px">' + lecKpis2 + '<div class="card kpi"><div class="v">' + all.length + '</div><div class="l">Assessment attempts</div></div><div class="card kpi"><div class="v">' + dueConcepts().length + '</div><div class="l">Concepts due for revision</div></div></div>'));
  if (!all.length) { body.appendChild(h('<div class="card">No assessments submitted yet. <a href="#/tests">Go to the assessments</a>.</div>')); return; }
  var tbl = h('<div class="card" style="overflow-x:auto"><div class="row"><h2 style="margin:0">Attempts</h2><div class="spacer"></div><button class="btn dla">⬇ Download all my results</button></div><table class="data" style="margin-top:10px"><thead><tr><th>Assessment</th><th>Date</th><th>Score</th><th>%</th><th>Correct</th><th>Incorrect</th><th>Unanswered</th><th>Time</th><th></th></tr></thead><tbody></tbody></table></div>');
  all.slice().reverse().forEach(function (a) {
    $('tbody', tbl).appendChild(h('<tr><td>' + esc(D.tests[a.test].title) + '</td><td>' + fmtDate(a.submittedAt) + '</td><td>' + a.score + '/' + a.total + '</td><td><b>' + a.pct + '%</b></td><td>' + a.correct + '</td><td>' + a.incorrect + '</td><td>' + a.unanswered + '</td><td>' + fmtDur(a.durationSec) + '</td><td><a href="#/result/' + a.id + '">Open</a></td></tr>'));
  });
  $('.dla', tbl).onclick = function () { exportAttempts(all, 'vulva-results_' + slug(P.name || 'student') + (P.studentId ? '_' + slug(P.studentId) : '') + '_all.json'); };
  body.appendChild(tbl);
  var g = h('<div class="card" style="margin-top:16px"><h2 style="margin-top:0">Topic performance</h2><p class="small muted">Combined from your latest attempt at each assessment.</p></div>');
  g.appendChild(topicBars(combinedByTopic(latestAttempts()))); body.appendChild(g);
}
function progWeak(body) {
  body.appendChild(h('<p class="muted">Revision priorities from your latest attempt at each assessment: topic, score, number missed, and the exact sections to review.</p>'));
  body.appendChild(priorityCards(latestAttempts(), 5));
  if (latestAttempts().length) body.appendChild(h('<div class="row" style="margin-top:14px"><a class="btn primary" href="#/practice/retry">🔁 Retry all my mistakes (+ new questions on the same concepts)</a></div>'));
}
function progQueue(body) {
  var S = srs(), due = dueConcepts(), keys = Object.keys(S).sort(function (a, b) { return S[a].due - S[b].due; });
  body.appendChild(h('<p class="muted">A simple spaced-revision queue kept in this browser. A concept enters the queue when you miss it (in practice or an assessment) and is due at once. Each correct answer pushes it further back: 1, 3, 7, 14 and then 30 days.</p>'));
  body.appendChild(h('<div class="row" style="margin:6px 0 14px">' + (due.length ? '<a class="btn primary" href="#/practice/queue">▶ Revise the ' + due.length + ' due concept(s) now</a>' : '<span class="pill good">Nothing due now</span>') + '</div>'));
  if (!keys.length) { body.appendChild(h('<div class="card">Your queue is empty. Concepts you miss are added automatically.</div>')); return; }
  var t = h('<div class="card" style="overflow-x:auto"><table class="data"><thead><tr><th>Concept</th><th>Status</th><th>Times missed</th><th>Last result</th><th></th></tr></thead><tbody></tbody></table></div>');
  var now = Date.now();
  keys.forEach(function (k) {
    var e = S[k], d = e.due <= now ? '<span class="pill bad">Due now</span>' : '<span class="pill">Due ' + new Date(e.due).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + '</span>';
    $('tbody', t).appendChild(h('<tr><td><a href="' + conceptLink(k) + '">' + esc(conceptName(k)) + '</a></td><td>' + d + '</td><td>' + (e.wrong || 0) + '</td><td>' + (e.lastOk ? '✓' : '✗') + '</td><td><a href="#/practice/concept/' + k + '">Practise</a></td></tr>'));
  });
  body.appendChild(t);
  var r = h('<div class="row" style="margin-top:12px"><button class="btn danger" type="button">Clear the revision queue</button></div>');
  $('button', r).onclick = function () { confirmBox('Clear revision queue', 'This clears the spaced-revision queue in this browser. Results and practice history are kept.', 'Clear', function () { store.set('srs', {}); route(); }, true); };
  body.appendChild(r);
}

/* ---------------- LAST-MINUTE REVIEW ---------------- */
function viewReview(tab) {
  var T = [['facts', '⭐ ' + RV.facts.length + ' facts'], ['compare', '⚖️ ' + RV.comparisons.length + ' comparisons'], ['morph', '🔬 ' + RV.morphology.length + ' morphology associations'], ['traps', '⚠️ ' + RV.traps.length + ' exam traps']].concat(RV.review15.length || HOOKS.editing() ? [['15', '⏱ 15-minute review']] : []);
  if (!tab || !T.some(function (x) { return x[0] === tab; })) {
    app.appendChild(h('<h1>Last-Minute Review</h1>'));
    app.appendChild(h('<p class="muted">Short, high-yield material for the final days. Everything here comes from the two lectures and links back to the learning block where it is taught.</p>'));
    var g = h('<div class="grid g3"></div>');
    var desc = { facts: 'Active recall: read the question, answer in your head, then reveal.', compare: 'The confusable pairs, side by side.', morph: 'Classic gross and microscopic findings and what they mean.', traps: 'Trap → Remember, in one line each.', '15': 'Vascular, IHD/MI and structural disease in three 5-minute blocks.' };
    T.forEach(function (t) { g.appendChild(h('<a class="card step" href="#/review/' + t[0] + '"><div><h3>' + t[1] + '</h3><p class="small">' + desc[t[0]] + '</p></div></a>')); });
    app.appendChild(g); return;
  }
  touch('Last-minute review: ' + T.filter(function (x) { return x[0] === tab; })[0][1].replace(/^\S+ /, ''), location.hash);
  app.appendChild(h('<div class="row noprint"><a class="btn ghost" href="#/review">← Last-Minute Review</a><div class="spacer"></div>' + T.map(function (t) { return '<a class="btn' + (t[0] === tab ? ' navy' : '') + '" href="#/review/' + t[0] + '">' + t[1] + '</a>'; }).join('') + '</div>'));
  ({ facts: rvFacts, compare: rvCompare, morph: rvMorph, traps: rvTraps, '15': rv15 })[tab]();
}
function rvFacts() {
  var known = store.get('facts2', {});
  app.appendChild(h('<div class="row"><h1>⭐ High-yield facts — active recall</h1><div class="spacer"></div><button class="btn noprint all" type="button">Reveal all</button><button class="btn noprint pr" type="button">🖨 Print</button></div>'));
  app.appendChild(h('<p class="muted">Read each question and answer it in your head before revealing. Tick “I knew it” honestly; “Test me on this” gives you a practice question on the same concept.</p>'));
  function fk(f, i) { return f.id || i; }
  var n = RV.facts.filter(function (f, i) { return known[fk(f, i)]; }).length;
  app.appendChild(h('<p class="small"><b class="kn">' + n + '</b>/' + RV.facts.length + ' marked as known</p>'));
  var list = h('<ol class="factlist"></ol>');
  RV.facts.forEach(function (f, i) {
    var li = h('<li class="card fact' + (known[fk(f, i)] ? ' known' : '') + '" data-rv="facts" data-i="' + i + '"><div class="fq"><b>' + inl(f.q) + '</b></div><button class="btn rv noprint" type="button" aria-expanded="false">Reveal answer</button><div class="fa" hidden><p>' + inl(f.a) + '</p><p class="small"><b>Why it matters:</b> ' + inl(f.why) + '</p><div class="row small noprint"><label><input type="checkbox"' + (known[fk(f, i)] ? ' checked' : '') + '> I knew it</label><a href="#/practice/concept/' + f.concept + '">🧠 Test me on this</a><a href="' + subLink(f.sub) + '">📖 ' + esc(subTitle(f.sub)) + '</a></div></div></li>');
    $('.rv', li).onclick = function () { $('.fa', li).hidden = false; $('.rv', li).remove(); };
    $('input', li).onchange = function (e) { var k = store.get('facts2', {}); k[fk(f, i)] = e.target.checked; store.set('facts2', k); li.classList.toggle('known', e.target.checked); $('.kn').textContent = RV.facts.filter(function (x, j) { return k[fk(x, j)]; }).length; };
    list.appendChild(li);
  });
  app.appendChild(list);
  $('.all', app).onclick = function () { $$('.fa', list).forEach(function (x) { x.hidden = false; }); $$('.rv', list).forEach(function (x) { x.remove(); }); };
  $('.pr', app).onclick = function () { $$('.fa', list).forEach(function (x) { x.hidden = false; }); window.print(); };
}
function rvCompare() {
  app.appendChild(h('<h1>⚖️ Critical comparisons</h1>'));
  app.appendChild(h('<p class="muted">The pairs examiners use to build distractors. Cover a column and recall it.</p>'));
  var toc = h('<p class="small noprint">' + RV.comparisons.map(function (c, i) { return '<a href="#cmp-' + c.id + '">' + (i + 1) + '. ' + esc(c.title) + '</a>'; }).join(' · ') + '</p>');
  $$('a', toc).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var el = document.getElementById(a.getAttribute('href').slice(1)); if (el) el.scrollIntoView({ block: 'start' }); }; });
  app.appendChild(toc);
  RV.comparisons.forEach(function (c, i) {
    app.appendChild(h('<div class="card" id="cmp-' + c.id + '" data-rv="comparisons" data-i="' + i + '" style="margin-bottom:14px"><h2 style="margin-top:0">' + (i + 1) + '. ' + esc(c.title) + '</h2>' + md(c.md) + '<p class="small noprint"><a href="' + subLink(c.sub) + '">📖 Taught in ' + esc(subTitle(c.sub)) + '</a></p></div>'));
  });
}
function rvMorph() {
  app.appendChild(h('<h1>🔬 Classic morphology associations</h1>'));
  app.appendChild(h('<p class="muted">Read the finding, name the diagnosis, then reveal. Course content only.</p>'));
  var g = h('<div class="grid g2"></div>');
  RV.morphology.forEach(function (m, i) {
    var c = h('<div class="card morph" data-rv="morphology" data-i="' + i + '"><div class="small muted">' + esc(m.how) + '</div><p style="margin:.3em 0"><b>' + (i + 1) + '. ' + inl(m.finding) + '</b></p><button class="btn rv noprint" type="button">Reveal diagnosis</button><div class="fa" hidden><p>→ ' + inl(m.dx) + '</p><p class="small"><a href="' + subLink(m.sub) + '">📖 ' + esc(subTitle(m.sub)) + '</a></p></div></div>');
    $('.rv', c).onclick = function () { $('.fa', c).hidden = false; $('.rv', c).remove(); };
    g.appendChild(c);
  });
  app.appendChild(g);
}
function rvTraps() {
  app.appendChild(h('<h1>⚠️ Common exam traps</h1>'));
  app.appendChild(h('<p class="muted">Each trap is a wrong belief that examiners exploit, followed by what to remember instead.</p>'));
  var list = h('<div></div>');
  RV.traps.forEach(function (t, i) {
    list.appendChild(h('<div class="card trapcard" data-rv="traps" data-i="' + i + '"><p><span class="tl bad">Trap</span> ' + inl(t.trap) + '</p><p><span class="tl good">Remember</span> ' + inl(t.remember) + '</p><p class="small noprint"><a href="' + subLink(t.sub) + '">📖 ' + esc(subTitle(t.sub)) + '</a> · <a href="#/practice/concept/' + t.concept + '">🧠 Test me on this</a></p></div>'));
  });
  app.appendChild(list);
}
function rv15() {
  app.appendChild(h('<div class="row"><h1>⏱ 15-minute ' + esc(D.meta.subject) + ' review</h1><div class="spacer"></div><div class="noprint row"><span class="timer small15" aria-live="off">15:00</span><button class="btn primary go" type="button">▶ Start 15 minutes</button></div></div>'));
  app.appendChild(h('<p class="muted">Three 5-minute blocks. Start the timer and read each block in its time; the current block is highlighted.</p>'));
  var blocks = RV.review15.map(function (b, i) {
    var c = h('<div class="card r15" data-rv="review15" data-i="' + i + '" style="margin-bottom:14px"><div class="pill">' + esc(b.mins) + '</div><h2 style="margin:6px 0">' + esc(b.title) + '</h2><ul>' + b.points.map(function (x) { return '<li>' + inl(x) + '</li>'; }).join('') + '</ul></div>');
    app.appendChild(c); return c;
  });
  var iv = null;
  $('.go', app).onclick = function () {
    var end = Date.now() + 15 * 60000; if (iv) clearInterval(iv);
    $('.go', app).textContent = '↺ Restart';
    function tick() {
      var left = Math.max(0, (end - Date.now()) / 1000), el = $('.small15', app); if (!el) { clearInterval(iv); return; }
      el.textContent = fmtDur(left);
      var cur = Math.min(2, Math.floor((900 - left) / 300));
      blocks.forEach(function (b, i) { b.classList.toggle('now', i === cur && left > 0); });
      if (left <= 0) { clearInterval(iv); toast('15 minutes are up.'); }
    }
    iv = setInterval(tick, 1000); tick();
  };
  cleanup = function () { if (iv) clearInterval(iv); };
}

/* ---------------- PRESENTATION ---------------- */
function splitNotes(mdText) {
  var notes = [], keep = [];
  mdText.split('\n').forEach(function (l) { if (/^\*Source: /.test(l.trim())) notes.push(l.trim().replace(/^\*|\*$/g, '')); else keep.push(l); });
  return { md: keep.join('\n'), notes: notes };
}
function chunkMd(text) {
  // split at blank lines (tables/lists stay whole); a slide carries ~900 characters, a table counts extra
  var blocks = text.split(/\n\s*\n/).filter(function (b) { return b.trim(); }), out = [], cur = [], size = 0;
  blocks.forEach(function (b) {
    var w = b.length * (/^\s*\|/.test(b) ? 1.4 : 1);
    var glued = cur.length && /:(\*\*)?\s*$/.test(cur[cur.length - 1].trim());
    if (cur.length && !glued && size + w > 950) { out.push(cur.join('\n\n')); cur = []; size = 0; }
    cur.push(b); size += w;
  });
  if (cur.length) out.push(cur.join('\n\n'));
  return out.length ? out : [''];
}
function buildDeck(n) {
  var L = D.lectures[n - 1], slides = [{ k: 'title', L: L }];
  L.sections.forEach(function (s) {
    slides.push({ k: 'section', s: s });
    if (s.intro && s.subs.length === 0) { var sp = splitNotes(s.intro); chunkMd(sp.md).forEach(function (part, pi) { slides.push({ k: 'content', title: num(s.id) + ' ' + s.title + (pi ? ' (cont.)' : ''), md: part, notes: sp.notes, q: s.title }); }); }
    s.subs.forEach(function (u) {
      var sp = splitNotes(u.md), parts = chunkMd(sp.md);
      parts.forEach(function (part, pi) { slides.push({ k: 'content', title: num(u.id) + ' ' + u.title + (pi ? ' (cont.)' : ''), label: pi ? null : u.label, md: part, notes: sp.notes, q: u.title }); });
      (CHECKS_BY_SEC[u.id] || []).forEach(function (c) { slides.push({ k: 'check', c: c, title: 'Quick check · ' + c.id }); });
    });
    (CHECKS_BY_SEC[s.id] || []).forEach(function (c) { slides.push({ k: 'check', c: c, title: 'Quick check · ' + c.id }); });
  });
  slides.push({ k: 'end', L: L });
  return slides;
}
function checkSlideHtml(c) {
  var q = '<p><b>' + inl(c.q).replace(/\[ blank \]/g, '______') + '</b></p>', ans = '';
  if (c.type === 'tf') { q += '<div class="opts"><div class="opt"><span class="L">T</span>True</div><div class="opt"><span class="L">F</span>False</div></div>'; ans = c.answer ? 'True' : 'False'; }
  else if (c.type === 'mcq' || c.type === 'select') { q += '<div class="opts">' + c.options.map(function (o, i) { return '<div class="opt" data-i="' + i + '"><span class="L">' + LETTERS[i] + '</span>' + inl(o) + '</div>'; }).join('') + '</div>'; ans = (c.type === 'mcq' ? [c.answer] : c.answer).map(function (i) { return LETTERS[i]; }).join(', '); }
  else if (c.type === 'fill') { ans = c.answers.map(function (a) { return a[0]; }).join('; '); }
  else if (c.type === 'match') { q += '<div class="tablewrap"><table><tbody>' + c.left.map(function (l, i) { return '<tr><td>' + (i + 1) + '. ' + esc(l) + '</td><td>' + LETTERS[i].toLowerCase() + '. ' + esc(c.right[i]) + '</td></tr>'; }).join('') + '</tbody></table></div>'; ans = c.left.map(function (l, i) { return (i + 1) + '–' + LETTERS[c.key[i]].toLowerCase(); }).join(', '); }
  else if (c.type === 'sort') { q += '<p>' + c.items.map(function (x) { return esc(x[0]); }).join(' · ') + '</p><p class="small">Groups: ' + c.groups.map(esc).join(' | ') + '</p>'; ans = c.groups.map(function (g, gi) { return g + ': ' + c.items.filter(function (x) { return x[1] === gi; }).map(function (x) { return x[0]; }).join(', '); }).join(' — '); }
  return '<div class="md">' + q + '<div class="fb good reveal" hidden><span class="mark">Answer: ' + esc(ans) + '</span> ' + inl(c.expl) + '</div></div>';
}
/* ---------------- PRESENTATION (with slide editor) ---------------- */
// Slide decks are part of the content (D.decks). A teacher's slide edits go into the draft like every other
// edit and reach students when the draft is published. Decks nobody edited are generated from the lectures.
function contentChanged(what) { return HOOKS.contentChanged ? Promise.resolve(HOOKS.contentChanged(what)) : Promise.reject(new Error('Only teachers can change content.')); }
/* ---------------- PICTURES (central picture slots: D.pics, files in the server's media library) ---------------- */
var PICS = {};
function picKey(desc) { var t = String(desc).replace(/\s+/g, ' ').trim(), x = 5381; for (var i = 0; i < t.length; i++) x = ((x * 33) ^ t.charCodeAt(i)) >>> 0; return 'p' + x.toString(36) + t.length.toString(36); }
function installPictureHandlers() {
  // Everyone: click a picture to enlarge it. (Teachers' picture tools are installed by the editor.)
  document.addEventListener('click', function (e) {
    var t = e.target, fig = t.closest ? t.closest('.fig[data-pic]') : null; if (!fig) return;
    if (t.tagName === 'IMG' && fig.classList.contains('pic')) { var p = PICS[fig.getAttribute('data-pic')]; if (p) lightbox(p.src, (p.caption || fig.getAttribute('data-desc')) + (p.credit ? ' — ' + p.credit : '')); }
  });
}
function allPicSlots() {
  var out = [], seen = {}, tmp = document.createElement('div');
  function add(group, where, desc) { var k = picKey(desc); if (seen[k]) { seen[k].where.push(where); return; } seen[k] = { group: group, where: [where], desc: desc, key: k }; out.push(seen[k]); }
  D.lectures.forEach(function (L) {
    L.sections.forEach(function (s) {
      [{ id: s.id, md: s.intro }].concat(s.subs.map(function (u) { return { id: u.id, md: u.md }; })).forEach(function (u) {
        tmp.innerHTML = md(u.md); $$('.fig[data-desc]', tmp).forEach(function (f) { add('Lecture ' + L.num, u.id + ' ' + (SUBS[u.id] ? SUBS[u.id].title : s.title), f.getAttribute('data-desc')); });
      });
    });
  });
  D.questions.forEach(function (q) { if (q.image) add('Assessment questions', q.code + ' (' + D.tests[q.test].title + ')', q.image); });
  PR.forEach(function (x) { if (x.image) add('Practice questions', 'Practice ' + x.id, x.image); });
  return out;
}
function picStats() { var all = allPicSlots(); return { total: all.length, done: all.filter(function (x) { return PICS[x.key]; }).length, all: all }; }
function genDeck(n) {
  var L = D.lectures[n - 1], sid = 0;
  function id(p) { return p + '-' + n + '-' + (++sid); }
  return buildDeck(n).map(function (s) {
    if (s.k === 'title') return { id: id('t'), k: 'title', title: 'Lecture ' + n + ': ' + L.title, md: D.meta.author + ' · ' + D.meta.role + '\n\n' + D.meta.dept, notes: '', images: [] };
    if (s.k === 'section') return { id: id('s'), k: 'section', kicker: 'Section ' + num(s.s.id), title: s.s.title, md: '', notes: '', images: [] };
    if (s.k === 'end') return { id: id('e'), k: 'end', title: 'End of Lecture ' + n, md: 'Next: the Lecture ' + n + ' assessment' + (n === 2 ? ', the final mock and the 30 high-yield facts' : '') + '.', notes: '', images: [] };
    if (s.k === 'check') return { id: id('q'), k: 'check', title: s.title, checkId: s.c.id, notes: 'Ask the class first, then reveal (R). Source: ' + s.c.ref, images: [] };
    return { id: id('c'), k: 'content', title: s.title, label: s.label || null, md: s.md, notes: (s.notes || []).join(' · '), q: s.q, images: [] };
  });
}
function loadDeck(n) {
  var d = (D.decks || {})[n];
  if (d && d.slides && d.slides.length) return Promise.resolve({ slides: JSON.parse(JSON.stringify(d.slides)), source: 'edited', updatedAt: d.updatedAt });
  return Promise.resolve({ slides: genDeck(n), source: 'original' });
}
function saveDeck(n, slides) { D.decks = D.decks || {}; D.decks[n] = { updatedAt: Date.now(), slides: JSON.parse(JSON.stringify(slides)) }; return contentChanged('slides'); }
function resetDeck(n) { if (D.decks) delete D.decks[n]; return contentChanged('slides'); }
function storeImage(file) {
  // Resize in the browser, then upload to the server's media library (teachers only). Resolves to "media/<file>".
  if (!HOOKS.uploadImage) return Promise.reject(new Error('Only teachers can upload pictures.'));
  return readImageFile(file).then(HOOKS.uploadImage);
}
function readImageFile(file) {
  return new Promise(function (res, rej) {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return rej(new Error('Use a JPG, PNG, GIF or WebP picture (not ' + (file.name || 'this file') + ').'));
    var fr = new FileReader();
    fr.onerror = function () { rej(fr.error); };
    fr.onload = function () {
      var url = fr.result;
      if (/gif/.test(file.type) || file.size < 350000) return res(url);
      var img = new Image();
      img.onload = function () {
        var max = 1800, w = img.naturalWidth, hh = img.naturalHeight, sc = Math.min(1, max / Math.max(w, hh));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * sc); cv.height = Math.round(hh * sc);
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = function () { rej(new Error('Could not read ' + file.name)); };
      img.src = url;
    };
    fr.readAsDataURL(file);
  });
}
function lightbox(src, cap) {
  var bg = h('<div class="modal-bg lightbox" role="dialog" aria-label="Picture"><figure><img alt=""><figcaption></figcaption></figure></div>');
  $('img', bg).src = src; $('img', bg).alt = cap || 'Slide picture'; $('figcaption', bg).textContent = cap || '';
  function close() { bg.remove(); document.removeEventListener('keydown', k, true); }
  function k(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  bg.onclick = close; document.addEventListener('keydown', k, true); document.body.appendChild(bg);
}
function imagesHtml(s) {
  return (s.images || []).map(function (im, k) {
    return '<figure class="simg al-' + (im.align || 'right') + '" style="width:' + (im.align === 'full' ? 100 : (im.width || 45)) + '%"><img src="' + esc(im.src) + '" alt="' + esc(im.caption || 'Slide picture') + '" data-k="' + k + '" loading="lazy">' + (im.caption ? '<figcaption>' + inl(im.caption) + '</figcaption>' : '') + '</figure>';
  }).join('');
}
function slideHtml(s) {
  if (s.k === 'title' || s.k === 'end') return { cls: 'title', html: '<div style="font-size:clamp(16px,2vw,26px);width:100%"><div class="pill" style="background:rgba(255,255,255,.2);color:#fff">Vulvar pathology · Exam review</div><h1>' + inl(s.title) + '</h1><div class="sbody tb">' + imagesHtml(s) + md(s.md || '') + '</div></div>' };
  if (s.k === 'section') return { cls: 'section', html: '<div style="font-size:clamp(16px,2vw,28px);width:100%">' + (s.kicker ? '<div class="pill" style="background:var(--teal);color:#fff">' + esc(s.kicker) + '</div>' : '') + '<h1>' + inl(s.title) + '</h1><div class="sbody tb">' + imagesHtml(s) + md(s.md || '') + '</div></div>' };
  var body;
  if (s.k === 'check') { var c = CHECK_ID[s.checkId]; body = c ? checkSlideHtml(c) : '<p class="muted">This quick check is no longer available.</p>'; }
  else if (s.k === 'question') body = md(s.md || '') + '<div class="fb good reveal md" hidden><span class="mark">Answer:</span> ' + md(s.answer || '').replace(/^<div class="md">|<\/div>$/g, '') + '</div>';
  else body = md(s.md || '', { imgQuery: s.q || s.title });
  return { cls: '', html: '<h2>' + (s.k === 'check' || s.k === 'question' ? '🧩 ' : '') + inl(s.title || '') + ' ' + (s.label ? badge(s.label) : '') + '</h2><div class="sbody">' + imagesHtml(s) + body + '</div>' };
}
function viewFaculty() {
  if (!teacherOk()) { requireTeacher(function () {}); app.appendChild(h('<div class="card">This area is for teachers. <a href="#/present">Presentation mode</a> is open to everyone.</div>')); return; }
  app.appendChild(h('<h1>Faculty / Teacher tools</h1>'));
  app.appendChild(h('<p class="muted">For the teaching staff. Students never see this area or its tools.</p>'));
  var g = h('<div class="grid g2"></div>');
  [['#/faculty/content', '✏️', 'Content & publishing', 'Edit Mode, draft status, preview, publish to students (and GitHub), version history and rollback.'],
    ['#/faculty/questions', '🧩', 'Question banks', 'Add, edit, duplicate, reorder and delete practice questions, section checks and assessment questions.'],
    ['#/faculty/media', '🖼', 'Pictures & media library', 'Upload, replace, reuse and remove pictures; captions, alt text, size and alignment for every picture slot.'],
    ['#/present', '🖥️', 'Presentation mode', 'PowerPoint-style lecture decks from the same content, with speaker notes, reveal-answer questions and a slide editor.'],
    ['#/teacher', '📊', 'Results & item analysis', 'Import student result files, view results and statistics, item analysis with distractor counts and discrimination index, and Excel (CSV) export.']
  ].forEach(function (c) { g.appendChild(h('<a class="card step" href="' + c[0] + '"><div class="n">' + c[1] + '</div><div><h2 style="margin:0 0 4px">' + c[2] + '</h2><p class="small">' + c[3] + '</p></div></a>')); });
  app.appendChild(g);
  app.appendChild(h('<div class="note" style="margin-top:16px"><b>Formative revision and practice — not a secure high-stakes examination system.</b> Practice progress and assessment results stay in each student\'s browser; students send result files to you (Results & item analysis).</div>'));
}
function viewPresentHub() {
  var T = teacherOk();
  if (T) app.appendChild(h('<p class="small noprint"><a href="#/faculty">← Faculty tools</a></p>'));
  app.appendChild(h('<h1>Presentation mode</h1>'));
  app.appendChild(h('<p class="muted">PowerPoint-style lecture built from the same content: full screen, keyboard controls, slide overview, speaker notes and “Reveal answer” questions.' + (T ? ' Teachers can edit, add, delete and reorder slides and upload pictures (✏️ Edit slides).' : '') + '</p>'));
  var g = h('<div class="grid g2"></div>');
  D.lectures.forEach(function (L) {
    var card = h('<div class="card"><div class="row"><span class="pill cnt">Lecture ' + L.num + '</span><span class="pill warn st" hidden></span></div><h2 style="margin:8px 0">' + esc(L.title) + '</h2><div class="row"><a class="btn primary" href="#/present/' + L.num + '">▶ Start presentation</a>' + (T ? '<a class="btn" href="#/present/' + L.num + '/edit">✏️ Edit slides</a>' : '') + '</div></div>');
    loadDeck(L.num).then(function (d) { $('.cnt', card).textContent = 'Lecture ' + L.num + ' · ' + d.slides.length + ' slides'; if (d.source !== 'original' && T) { var st = $('.st', card); st.hidden = false; st.textContent = 'Edited slides'; } });
    g.appendChild(card);
  });
  app.appendChild(g);
  app.appendChild(h('<div class="card" style="margin-top:16px"><h3 style="margin-top:0">Keyboard</h3><p class="small">→ / Space / PageDown: next · ← / PageUp: previous · <b>F</b>: full screen · <b>O</b>: overview · <b>N</b>: speaker notes · <b>R</b>: reveal answer' + (T ? ' · <b>E</b>: edit mode' : '') + ' · <b>Home/End</b>: first/last · <b>Esc</b>: close</p>' + (T ? '<h3>Where edits are kept</h3><p class="small">Slide edits and pictures are saved to the <b>draft</b> on the server (students do not see them yet). Use <b>Preview</b> and <b>Publish</b> in the editor bar to give them to students.</p>' : '') + '</div>'));
}
function requireTeacher(cb) {
  if (teacherOk()) return cb();
  modal('Teacher sign-in required', '<p>This is a teacher tool. Sign out, then sign in on the <b>Teacher</b> tab of the sign-in page.</p>', [{ label: 'Close' }, { label: 'Sign out', cls: 'primary', onClick: function () { CX.logout(); } }]);
}
function startPresentation(n, wantEdit) {
  var host = h('<div class="pres" role="dialog" aria-label="Presentation"><div class="pres-stage"><div class="slide"><p class="muted">Loading…</p></div></div></div>');
  document.body.appendChild(host);
  var alive = true;
  cleanup = function () { alive = false; if (host.__teardown) host.__teardown(); else host.remove(); };
  loadDeck(n).then(function (d) { if (alive) runPresentation(n, d, host, wantEdit); });
}
function runPresentation(n, deck, P, wantEdit) {
  var slides = deck.slides, i = 0, notesOn = false, overlay = null, editing = false, dirty = false, undo = [], saveT = null, pendingSnap = null;
  P.innerHTML = '<div class="pres-main"><div class="pres-stage"><div class="slide"></div></div><aside class="editor" hidden aria-label="Slide editor"></aside></div><div class="pres-notes" hidden></div>' +
    '<div class="pres-bar"><button class="btn b-exit">✕ Exit</button><button class="btn b-prev" aria-label="Previous slide">←</button><span class="cnt"></span><button class="btn b-next" aria-label="Next slide">→</button><button class="btn b-rev">Reveal answer</button><span class="saved small" aria-live="polite"></span><div class="spacer"></div><button class="btn b-ov">▦ Overview</button><button class="btn b-notes">🗒 Notes</button><button class="btn b-edit">✏️ Edit slides</button><button class="btn b-fs">⛶ Full screen</button></div>';
  var slide = $('.slide', P), notes = $('.pres-notes', P), ed = $('.editor', P);
  function orig() { return genDeck(n); }
  function snapshot() { undo.push(JSON.stringify(slides)); if (undo.length > 40) undo.shift(); }
  function persist() {
    dirty = true; $('.saved', P).textContent = 'Saving…';
    clearTimeout(saveT); saveT = setTimeout(function () { saveDeck(n, slides).then(function () { dirty = false; $('.saved', P).textContent = '✓ Saved to draft'; }, function (e) { $('.saved', P).textContent = '⚠ ' + e.message; }); }, 350);
  }
  function fit() {
    var body = $('.slide > .sbody', slide); if (!body) return;
    var size = Math.max(16, Math.min(34, slide.clientWidth / 36)); slide.style.fontSize = size + 'px';
    var guard = 0; while (body.scrollHeight > body.clientHeight + 2 && size > 11 && guard++ < 40) { size -= 1; slide.style.fontSize = size + 'px'; }
  }
  function draw() {
    if (!slides.length) { slides.push({ id: uid('c'), k: 'content', title: 'New slide', md: '', notes: '', images: [] }); }
    i = Math.max(0, Math.min(slides.length - 1, i));
    var s = slides[i], r = slideHtml(s);
    slide.className = 'slide' + (r.cls ? ' ' + r.cls : ''); slide.style.fontSize = ''; slide.innerHTML = r.html;
    $$('.simg img', slide).forEach(function (im) { im.onload = fit; im.onclick = function () { var x = s.images[+im.dataset.k]; lightbox(x.src, x.caption); }; });
    $('.cnt', P).textContent = (i + 1) + ' / ' + slides.length;
    $('.b-rev', P).hidden = !(s.k === 'check' || s.k === 'question');
    notes.innerHTML = '<b>Speaker notes:</b> ' + (s.notes ? inl(s.notes) : '—');
    notes.hidden = !notesOn;
    fit(); requestAnimationFrame(fit);
    if (editing) drawEditor();
  }
  function go(k) { i = Math.max(0, Math.min(slides.length - 1, k)); draw(); }
  function reveal() { var rv = $('.reveal', slide); if (rv) { rv.hidden = false; var s = slides[i]; if (s.k === 'check') { var c = CHECK_ID[s.checkId]; if (c && (c.type === 'mcq' || c.type === 'select')) (c.type === 'mcq' ? [c.answer] : c.answer).forEach(function (x) { var o = $('.opt[data-i="' + x + '"]', slide); if (o) o.classList.add('right'); }); } fit(); } }
  function titleOf(s) { return s.k === 'section' ? (s.kicker ? s.kicker + ' — ' : '') + s.title : s.title || '(untitled)'; }
  function overview() {
    if (overlay) { overlay.remove(); overlay = null; return; }
    overlay = h('<div class="overview" role="dialog" aria-label="Slide overview"></div>');
    slides.forEach(function (s, k) { var b = h('<button class="' + (k === i ? 'cur' : '') + '"><b>' + (k + 1) + (s.images && s.images.length ? ' · 🖼 ' + s.images.length : '') + '</b>' + esc(titleOf(s)) + '</button>'); b.onclick = function () { overlay.remove(); overlay = null; go(k); }; overlay.appendChild(b); });
    document.body.appendChild(overlay); var c = $('.cur', overlay); if (c) { c.focus(); c.scrollIntoView({ block: 'center' }); }
  }
  function fs() { if (!document.fullscreenElement) { (P.requestFullscreen ? P.requestFullscreen() : Promise.resolve()).catch(function () {}); } else document.exitFullscreen(); }
  function teardown() { document.removeEventListener('keydown', key); window.removeEventListener('resize', fit); document.removeEventListener('paste', onPaste); if (overlay) overlay.remove(); if (dirty) saveDeck(n, slides); P.remove(); }
  P.__teardown = teardown;
  function exit() { teardown(); if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); if (location.hash !== '#/present') location.hash = '#/present'; else route(); }
  function typing(e) { var t = (e.target || {}).tagName; return /INPUT|TEXTAREA|SELECT/.test(t) || (e.target && e.target.isContentEditable); }
  function key(e) {
    if (document.querySelector('.modal-bg')) return;
    if (e.key === 'Escape') { if (overlay) { overlay.remove(); overlay = null; } else if (typing(e)) e.target.blur(); else if (!document.fullscreenElement) exit(); return; }
    if (overlay || typing(e)) return;
    if ((e.ctrlKey || e.metaKey) && /^[zZ]$/.test(e.key) && editing) { e.preventDefault(); doUndo(); return; }
    if (['ArrowRight', 'PageDown', ' '].indexOf(e.key) >= 0) { e.preventDefault(); go(i + 1); }
    else if (['ArrowLeft', 'PageUp'].indexOf(e.key) >= 0) { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1);
    else if (/^[fF]$/.test(e.key)) fs(); else if (/^[oO]$/.test(e.key)) overview();
    else if (/^[nN]$/.test(e.key)) { notesOn = !notesOn; notes.hidden = !notesOn; } else if (/^[rR]$/.test(e.key)) reveal();
    else if (/^[eE]$/.test(e.key)) toggleEdit();
  }
  /* ---- editor ---- */
  function toggleEdit() {
    if (editing) { editing = false; ed.hidden = true; P.classList.remove('editing'); $('.b-edit', P).textContent = '✏️ Edit slides'; draw(); return; }
    requireTeacher(function () { editing = true; ed.hidden = false; P.classList.add('editing'); $('.b-edit', P).textContent = '✓ Done editing'; draw(); });
  }
  function change(fn, noSnap) { if (!noSnap) snapshot(); fn(); persist(); draw(); }
  function doUndo() { if (!undo.length) { toast('Nothing to undo.'); return; } slides = JSON.parse(undo.pop()); persist(); draw(); toast('Undone.'); }
  function newSlide(kind) {
    if (kind === 'question') return { id: uid('u'), k: 'question', title: 'Question', md: 'Type the question here.\n\n- A. …\n- B. …\n- C. …\n- D. …', answer: 'B. Type the answer and a short explanation.', notes: '', images: [] };
    if (kind === 'section') return { id: uid('u'), k: 'section', kicker: 'Section', title: 'New section', md: '', notes: '', images: [] };
    return { id: uid('u'), k: 'content', title: kind === 'picture' ? 'Picture' : 'New slide', md: kind === 'picture' ? '' : '**Key point:** type your text here.\n\n- First point\n- Second point', notes: '', images: [] };
  }
  function addPictures(files, align) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!list.length) { toast('Choose an image file (JPG, PNG, GIF, SVG or WebP).'); return; }
    $('.saved', P).textContent = 'Adding picture…';
    Promise.all(list.map(function (f) { return storeImage(f).then(function (src) { return { src: src, caption: '', width: align === 'full' ? 100 : 45, align: align || 'right' }; }); }))
      .then(function (ims) { change(function () { var s = slides[i]; s.images = (s.images || []).concat(ims); }); toast(ims.length + ' picture(s) added.'); })
      .catch(function (err) { toast(err.message || 'Could not add the picture.'); $('.saved', P).textContent = ''; });
  }
  function onPaste(e) {
    if (!editing) return;
    var files = Array.prototype.slice.call((e.clipboardData || {}).files || []);
    if (files.length && files.some(function (f) { return /^image\//.test(f.type); })) { e.preventDefault(); addPictures(files); }
  }
  document.addEventListener('paste', onPaste);
  var stage = $('.pres-stage', P);
  stage.addEventListener('dragover', function (e) { if (editing) { e.preventDefault(); stage.classList.add('drop'); } });
  stage.addEventListener('dragleave', function () { stage.classList.remove('drop'); });
  stage.addEventListener('drop', function (e) { if (!editing) return; e.preventDefault(); stage.classList.remove('drop'); addPictures(e.dataTransfer.files); });
  function field(label, html) { return '<div class="field"><label>' + label + '</label>' + html + '</div>'; }
  function drawEditor() {
    var s = slides[i], o = null;
    orig().some(function (x) { if (x.id === s.id) { o = x; return true; } return false; });
    var kindName = { title: 'Title slide', section: 'Section slide', content: 'Text slide', check: 'Quick check (from the question bank)', question: 'Question slide with reveal', end: 'Closing slide' }[s.k] || s.k;
    ed.innerHTML = '<div class="ed-head"><b>Slide ' + (i + 1) + ' of ' + slides.length + '</b><span class="small muted">' + kindName + '</span></div>' +
      '<div class="ed-row"><select class="ed-addkind" aria-label="Type of new slide"><option value="content">Text slide</option><option value="picture">Picture slide</option><option value="question">Question slide</option><option value="section">Section slide</option></select><button class="btn primary ed-add">＋ Add after</button></div>' +
      '<div class="ed-row"><button class="btn ed-dup">⧉ Duplicate</button><button class="btn ed-up" title="Move earlier"' + (i === 0 ? ' disabled' : '') + '>↑ Move</button><button class="btn ed-down" title="Move later"' + (i === slides.length - 1 ? ' disabled' : '') + '>↓ Move</button><button class="btn danger ed-del">🗑 Delete</button></div>' +
      (s.k === 'section' ? field('Small label above the title', '<input class="ed-kicker" value="' + esc(s.kicker || '') + '">') : '') +
      field('Title', '<input class="ed-title" value="' + esc(s.title || '') + '">') +
      (s.k === 'check' ? '<p class="small note">This slide shows a section check from the question bank. You can change its title, notes and pictures, move or delete it. To write your own question, add a <b>Question slide</b>.</p>'
        : field(s.k === 'question' ? 'Question (text)' : 'Slide text', '<textarea class="ed-md" rows="10" spellcheck="true">' + esc(s.md || '') + '</textarea>') +
          (s.k === 'question' ? field('Answer (shown when you press Reveal)', '<textarea class="ed-ans" rows="4">' + esc(s.answer || '') + '</textarea>') : '') +
          '<details class="small ed-help"><summary>Formatting help</summary><div><code>**bold**</code> · <code>*italic*</code> · a line starting <code>- </code> is a bullet · <code>1. </code> numbered · tables: <code>| A | B |</code> then <code>| --- | --- |</code> · start a paragraph with <code>**HIGH-YIELD FACT:**</code>, <code>**EXAM TRAP:**</code> or <code>**Why:**</code> for a coloured box · <code>**Image:** description</code> makes a described-image card.</div></details>') +
      '<div class="ed-sec"><b>Pictures</b><div class="ed-row"><label class="btn primary">🖼 Upload picture<input type="file" accept="image/*" multiple hidden class="ed-file"></label></div><p class="small muted" style="margin:4px 0">Or paste an image (Ctrl+V) or drag it onto the slide. Large photos are resized automatically. Use only images you are allowed to use and put the source in the caption.</p><div class="ed-imgs"></div></div>' +
      field('Speaker notes', '<textarea class="ed-notes" rows="3">' + esc(s.notes || '') + '</textarea>') +
      '<div class="ed-row"><button class="btn ed-undo"' + (undo.length ? '' : ' disabled') + '>↶ Undo</button>' + (o ? '<button class="btn ed-reset1">Reset this slide</button>' : '') + '</div>' +
      '<div class="ed-sec"><b>Whole lecture deck</b><p class="small muted" style="margin:4px 0">Source: ' + (deck.source === 'original' && !undo.length ? 'original generated slides' : 'your edited slides') + '. Edits are saved automatically to the draft; students see them after you publish.</p>' +
      '<div class="ed-col"><button class="btn ed-exp">⬇ Export slides file</button><label class="btn">⬆ Import slides file<input type="file" accept=".json,application/json" hidden class="ed-imp"></label><button class="btn danger ed-resetall">Reset whole deck to original</button></div></div>';
    var imgs = $('.ed-imgs', ed);
    (s.images || []).forEach(function (im, k) {
      var row = h('<div class="ed-img"><img alt=""><div class="ed-img-f"><input class="cap" placeholder="Caption / source (e.g. H&E ×200 — own collection)" aria-label="Caption"><div class="ed-row"><label class="small">Size <input type="range" class="w" min="15" max="100" step="5" aria-label="Picture size"></label><select class="al" aria-label="Position"><option value="right">Right of text</option><option value="left">Left of text</option><option value="center">Centred</option><option value="full">Full width</option></select></div><div class="ed-row"><button class="btn up small"' + (k === 0 ? ' disabled' : '') + ' title="Move up">↑</button><button class="btn dn small"' + (k === s.images.length - 1 ? ' disabled' : '') + ' title="Move down">↓</button><button class="btn danger rm small">Remove</button></div></div></div>');
      $('img', row).src = im.src; $('.cap', row).value = im.caption || ''; $('.w', row).value = im.width || 45; $('.al', row).value = im.align || 'right';
      $('.cap', row).addEventListener('focus', function () { pendingSnap = JSON.stringify(slides); });
      $('.cap', row).oninput = function (e) { flushSnap(); im.caption = e.target.value; persist(); redrawSlideOnly(); };
      $('.w', row).oninput = function (e) { flushSnap(true); im.width = +e.target.value; persist(); redrawSlideOnly(); };
      $('.al', row).onchange = function (e) { change(function () { im.align = e.target.value; }); };
      $('.up', row).onclick = function () { change(function () { s.images.splice(k - 1, 0, s.images.splice(k, 1)[0]); }); };
      $('.dn', row).onclick = function () { change(function () { s.images.splice(k + 1, 0, s.images.splice(k, 1)[0]); }); };
      $('.rm', row).onclick = function () { change(function () { s.images.splice(k, 1); }); };
      imgs.appendChild(row);
    });
    if (!(s.images || []).length) imgs.appendChild(h('<p class="small muted">No pictures on this slide.</p>'));
    function bindText(sel, prop) {
      var el = $(sel, ed); if (!el) return;
      el.addEventListener('focus', function () { pendingSnap = JSON.stringify(slides); });
      el.addEventListener('input', function () { flushSnap(); slides[i][prop] = el.value; persist(); redrawSlideOnly(); });
    }
    bindText('.ed-title', 'title'); bindText('.ed-kicker', 'kicker'); bindText('.ed-md', 'md'); bindText('.ed-ans', 'answer'); bindText('.ed-notes', 'notes');
    $('.ed-add', ed).onclick = function () {
      var kind = $('.ed-addkind', ed).value, ns = newSlide(kind);
      change(function () { slides.splice(i + 1, 0, ns); i++; });
      if (kind === 'picture') { var f = $('.ed-file', ed); if (f) f.click(); } else { var t = $('.ed-title', ed); if (t) { t.focus(); t.select(); } }
    };
    $('.ed-dup', ed).onclick = function () { change(function () { var c = JSON.parse(JSON.stringify(slides[i])); c.id = uid('u'); slides.splice(i + 1, 0, c); i++; }); };
    $('.ed-up', ed).onclick = function () { change(function () { slides.splice(i - 1, 0, slides.splice(i, 1)[0]); i--; }); };
    $('.ed-down', ed).onclick = function () { change(function () { slides.splice(i + 1, 0, slides.splice(i, 1)[0]); i++; }); };
    $('.ed-del', ed).onclick = function () {
      if (slides.length <= 1) { toast('A deck needs at least one slide.'); return; }
      confirmBox('Delete slide ' + (i + 1) + '?', 'Delete “' + titleOf(s) + '”? You can bring it back with Undo (or Ctrl+Z) while this presentation is open.', 'Delete slide', function () { change(function () { slides.splice(i, 1); if (i >= slides.length) i = slides.length - 1; }); }, true);
    };
    $('.ed-file', ed).onchange = function (e) { addPictures(e.target.files, slides[i].k === 'content' && !slides[i].md ? 'full' : 'right'); e.target.value = ''; };
    $('.ed-undo', ed).onclick = doUndo;
    if (o) $('.ed-reset1', ed).onclick = function () { confirmBox('Reset this slide', 'Put this slide back to its original text? Pictures you added to it are removed.', 'Reset slide', function () { change(function () { slides[i] = JSON.parse(JSON.stringify(o)); }); }, true); };
    $('.ed-exp', ed).onclick = function () { download('vulva-slides_lecture' + n + '_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ kind: 'vulva-review-slides', lecture: n, version: APP_VERSION, exportedAt: Date.now(), slides: slides })); toast('Slides file downloaded (pictures included).'); };
    $('.ed-imp', ed).onchange = function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      var r = new FileReader(); r.onload = function () {
        var j; try { j = JSON.parse(r.result); } catch (x) { toast('That is not a slides file.'); return; }
        if (!j || j.kind !== 'vulva-review-slides' || !Array.isArray(j.slides) || !j.slides.length) { toast('That is not a slides file for this platform.'); return; }
        var go2 = function () { change(function () { slides = j.slides; i = 0; }); toast('Slides imported (' + j.slides.length + ').'); };
        if (j.lecture !== n) confirmBox('Different lecture', 'This file holds slides for Lecture ' + j.lecture + '. Replace the Lecture ' + n + ' deck with it anyway?', 'Replace', go2, true); else confirmBox('Replace slides', 'Replace this deck with the ' + j.slides.length + ' slides in the file? You can Undo while the presentation is open.', 'Replace', go2);
      }; r.readAsText(f);
    };
    $('.ed-resetall', ed).onclick = function () { confirmBox('Reset the whole deck', 'Discard all slide edits and pictures for Lecture ' + n + ' in the draft and return to the original slides? Export a slides file first if you may want them back.', 'Reset deck', function () { resetDeck(n).then(function () { undo = []; slides = genDeck(n); deck.source = 'original'; i = Math.min(i, slides.length - 1); draw(); toast('Deck reset to the original.'); }); }, true); };
  }
  function flushSnap() { if (pendingSnap) { undo.push(pendingSnap); if (undo.length > 40) undo.shift(); pendingSnap = null; var u = $('.ed-undo', ed); if (u) u.disabled = false; } }
  function redrawSlideOnly() {
    var s = slides[i], r = slideHtml(s);
    slide.className = 'slide' + (r.cls ? ' ' + r.cls : ''); slide.style.fontSize = ''; slide.innerHTML = r.html;
    $$('.simg img', slide).forEach(function (im) { im.onload = fit; im.onclick = function () { var x = s.images[+im.dataset.k]; lightbox(x.src, x.caption); }; });
    notes.innerHTML = '<b>Speaker notes:</b> ' + (s.notes ? inl(s.notes) : '—');
    $('.b-rev', P).hidden = !(s.k === 'check' || s.k === 'question');
    fit();
  }
  $('.b-exit', P).onclick = exit; $('.b-prev', P).onclick = function () { go(i - 1); }; $('.b-next', P).onclick = function () { go(i + 1); };
  $('.b-rev', P).onclick = reveal; $('.b-ov', P).onclick = overview; $('.b-notes', P).onclick = function () { notesOn = !notesOn; notes.hidden = !notesOn; }; $('.b-fs', P).onclick = fs;
  $('.b-edit', P).onclick = toggleEdit;
  document.addEventListener('keydown', key); window.addEventListener('resize', fit);
  draw(); $('.b-next', P).focus();
  if (wantEdit) toggleEdit();
}

/* ---------------- TEACHER PORTAL ---------------- */
// Teacher rights come from the server session (role "admin"); the server re-checks them on every change.
function teacherOk() { return CX.role === 'admin'; }
function viewTeacher() {
  if (!teacherOk()) { requireTeacher(function () {}); app.appendChild(h('<div class="card">The results portal is for teachers.</div>')); return; }
  app.appendChild(h('<p class="small noprint"><a href="#/faculty">← Faculty tools</a></p><h1>Results & item analysis</h1>'));
  var tabs = h('<div class="tabs"><button data-t="res" class="on">📊 Results</button><button data-t="item">🔎 Item analysis</button><button data-t="set">⚙️ Settings</button><button data-t="help">❓ Help & deployment</button></div>');
  var body = h('<div></div>'); app.appendChild(tabs); app.appendChild(body);
  var state = { test: Object.keys(D.tests)[0], q: '', sort: 'submittedAt', dir: -1 };
  function show(t) { $$('button', tabs).forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); }); body.innerHTML = ''; ({ res: tResults, item: tItems, set: tSettings, help: tHelp })[t](body, state); }
  $$('button', tabs).forEach(function (b) { b.onclick = function () { show(b.dataset.t); }; });
  show('res');
}
function allResults() {
  var local = attempts().map(function (a) { return Object.assign({ src: 'This browser' }, a); });
  var imp = store.get('imported', []), seen = {}, out = [];
  local.concat(imp).forEach(function (a) { if (!seen[a.id]) { seen[a.id] = 1; out.push(a); } });
  return out;
}
function validAttempt(a) {
  if (!a || typeof a.id !== 'string' || !D.tests[a.test] || typeof a.name !== 'string') return false;
  if (Array.isArray(a.answers)) return !!normAttempt(a);
  return Array.isArray(a.qids) && !!a.answers && typeof a.answers === 'object';
}
function importFiles(files, done) {
  var imp = store.get('imported', []), have = {}, added = 0, bad = 0, tampered = 0, pending = files.length;
  allResults().forEach(function (a) { have[a.id] = 1; });
  if (!pending) return done(0, 0, 0);
  Array.prototype.forEach.call(files, function (f) {
    var r = new FileReader();
    r.onload = function () {
      var list = [];
      try { var j = JSON.parse(r.result); list = j && j.attempts ? j.attempts : Array.isArray(j) ? j : [j]; } catch (e) { bad++; }
      var checks = list.map(function (a) {
        if (!validAttempt(a)) { bad++; return Promise.resolve(); }
        // The check value covers the answers and score as submitted; the score shown is re-graded with the current key.
        return sha256(sigPayload(a)).then(function (s) {
          var n = normAttempt(a), rec = Object.assign({}, n, gradeAttempt(n), { src: 'Imported: ' + f.name, verified: s === a.sig });
          if (!rec.verified) tampered++;
          if (!have[a.id]) { have[a.id] = 1; imp.push(rec); added++; }
        });
      });
      Promise.all(checks).then(function () { if (--pending === 0) { store.set('imported', imp); done(added, bad, tampered); } });
    };
    r.onerror = function () { bad++; if (--pending === 0) { store.set('imported', imp); done(added, bad, tampered); } };
    r.readAsText(f);
  });
}
function kpis(list, S) {
  var ps = list.map(function (a) { return a.pct; }), emails = {};
  list.forEach(function (a) { emails[String(a.studentId || a.email || a.name).toLowerCase()] = 1; });
  var mean = ps.length ? Math.round(10 * ps.reduce(function (x, y) { return x + y; }, 0) / ps.length) / 10 : 0;
  return [['Attempts', list.length], ['Students', Object.keys(emails).length], ['Average', ps.length ? mean + '%' : '—'], ['Median', ps.length ? median(ps) + '%' : '—'], ['Highest', ps.length ? Math.max.apply(null, ps) + '%' : '—'], ['Lowest', ps.length ? Math.min.apply(null, ps) + '%' : '—'], ['Pass rate (≥' + S.pass + '%)', ps.length ? pct(ps.filter(function (p) { return p >= S.pass; }).length, ps.length) + '%' : '—']];
}
function tResults(body, st) {
  var S = settings();
  var ctl = h('<div class="card"><div class="row"><div class="field" style="margin:0"><label for="ft">Assessment</label><select id="ft"><option value="ALL">All assessments</option>' + Object.keys(D.tests).map(function (t) { return '<option value="' + t + '">' + esc(D.tests[t].title) + '</option>'; }).join('') + '</select></div><div class="field" style="margin:0;flex:1;min-width:180px"><label for="fq">Search name, Student ID or email</label><input id="fq" type="search" value="' + esc(st.q) + '"></div><div class="spacer"></div>' +
    '<label class="btn" style="margin-top:22px">⬆ Import result files<input type="file" accept=".json,application/json" multiple hidden></label><button class="btn ex1" style="margin-top:22px">⬇ Summary CSV</button><button class="btn ex2" style="margin-top:22px">⬇ Detailed CSV</button></div><p class="small muted" style="margin:8px 0 0">Results appear here from this browser and from result files students send you (import as many as you like; duplicates are ignored). CSV files open directly in Excel.</p></div>');
  body.appendChild(ctl);
  $('#ft', ctl).value = st.test;
  var out = h('<div></div>'); body.appendChild(out);
  function filtered() { var q = st.q.toLowerCase(); return allResults().filter(function (a) { return (st.test === 'ALL' || a.test === st.test) && (!q || (a.name + ' ' + (a.studentId || '') + ' ' + (a.email || '')).toLowerCase().indexOf(q) >= 0); }); }
  function draw() {
    out.innerHTML = '';
    var list = filtered();
    out.appendChild(h('<div class="grid g4" style="margin:14px 0">' + kpis(list, S).map(function (k) { return '<div class="card kpi"><div class="v">' + esc(k[1]) + '</div><div class="l">' + esc(k[0]) + '</div></div>'; }).join('') + '</div>'));
    if (!list.length) { out.appendChild(h('<div class="card">No results yet for this filter. Ask students to click “Download result file” after an assessment and send you the file, then import it here.</div>')); return; }
    var by = {}; list.forEach(function (a) { Object.keys(a.byTopic || {}).forEach(function (k) { by[k] = by[k] || [0, 0]; by[k][0] += a.byTopic[k][0]; by[k][1] += a.byTopic[k][1]; }); });
    var tp = h('<div class="card"><h2 style="margin-top:0">Class topic performance</h2><p class="small muted">Weakest topics first.</p></div>'); tp.appendChild(topicBars(by)); out.appendChild(tp);
    var cols = [['name', 'Name'], ['studentId', 'Student ID'], ['email', 'Email'], ['test', 'Assessment'], ['score', 'Score'], ['pct', '%'], ['correct', 'Correct'], ['incorrect', 'Incorrect'], ['unanswered', 'Unanswered'], ['submittedAt', 'Date'], ['src', 'Source']];
    var t = h('<div class="card" style="margin-top:16px;overflow-x:auto"><h2 style="margin-top:0">Student results (' + list.length + ')</h2><table class="data"><thead><tr>' + cols.map(function (c) { return '<th class="sort" data-k="' + c[0] + '" tabindex="0" aria-sort="' + (st.sort === c[0] ? (st.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + c[1] + (st.sort === c[0] ? (st.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '<th>Check</th></tr></thead><tbody></tbody></table></div>');
    list.sort(function (a, b) { var x = a[st.sort] == null ? '' : a[st.sort], y = b[st.sort] == null ? '' : b[st.sort]; if (typeof x === 'string') { x = x.toLowerCase(); y = String(y).toLowerCase(); } return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    list.forEach(function (a) {
      var tr = h('<tr class="click" tabindex="0"><td>' + esc(a.name) + '</td><td>' + esc(a.studentId || '—') + '</td><td>' + esc(a.email || '') + '</td><td>' + esc(D.tests[a.test] ? D.tests[a.test].title : a.test) + '</td><td>' + a.score + '/' + a.total + '</td><td><b>' + a.pct + '%</b></td><td>' + a.correct + '</td><td>' + a.incorrect + '</td><td>' + a.unanswered + '</td><td>' + fmtDate(a.submittedAt) + '</td><td class="small">' + esc(a.src) + '</td><td>' + (a.verified === false ? '<span class="pill warn" title="The file was edited after it was downloaded">⚠ edited</span>' : '<span class="pill good">✓</span>') + '</td></tr>');
      tr.onclick = function () { studentDetail(a); }; tr.onkeydown = function (e) { if (e.key === 'Enter') studentDetail(a); };
      $('tbody', t).appendChild(tr);
    });
    $$('th.sort', t).forEach(function (th) { var fn = function () { var k = th.dataset.k; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = 1; } draw(); }; th.onclick = fn; th.onkeydown = function (e) { if (e.key === 'Enter') fn(); }; });
    out.appendChild(t);
    var imp = store.get('imported', []);
    if (imp.length) { var cl = h('<div class="row" style="margin-top:12px"><button class="btn danger">Remove all imported results (' + imp.length + ')</button></div>'); $('button', cl).onclick = function () { confirmBox('Remove imported results', 'This removes the ' + imp.length + ' imported result(s) from this browser. The original files are not affected, and results taken in this browser stay.', 'Remove', function () { store.set('imported', []); draw(); }, true); }; out.appendChild(cl); }
  }
  $('#ft', ctl).onchange = function (e) { st.test = e.target.value; draw(); };
  $('#fq', ctl).oninput = function (e) { st.q = e.target.value; draw(); };
  $('input[type=file]', ctl).onchange = function (e) { importFiles(e.target.files, function (a, b, t) { toast(a + ' result(s) imported' + (b ? ', ' + b + ' file(s)/record(s) not recognised' : '') + (t ? ', ' + t + ' marked as edited' : '') + '.'); e.target.value = ''; draw(); }); };
  $('.ex1', ctl).onclick = function () {
    var rows = [['Name', 'Student ID', 'Email', 'Assessment', 'Score', 'Total', 'Percentage', 'Correct', 'Incorrect', 'Unanswered', 'Time used (min)', 'Started', 'Submitted', 'Auto-submitted', 'File check', 'Source']];
    filtered().forEach(function (a) { rows.push([a.name, a.studentId || '', a.email || '', D.tests[a.test].title, a.score, a.total, a.pct, a.correct, a.incorrect, a.unanswered, Math.round(a.durationSec / 6) / 10, new Date(a.startedAt).toLocaleString(), new Date(a.submittedAt).toLocaleString(), a.auto ? 'yes' : 'no', a.verified === false ? 'edited' : 'ok', a.src]); });
    download('vulva-results-summary_' + st.test + '.csv', csv(rows), 'text/csv;charset=utf-8');
  };
  $('.ex2', ctl).onclick = function () {
    var rows = [['Name', 'Student ID', 'Email', 'Assessment', 'Submitted', 'Question code', 'Question', 'Topic', 'Concept', 'Answer given', 'Correct answer', 'Result']];
    filtered().forEach(function (a) { attemptQs(a).forEach(function (q) { var g = givenIdx(a, q); rows.push([a.name, a.studentId || '', a.email || '', D.tests[a.test].title, new Date(a.submittedAt).toLocaleString(), q.code, q.id, D.topics[q.topic].name, conceptName(q.concept), g == null ? '' : g < 0 ? '(option removed)' : LETTERS[g], LETTERS[q.answer], g == null ? 'unanswered' : isRight(a, q) ? 'correct' : 'incorrect']); }); });
    download('vulva-results-detailed_' + st.test + '.csv', csv(rows), 'text/csv;charset=utf-8');
  };
  draw();
}
function studentDetail(a) {
  var html = '<p class="small muted">' + (a.studentId ? 'Student ID ' + esc(a.studentId) + ' · ' : '') + (a.email ? esc(a.email) + ' · ' : '') + esc(D.tests[a.test].title) + ' · ' + fmtDate(a.submittedAt) + (a.auto ? ' · auto-submitted' : '') + ' · time used ' + fmtDur(a.durationSec) + '</p><p><b>' + a.score + '/' + a.total + ' (' + a.pct + '%)</b> — ' + a.correct + ' correct, ' + a.incorrect + ' incorrect, ' + a.unanswered + ' unanswered.</p>' +
    '<div class="tablewrap"><table class="data"><thead><tr><th>Q</th><th>Topic</th><th>Given</th><th>Key</th><th></th></tr></thead><tbody>' +
    attemptQs(a).map(function (q) { var g = givenIdx(a, q); return '<tr><td>' + esc(q.code) + '</td><td>' + esc(D.topics[q.topic].name) + '</td><td>' + (g == null ? '—' : g < 0 ? '?' : LETTERS[g]) + '</td><td>' + LETTERS[q.answer] + '</td><td>' + (g == null ? '<span class="pill warn">blank</span>' : isRight(a, q) ? '<span class="pill good">✓</span>' : '<span class="pill bad">✗</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  modal(a.name, html);
}
function itemStats(test, list) {
  // difficulty (% correct), % incorrect / unanswered, distractor counts, and upper–lower 27% discrimination index (n ≥ 10)
  // Per question, only the attempts whose paper contained it are counted (questions can be added later).
  return QBY[test].map(function (q, i) {
    var took = list.filter(function (a) { return (a.qids || []).indexOf(q.id) >= 0; });
    var n = took.length, sorted = took.slice().sort(function (a, b) { return b.score - a.score; });
    var k = Math.max(1, Math.round(n * 0.27)), up = sorted.slice(0, k), lo = sorted.slice(n - k);
    var dist = q.options.map(function () { return 0; }), blank = 0;
    took.forEach(function (a) { var g = givenIdx(a, q); if (g == null) blank++; else if (g >= 0) dist[g]++; });
    var right = dist[q.answer], wrongN = n - right - blank;
    var di = null;
    if (n >= 10) { var pu = up.filter(function (a) { return isRight(a, q); }).length / k, pl = lo.filter(function (a) { return isRight(a, q); }).length / k; di = Math.round((pu - pl) * 100) / 100; }
    var wrong = dist.map(function (c, j) { return [j, c]; }).filter(function (x) { return x[0] !== q.answer && x[1] > 0; }).sort(function (x, y) { return y[1] - x[1]; })[0];
    return { q: q, i: i, n: n, p: pct(right, n), pw: pct(wrongN, n), pb: pct(blank, n), dist: dist, blank: blank, di: di, wrong: wrong };
  });
}
function tItems(body, st) {
  if (st.test === 'ALL') st.test = Object.keys(D.tests)[0];
  var ctl = h('<div class="card"><div class="row"><div class="field" style="margin:0"><label for="it">Assessment</label><select id="it">' + Object.keys(D.tests).map(function (t) { return '<option value="' + t + '">' + esc(D.tests[t].title) + '</option>'; }).join('') + '</select></div><div class="field" style="margin:0"><label for="is">Sort by</label><select id="is"><option value="p">Hardest first (% correct)</option><option value="di">Lowest discrimination first</option><option value="i">Question order</option></select></div><div class="spacer"></div><button class="btn exi" style="margin-top:22px">⬇ Item analysis CSV</button></div>' +
    '<p class="small muted" style="margin:8px 0 0"><b>% correct</b> = item difficulty. <b>A–D</b> = how many chose each option (key in green). <b>DI</b> = discrimination index: proportion correct in the top 27% of scorers minus the bottom 27% (shown when at least 10 attempts are available; ≥0.3 good, 0.2–0.29 acceptable, &lt;0.2 review the item, negative = check the key). A distractor chosen by no one is not working.</p></div>');
  body.appendChild(ctl); $('#it', ctl).value = st.test; st.isort = st.isort || 'p'; $('#is', ctl).value = st.isort;
  var out = h('<div></div>'); body.appendChild(out);
  function list() { return allResults().filter(function (a) { return a.test === st.test; }); }
  function draw() {
    out.innerHTML = '';
    var L = list();
    if (!L.length) { out.appendChild(h('<div class="card" style="margin-top:14px">No results for this assessment yet.</div>')); return; }
    var rows = itemStats(st.test, L), optCols = [];
    rows.forEach(function (r) { while (optCols.length < r.dist.length) optCols.push(optCols.length); });
    rows.sort(function (a, b) { return st.isort === 'i' ? a.i - b.i : st.isort === 'di' ? (a.di == null ? 9 : a.di) - (b.di == null ? 9 : b.di) : a.p - b.p; });
    var t = h('<div class="card" style="margin-top:14px;overflow-x:auto"><h2 style="margin-top:0">Item analysis · ' + L.length + ' attempt(s)' + (L.length < 10 ? ' <span class="pill warn">DI needs ≥10 attempts</span>' : '') + '</h2><table class="data"><thead><tr><th>Code</th><th>Topic</th><th>% correct</th><th>% incorrect</th><th>% unanswered</th>' + optCols.map(function (j) { return '<th>' + LETTERS[j] + '</th>'; }).join('') + '<th>Blank</th><th>Key</th><th>DI</th><th>Top distractor</th></tr></thead><tbody></tbody></table></div>');
    rows.forEach(function (r) {
      var diCell = r.di == null ? '—' : '<span class="' + (r.di < 0 ? 'neg' : r.di < 0.2 ? 'lowdi' : '') + '">' + r.di.toFixed(2) + '</span>';
      var tr = h('<tr class="click" tabindex="0"><td>' + esc(r.q.code) + '</td><td>' + esc(D.topics[r.q.topic].name) + '</td><td><b>' + r.p + '%</b></td><td>' + r.pw + '%</td><td>' + r.pb + '%</td>' + optCols.map(function (j) { var c = r.dist[j]; if (c == null) return '<td class="muted">—</td>'; return '<td' + (j === r.q.answer ? ' style="color:var(--good);font-weight:800"' : c === 0 ? ' class="muted"' : '') + '>' + c + ' <span class="small muted">(' + pct(c, r.n) + '%)</span></td>'; }).join('') + '<td>' + r.blank + '</td><td>' + LETTERS[r.q.answer] + '</td><td>' + diCell + '</td><td>' + (r.wrong ? LETTERS[r.wrong[0]] + ' (' + r.wrong[1] + ')' : '—') + '</td></tr>');
      var open = function () { var m = modal(r.q.code + ' · ' + D.topics[r.q.topic].name, ''); $('.mbody', m.el).appendChild(reviewItem(r.q, null, false)); var pl = $('.mbody .pill', m.el); if (pl) pl.remove(); };
      tr.onclick = open; tr.onkeydown = function (e) { if (e.key === 'Enter') open(); };
      $('tbody', t).appendChild(tr);
    });
    out.appendChild(t);
  }
  $('#it', ctl).onchange = function (e) { st.test = e.target.value; draw(); };
  $('#is', ctl).onchange = function (e) { st.isort = e.target.value; draw(); };
  $('.exi', ctl).onclick = function () {
    var L = list(); if (!L.length) { toast('No results for this assessment yet.'); return; }
    var rows = [['Code', 'Question', 'Topic', 'Concept', 'Lecture', 'Section', 'Difficulty level', 'Source type', 'Previous-exam concept', 'Image-based', 'Integrated', 'Key', 'Attempts', '% correct', '% incorrect', '% unanswered', 'A', 'B', 'C', 'D', 'E', 'Blank', 'Discrimination index']];
    itemStats(st.test, L).forEach(function (r) { var q = r.q; rows.push([q.code, q.id, D.topics[q.topic].name, conceptName(q.concept), q.lecture, q.section, q.difficulty, q.sourceType, q.previousExam ? 'yes' : 'no', q.imageBased ? 'yes' : 'no', q.integrated ? 'yes' : 'no', LETTERS[q.answer], r.n, r.p, r.pw, r.pb, r.dist[0], r.dist[1], r.dist[2], r.dist[3], r.dist[4] == null ? '' : r.dist[4], r.blank, r.di == null ? '' : r.di]); });
    download('vulva-item-analysis_' + st.test + '.csv', csv(rows), 'text/csv;charset=utf-8');
  };
  draw();
}
function tSettings(body) {
  var S = settings();
  var c = h('<div class="grid g2"><div class="card"><h2 style="margin-top:0">Assessment settings</h2><div class="field"><label for="sp">Pass mark (%) — used for the pass-rate statistic</label><input id="sp" type="number" min="0" max="100" value="' + S.pass + '"></div>' +
    Object.keys(D.tests).map(function (t) { return '<div class="field"><label for="sm-' + t + '">Time limit — ' + esc(D.tests[t].title) + ' (minutes)</label><input id="sm-' + t + '" type="number" min="5" max="240" value="' + S.minutes[t] + '"></div>'; }).join('') +
    '<button class="btn primary sv">Save settings</button><p class="small muted">These settings apply to this browser only. To change the default time limit for every student, use Faculty tools → Content & publishing → Course settings.</p></div>' +
    '<div class="card"><h2 style="margin-top:0">Passwords</h2><p class="small">The shared student password and the teacher accounts are set on the server (see DEPLOY.md: <code>STUDENT_PASSWORD_HASH</code>, <code>ADMIN_PASSWORD_HASH</code>). Changing one there signs out everyone who used the old one.</p>' +
    '<h2>Data in this browser</h2><p class="small">' + attempts().length + ' attempt(s) taken here · ' + store.get('imported', []).length + ' imported.</p><button class="btn danger wipe">Delete attempts taken in this browser</button></div></div>');
  $('.sv', c).onclick = function () {
    var p = Math.max(0, Math.min(100, +$('#sp', c).value || 50)), m = {};
    Object.keys(D.tests).forEach(function (t) { m[t] = Math.max(5, Math.min(240, +$('#sm-' + t, c).value || D.tests[t].minutes)); });
    store.set('settings', { pass: p, minutes: m }); toast('Settings saved.');
  };
  $('.wipe', c).onclick = function () { confirmBox('Delete attempts', 'This permanently deletes the ' + attempts().length + ' attempt(s) taken in this browser. Export a CSV first if you need them. Imported results are kept.', 'Delete', function () { store.set('attempts', []); route(); }, true); };
  body.appendChild(c);
}
function tHelp(body) {
  body.appendChild(h('<div class="card md"><h2 style="margin-top:0">How results reach you</h2>' +
    '<ol><li>Students sign in with the shared student password and take an assessment. The result is stored in <b>their</b> browser and shown to them with explanations and weak areas.</li><li>They click <b>⬇ Download result file</b> (on the result page) or <b>Download all my results</b> (My Progress) and send the .json file to you.</li><li>You choose <b>⬆ Import result files</b> here, select all the files at once, and export <b>Summary CSV</b> or <b>Detailed CSV</b> for Excel.</li></ol>' +
    '<div class="co clar"><p><b>Formative revision and practice — not a secure high-stakes examination system.</b> The shared student login keeps the platform private but does not identify individual students; name and Student ID are typed by the student. Result files carry a check value that flags casual editing. Questions are graded by their permanent question id, so editing or reordering questions later does not change how old result files are read.</p></div>' +
    '<h3>For official examinations</h3><p>Use individual student accounts with server-side delivery and scoring. The server already separates roles and permissions, so individual accounts can be added later without redesigning the platform.</p></div>'));
}

/* ---------------- boot ---------------- */
reindex();
function startApp() {
  shell();
  installPictureHandlers();
  // Teachers: the editor (loaded by boot.js only for teacher sessions) plugs in here.
  if (CX.role === 'admin' && typeof window.VULVA_EDITOR === 'function') window.VULVA_EDITOR({
    D: D, CX: CX, HOOKS: HOOKS, route: route, reindex: reindex, num: num, md: md, inl: inl, esc: esc, h: h, $: $, $$: $$,
    modal: modal, confirmBox: confirmBox, toast: toast, uid: uid, slug: slug, download: download, figCard: figCard, picKey: picKey,
    pics: function () { return PICS; }, allPicSlots: allPicSlots, readImageFile: readImageFile, storeImage: storeImage, lightbox: lightbox,
    sbaCard: sbaCard, renderCheck: renderCheck, LETTERS: LETTERS, TYPE_NAMES: TYPE_NAMES, LABEL_TEXT: LABEL_TEXT, STARS: STARS, badge: badge, stars: stars,
    index: function () { return { SECTIONS: SECTIONS, SUBS: SUBS, ORDER: ORDER, QID: QID, PID: PID, CHECK_ID: CHECK_ID, QBY: QBY }; },
    cleanup: function (fn) { cleanup = fn; }, app: function () { return app; }, loadDeck: loadDeck
  });
  window.addEventListener('hashchange', route);
  route();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp); else startApp();
window.__vulva = { D: D, md: md, buildDeck: buildDeck, gradeAttempt: gradeAttempt };
}
window.VULVA_MAIN = main;
})();
