/* Vulvar Pathology Exam Review — learner app (connected to the platform's Apps Script backend).
   main(D, CX) is started by boot.js after sign-in.
   D  = the Learn content (lectures, section checks, review, pictures, slides), decrypted in this browser with
        the key the backend releases only after sign-in (teachers who edit get their draft instead).
   CX = the connection: { role: 'student' | 'admin', username, name, api(action, payload) → Promise, logout(), … }.
   Practice and assessment questions are NOT in D: they live in the backend question bank (Gyn.gs) and are
   fetched, checked and graded there, so answers never reach the browser before they should.
   The teacher editor (editor.js) plugs in through the HOOKS object below; every change it makes is checked
   again by the backend (teacher session), so hiding it from students is only for tidiness. */
(function () {
'use strict';
function main(D, CX) {
var MOD = String(CX.module || 'vulva').split('-')[0];
var P = (D.meta.storagePrefix || MOD + '_') + (CX.role === 'admin' ? 't_' : 'u_' + String(CX.username || '').toLowerCase().replace(/[^a-z0-9]+/g, '') + '_');
// Extension points used by the teacher editor (absent for students: all no-ops).
var HOOKS = { afterRender: null, contentChanged: null, uploadImage: null, route: null, faculty: null, figTools: null, editing: function () { return false; } };
var APP_VERSION = D.meta.version;
var STORAGE_OK = true;
try { localStorage.setItem(P + '__t', '1'); localStorage.removeItem(P + '__t'); } catch (e) { STORAGE_OK = false; }
var mem = {};
var store = {
  get: function (k, d) { try { var v = STORAGE_OK ? localStorage.getItem(P + k) : mem[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v, noSync) { var s = JSON.stringify(v); try { if (STORAGE_OK) localStorage.setItem(P + k, s); else mem[k] = s; } catch (e) { mem[k] = s; } if (!noSync && SYNC_KINDS[k]) queueSync(k); },
  del: function (k) { try { if (STORAGE_OK) localStorage.removeItem(P + k); delete mem[k]; } catch (e) {} }
};

// Study progress that follows the student to every device (saved on the backend, vulvaProgressSave).
var SYNC_KINDS = { studied: 'studied', facts2: 'facts', checks: 'checks', last: 'last' }, syncQ = {}, syncT = null;
function queueSync(k) {
  if (CX.role !== 'student') return;
  syncQ[k] = 1; clearTimeout(syncT);
  syncT = setTimeout(function () {
    var items = Object.keys(syncQ).map(function (key) { return { kind: SYNC_KINDS[key], value: store.get(key, {}) }; }); syncQ = {};
    CX.api('vulvaProgressSave', { items: items });
  }, 2500);
}
window.addEventListener('pagehide', function () { if (Object.keys(syncQ).length) { clearTimeout(syncT); var items = Object.keys(syncQ).map(function (key) { return { kind: SYNC_KINDS[key], value: store.get(key, {}) }; }); syncQ = {}; CX.api('vulvaProgressSave', { items: items }, { keepalive: true }); } });

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
/** Pictures in the media library are stored encrypted; boot.js decrypts every <img data-media> after sign-in. */
var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function imgTag(src, attrs) { src = String(src || ''); return /^media\//.test(src) ? '<img src="' + BLANK + '" data-media="' + esc(src) + '" ' + attrs + '>' : '<img src="' + esc(src) + '" ' + attrs + ' loading="lazy">'; }
var MICRO = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="10" fill="#e3f3f2"/><path d="M18 10h8v4h-2v10a8 8 0 1 1-4 0V14h-2z" fill="none" stroke="#0e7c7b" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 38h24" stroke="#0f2a4a" stroke-width="2.6" stroke-linecap="round"/><circle cx="22" cy="31" r="3" fill="#0e7c7b"/></svg>';
function figCard(desc) {
  // Picture slot. Identified by its description (e.g. "pic:vu012"), so the same slot shows the same picture in the lecture, questions and slides.
  var key = picKey(desc), p = PICS[key], E = HOOKS.editing();
  var tools = E && HOOKS.figTools ? HOOKS.figTools(key, p) : '';
  var attrs = ' data-pic="' + key + '" data-desc="' + esc(desc) + '"' + (E ? ' tabindex="0"' : '');
  if (p) {
    var al = p.align && p.align !== 'center' ? ' al-' + p.align : '', w = p.width && p.width < 100 && p.align !== 'full' ? ' style="--w:' + (+p.width) + '%"' : '';
    return '<figure class="fig pic' + al + (w ? ' sized' : '') + '"' + attrs + w + '>' + (p.title ? '<div class="fig-t">' + inl(p.title) + '</div>' : '') + imgTag(p.src, 'alt="' + esc(p.alt || p.caption || desc) + '" title="Click to enlarge"') + '<figcaption class="cap">' + inl(p.caption || desc) + (p.description ? '<div class="small">' + inl(p.description) + '</div>' : '') + (p.credit ? '<div class="small muted">' + inl(p.credit) + '</div>' : '') + '</figcaption>' + tools + '</figure>';
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
var SECTIONS, SUBS, ORDER, NUM, CHECKS_BY_SEC, CHECK_ID, PR, PID, PBY_SUB, PBY_CONCEPT, CONCEPTS, SEC_TOPIC, RV;
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
  D.checks = D.checks || []; D.tests = D.tests || {};
  CHECKS_BY_SEC = {}; CHECK_ID = {}; D.checks.forEach(function (c) { CHECK_ID[c.id] = c; (CHECKS_BY_SEC[c.sec] = CHECKS_BY_SEC[c.sec] || []).push(c); });
  CONCEPTS = D.concepts;
  // Practice questions: the server's index (ids + where they belong), in the teacher's chosen order.
  var order = ((D.questionOrder || {}).practice || []), pos = {}; order.forEach(function (id, i) { pos[id] = i; });
  PR = (SV.practiceIndex || []).slice().sort(function (a, b) { var x = id2pos(a.id), y = id2pos(b.id); return x - y || (a.id < b.id ? -1 : 1); });
  function id2pos(id) { return id in pos ? pos[id] : 1e6; }
  PID = {}; PBY_SUB = {}; PBY_CONCEPT = {};
  PR.forEach(function (x) { PID[x.id] = x; (PBY_SUB[x.sub] = PBY_SUB[x.sub] || []).push(x); (PBY_CONCEPT[x.concept] = PBY_CONCEPT[x.concept] || []).push(x); });
  SEC_TOPIC = {}; Object.keys(D.topics).forEach(function (k) { D.topics[k].sections.forEach(function (sid) { SEC_TOPIC[sid] = k; }); });
  RV = D.review; ['facts', 'traps', 'comparisons', 'morphology', 'review15'].forEach(function (k) { RV[k] = RV[k] || []; });
  PICS = D.pics || (D.pics = {});
}
function num(id) { return NUM[id] || id; }
/** topic of a practice question: by its section, or by the section of its learning block */
function secTopic(x) { return SEC_TOPIC[x.section] || SEC_TOPIC[(SUBS[x.sub] || SUBS[x.section] || {}).section] || ''; }
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
    '<div class="userchip"><button class="btn uc" type="button" aria-haspopup="true" aria-expanded="false">👤 <span class="lbl">' + esc(CX.name || (CX.role === 'admin' ? 'Teacher' : 'Student')) + '</span></button><div class="ucm" hidden>' + (CX.role === 'student' ? '<div class="small muted" style="padding:6px 10px">Student ID ' + esc(CX.username) + '</div><button type="button" class="cp">🔑 Change password</button>' : '') + '<button type="button" class="lo">Sign out</button></div></div></div></header>'), document.body.firstChild);
  var uc = $('.userchip .uc'), ucm = $('.userchip .ucm');
  uc.onclick = function (e) { e.stopPropagation(); ucm.hidden = !ucm.hidden; uc.setAttribute('aria-expanded', !ucm.hidden); };
  document.addEventListener('click', function () { ucm.hidden = true; uc.setAttribute('aria-expanded', 'false'); });
  if ($('.userchip .cp')) $('.userchip .cp').onclick = function () { CX.changePassword(); };
  $('.userchip .lo').onclick = function () { if (HOOKS.beforeLogout && HOOKS.beforeLogout() === false) return; CX.logout(); };
  $$('.nav a').forEach(function (a) { navEls[a.dataset.k] = a; });
  $('.searchbox').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#gsearch').value.trim(); if (v.length > 1) location.hash = '#/search/' + encodeURIComponent(v); });
  app = $('#app');
  document.body.appendChild(h('<footer class="footer">' + esc(D.meta.title) + ' · ' + esc(D.meta.author) + ', ' + esc(D.meta.role) + ' · ' + esc(D.meta.dept) + '<br>Content: ' + esc(D.meta.contentNote) + ' Your progress and results are saved to your account on the platform. Version ' + esc(APP_VERSION) + '.</footer>'));
}
function setNav(k) { Object.keys(navEls).forEach(function (x) { navEls[x].classList.toggle('active', x === k); if (x === k) navEls[x].setAttribute('aria-current', 'page'); else navEls[x].removeAttribute('aria-current'); }); }
var cleanup = null;
function route() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  $$('.modal-bg').forEach(function (m) { m.remove(); });
  var hsh = decodeURIComponent(location.hash.replace(/^#\/?/, '')), parts = hsh.split('/');
  var v = parts[0] || '';
  window.scrollTo(0, 0);
  app.innerHTML = ''; routeTok++;
  if (!STORAGE_OK) app.appendChild(h('<div class="note" style="margin-bottom:14px">This browser is blocking local storage (for example, a private window). You can use everything, but progress and results will be lost when the page closes.</div>'));
  var cur = activeAssessment();
  if (cur && v !== 'test') app.appendChild(h('<div class="note noprint" style="margin-bottom:14px">⏱ You have an assessment in progress: <a href="#/test/' + esc(cur.id) + '">return to ' + esc(cur.title) + '</a>. The timer keeps running.</div>'));
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
  else if (v === 'teacher') { setNav('faculty'); viewTeacher(parts[1]); }
  else { setNav('home'); viewHome(); }
  var h1 = $('h1', app); if (h1) document.title = h1.textContent + ' — ' + D.meta.short;
  if (HOOKS.afterRender) HOOKS.afterRender(v, parts);
}

/* ---------------- progress state (server) ---------------- */
// SV = this student's state from the backend (vulvaBootstrap): assessments, practice index, revision queue,
// topic analysis and synced progress. Refreshed after practice and assessments.
var SV = { assessments: [], practiceIndex: [], srs: {}, due: [], priorities: [], topics: [], progress: { practice: {} } }, svAt = 0, svBusy = null;
function applyBootstrap(r) {
  SV = r; SV.progress = SV.progress || {}; SV.progress.practice = SV.progress.practice || {}; svAt = Date.now();
  // progress saved on the backend wins over this browser's copy for items it knows about
  if (CX.role === 'student') {
    [['studied', 'studied'], ['facts2', 'facts'], ['checks', 'checks']].forEach(function (k) { var srv = SV.progress[k[1]]; if (srv && Object.keys(srv).length) store.set(k[0], Object.assign(store.get(k[0], {}), srv), true); });
    if (SV.progress.last && (!store.get('last', null) || SV.progress.last.at > store.get('last', {}).at)) store.set('last', SV.progress.last, true);
  }
  if (SECTIONS) reindex();
}
function refreshServer(force) {
  if (svBusy) return svBusy;
  if (!force && Date.now() - svAt < 60000) return Promise.resolve(SV);
  svBusy = CX.api('vulvaBootstrap').then(function (r) { svBusy = null; if (r.ok) applyBootstrap(r); return SV; }, function () { svBusy = null; return SV; });
  return svBusy;
}
function studied() { return store.get('studied', {}); }
function lectureProgress(n) { var L = D.lectures[n - 1], st = studied(); var done = L.sections.filter(function (s) { return st[s.id]; }).length; return { done: done, total: L.sections.length }; }
function activeAssessment() { return (SV.assessments || []).filter(function (a) { return a.active; })[0] || null; }

/* ---------------- activity, revision queue, priorities ---------------- */
function touch(label, href) { store.set('last', { label: label, href: href, at: Date.now() }); }
function dueConcepts() { var S = SV.srs || {}, now = Date.now(); return Object.keys(S).filter(function (k) { return S[k].due <= now; }).sort(function (a, b) { return S[a].due - S[b].due; }); }
function topicName(k) { return D.topics[k] ? D.topics[k].name : k; }
/** Revision priorities computed on the server from the latest attempt at each assessment. */
function priorityCards(list, n) {
  var P = (list || []).slice(0, n || 3), box = h('<div class="prios"></div>');
  if (!P.length) { box.appendChild(h('<p class="muted">No weak topic yet' + ((SV.assessments || []).some(function (a) { return a.attempts; }) ? ' — every question in your latest attempts was correct.' : '. Take an assessment and your revision priorities will appear here.') + '</p>')); return box; }
  P.forEach(function (r, i) {
    var secs = (r.sections || []).filter(Boolean);
    box.appendChild(h('<div class="prio-card"><div class="pn">Revision Priority ' + (i + 1) + '</div><h3>' + esc(topicName(r.topic)) + '</h3>' +
      '<p class="small"><b>' + r.questions_correct + '/' + r.questions_attempted + '</b> (' + r.score + '%) · <b>' + r.missed + '</b> missed</p>' +
      (secs.length ? '<p class="small">Review: ' + secs.map(function (x) { return '<a href="' + subLink(x) + '">' + esc(subTitle(x)) + '</a>'; }).join('; ') + '</p>' : '') +
      '<div class="row">' + (secs.length ? '<a class="btn" href="' + subLink(secs[0]) + '">📖 Review topic</a>' : '') + '<a class="btn primary" href="#/practice/retry/' + encodeURIComponent((r.attemptIds || []).join(',')) + '/' + encodeURIComponent(r.topic) + '">🔁 Retry weak questions</a></div></div>'));
  });
  return box;
}
function nextSection() { var st = studied(); for (var i = 0; i < ORDER.length; i++) if (!st[ORDER[i]] && SECTIONS[ORDER[i]].subs.length + (SECTIONS[ORDER[i]].intro ? 1 : 0)) return ORDER[i]; return null; }
function nextAction() {
  var act = activeAssessment(); if (act) return ['#/test/' + act.id, 'Resume ' + act.title, 'The timer is still running.'];
  var due = dueConcepts();
  if (due.length) return ['#/progress/queue', 'Revise ' + due.length + ' concept(s) due for revision', 'Short targeted practice on what you missed.'];
  for (var i = 0; i < D.lectures.length; i++) {
    var p = lectureProgress(i + 1);
    if (p.done < p.total) { var ns = nextSection(); if (ns) return [secLink(ns), 'Continue learning: ' + secTitle(ns), p.done + ' of ' + p.total + ' ' + D.lectures[i].title + ' sections studied.']; }
  }
  var todo = (SV.assessments || []).filter(function (a) { return a.canStart && !a.attempts; })[0];
  if (todo) return ['#/test/' + todo.id, 'Take the ' + todo.title, todo.questionCount + ' questions, ' + todo.durationMin + ' minutes.'];
  var P = SV.priorities || [];
  if (P.length) return ['#/practice/retry/' + encodeURIComponent((P[0].attemptIds || []).join(',')) + '/' + encodeURIComponent(P[0].topic), 'Retry your weak questions: ' + topicName(P[0].topic), 'Your lowest-scoring topic in the latest attempts.'];
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
  var asm = SV.assessments || [];
  g.appendChild(h('<div class="card"><h2 style="margin-top:0">📝 Assessments</h2>' + (asm.length ? '<table class="data"><tbody>' + asm.map(function (x) { return '<tr><td><a href="#/test/' + esc(x.id) + '">' + esc(x.title) + '</a></td><td>' + (x.last ? 'Last <b>' + x.last.percent + '%</b> · best ' + x.best + '%' : x.active ? '<span class="pill warn">in progress</span>' : '<span class="muted">Not attempted</span>') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">No assessment is open yet.</p>') + '</div>'));
  app.appendChild(g);
  var pr = h('<div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">🎯 Top 3 revision priorities</h2><div class="spacer"></div><a class="small" href="#/progress">All results →</a></div><p class="small muted" style="margin:4px 0 10px">From your latest attempt at each assessment.</p></div>');
  pr.appendChild(priorityCards(SV.priorities, 3)); app.appendChild(pr);
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
  if (n === D.lectures.length) { main.appendChild(h('<div class="card"><h2 style="margin-top:0">⭐ Finished all the teaching sections?</h2><p>Take an <a href="#/tests">assessment</a>, then finish with the <a href="#/review">Last-Minute Review</a> (key facts as active recall, plus traps and the 15-minute review).</p></div>')); }
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
  if (!nx) return '<a class="btn primary" href="#/tests">Next: the assessments →</a>';
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

/* ---------------- PRACTICE (server question bank: answers are checked on the server) ---------------- */
function pstate() { return (SV.progress && SV.progress.practice) || {}; }
var ITEMS = {};   // practice questions already fetched: id → { id, stem[], image, options[], … } (no answers)
function loadItems(ids) {
  var need = ids.filter(function (id) { return !ITEMS[id]; });
  if (!need.length) return Promise.resolve(ids.map(function (id) { return ITEMS[id]; }).filter(Boolean));
  var chunks = []; for (var i = 0; i < need.length; i += 150) chunks.push(need.slice(i, i + 150));
  return Promise.all(chunks.map(function (c) { return CX.api('vulvaPracticeItems', { ids: c }); })).then(function (rs) {
    rs.forEach(function (r) { if (r.ok) r.items.forEach(function (it) { ITEMS[it.id] = it; }); else toast(r.error || 'Questions could not be loaded.'); });
    return ids.map(function (id) { return ITEMS[id]; }).filter(Boolean);
  });
}
function stemParas(x) {
  var parts = x.stem || [], mark = parts.indexOf('[[IMAGE]]') >= 0;
  return parts.map(function (p) { return p === '[[IMAGE]]' ? (x.image ? figCard(x.image) : '') : '<p>' + inl(p) + '</p>'; }).join('') + (!mark && x.image ? figCard(x.image) : '');
}
function sbaCard(x, onDone, opts) {
  opts = opts || {};
  var prev = pstate()[x.id];
  var el = h('<div class="sba" data-qid="' + esc(x.id) + '" data-bank="practice"><div class="row small muted"><b style="color:var(--navy)">' + esc(x.kind === 'assess' ? (x.code || 'Assessment question') + ' · from an assessment' : 'Practice question') + '</b>' +
    (x.past ? '<span class="pill">past paper: ' + esc(x.past) + '</span>' : x.previousExam ? '<span class="pill">previous-exam concept</span>' : '') + (opts.newItem ? '<span class="pill good">new question</span>' : '') +
    (prev ? '<span class="pill ' + (prev.ok ? 'good' : 'bad') + '">' + (prev.ok ? 'correct last time' : 'missed last time') + '</span>' : '') +
    '</div><div class="stem md">' + stemParas(x) + '</div><div class="opts" role="radiogroup" aria-label="Options"></div><div class="row"><button class="btn primary chk" type="button">Check answer</button></div><div class="fbx" aria-live="polite"></div></div>');
  var og = $('.opts', el), sel = null, done = false;
  (x.options || []).forEach(function (o, i) {
    var b = h('<button class="opt" type="button" role="radio" aria-checked="false"><span class="L">' + LETTERS[i] + '</span><span>' + inl(o) + '</span></button>');
    b.onclick = function () { if (done) return; sel = i; $$('.opt', og).forEach(function (y, j) { y.classList.toggle('sel', j === i); y.setAttribute('aria-checked', j === i); }); };
    og.appendChild(b);
  });
  $('.chk', el).onclick = function () {
    if (done) return;
    if (sel == null) { toast('Choose an answer first.'); return; }
    var btn = $('.chk', el); btn.disabled = true; btn.textContent = 'Checking…';
    CX.api('vulvaPracticeCheck', { id: x.id, answer: sel }).then(function (r) {
      if (!r.ok) { btn.disabled = false; btn.textContent = 'Check answer'; toast(r.error || 'The answer could not be checked.'); return; }
      done = true; btn.remove();
      $$('.opt', og).forEach(function (y, j) { y.disabled = true; if (j === r.answer) y.classList.add('right'); else if (j === sel) y.classList.add('wrong'); });
      var sec = r.sub || r.section;
      $('.fbx', el).innerHTML = '<div class="fb ' + (r.correct ? 'good' : 'bad') + ' md"><p><span class="mark">' + (r.correct ? '✓ Correct.' : '✗ Not quite — the answer is ' + LETTERS[r.answer] + '.') + '</span> ' + inl(r.explanation || '') + '</p>' + (r.trap ? '<p><strong>Exam trap:</strong> ' + inl(r.trap) + '</p>' : '') +
        '<p class="src">' + esc(r.ref || '') + (sec && (SUBS[sec] || SECTIONS[sec]) ? ' · <a href="' + subLink(sec) + '">Review ' + esc(subTitle(sec)) + '</a>' : '') + '</p></div>';
      if (CX.role === 'student') { SV.progress.practice[x.id] = { ok: r.correct, at: Date.now() }; svAt = 0; }
      if (onDone) onDone(r.correct);
    });
  };
  return el;
}
function testYourself(subId) {
  var items = PBY_SUB[subId] || [];
  var d = h('<details class="ty noprint"><summary>🧠 Test yourself <span class="small muted">(' + items.length + ' question' + (items.length > 1 ? 's' : '') + ')</span></summary><div class="tyb"><p class="small muted">Loading…</p></div></details>');
  d.addEventListener('toggle', function () {
    if (!d.open || d.dataset.r) return; d.dataset.r = 1;
    loadItems(items.map(function (x) { return x.id; })).then(function (list) { var b = $('.tyb', d); b.innerHTML = ''; list.forEach(function (x) { b.appendChild(sbaCard(x)); }); if (!list.length) b.innerHTML = '<p class="muted">No questions available.</p>'; });
  });
  return d;
}
/** A practice run. `items` are full questions or index entries (fetched first). */
function runSet(title, sub, items, opts) {
  opts = opts || {};
  app.appendChild(h('<div class="row"><div><div class="pill">' + esc(opts.kicker || 'Practice') + '</div><h1 style="margin-top:6px">' + esc(title) + '</h1>' + (sub ? '<p class="muted" style="margin:0">' + sub + '</p>' : '') + '</div><div class="spacer"></div><a class="btn" href="#/practice">← Practice</a></div>'));
  if (!items.length) { app.appendChild(h('<div class="card" style="margin-top:14px">' + (opts.empty || 'No questions here yet.') + '</div>')); return; }
  var box = h('<div class="card runner" style="margin-top:14px"><p class="muted">Loading questions…</p></div>'); app.appendChild(box);
  var host = app;
  loadItems(items.map(function (x) { return x.id; })).then(function (list) { if (document.body.contains(box)) run(list); });
  function run(list) {
    items = list;
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
      var cons = {}; missed.forEach(function (x) { if (x.concept) cons[x.concept] = 1; });
      box.appendChild(h('<h2 style="margin-top:0">Summary: ' + right + ' / ' + items.length + ' (' + pct(right, items.length) + '%)</h2>'));
      if (!missed.length) box.appendChild(h('<p>✓ All correct. These concepts move further back in your revision queue.</p>'));
      else box.appendChild(h('<div><p>Missed concepts (added to your <a href="#/progress/queue">revision queue</a>):</p><ul>' + Object.keys(cons).map(function (k) { return '<li><a href="' + conceptLink(k) + '">' + esc(conceptName(k)) + '</a></li>'; }).join('') + '</ul></div>'));
      var r = h('<div class="row"><button class="btn" type="button">↺ Do this set again</button>' + (missed.length ? '<button class="btn primary" type="button">Retry only the ' + missed.length + ' missed</button>' : '') + '<a class="btn ghost" href="#/progress">My Progress →</a></div>');
      var bs = $$('button', r);
      bs[0].onclick = function () { i = 0; res = []; draw(); };
      if (bs[1]) bs[1].onclick = function () { items = missed; i = 0; res = []; draw(); };
      box.appendChild(r);
      refreshServer(true);
    }
    draw();
  }
  void host;
}
/** Up to `max` practice questions on these concepts (index entries), least-practised first. */
function newOnConcepts(concepts, topic, max) {
  var out = [], seen = {}, st = pstate(), pool = [];
  concepts.forEach(function (k) { (PBY_CONCEPT[k] || []).forEach(function (x) { pool.push(x); }); });
  if (topic) PR.forEach(function (x) { if (secTopic(x) === topic) pool.push(x); });
  function rank(x) { var sx = st[x.id]; return (concepts.indexOf(x.concept) >= 0 ? 0 : 10) + (sx ? (sx.ok ? 2 : 1) : 0); }
  pool.sort(function (a, b) { return rank(a) - rank(b); });
  pool.forEach(function (x) { if (out.length < max && !seen[x.id]) { seen[x.id] = 1; out.push(x); } });
  return out;
}
function viewPractice(mode, args) {
  args = args || [];
  if (mode === 'retry') {
    var ids = (args[0] || '').split(',').filter(Boolean), topic = args[1] || '';
    touch('Retry my mistakes' + (topic ? ': ' + topicName(topic) : ''), location.hash);
    var hold = h('<div class="card">Preparing your questions…</div>'); app.appendChild(hold);
    return CX.api('vulvaRetrySet', { attemptIds: ids, topic: topic }).then(function (r) {
      if (!document.body.contains(hold)) return; hold.remove();
      if (!r.ok) { app.appendChild(h('<div class="card err">' + esc(r.error || 'Your questions could not be loaded.') + '</div>')); return; }
      r.missed.concat(r.fresh).forEach(function (it) { ITEMS[it.id] = it; });
      var nid = {}; r.fresh.forEach(function (x) { nid[x.id] = 1; });
      runSet(topic ? 'Retry weak questions: ' + topicName(topic) : 'Retry my mistakes', r.missed.length + ' question(s) you got wrong or left blank, plus ' + r.fresh.length + ' new question(s) on the same concepts.' + (r.hiddenUntilClose ? ' ' + r.hiddenUntilClose + ' more will be available when your teacher closes the assessment.' : ''), r.missed.concat(r.fresh), { kicker: 'Retry', newIds: nid, empty: 'No missed questions found. <a href="#/tests">Take an assessment</a> first.' });
    });
  }
  if (mode === 'topic' && args[0] && D.topics[args[0]]) {
    touch('Topic practice: ' + topicName(args[0]), location.hash);
    return runSet('Topic practice: ' + topicName(args[0]), 'Single-best-answer questions written from the lectures (not the assessment questions).', PR.filter(function (x) { return secTopic(x) === args[0]; }));
  }
  if (mode === 'concept' && args[0]) {
    touch('Practice: ' + conceptName(args[0]), location.hash);
    return runSet(conceptName(args[0]), 'Practice questions on this concept. <a href="' + conceptLink(args[0]) + '">Review the learning block</a>.', PBY_CONCEPT[args[0]] || [], { empty: 'No practice question on this concept yet — <a href="' + conceptLink(args[0]) + '">review the learning block</a>.' });
  }
  if (mode === 'prev') { touch('Previous-exam concepts', location.hash); return runSet('Previous-exam concepts', 'Questions that re-test concepts examined in previous papers.', PR.filter(function (x) { return x.prev || x.past; }), { kicker: 'Practice' }); }
  if (mode === 'image') { touch('Morphology Challenge', location.hash); return runSet('Morphology Challenge', 'Identify the lesion from the gross and microscopic images. Click any image to zoom.', PR.filter(function (x) { return x.img; })); }
  if (mode === 'queue') {
    var due = dueConcepts(), items = [];
    due.forEach(function (k) { var c = newOnConcepts([k], null, 1); if (c.length) items.push(c[0]); });
    touch('Revision queue', location.hash);
    return runSet('Due for revision', due.length + ' concept(s) due; one question each. Correct answers push a concept further back; wrong answers bring it back tomorrow.', items, { kicker: 'Revision queue', empty: 'Nothing is due. Missed concepts from practice and assessments are added automatically.' });
  }
  app.appendChild(h('<h1>Practice</h1>'));
  app.appendChild(h('<p class="muted">Formative practice with instant feedback. Practice questions are separate from the assessment questions.</p>'));
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
    [['#/practice/prev', '📜 Previous-exam concepts', PR.filter(function (x) { return x.prev || x.past; }).length + ' questions on concepts examined before'], ['#/practice/image', '🔬 Morphology Challenge', PR.filter(function (x) { return x.img; }).length + ' image-based lesion-recognition questions'], ['#/progress/queue', '🔁 Due for revision', dueConcepts().length + ' concept(s) due now']].forEach(function (c) { g.appendChild(h('<a class="card step" href="' + c[0] + '"><div><h3>' + c[1] + '</h3><p class="small">' + esc(c[2]) + '</p></div></a>')); });
    body.appendChild(g);
    var t = h('<div class="card" style="margin-top:16px"><h2 style="margin-top:0">Topic practice</h2><div class="topics"></div></div>');
    Object.keys(D.topics).forEach(function (k) {
      var its = PR.filter(function (x) { return secTopic(x) === k; }); if (!its.length) return;
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
  box.appendChild(priorityCards(SV.priorities, 5));
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
  var box = h('<div></div>'), st = pstate(), pw = PR.filter(function (x) { return st[x.id] && !st[x.id].ok; });
  var anyAttempt = (SV.assessments || []).some(function (a) { return a.attempts; });
  box.appendChild(h('<div class="row"><p class="muted" style="flex:1;margin:0">Assessment questions you got wrong or left blank in your latest attempts, and practice questions you missed at your last try (' + pw.length + ').</p>' + (anyAttempt ? '<a class="btn primary" href="#/practice/retry">🔁 Retry my assessment mistakes</a>' : '') + (pw.length ? '<button class="btn pwr" type="button">Retry missed practice (' + pw.length + ')</button>' : '') + '</div>'));
  if (pw.length) $('.pwr', box).onclick = function () { app.innerHTML = ''; runSet('Missed practice questions', 'Practice questions you got wrong at your last try.', pw); };
  if (!anyAttempt && !pw.length) box.appendChild(h('<div class="card" style="margin-top:10px">No mistakes recorded yet.</div>'));
  return box;
}

/* ---------------- ASSESSMENTS (papers, timing and grading on the server) ---------------- */
function viewTests() {
  app.appendChild(h('<h1>Assessments</h1>'));
  app.appendChild(h('<p class="muted">Timed single-best-answer papers. Your answers are saved on the platform as you go and graded by the platform when you submit.</p>'));
  var list = SV.assessments || [];
  if (!list.length) { app.appendChild(h('<div class="card">No assessment is open at the moment.</div>')); return; }
  var g = h('<div class="grid g3"></div>');
  list.forEach(function (a) {
    var left = a.attemptsAllowed ? Math.max(0, a.attemptsAllowed - a.attempts) : null;
    g.appendChild(h('<div class="card"><div class="pill">' + a.questionCount + ' questions · ' + a.durationMin + ' min</div><h2 style="margin:8px 0 4px">' + esc(a.title) + '</h2><p class="muted" style="margin-top:0">' + esc(a.subtitle || '') + '</p>' +
      '<p class="small">' + (a.last ? 'Last: <b>' + a.last.percent + '%</b> (' + fmtDate(a.last.submittedAt) + ')<br>Best: <b>' + a.best + '%</b> · ' + a.attempts + ' attempt(s)' : 'Not attempted yet') + (left !== null ? '<br>' + left + ' attempt(s) left' : '') + (a.status === 'closed' ? '<br><span class="pill">closed</span>' : '') + '</p>' +
      '<div class="row">' + (a.canStart ? '<a class="btn primary" href="#/test/' + esc(a.id) + '">' + (a.active ? 'Resume' : a.attempts ? 'Retake' : 'Start') + '</a>' : '') + (a.last ? '<a class="btn" href="#/result/' + esc(a.last.id) + '">Last result</a>' : '') + '</div></div>'));
  });
  app.appendChild(g);
}
function viewTest(id) {
  var a = (SV.assessments || []).filter(function (x) { return x.id === id; })[0];
  if (!a) { app.appendChild(h('<div class="card">This assessment is not available. <a href="#/tests">All assessments</a></div>')); return; }
  if (a.active) return startExam(a);
  if (!a.canStart) { app.appendChild(h('<div class="card">' + (CX.role !== 'student' ? 'Teachers can preview the questions in Faculty tools → Question banks; assessments are taken by students.' : 'You cannot start this assessment (closed, or no attempts left).') + ' <a href="#/tests">All assessments</a></div>')); return; }
  var c = h('<div class="card" style="max-width:660px;margin:0 auto"><div class="pill">' + a.questionCount + ' questions · ' + a.durationMin + ' minutes</div><h1 style="margin-top:8px">' + esc(a.title) + '</h1><p class="muted">' + esc(a.subtitle || '') + '</p>' +
    '<ul class="small"><li>Single best answer. Letter keys (A, B, C, D) answer; ← → move between questions.</li><li>Your answers are saved on the platform as you go — if your connection drops or you close the page, sign in again and resume.</li><li>The timer is kept by the platform and keeps running if you leave; when time is up your saved answers are submitted automatically.</li>' + (a.attemptsAllowed ? '<li>You have ' + Math.max(0, a.attemptsAllowed - a.attempts) + ' attempt(s) left.</li>' : '') + '</ul>' +
    '<button class="btn primary go" type="button" style="margin-top:6px">Start the assessment</button></div>');
  $('.go', c).onclick = function () { startExam(a, $('.go', c)); };
  app.appendChild(c);
}
function startExam(a, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  CX.api('vulvaStart', { assessmentId: a.id }).then(function (r) {
    if (!r.ok) { if (btn) { btn.disabled = false; btn.textContent = 'Start the assessment'; } toast(r.error || 'The assessment could not be started.'); return; }
    touch(a.title, '#/test/' + a.id);
    app.innerHTML = ''; runExam(r.attempt);
  });
}
function runExam(att) {
  var qs = att.paper, skew = att.serverTime - Date.now(), ans = {}, dirty = false, saving = false, curI = 0, finished = false;
  Object.keys(att.responses || {}).forEach(function (k) { ans[k] = att.responses[k]; });
  var local = store.get('exam_' + att.id, null); if (local && local.at > (att.serverTime || 0) - 5000) { Object.keys(local.ans || {}).forEach(function (k) { ans[k] = local.ans[k]; }); dirty = true; }
  var wrap = h('<div class="exam"><div><div class="card"><div class="row"><div><div class="small muted">' + esc(att.title) + ' · ' + esc(CX.name || '') + '</div><div class="qcount" style="font-weight:700;color:var(--navy)"></div></div><div class="spacer"></div><button class="btn flagb" type="button">⚑ Flag</button></div><div class="qbody"></div><div class="row" style="margin-top:14px"><button class="btn prev">← Previous</button><button class="btn clear ghost">Clear answer</button><div class="spacer"></div><button class="btn primary next">Next →</button></div></div></div>' +
    '<aside class="card exam-side"><div class="small muted">Time remaining</div><div class="timer" aria-live="off">--:--</div><div class="progress" style="margin:8px 0"><i class="tp"></i></div><div class="small ansd"></div><div class="small muted svst" aria-live="polite"></div><div class="qnav" aria-label="Question navigator"></div><div class="legend"><span><i style="background:var(--teal)"></i>answered</span><span><i style="background:#fff;border:1px solid #ccc"></i>blank</span><span><i style="background:#f0b429;border-radius:50%"></i>flagged</span></div><button class="btn primary submit" style="width:100%;justify-content:center;margin-top:14px">Submit paper</button></aside></div>');
  app.appendChild(wrap);
  var flags = store.get('flags_' + att.id, []);
  var qnav = $('.qnav', wrap);
  qs.forEach(function (q, i) { var b = h('<button type="button" aria-label="Question ' + (i + 1) + '">' + (i + 1) + '</button>'); b.onclick = function () { curI = i; draw(); }; qnav.appendChild(b); });
  function remember() { store.set('exam_' + att.id, { ans: ans, at: Date.now() }); dirty = true; saveSoon(); }
  var saveT = null;
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveNow, 2500); }
  function saveNow() {
    if (!dirty || saving || finished) return Promise.resolve();
    saving = true; dirty = false; $('.svst', wrap).textContent = 'Saving…';
    return CX.api('vulvaSave', { attemptId: att.id, responses: ans }).then(function (r) {
      saving = false;
      if (r.ok) { $('.svst', wrap).textContent = '✓ Answers saved ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); skew = r.serverTime - Date.now(); return; }
      if (r.code === 'expired' || r.code === 'final') { finished = true; stop(); toast(r.error); location.hash = '#/result/' + att.id; return; }
      dirty = true; $('.svst', wrap).textContent = '⚠ Not saved yet — will retry (' + (r.error || 'connection') + ')';
    });
  }
  function draw() {
    var i = curI, q = qs[i];
    $('.qcount', wrap).textContent = 'Question ' + (i + 1) + ' of ' + qs.length;
    var body = $('.qbody', wrap);
    body.innerHTML = '<div class="q"><div class="stem md">' + stemParas(q) + '</div><div class="opts" role="radiogroup" aria-label="Options"></div></div>';
    var og = $('.opts', body);
    q.options.forEach(function (o, j) {
      var on = ans[i] === j;
      var b = h('<button class="opt' + (on ? ' sel' : '') + '" type="button" role="radio" aria-checked="' + on + '"><span class="L">' + LETTERS[j] + '</span><span>' + inl(o) + '</span></button>');
      b.onclick = function () { ans[i] = j; remember(); draw(); };
      og.appendChild(b);
    });
    $('.flagb', wrap).textContent = flags.indexOf(i) >= 0 ? '⚑ Flagged' : '⚑ Flag';
    $('.prev', wrap).disabled = i === 0; $('.next', wrap).textContent = i === qs.length - 1 ? 'Review & submit' : 'Next →';
    $$('button', qnav).forEach(function (b, j) { b.classList.toggle('ans', ans[j] != null); b.classList.toggle('cur', j === i); b.classList.toggle('flag', flags.indexOf(j) >= 0); });
    $('.ansd', wrap).textContent = Object.keys(ans).length + ' of ' + qs.length + ' answered';
  }
  $('.prev', wrap).onclick = function () { if (curI > 0) { curI--; draw(); } };
  $('.next', wrap).onclick = function () { if (curI < qs.length - 1) { curI++; draw(); } else confirmSubmit(); };
  $('.clear', wrap).onclick = function () { delete ans[curI]; remember(); draw(); };
  $('.flagb', wrap).onclick = function () { var k = flags.indexOf(curI); if (k >= 0) flags.splice(k, 1); else flags.push(curI); store.set('flags_' + att.id, flags); draw(); };
  function confirmSubmit() {
    var blank = qs.length - Object.keys(ans).length, fl = flags.length;
    confirmBox('Submit your paper?', (blank ? blank + ' question(s) are unanswered. ' : 'All questions answered. ') + (fl ? fl + ' question(s) are flagged. ' : '') + 'After submission you will see your score. You cannot change your answers after this.', 'Submit now', function () { submit(false); });
  }
  function submit(auto) {
    if (finished) return; finished = true; stop();
    $('.submit', wrap).disabled = true; $('.svst', wrap).textContent = 'Submitting…';
    var key = 'sk_' + att.id;
    CX.api('vulvaSubmit', { attemptId: att.id, responses: ans, submitKey: key }).then(function (r) {
      if (!r.ok) {
        if (r.code === 'expired' || r.code === 'final') { store.del('exam_' + att.id); svAt = 0; refreshServer(true); location.hash = '#/result/' + att.id; return; }
        $('.svst', wrap).textContent = '⚠ Not submitted yet';
        modal('Submission not yet confirmed', '<p class="err"><b>' + esc(r.error || 'Your paper could not be submitted.') + '</b></p><p>Your answers are kept on this device. Check your connection and press <b>Try again</b>. Submitting again is safe — the platform records only one submission.</p>',
          [{ label: 'Try again', cls: 'primary', onClick: function () { finished = false; setTimeout(function () { submit(auto); }, 0); } }]);
        return;
      }
      store.del('exam_' + att.id); store.del('flags_' + att.id);
      RESULTS[att.id] = r.result; svAt = 0; refreshServer(true);
      if (auto || r.expired) toast('Time is up — your paper has been submitted.');
      location.hash = '#/result/' + att.id;
    });
  }
  $('.submit', wrap).onclick = confirmSubmit;
  var iv = null, sv = null;
  function tick() {
    var left = (att.deadlineAt - (Date.now() + skew)) / 1000, tot = att.durationMin * 60;
    var tm = $('.timer', wrap); if (!tm) return;
    tm.textContent = fmtDur(left); tm.classList.toggle('low', left < 300);
    $('.tp', wrap).style.width = Math.max(0, 100 * left / tot) + '%';
    if (left <= 0) submit(true);
  }
  function start() { iv = setInterval(tick, 1000); sv = setInterval(function () { if (dirty) saveNow(); }, 20000); }
  function stop() { clearInterval(iv); clearInterval(sv); clearTimeout(saveT); }
  start(); tick(); draw();
  if (dirty) saveSoon();
  function onKey(e) {
    if (document.querySelector('.modal-bg') || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName)) return;
    var k = e.key.toUpperCase(), q = qs[curI], j = LETTERS.indexOf(k);
    if (k.length === 1 && j >= 0 && j < q.options.length) { ans[curI] = j; remember(); draw(); }
    else if (e.key === 'ArrowRight' && curI < qs.length - 1) { curI++; draw(); }
    else if (e.key === 'ArrowLeft' && curI > 0) { curI--; draw(); }
  }
  function onUnload() { if (dirty && !finished) CX.api('vulvaSave', { attemptId: att.id, responses: ans }, { keepalive: true }); }
  document.addEventListener('keydown', onKey); window.addEventListener('pagehide', onUnload);
  cleanup = function () { stop(); if (dirty && !finished) saveNow(); document.removeEventListener('keydown', onKey); window.removeEventListener('pagehide', onUnload); };
}
var RESULTS = {};
function topicBars(topics) {
  var box = h('<div></div>');
  (topics || []).slice().sort(function (a, b) { return a.score - b.score; }).forEach(function (x) {
    var p = x.score, col = p >= 75 ? 'var(--good)' : p >= 50 ? '#c98a00' : 'var(--bad)';
    box.appendChild(h('<div class="bar"><span>' + esc(topicName(x.topic)) + '</span><span class="track" role="img" aria-label="' + p + '%"><i style="width:' + p + '%;background:' + col + '"></i></span><b>' + x.questions_correct + '/' + x.questions_attempted + '</b></div>'));
  });
  if (!box.children.length) box.appendChild(h('<p class="muted">No results yet.</p>'));
  return box;
}
function reviewItemHtml(it) {
  var el = h('<div class="q"><div class="row small muted"><b style="color:var(--navy)">' + esc(it.code || ('Question ' + it.n)) + '</b><span>· ' + esc(topicName(it.topic)) + '</span>' + (it.difficulty ? '<span>· ' + esc(it.difficulty) + '</span>' : '') + '<span class="pill ' + (it.response == null ? 'warn' : it.correct ? 'good' : 'bad') + '">' + (it.response == null ? 'Unanswered' : it.correct ? 'Correct' : 'Incorrect') + '</span></div><div class="stem md">' + stemParas(it) + '</div><div class="opts"></div><div class="fb ' + (it.correct ? 'good' : 'bad') + ' md"></div></div>');
  var og = $('.opts', el);
  it.options.forEach(function (o, i) {
    var cls = i === it.correctOption ? 'right' : i === it.response ? 'wrong' : '';
    og.appendChild(h('<div class="opt ' + cls + '"><span class="L">' + LETTERS[i] + '</span><span>' + inl(o) + (i === it.response ? ' <span class="small muted">(your answer)</span>' : '') + '</span></div>'));
  });
  var sec = it.section && (SECTIONS[it.section] || SUBS[it.section]) ? it.section : null;
  $('.fb', el).innerHTML = '<p><span class="mark">Answer: ' + LETTERS[it.correctOption] + '.</span> ' + inl(it.explanation || '') + '</p>' + (it.trap ? '<p><strong>Exam trap:</strong> ' + inl(it.trap) + '</p>' : '') + (it.objective ? '<p class="small"><b>Learning objective:</b> ' + esc(it.objective) + '</p>' : '') + '<p class="src">' + esc(it.ref || '') + (sec ? ' · <a href="' + secLink(sec) + '">Revise section ' + esc(num(sec)) + '</a>' : '') + (it.concept ? ' · <a href="#/practice/concept/' + esc(it.concept) + '">Practise this concept</a>' : '') + '</p>';
  return el;
}
function viewResult(id) {
  var hold = h('<div class="card">Loading your result…</div>'); app.appendChild(hold);
  (RESULTS[id] ? Promise.resolve({ ok: true, result: RESULTS[id] }) : CX.api('vulvaResult', { attemptId: id })).then(function (r) {
    if (!document.body.contains(hold)) return; hold.remove();
    if (!r.ok) { app.appendChild(h('<div class="card">' + esc(r.error || 'Result not found.') + ' <a href="#/progress">All results</a></div>')); return; }
    var a = r.result; RESULTS[id] = a;
    app.appendChild(h('<div class="row"><div><div class="pill">' + esc(a.assessmentTitle) + '</div><h1 style="margin-top:6px">Your result: ' + a.percent + '%</h1><p class="muted" style="margin:0">' + esc(CX.name || '') + ' · submitted ' + fmtDate(a.submittedAt) + (a.auto ? ' (automatically, time ran out)' : '') + '</p></div><div class="spacer"></div><div class="row noprint"><button class="btn pr">🖨 Print</button><a class="btn" href="#/tests">Assessments</a>' + (a.correct < a.total ? '<a class="btn primary" href="#/practice/retry/' + esc(a.id) + '">🔁 Retry my mistakes</a>' : '') + '</div></div>'));
    var band = a.passPct ? (a.percent >= a.passPct ? 'At or above the ' + a.passPct + '% mark' : 'Below the ' + a.passPct + '% mark') : '';
    app.appendChild(h('<div class="grid g4" style="margin:16px 0">' +
      [['Score', a.score + ' / ' + a.total], ['Percentage', a.percent + '%'], ['Correct', a.correct], ['Incorrect', a.incorrect], ['Unanswered', a.unanswered], ['Time used', fmtDur(a.durationSec)], ['Date', fmtDate(a.submittedAt)]].concat(band ? [['Band', band]] : [])
        .map(function (k) { return '<div class="card kpi"><div class="v" style="font-size:' + (String(k[1]).length > 12 ? 15 : 24) + 'px">' + esc(k[1]) + '</div><div class="l">' + esc(k[0]) + '</div></div>'; }).join('') + '</div>'));
    var pc = h('<div class="card" style="margin-bottom:16px"><h2 style="margin-top:0">🎯 Revision priorities</h2><p class="small muted" style="margin-top:0">Your weakest topics in this attempt, with the sections to review.</p></div>');
    pc.appendChild(priorityCards(a.priorities, 3)); app.appendChild(pc);
    var g = h('<div class="card"><h2 style="margin-top:0">Topic performance</h2></div>'); g.appendChild(topicBars(a.topics)); app.appendChild(g);
    var rv = h('<div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">Review every question</h2><div class="spacer"></div><div class="tabs" style="margin:0;border:0"><button class="on" data-f="all">All</button><button data-f="wrong">Incorrect</button><button data-f="blank">Unanswered</button></div></div><div class="rvl"></div></div>');
    function fill(f) {
      $$('.tabs button', rv).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
      var l = $('.rvl', rv); l.innerHTML = '';
      if (!a.reviewAvailable) { l.appendChild(h('<p class="muted">' + esc(a.reviewMessage || 'Your teacher has not released the answers for this assessment.') + '</p>')); return; }
      a.review.forEach(function (it) {
        if (f === 'wrong' && (it.response == null || it.correct)) return;
        if (f === 'blank' && it.response != null) return;
        var w = h('<div class="review-item"><div class="small muted">Question ' + it.n + '</div></div>'); w.appendChild(reviewItemHtml(it)); l.appendChild(w);
      });
      if (!l.children.length) l.appendChild(h('<p class="muted">None.</p>'));
    }
    $$('.tabs button', rv).forEach(function (b) { b.onclick = function () { fill(b.dataset.f); }; });
    fill('all'); app.appendChild(rv);
    $('.pr', app).onclick = function () { window.print(); };
  });
}
function viewProgress(tab) {
  app.appendChild(h('<h1>My Progress</h1>'));
  var tabs = h('<div class="tabs" role="tablist"><button data-f="results">Results</button><button data-f="weak">Weak topics</button><button data-f="queue">Revision queue</button></div>');
  var body = h('<div><p class="muted">Loading…</p></div>'); app.appendChild(tabs); app.appendChild(body);
  var data = null;
  function show(f) {
    $$('button', tabs).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); b.setAttribute('aria-selected', b.dataset.f === f); });
    body.innerHTML = '';
    if (!data) { body.appendChild(h('<p class="muted">Loading…</p>')); return; }
    ({ results: progResults, weak: progWeak, queue: progQueue })[f](body, data);
  }
  $$('button', tabs).forEach(function (b) { b.onclick = function () { show(b.dataset.f); }; });
  var first = ['weak', 'queue'].indexOf(tab) >= 0 ? tab : 'results';
  show(first);
  if (CX.role !== 'student') { data = { attempts: [], topics: [], priorities: [], srs: {}, due: [] }; show(first); return; }
  CX.api('vulvaMyResults').then(function (r) { if (!r.ok) { body.innerHTML = '<p class="err">' + esc(r.error) + '</p>'; return; } data = r; SV.srs = r.srs; SV.priorities = r.priorities; if (document.body.contains(body)) show(first); });
}
function progResults(body, d) {
  body.appendChild(h('<p class="muted">Every assessment you have submitted, saved on the platform under your account.</p>'));
  var lecKpis = D.lectures.map(function (L, i) { var s = lectureProgress(i + 1); return '<div class="card kpi"><div class="v">' + pct(s.done, s.total) + '%</div><div class="l">' + esc(L.title) + ' studied</div></div>'; }).join('');
  body.appendChild(h('<div class="grid g4" style="margin:4px 0 14px">' + lecKpis + '<div class="card kpi"><div class="v">' + d.attempts.length + '</div><div class="l">Assessment attempts</div></div><div class="card kpi"><div class="v">' + (d.due || []).length + '</div><div class="l">Concepts due for revision</div></div></div>'));
  if (!d.attempts.length) { body.appendChild(h('<div class="card">No assessments submitted yet. <a href="#/tests">Go to the assessments</a>.</div>')); return; }
  var tbl = h('<div class="card" style="overflow-x:auto"><h2 style="margin:0">Attempts</h2><table class="data" style="margin-top:10px"><thead><tr><th>Assessment</th><th>Date</th><th>Score</th><th>%</th><th>Correct</th><th>Incorrect</th><th>Unanswered</th><th>Time</th><th></th></tr></thead><tbody></tbody></table></div>');
  d.attempts.forEach(function (a) {
    $('tbody', tbl).appendChild(h('<tr><td>' + esc(a.assessmentTitle) + (a.auto ? ' <span class="pill warn">auto</span>' : '') + '</td><td>' + fmtDate(a.submittedAt) + '</td><td>' + a.score + '/' + a.total + '</td><td><b>' + a.percent + '%</b></td><td>' + a.correct + '</td><td>' + a.incorrect + '</td><td>' + a.unanswered + '</td><td>' + fmtDur(a.durationSec) + '</td><td><a href="#/result/' + esc(a.id) + '">Open</a></td></tr>'));
  });
  body.appendChild(tbl);
  var g = h('<div class="card" style="margin-top:16px"><h2 style="margin-top:0">Topic performance</h2><p class="small muted">From your latest attempt at each assessment.</p></div>');
  g.appendChild(topicBars(d.topics)); body.appendChild(g);
}
function progWeak(body, d) {
  body.appendChild(h('<p class="muted">Revision priorities from your latest attempt at each assessment: topic, score, number missed, and the sections to review.</p>'));
  body.appendChild(priorityCards(d.priorities, 5));
  if (d.attempts.length) body.appendChild(h('<div class="row" style="margin-top:14px"><a class="btn primary" href="#/practice/retry">🔁 Retry all my mistakes (+ new questions on the same concepts)</a></div>'));
}
function progQueue(body, d) {
  var S = d.srs || {}, now = Date.now(), keys = Object.keys(S).sort(function (a, b) { return S[a].due - S[b].due; }), due = keys.filter(function (k) { return S[k].due <= now; });
  body.appendChild(h('<p class="muted">A spaced-revision queue kept on the platform. A concept enters the queue when you miss it (in practice or an assessment) and is due at once. Each correct answer pushes it further back: 1, 3, 7, 14 and then 30 days.</p>'));
  body.appendChild(h('<div class="row" style="margin:6px 0 14px">' + (due.length ? '<a class="btn primary" href="#/practice/queue">▶ Revise the ' + due.length + ' due concept(s) now</a>' : '<span class="pill good">Nothing due now</span>') + '</div>'));
  if (!keys.length) { body.appendChild(h('<div class="card">Your queue is empty. Concepts you miss are added automatically.</div>')); return; }
  var t = h('<div class="card" style="overflow-x:auto"><table class="data"><thead><tr><th>Concept</th><th>Status</th><th>Times missed</th><th>Last result</th><th></th></tr></thead><tbody></tbody></table></div>');
  keys.forEach(function (k) {
    var e = S[k], dd = e.due <= now ? '<span class="pill bad">Due now</span>' : '<span class="pill">Due ' + new Date(e.due).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + '</span>';
    $('tbody', t).appendChild(h('<tr><td><a href="' + conceptLink(k) + '">' + esc(conceptName(k)) + '</a></td><td>' + dd + '</td><td>' + (e.wrong || 0) + '</td><td>' + (e.lastOk ? '✓' : '✗') + '</td><td><a href="#/practice/concept/' + esc(k) + '">Practise</a></td></tr>'));
  });
  body.appendChild(t);
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
    if (t.tagName === 'IMG' && fig.classList.contains('pic')) { var p = PICS[fig.getAttribute('data-pic')]; if (p) lightbox(t.src, (p.caption || fig.getAttribute('data-desc')) + (p.credit ? ' — ' + p.credit : '')); }
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
  // Question pictures live in the server question bank; the editor supplies them (teachers only).
  (HOOKS.questionImages ? HOOKS.questionImages() : []).forEach(function (x) { add(x.group, x.where, x.desc); });
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
    return '<figure class="simg al-' + (im.align || 'right') + '" style="width:' + (im.align === 'full' ? 100 : (im.width || 45)) + '%">' + imgTag(im.src, 'alt="' + esc(im.caption || 'Slide picture') + '" data-k="' + k + '"') + (im.caption ? '<figcaption>' + inl(im.caption) + '</figcaption>' : '') + '</figure>';
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
    ['#/teacher/bank', '🗂', 'Question bank', 'Practice and assessment questions on the server: add, edit (each edit is a new version), duplicate, activate/deactivate, history.'],
    ['#/teacher/assess', '📝', 'Assessments', 'Create, publish, close and archive assessments; question pool, time, attempts, pass mark, answer release.'],
    ['#/faculty/questions/checks', '🧩', 'Section checks', 'The Pathology Challenge questions (true/false, fill-in, matching, sorting…) — part of the Learn content.'],
    ['#/faculty/media', '🖼', 'Pictures & media library', 'Upload, replace, reuse and remove pictures; captions, alt text, size and alignment for every picture slot.'],
    ['#/present', '🖥️', 'Presentation mode', 'PowerPoint-style lecture decks from the same content, with speaker notes, reveal-answer questions and a slide editor.'],
    ['#/teacher/students', '👥', 'Student accounts', 'Create student accounts (Student ID + password), reset passwords, unlock, deactivate.'],
    ['#/teacher/analytics', '📊', 'Results & item analysis', 'Every attempt, per-topic results, item analysis with distractor counts and discrimination index, and Excel (CSV) export.'],
    ['#/teacher/import', '⬆', 'Import, audit & account', 'Import the question bank (the module seed file), the audit log, and the teacher password.']
  ].forEach(function (c) { g.appendChild(h('<a class="card step" href="' + c[0] + '"><div class="n">' + c[1] + '</div><div><h2 style="margin:0 0 4px">' + c[2] + '</h2><p class="small">' + c[3] + '</p></div></a>')); });
  app.appendChild(g);
  app.appendChild(h('<div class="note" style="margin-top:16px">Students sign in with their own Student ID and password. Questions, answers, grading and results are kept on your Google Apps Script backend; the published content on GitHub Pages is encrypted.</div>'));
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
    $('.ed-exp', ed).onclick = function () { download(MOD + '-slides_lecture' + n + '_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ kind: MOD + '-review-slides', lecture: n, version: APP_VERSION, exportedAt: Date.now(), slides: slides })); toast('Slides file downloaded (pictures included).'); };
    $('.ed-imp', ed).onchange = function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      var r = new FileReader(); r.onload = function () {
        var j; try { j = JSON.parse(r.result); } catch (x) { toast('That is not a slides file.'); return; }
        if (!j || j.kind !== MOD + '-review-slides' || !Array.isArray(j.slides) || !j.slides.length) { toast('That is not a slides file for this platform.'); return; }
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

/* ---------------- TEACHER PAGES ---------------- */
// Teacher rights come from the server session; the server re-checks them on every request.
function teacherOk() { return CX.role === 'admin'; }
var routeTok = 0;
function live(tok) { return tok === routeTok; }
function api(action, payload, opts) { return CX.api(action, payload || {}, opts); }
function netMsg(r) { return (r && r.error) || 'The platform could not be reached. Check your connection and try again.'; }
function viewTeacher(tab) {
  if (!teacherOk()) { app.appendChild(h('<div class="card">The teacher portal is for teachers. <a href="#/">Home</a></div>')); return; }
  app.appendChild(h('<p class="small noprint"><a href="#/faculty">← Faculty tools</a></p>'));
  srvTeacher(tab, routeTok);
}
/* ---------------- TEACHER PORTAL (from the connected edition; every action is authorised by the backend) ---------------- */
var TS = { tab: 'assess', aid: '', scope: 'first', bankQ: '', bankKind: 'all', bankTopic: '' };
function srvTeacher(tab, tok) {
  TS.tab = ['assess', 'analytics', 'bank', 'students', 'import', 'audit', 'account'].indexOf(tab) >= 0 ? tab : TS.tab;
  app.appendChild(h('<div class="row"><h1>Teacher portal</h1><div class="spacer"></div><span class="pill good">● Connected to the platform server</span></div>'));
  app.appendChild(h('<p class="muted small">Gynecology Pathology module (<code>' + esc(CX.module) + '</code>) of the shared Pathology Teaching Platform backend. Every action here is authorised on the server with your teacher session.</p>'));
  var T = [['assess', '📝 Assessments'], ['analytics', '📊 Analytics & item analysis'], ['bank', '🗂 Question bank'], ['students', '👥 Students'], ['import', '⬆ Import / migration'], ['audit', '🧾 Audit log'], ['account', '🔑 Account']];
  var tabs = h('<div class="tabs">' + T.map(function (t) { return '<button data-t="' + t[0] + '"' + (t[0] === TS.tab ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>');
  var body = h('<div></div>'); app.appendChild(tabs); app.appendChild(body);
  $$('button', tabs).forEach(function (b) { b.onclick = function () { location.hash = '#/teacher/' + b.dataset.t; }; });
  ({ assess: tAssess, analytics: tAnalytics, bank: tBank, students: tStudents, import: tImport, audit: tAudit, account: tAccount })[TS.tab](body, tok);
}
function tLoad(body, action, payload, tok, fn) {
  body.innerHTML = '<div class="card">⏳ Loading…</div>';
  return api(action, payload || {}).then(function (r) { if (!live(tok)) return; body.innerHTML = ''; if (!r.ok) { body.appendChild(h('<div class="card err">' + esc(netMsg(r)) + '</div>')); return; } fn(r); });
}
var STATUS_TXT = { draft: 'Draft (hidden from students)', published: 'Published (open)', closed: 'Closed (results visible, no new attempts)', archived: 'Archived (hidden)' };
function tAssess(body, tok) {
  tLoad(body, 'vulvaAdminOverview', {}, tok, function (r) {
    body.appendChild(h('<div class="grid g4" style="margin-bottom:14px"><div class="card kpi"><div class="v">' + r.bank.assess + '</div><div class="l">Assessment questions</div></div><div class="card kpi"><div class="v">' + r.bank.practice + '</div><div class="l">Practice questions</div></div><div class="card kpi"><div class="v">' + r.bank.inactive + '</div><div class="l">Inactive questions</div></div><div class="card kpi"><div class="v">' + r.bank.versions + '</div><div class="l">Question versions stored</div></div></div>'));
    if (!r.assessments.length) { body.appendChild(h('<div class="card">No assessments yet. Run <a href="#/teacher/import">Import / migration</a> first (it creates the module exam as a draft), or create one.</div>')); }
    var t = h('<div class="card" style="overflow-x:auto"><div class="row"><h2 style="margin:0">Assessments</h2><div class="spacer"></div><button class="btn primary new" type="button">＋ New assessment</button></div><table class="data" style="margin-top:10px"><thead><tr><th>Assessment</th><th>Status</th><th>Questions</th><th>Minutes</th><th>Attempts allowed</th><th>Review</th><th>Started / finished</th><th></th></tr></thead><tbody></tbody></table></div>');
    r.assessments.forEach(function (a) {
      var tr = h('<tr><td><b>' + esc(a.title) + '</b><div class="small muted">' + esc(a.id) + '</div></td><td><span class="pill ' + (a.status === 'published' ? 'good' : a.status === 'draft' ? 'warn' : '') + '">' + esc(a.status) + '</span></td><td>' + a.questionCount + ' of ' + a.pool.length + (a.randomizeQuestions ? ' · shuffled' : '') + '</td><td>' + a.durationMin + '</td><td>' + (a.attemptsAllowed || 'unlimited') + '</td><td>' + esc(a.review.replace('_', ' ')) + '</td><td>' + a.started + ' / ' + a.finished + '</td><td class="row" style="gap:4px"></td></tr>');
      var cell = tr.lastChild;
      var btn = function (label, fn, cls) { var b = h('<button class="btn ' + (cls || '') + '" type="button" style="padding:4px 8px;font-size:12px">' + label + '</button>'); b.onclick = fn; cell.appendChild(b); };
      btn('Edit', function () { editAssessment(a, tok); });
      if (a.status !== 'published') btn('Publish', function () { setStatus(a, 'published'); }, 'primary');
      if (a.status === 'published') btn('Close', function () { setStatus(a, 'closed'); });
      if (a.status !== 'draft' && a.status !== 'archived') btn('Back to draft', function () { setStatus(a, 'draft'); });
      if (a.status !== 'archived') btn('Archive', function () { setStatus(a, 'archived'); });
      btn('Analytics', function () { TS.aid = a.id; location.hash = '#/teacher/analytics'; });
      $('tbody', t).appendChild(tr);
    });
    $('.new', t).onclick = function () { editAssessment(null, tok); };
    body.appendChild(t);
    body.appendChild(h('<p class="small muted">Only <b>published</b> assessments can be started by students; <b>closed</b> ones stay visible with results. Changes apply to new attempts only — every attempt keeps the exact questions, versions and option order it was given.</p>'));
    function setStatus(a, st) {
      var go = function () { api('vulvaAdminSaveAssessment', { assessment: Object.assign({}, a, { status: st }) }).then(function (x) { if (x.ok) { toast('“' + a.title + '” is now ' + st + '.'); route(); } else toast(netMsg(x)); }); };
      if (st === 'published' || st === 'closed' || st === 'archived') confirmBox('Change status', 'Set “' + a.title + '” to ' + STATUS_TXT[st] + '?', 'Confirm', go); else go();
    }
  });
}
function editAssessment(a, tok) {
  a = a || { id: '', title: '', subtitle: '', lecture: '', durationMin: 30, questionCount: 20, pool: [], randomizeQuestions: false, randomizeOptions: true, status: 'draft', passPct: 50, attemptsAllowed: 0, review: 'after_submit' };
  var m = modal(a.id ? 'Edit assessment' : 'New assessment', '<div class="grid g2"><div class="field"><label for="ea-t">Title</label><input id="ea-t" value="' + esc(a.title) + '"></div><div class="field"><label for="ea-s">Subtitle</label><input id="ea-s" value="' + esc(a.subtitle || '') + '"></div>' +
    '<div class="field"><label for="ea-l">Lecture tag (L1, L2, MOCK)</label><input id="ea-l" value="' + esc(a.lecture || '') + '"></div><div class="field"><label for="ea-d">Duration (minutes)</label><input id="ea-d" type="number" min="1" max="300" value="' + a.durationMin + '"></div>' +
    '<div class="field"><label for="ea-n">Questions per attempt</label><input id="ea-n" type="number" min="1" value="' + a.questionCount + '"></div><div class="field"><label for="ea-a">Attempts allowed (0 = unlimited)</label><input id="ea-a" type="number" min="0" max="20" value="' + (a.attemptsAllowed || 0) + '"></div>' +
    '<div class="field"><label for="ea-p">Pass mark (%)</label><input id="ea-p" type="number" min="0" max="100" value="' + a.passPct + '"></div><div class="field"><label for="ea-r">Answers & explanations for students</label><select id="ea-r"><option value="after_submit">Right after submission</option><option value="after_close">Only after I close the assessment</option><option value="never">Never (score and topics only)</option></select></div></div>' +
    '<label class="small"><input type="checkbox" id="ea-rq"' + (a.randomizeQuestions ? ' checked' : '') + '> Randomise question order (per attempt)</label><br><label class="small"><input type="checkbox" id="ea-ro"' + (a.randomizeOptions ? ' checked' : '') + '> Randomise option order (per attempt; scoring maps options back automatically)</label>' +
    '<div class="field" style="margin-top:10px"><label for="ea-q">Question pool — question codes, one per line or separated by commas. If the pool is larger than “questions per attempt”, each student gets a random sample.</label><textarea id="ea-q" rows="6" style="width:100%;font-family:monospace">' + esc((a.pool || []).join('\n')) + '</textarea></div>',
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', busy: true, onClick: function (bg) {
      var x = { id: a.id || '', title: $('#ea-t', bg).value, subtitle: $('#ea-s', bg).value, lecture: $('#ea-l', bg).value.trim().toUpperCase(), durationMin: +$('#ea-d', bg).value, questionCount: +$('#ea-n', bg).value, attemptsAllowed: +$('#ea-a', bg).value, passPct: +$('#ea-p', bg).value,
        review: $('#ea-r', bg).value, randomizeQuestions: $('#ea-rq', bg).checked, randomizeOptions: $('#ea-ro', bg).checked, pool: $('#ea-q', bg).value.split(/[\s,;]+/).filter(Boolean), status: a.status };
      api('vulvaAdminSaveAssessment', { assessment: x }).then(function (r) { if (r.ok) { m.close(); toast('Saved.'); route(); } else { toast(netMsg(r)); var btns = $$('.modal .btn', document); btns.forEach(function (b) { b.disabled = false; }); } });
      return false;
    } }]);
  $('#ea-r', m.el).value = a.review || 'after_submit';
}
function tAnalytics(body, tok) {
  tLoad(body, 'vulvaAdminOverview', {}, tok, function (ov) {
    if (!ov.assessments.length) { body.appendChild(h('<div class="card">No assessments yet.</div>')); return; }
    if (!TS.aid || !ov.assessments.some(function (a) { return a.id === TS.aid; })) TS.aid = ov.assessments[0].id;
    var ctl = h('<div class="card"><div class="row"><div class="field" style="margin:0"><label for="an-a">Assessment</label><select id="an-a">' + ov.assessments.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.title) + ' (' + esc(a.status) + ')</option>'; }).join('') + '</select></div>' +
      '<div class="field" style="margin:0"><label for="an-s">Attempts used for statistics</label><select id="an-s"><option value="first">First attempt of each student (recommended)</option><option value="best">Best attempt</option><option value="latest">Latest attempt</option><option value="all">All attempts</option></select></div><div class="spacer"></div>' +
      '<button class="btn e1" type="button" style="margin-top:22px">⬇ Summary CSV</button><button class="btn e2" type="button" style="margin-top:22px">⬇ Item analysis CSV</button><button class="btn e3" type="button" style="margin-top:22px">⬇ Detailed answers CSV</button></div></div>');
    body.appendChild(ctl); $('#an-a', ctl).value = TS.aid; $('#an-s', ctl).value = TS.scope;
    var out = h('<div></div>'); body.appendChild(out);
    var last = null;
    function load() {
      out.innerHTML = '<div class="card">⏳ Calculating on the server…</div>';
      api('vulvaAdminAnalytics', { assessmentId: TS.aid, scope: TS.scope }).then(function (r) {
        if (!live(tok)) return; out.innerHTML = '';
        if (!r.ok) { out.appendChild(h('<div class="card err">' + esc(netMsg(r)) + '</div>')); return; }
        last = r; var s = r.stats;
        out.appendChild(h('<div class="grid g4" style="margin:14px 0">' + [['Attempts analysed', s.attempts], ['Students', s.students], ['Average', s.mean == null ? '—' : s.mean + '%'], ['Median', s.median == null ? '—' : s.median + '%'], ['Highest', s.highest == null ? '—' : s.highest + '%'], ['Lowest', s.lowest == null ? '—' : s.lowest + '%'], ['Pass rate (≥' + s.passPct + '%)', s.passRate == null ? '—' : s.passRate + '%'], ['Completion rate', s.completionRate == null ? '—' : s.completionRate + '%'], ['In progress now', s.inProgress], ['Auto-submitted (time)', s.expired]]
          .map(function (k) { return '<div class="card kpi"><div class="v">' + esc(k[1]) + '</div><div class="l">' + esc(k[0]) + '</div></div>'; }).join('') + '</div>'));
        if (r.topics.length) {
          out.appendChild(h('<div class="card" style="overflow-x:auto"><h2 style="margin-top:0">Topic performance (weakest first)</h2><table class="data"><thead><tr><th>Topic</th><th>Average</th><th>Answers</th><th>Correct</th><th>Incorrect</th><th>Unanswered</th></tr></thead><tbody>' +
            r.topics.map(function (t) { return '<tr><td>' + esc((D.topics[t.topic] || {}).name || t.topic) + '</td><td><b>' + t.score + '%</b>' + (t.weak ? ' <span class="pill bad">weak</span>' : t.score >= 80 ? ' <span class="pill good">strong</span>' : '') + '</td><td>' + t.questions_attempted + '</td><td>' + t.questions_correct + '</td><td>' + t.questions_incorrect + '</td><td>' + t.questions_unanswered + '</td></tr>'; }).join('') + '</tbody></table></div>'));
        }
        var it = h('<div class="card" style="margin-top:16px;overflow-x:auto"><h2 style="margin-top:0">Question performance & item analysis</h2><p class="small muted">Options are shown in their <b>original</b> order (A–D as written), even when papers were shuffled. Key in green. <b>DI</b> = discrimination index (top 27% minus bottom 27%, shown with ≥10 attempts): ≥0.3 good · 0.2–0.29 acceptable · &lt;0.2 review · negative = check the key. <b>Dead</b> = distractors chosen by nobody. Click a row for the full question.</p><table class="data"><thead><tr><th>Code</th><th>Topic</th><th>n</th><th>Correct</th><th>Incorrect</th><th>Unans.</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Key</th><th>Difficulty</th><th>DI</th><th>Dead</th></tr></thead><tbody></tbody></table></div>');
        r.items.forEach(function (x) {
          var tr = h('<tr class="click" tabindex="0"><td>' + esc(x.code) + (x.version > 1 ? ' <span class="small muted">v' + x.version + '</span>' : '') + '</td><td>' + esc((D.topics[x.topic] || {}).name || x.topic) + '</td><td>' + x.n + '</td><td><b>' + x.pctCorrect + '%</b></td><td>' + x.pctIncorrect + '%</td><td>' + x.pctUnanswered + '%</td>' +
            x.distPct.map(function (p, j) { return '<td' + (j === x.answer ? ' style="color:var(--good);font-weight:800"' : x.dist[j] === 0 ? ' class="muted"' : '') + '>' + p + '%</td>'; }).join('') + '<td>' + LETTERS[x.answer] + '</td><td>' + x.difficultyIndex.toFixed(2) + '</td><td>' + (x.discrimination == null ? '—' : '<span class="' + (x.discrimination < 0 ? 'neg' : x.discrimination < 0.2 ? 'lowdi' : '') + '">' + x.discrimination.toFixed(2) + '</span>') + '</td><td>' + x.nonFunctioning + '</td></tr>');
          var open = function () { modal(x.code + ' (version ' + x.version + ')', '<p>' + esc(x.stem) + '</p><ol type="A">' + x.options.map(function (o, j) { return '<li' + (j === x.answer ? ' style="color:var(--good);font-weight:700"' : '') + '>' + esc(o) + ' — ' + x.dist[j] + ' (' + x.distPct[j] + '%)</li>'; }).join('') + '</ol><p class="small">Unanswered: ' + x.unanswered + ' · Concept: ' + esc(conceptName(x.concept)) + '</p>'); };
          tr.onclick = open; tr.onkeydown = function (e) { if (e.key === 'Enter') open(); };
          $('tbody', it).appendChild(tr);
        });
        if (!r.items.length) $('tbody', it).appendChild(h('<tr><td colspan="14" class="muted">No finished attempts yet.</td></tr>'));
        out.appendChild(it);
        var st = h('<div class="card" style="margin-top:16px;overflow-x:auto"><h2 style="margin-top:0">Student attempts (' + r.attempts.length + ')</h2><div class="field" style="max-width:320px"><label for="an-q">Search name or Student ID</label><input id="an-q" type="search"></div><table class="data"><thead><tr><th>Student</th><th>Student ID</th><th>Attempt</th><th>Status</th><th>Score</th><th>%</th><th>Submitted</th><th></th></tr></thead><tbody></tbody></table></div>');
        function rows() {
          var q = ($('#an-q', st).value || '').toLowerCase(), tb = $('tbody', st); tb.innerHTML = '';
          r.attempts.filter(function (a) { return !q || (a.name + ' ' + a.username).toLowerCase().indexOf(q) >= 0; }).forEach(function (a) {
            var tr = h('<tr><td>' + esc(a.name) + '</td><td>' + esc(a.username) + '</td><td>' + a.attemptNo + '</td><td><span class="pill ' + (a.status === 'submitted' ? 'good' : a.status === 'started' ? 'warn' : '') + '">' + esc(a.status) + '</span></td><td>' + (a.score == null ? '—' : a.score + '/' + a.total) + '</td><td>' + (a.percent == null ? '—' : '<b>' + a.percent + '%</b>') + '</td><td>' + (a.submittedAt ? fmtDate(a.submittedAt) : '—') + '</td><td></td></tr>');
            var c = tr.lastChild;
            if (a.status === 'submitted' || a.status === 'expired') { var b = h('<button class="btn" type="button" style="padding:3px 8px;font-size:12px">Details</button>'); b.onclick = function () { attemptDetail(a.id); }; c.appendChild(b); }
            if (a.status === 'started') { var x = h('<button class="btn danger" type="button" style="padding:3px 8px;font-size:12px">Cancel attempt</button>'); x.onclick = function () { confirmBox('Cancel attempt', 'Cancel ' + a.name + '’s attempt in progress? It will be marked “abandoned” and will not be scored.', 'Cancel attempt', function () { api('vulvaAdminAbandon', { attemptId: a.id }).then(function (y) { toast(y.ok ? 'Attempt cancelled.' : netMsg(y)); load(); }); }, true); }; c.appendChild(x); }
            tb.appendChild(tr);
          });
        }
        $('#an-q', st).oninput = rows; rows(); out.appendChild(st);
      });
    }
    function attemptDetail(id) {
      api('vulvaAdminAttempt', { attemptId: id }).then(function (r) {
        if (!r.ok) return toast(netMsg(r));
        var a = r.result, m = modal(a.name + ' · ' + a.assessmentTitle, '<p class="small muted">Student ID ' + esc(a.username) + ' · ' + fmtDate(a.submittedAt) + (a.auto ? ' · auto-submitted' : '') + ' · time used ' + fmtDur(a.durationSec) + '</p><p><b>' + a.score + '/' + a.total + ' (' + a.percent + '%)</b> — ' + a.correct + ' correct, ' + a.incorrect + ' incorrect, ' + a.unanswered + ' unanswered.</p><div class="dt"></div>');
        a.review.forEach(function (it) { var d = h('<div class="review-item"></div>'); d.appendChild(reviewItemHtml(it)); $('.dt', m.el).appendChild(d); });
      });
    }
    $('#an-a', ctl).onchange = function (e) { TS.aid = e.target.value; load(); };
    $('#an-s', ctl).onchange = function (e) { TS.scope = e.target.value; load(); };
    $('.e1', ctl).onclick = function () { if (!last) return; var rows = [['Name', 'Student ID', 'Assessment', 'Attempt', 'Status', 'Score', 'Total', 'Percentage', 'Correct', 'Incorrect', 'Unanswered', 'Time used (min)', 'Started', 'Submitted', 'Auto-submitted']];
      last.attempts.forEach(function (a) { rows.push([a.name, a.username, last.assessment.title, a.attemptNo, a.status, a.score, a.total, a.percent, a.correct, a.incorrect, a.unanswered, a.durationSec == null ? '' : Math.round(a.durationSec / 6) / 10, new Date(a.startedAt).toLocaleString(), a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '', a.auto ? 'yes' : 'no']); });
      download(MOD + '-' + slug(last.assessment.title) + '-summary.csv', csv(rows), 'text/csv;charset=utf-8'); };
    $('.e2', ctl).onclick = function () { if (!last) return; var rows = [['Code', 'Version', 'Topic', 'Concept', 'n', '% correct', '% incorrect', '% unanswered', 'A %', 'B %', 'C %', 'D %', 'Key', 'Difficulty index', 'Discrimination index', 'Non-functioning distractors']];
      last.items.forEach(function (x) { rows.push([x.code, x.version, (D.topics[x.topic] || {}).name || x.topic, conceptName(x.concept), x.n, x.pctCorrect, x.pctIncorrect, x.pctUnanswered, x.distPct[0], x.distPct[1], x.distPct[2], x.distPct[3], LETTERS[x.answer], x.difficultyIndex, x.discrimination == null ? '' : x.discrimination, x.nonFunctioning]); });
      download(MOD + '-' + slug(last.assessment.title) + '-item-analysis.csv', csv(rows), 'text/csv;charset=utf-8'); };
    $('.e3', ctl).onclick = function () {
      api('vulvaAdminAnalytics', { assessmentId: TS.aid, scope: TS.scope, withAnswers: true }).then(function (r) {
        if (!r.ok) return toast(netMsg(r));
        var rows = [['Name', 'Student ID', 'Attempt ID', 'Question', 'Version', 'Answer given (original letter)', 'Correct answer', 'Result']];
        (r.answers || []).forEach(function (a) { a.items.forEach(function (x) { rows.push([a.name, a.username, a.id, x[0], x[1], x[2] == null ? '' : LETTERS[x[2]], LETTERS[x[3]], x[2] == null ? 'unanswered' : x[4] ? 'correct' : 'incorrect']); }); });
        download(MOD + '-' + slug(r.assessment.title) + '-detailed.csv', csv(rows), 'text/csv;charset=utf-8');
      });
    };
    load();
  });
}
function tBank(body, tok) {
  tLoad(body, 'vulvaAdminBank', {}, tok, function (r) {
    var ctl = h('<div class="card"><div class="row"><div class="field" style="margin:0"><label for="bk-k">Type</label><select id="bk-k"><option value="all">All</option><option value="assess">Assessment</option><option value="practice">Practice</option><option value="inactive">Inactive only</option></select></div><div class="field" style="margin:0"><label for="bk-t">Topic</label><select id="bk-t"><option value="">All topics</option>' + Object.keys(D.topics).map(function (k) { return '<option value="' + k + '">' + esc(D.topics[k].name) + '</option>'; }).join('') + '</select></div><div class="field" style="margin:0;flex:1;min-width:180px"><label for="bk-q">Search code or text</label><input id="bk-q" type="search"></div><button class="btn primary nq" type="button" style="margin-top:22px">＋ New question</button></div>' +
      '<p class="small muted" style="margin:8px 0 0">Editing never overwrites: every change creates a new version; attempts keep the version they were given. Deactivated questions are not used in new attempts or practice.</p></div>');
    body.appendChild(ctl);
    $('#bk-k', ctl).value = TS.bankKind; $('#bk-t', ctl).value = TS.bankTopic; $('#bk-q', ctl).value = TS.bankQ;
    var t = h('<div class="card" style="margin-top:14px;overflow-x:auto"><table class="data"><thead><tr><th>Code</th><th>Type</th><th>Topic</th><th>Question</th><th>Key</th><th>Ver.</th><th>Used</th><th>Active</th><th></th></tr></thead><tbody></tbody></table></div>');
    body.appendChild(t);
    function draw() {
      var tb = $('tbody', t); tb.innerHTML = ''; var q = TS.bankQ.toLowerCase(), n = 0;
      r.questions.filter(function (x) { return (TS.bankKind === 'all' || (TS.bankKind === 'inactive' ? !x.active : x.kind === TS.bankKind)) && (!TS.bankTopic || x.topic === TS.bankTopic) && (!q || (x.qid + ' ' + x.legacyId + ' ' + x.stem).toLowerCase().indexOf(q) >= 0); }).forEach(function (x) {
        if (n++ > 300) return;
        var tr = h('<tr><td><b>' + esc(x.qid) + '</b><div class="small muted">' + esc(x.legacyId) + '</div></td><td>' + (x.kind === 'assess' ? 'Assessment' : 'Practice') + '</td><td>' + esc((D.topics[x.topic] || {}).name || x.topic) + '</td><td class="small">' + esc(String(x.stem).replace(/\[\[IMAGE\]\]/g, '🖼').slice(0, 140)) + '…</td><td>' + LETTERS[x.answer] + '</td><td>' + x.version + '</td><td>' + x.usedInAttempts + '</td><td><label><input type="checkbox"' + (x.active ? ' checked' : '') + ' aria-label="Active"></label></td><td class="row" style="gap:4px"></td></tr>');
        $('input', tr).onchange = function (e) { api('vulvaAdminSetActive', { qid: x.qid, active: e.target.checked }).then(function (y) { if (y.ok) { x.active = e.target.checked; svAt = 0; if (HOOKS.bankChanged) HOOKS.bankChanged(); toast(x.qid + (x.active ? ' activated.' : ' deactivated.')); } else { toast(netMsg(y)); e.target.checked = !e.target.checked; } }); };
        var c = tr.lastChild;
        [['Edit', 'edit'], ['Duplicate', 'duplicate'], ['History', 'history']].forEach(function (b) { var el = h('<button class="btn" type="button" style="padding:3px 8px;font-size:12px">' + b[0] + '</button>'); el.onclick = function () { if (b[1] === 'history') history(x); else editQuestion(x, b[1]); }; c.appendChild(el); });
        tb.appendChild(tr);
      });
      if (!tb.children.length) tb.appendChild(h('<tr><td colspan="9" class="muted">No questions match. Import the bank first (Import / migration).</td></tr>'));
    }
    function history(x) {
      api('vulvaAdminQuestionHistory', { qid: x.qid }).then(function (y) {
        if (!y.ok) return toast(netMsg(y));
        modal(x.qid + ' — version history', y.versions.map(function (v) { return '<div class="review-item"><div class="small muted">Version ' + v.version + ' · ' + fmtDate(v.createdAt) + ' · by ' + esc(v.createdBy) + '</div><p>' + esc(String(v.stem).slice(0, 400)) + '</p><ol type="A">' + v.options.map(function (o, j) { return '<li' + (j === v.answer ? ' style="color:var(--good);font-weight:700"' : '') + '>' + esc(o) + '</li>'; }).join('') + '</ol></div>'; }).join(''));
      });
    }
    ['#bk-k', '#bk-t'].forEach(function (s) { $(s, ctl).onchange = function () { TS.bankKind = $('#bk-k', ctl).value; TS.bankTopic = $('#bk-t', ctl).value; draw(); }; });
    $('#bk-q', ctl).oninput = function (e) { TS.bankQ = e.target.value; draw(); };
    $('.nq', ctl).onclick = function () { editQuestion(null, 'new'); };
    draw();
  });
}
function editQuestion(x, mode) {
  x = x || { kind: 'assess', lecture: 'MAIN', section: '', sub: '', topic: Object.keys(D.topics)[0], concept: '', objective: '', difficulty: 'Application', priority: 2, label: 'COURSE CORE', previousExam: false, integrated: false, image: '', stem: '', options: ['', '', '', ''], answer: 0, explanation: '', trap: '', ref: '' };
  var title = mode === 'edit' ? 'Edit ' + x.qid + ' (saves as version ' + (x.version + 1) + ')' : mode === 'duplicate' ? 'Duplicate of ' + x.qid + ' (new question)' : 'New question';
  var m = modal(title, '<div class="grid g2"><div class="field"><label for="eq-k">Type</label><select id="eq-k"' + (mode === 'edit' ? ' disabled' : '') + '><option value="assess">Assessment (secure)</option><option value="practice">Practice (formative)</option></select></div><div class="field"><label for="eq-l">Lecture</label><select id="eq-l"><option>L1</option><option>L2</option><option>L1+L2</option></select></div>' +
    '<div class="field"><label for="eq-t">Topic</label><select id="eq-t">' + Object.keys(D.topics).map(function (k) { return '<option value="' + k + '">' + esc(D.topics[k].name) + '</option>'; }).join('') + '</select></div><div class="field"><label for="eq-se">Section / learning block (e.g. 1.3 or 1.3.6)</label><input id="eq-se" value="' + esc(x.sub || x.section) + '"></div>' +
    '<div class="field"><label for="eq-c">Concept key</label><input id="eq-c" value="' + esc(x.concept) + '" list="eq-cl"><datalist id="eq-cl">' + Object.keys(CONCEPTS).map(function (k) { return '<option value="' + k + '">' + esc(CONCEPTS[k].name) + '</option>'; }).join('') + '</datalist></div><div class="field"><label for="eq-d">Cognitive level</label><select id="eq-d"><option>Recall</option><option>Application</option><option>Interpretation</option></select></div>' +
    '<div class="field"><label for="eq-p">Priority</label><select id="eq-p"><option value="3">★★★ MUST KNOW</option><option value="2">★★ HIGH-YIELD</option><option value="1">★ SUPPORTING</option></select></div><div class="field"><label for="eq-lb">Source label</label><select id="eq-lb"><option>COURSE + EXAM</option><option>COURSE CORE</option><option>CLARIFICATION</option><option>SUPPLEMENTARY</option></select></div></div>' +
    '<div class="field"><label for="eq-o">Learning objective</label><input id="eq-o" value="' + esc(x.objective) + '"></div>' +
    '<div class="field"><label for="eq-s">Stem (blank line = new paragraph; write [[IMAGE]] where the picture goes)</label><textarea id="eq-s" rows="4" style="width:100%">' + esc(x.stem) + '</textarea></div>' +
    '<div class="field"><label for="eq-i">Picture slot (optional)</label><div class="row"><input id="eq-i" style="flex:1" value="' + esc(x.image || '') + '" placeholder="e.g. pic:vu012">' + (HOOKS.pictureDialog ? '<button class="btn eq-pic" type="button">🖼 Add / edit picture</button>' : '') + '</div><div class="small muted">Pictures are shared slots: the same slot shows the same picture in the lecture, questions and slides.</div></div>' +
    [0, 1, 2, 3].map(function (i) { return '<div class="row" style="margin:4px 0"><label><input type="radio" name="eq-a" value="' + i + '"' + (x.answer === i ? ' checked' : '') + '> ' + LETTERS[i] + '</label><input class="eq-op" style="flex:1" value="' + esc(x.options[i] || '') + '" aria-label="Option ' + LETTERS[i] + '"></div>'; }).join('') +
    '<div class="field"><label for="eq-e">Explanation (why the key is right and the main distractor wrong)</label><textarea id="eq-e" rows="3" style="width:100%">' + esc(x.explanation) + '</textarea></div>' +
    '<div class="grid g2"><div class="field"><label for="eq-tr">Exam trap (optional)</label><input id="eq-tr" value="' + esc(x.trap || '') + '"></div><div class="field"><label for="eq-r">Source / reference</label><input id="eq-r" value="' + esc(x.ref || '') + '"></div></div>' +
    '<label class="small"><input type="checkbox" id="eq-pe"' + (x.previousExam ? ' checked' : '') + '> Previous-exam concept</label> <label class="small"><input type="checkbox" id="eq-in"' + (x.integrated ? ' checked' : '') + '> Integrated (spans multiple lectures)</label>',
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: function (bg) {
      // resolve against the course itself: a learning block → its section; a section → no block
      var sec = $('#eq-se', bg).value.trim(), isSub = !!SUBS[sec], place = isSub ? SUBS[sec].section : SECTIONS[sec] ? sec : sec;
      if (!SUBS[sec] && !SECTIONS[sec] && !window.confirm('“' + sec + '” is not a section or learning block of this course. Save anyway?')) return false;
      var q = { qid: x.qid, kind: $('#eq-k', bg).value, lecture: $('#eq-l', bg).value, topic: $('#eq-t', bg).value, section: place, sub: isSub ? sec : '', concept: $('#eq-c', bg).value.trim(),
        difficulty: $('#eq-d', bg).value, priority: +$('#eq-p', bg).value, label: $('#eq-lb', bg).value, objective: $('#eq-o', bg).value.trim(), stem: $('#eq-s', bg).value.trim(), image: $('#eq-i', bg).value.trim(),
        options: $$('.eq-op', bg).map(function (i) { return i.value.trim(); }), answer: +(($('input[name=eq-a]:checked', bg) || {}).value || 0), explanation: $('#eq-e', bg).value.trim(), trap: $('#eq-tr', bg).value.trim(), ref: $('#eq-r', bg).value.trim(),
        previousExam: $('#eq-pe', bg).checked, integrated: $('#eq-in', bg).checked, code: x.code, legacyId: x.legacyId };
      api('vulvaAdminSaveQuestion', { question: q, mode: mode }).then(function (r) { if (r.ok) { m.close(); toast(r.unchanged ? 'No changes — nothing saved.' : 'Saved ' + r.qid + ' as version ' + r.version + '.'); if (HOOKS.bankChanged) HOOKS.bankChanged(); refreshServer(true).then(route); } else toast(netMsg(r)); });
      return false;
    } }]);
  if (x.lecture && !$('#eq-l option[value="' + x.lecture + '"]', m.el) && !$$('#eq-l option', m.el).some(function (o) { return o.textContent === x.lecture; })) $('#eq-l', m.el).appendChild(h('<option>' + esc(x.lecture) + '</option>'));
  var pb = $('.eq-pic', m.el); if (pb) pb.onclick = function () { var inp = $('#eq-i', m.el); if (!inp.value.trim()) inp.value = 'pic:q' + Date.now().toString(36); HOOKS.pictureDialog(inp.value.trim(), { stack: true }); };
  $('#eq-k', m.el).value = x.kind; $('#eq-l', m.el).value = x.lecture; $('#eq-t', m.el).value = x.topic; $('#eq-d', m.el).value = x.difficulty || 'Application'; $('#eq-p', m.el).value = String(x.priority || 2); $('#eq-lb', m.el).value = x.label || 'COURSE CORE';
  $('.modal', m.el).style.maxWidth = '860px';
}
function tStudents(body, tok) {
  tLoad(body, 'listStudents', {}, tok, function (r) {
    var c = h('<div class="card"><h2 style="margin-top:0">Student accounts (' + r.students.length + ')</h2><p class="small muted">These are the platform’s own student accounts (shared Students sheet, same sign-in and password rules as the other modules). The username is the Student ID. The server keeps only salted password hashes.</p>' +
      '<details><summary><b>＋ Add students</b> (paste: Student ID, Full name, Email — one per line)</summary><textarea id="st-b" rows="6" style="width:100%;font-family:monospace" placeholder="2023001, Ahmed Ali, ahmed@example.com"></textarea><button class="btn primary st-add" type="button">Create accounts</button><p class="small muted">Each new student gets a temporary password (shown once) and must choose their own at first sign-in.</p></details>' +
      '<div class="field" style="max-width:320px;margin-top:10px"><label for="st-q">Search</label><input id="st-q" type="search"></div><div style="overflow-x:auto"><table class="data"><thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody></tbody></table></div></div>');
    body.appendChild(c);
    function rows() {
      var q = ($('#st-q', c).value || '').toLowerCase(), tb = $('tbody', c); tb.innerHTML = '';
      r.students.filter(function (s) { return !q || (s.username + ' ' + s.name + ' ' + s.email).toLowerCase().indexOf(q) >= 0; }).forEach(function (s) {
        var tr = h('<tr><td>' + esc(s.username) + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.email) + '</td><td>' + (s.active ? '<span class="pill good">active</span>' : '<span class="pill bad">inactive</span>') + (s.locked ? ' <span class="pill warn">locked</span>' : '') + (s.mustChange ? ' <span class="pill">temp password</span>' : '') + '</td><td>' + (s.lastLogin ? fmtDate(s.lastLogin) : '—') + '</td><td class="row" style="gap:4px"></td></tr>');
        var cell = tr.lastChild, b = function (l, fn) { var el = h('<button class="btn" type="button" style="padding:3px 8px;font-size:12px">' + l + '</button>'); el.onclick = fn; cell.appendChild(el); };
        b('Reset password', function () { confirmBox('Reset password', 'Give ' + s.name + ' a new temporary password? They are signed out everywhere.', 'Reset', function () { api('resetStudentPassword', { username: s.username }).then(function (x) { if (x.ok) modal('Temporary password', '<p>' + esc(s.username) + ': <b style="font-family:monospace;font-size:18px">' + esc(x.tempPassword) + '</b></p><p class="small muted">Shown only now.</p>'); else toast(netMsg(x)); }); }); });
        b(s.active ? 'Deactivate' : 'Activate', function () { api('setStudentActive', { username: s.username, active: !s.active }).then(function (x) { if (x.ok) { s.active = !s.active; rows(); } else toast(netMsg(x)); }); });
        if (s.locked) b('Unlock', function () { api('unlockStudent', { username: s.username }).then(function (x) { if (x.ok) { s.locked = false; rows(); } else toast(netMsg(x)); }); });
        tb.appendChild(tr);
      });
    }
    $('#st-q', c).oninput = rows; rows();
    $('.st-add', c).onclick = function () {
      var list = $('#st-b', c).value.split(/\r?\n/).map(function (l) { var p = l.split(/[,;\t]/).map(function (x) { return x.trim(); }); return p[0] ? { username: p[0], name: p[1] || '', email: p[2] || '' } : null; }).filter(Boolean);
      if (!list.length) return toast('Paste at least one line.');
      api('bulkAddStudents', { students: list }).then(function (x) {
        if (!x.ok) return toast(netMsg(x));
        var made = x.results.filter(function (y) { return y.ok; }), bad = x.results.filter(function (y) { return !y.ok; });
        modal('Accounts created: ' + made.length, (made.length ? '<table class="data"><thead><tr><th>Student ID</th><th>Temporary password</th></tr></thead><tbody>' + made.map(function (y) { return '<tr><td>' + esc(y.username) + '</td><td style="font-family:monospace;font-weight:700">' + esc(y.tempPassword) + '</td></tr>'; }).join('') + '</tbody></table><p class="small muted">Shown only now — copy or download them before closing.</p>' : '') + (bad.length ? '<p class="err">' + bad.map(function (y) { return esc(y.error); }).join('<br>') + '</p>' : ''),
          [{ label: 'Download CSV', onClick: function () { download(MOD + '-new-student-passwords.csv', csv([['Student ID', 'Temporary password']].concat(made.map(function (y) { return [y.username, y.tempPassword]; }))), 'text/csv;charset=utf-8'); return false; } }, { label: 'Close', cls: 'primary', onClick: function () { route(); } }]);
      });
    };
  });
}
function tImport(body, tok) {
  body.appendChild(h('<div class="card md"><h2 style="margin-top:0">Import / migration of the ' + esc(D.meta.short) + ' question bank</h2><p>Upload <code>' + MOD + '_seed.json</code> (produced by the build from the approved content: the assessed Vulvar Pathology Exam SBAs with answer keys, explanations and metadata, the ungraded practice-bank SBAs, and the assessment definition). The server validates every record first and shows a report; nothing is written until you confirm.</p>' +
    '<ul><li>Re-importing is safe: unchanged questions are skipped; changed ones become a <b>new version</b> (history kept).</li><li>Assessments are created as <b>drafts</b> only if they do not already exist — your settings are never overwritten.</li><li>Keep this file private: it contains the answer keys. Do not upload it to the student website.</li></ul>' +
    '<label class="btn primary">📄 Choose ' + MOD + '_seed.json<input type="file" accept=".json,application/json" hidden></label><div class="rep" style="margin-top:14px"></div></div>'));
  var rep = $('.rep', body), data = null;
  function showReport(r, dry) {
    var R = r.report;
    rep.innerHTML = '<h3>' + (dry ? 'Validation report (nothing written yet)' : 'Import complete') + '</h3><table class="data"><tbody>' +
      [['Questions found', R.questionsFound], ['New questions ' + (dry ? 'to import' : 'imported'), R.imported], ['Changed questions → new version', R.newVersions], ['Unchanged (skipped)', R.unchanged], ['Rejected', R.rejected], ['Duplicate IDs', R.duplicates], ['Missing metadata (warnings)', R.missingMetadata]].map(function (x) { return '<tr><td>' + x[0] + '</td><td><b>' + x[1] + '</b></td></tr>'; }).join('') + '</tbody></table>' +
      (R.assessments.length ? '<p><b>Assessments:</b></p><ul>' + R.assessments.map(function (a) { return '<li>' + esc(a.title) + ' — ' + esc(a.action) + ' (' + a.poolFound + '/' + a.pool + ' pool questions found)</li>'; }).join('') + '</ul>' : '') +
      (R.problems.length ? '<details><summary>' + R.problems.length + ' problem(s)/warning(s)</summary><ul>' + R.problems.map(function (p) { return '<li>' + esc(p.qid || '#' + p.index) + ': ' + esc(p.error || p.warning) + '</li>'; }).join('') + '</ul></details>' : '') +
      (dry && (R.imported || R.newVersions || R.assessments.some(function (a) { return /created/.test(a.action); })) ? '<button class="btn primary go" type="button">Import now</button>' : '');
    var go = $('.go', rep); if (go) go.onclick = function () { go.disabled = true; go.textContent = 'Importing…'; api('vulvaAdminImport', Object.assign({}, data, { dryRun: false }), { timeout: 120000 }).then(function (x) { if (x.ok) { showReport(x, false); toast('Import complete.'); if (HOOKS.bankChanged) HOOKS.bankChanged(); refreshServer(true); } else toast(netMsg(x)); }); };
  }
  $('input[type=file]', body).onchange = function (e) {
    var f = e.target.files[0]; if (!f) return; var rd = new FileReader();
    rd.onload = function () {
      try { data = JSON.parse(rd.result); if (data.kind !== MOD + '-seed' || !Array.isArray(data.questions)) throw 0; } catch (x) { rep.innerHTML = '<p class="err">This is not a seed file for this module.</p>'; return; }
      rep.innerHTML = '<p>⏳ Validating ' + data.questions.length + ' questions on the server…</p>';
      api('vulvaAdminImport', { questions: data.questions, assessments: data.assessments, topics: data.topics, dryRun: true }, { timeout: 120000 }).then(function (r) { data = { questions: data.questions, assessments: data.assessments, topics: data.topics }; if (r.ok) showReport(r, true); else rep.innerHTML = '<p class="err">' + esc(netMsg(r)) + '</p>'; });
    };
    rd.readAsText(f);
  };
}
function tAudit(body, tok) {
  tLoad(body, 'vulvaAdminAudit', { limit: 400 }, tok, function (r) {
    var t = h('<div class="card" style="overflow-x:auto"><h2 style="margin-top:0">Audit log (latest ' + r.events.length + ')</h2><table class="data"><thead><tr><th>When</th><th>Who</th><th>Role</th><th>Event</th><th>Reference</th><th>Detail</th></tr></thead><tbody>' +
      r.events.map(function (e) { return '<tr><td>' + fmtDate(e.at) + '</td><td>' + esc(e.actor) + '</td><td>' + esc(e.role) + '</td><td>' + esc(e.event) + '</td><td class="small">' + esc(e.ref) + '</td><td class="small">' + esc(String(e.detail).slice(0, 160)) + '</td></tr>'; }).join('') + '</tbody></table></div>');
    body.appendChild(t);
  });
}
function tAccount(body) {
  var c = h('<div class="card" style="max-width:520px"><h2 style="margin-top:0">Teacher password</h2><p class="small muted">This module has its own teacher password on the shared backend (like every module). Minimum 8 characters.</p><div class="field"><label for="ac-o">Current password</label><input id="ac-o" type="password" autocomplete="current-password"></div><div class="field"><label for="ac-n">New password</label><input id="ac-n" type="password" autocomplete="new-password"></div><button class="btn primary" type="button">Change password</button></div>');
  $('button', c).onclick = function () { api('changePassword', { oldPassword: $('#ac-o', c).value, newPassword: $('#ac-n', c).value }).then(function (r) { toast(r.ok ? 'Password changed.' : netMsg(r)); if (r.ok) { $('#ac-o', c).value = ''; $('#ac-n', c).value = ''; } }); };
  body.appendChild(c);
  body.appendChild(h('<div class="note" style="margin-top:16px"><b>Security model.</b> Answer keys, explanations, unpublished assessments, analytics and question editing are available only through server actions that check a valid teacher session. Students receive papers without answers; the server scores every attempt and enforces the timer. The offline revision edition (separate file) is for revision only and its results are not official.</div>'));
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
    index: function () { return { SECTIONS: SECTIONS, SUBS: SUBS, ORDER: ORDER, PID: PID, CHECK_ID: CHECK_ID, SEC_TOPIC: SEC_TOPIC, PR: PR }; },
    imgTag: imgTag, stemParas: stemParas, editServerQuestion: editQuestion, topicName: topicName, refreshServer: refreshServer, fmtDate: fmtDate, fmtDur: fmtDur, pct: pct,
    cleanup: function (fn) { cleanup = fn; }, app: function () { return app; }, loadDeck: loadDeck
  });
  window.addEventListener('hashchange', route);
  app.innerHTML = '<div class="card">⏳ Loading your progress…</div>';
  refreshServer(true).then(route, route);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp); else startApp();
window.__vulva = { D: D, md: md, buildDeck: buildDeck, state: function () { return { PR: PR, SV: SV }; } };
}
window.VULVA_MAIN = main;
})();
