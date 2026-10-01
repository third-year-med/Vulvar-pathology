/* Teacher editor — loaded by boot.js for teacher sessions only. It contains no secrets: every action it
   performs is a backend call that the Apps Script backend (GynContent.gs / Gyn.gs) authorises with the
   teacher session. Built on the same principles as the Presentation Mode slide editor: content is plain text
   with the platform's own light formatting, edited in a panel with live preview, undo, and automatic saving
   to the DRAFT kept in the private spreadsheet — students never see it until it is published.

   Pieces (all generic, reused across Learn, Practice, Review and media):
   - Draft:       state, autosave (debounced), conflict handling, undo/redo, unsaved-changes warnings
   - Panel:       side drawer / mobile sheet used by every editor
   - MdField:     text area + formatting toolbar + live preview (bold, italic, headings, lists, links,
                  tables with a grid editor, callouts, labels, pictures; paste from Word/web keeps formatting)
   - FormEditor:  schema-driven form for records (sections, review items, settings)
   - Blocks:      click any paragraph/list/table/picture in Learn Mode to edit, move, duplicate or delete it
   - Questions:   structural editor for section checks (part of the Learn content); practice and assessment
                  questions live in the backend question bank and open the Teacher portal's editor
   - Pictures:    picture dialog (replace/upload/library, caption, alt text, size, alignment) + media library;
                  files are encrypted in this browser and committed to GitHub by the backend
   - Publishing:  draft status, preview, publish (encrypted, committed to GitHub by the backend), history and
                  rollback (spreadsheet snapshots and GitHub commits) */
(function () {
  'use strict';
  window.VULVA_EDITOR = function (A) {
    var D = A.D, CX = A.CX, HOOKS = A.HOOKS, $ = A.$, $$ = A.$$, h = A.h, esc = A.esc, inl = A.inl, md = A.md, toast = A.toast;
    var LETTERS = A.LETTERS, LABEL_TEXT = A.LABEL_TEXT;
    var IS_DRAFT = CX.view === 'draft';
    var EDIT_KEY = 'vp_edit';
    var editing = IS_DRAFT && sessionStorage.getItem(EDIT_KEY) === '1';
    var preview = false;
    function isEditing() { return editing && !preview; }
    HOOKS.editing = isEditing;

    /* ================= Draft state, saving, undo ================= */
    var rev = CX.rev || 0, dirty = false, saving = false, saveErr = '', lastSaved = CX.savedAt, saveT = null, undoStack = [], redoStack = [];
    function cleanContent() {
      // D carries a few lookup fields the app adds at run time (section → lecture); they are not content.
      var c = JSON.parse(JSON.stringify(D)); delete c.__published;
      c.lectures.forEach(function (L) { L.sections.forEach(function (s) { delete s.lecture; s.subs.forEach(function (u) { delete u.section; delete u.lecture; }); }); });
      return c;
    }
    function snapshot() { undoStack.push(JSON.stringify(cleanContent())); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
    function replaceD(json) { var c = JSON.parse(json); Object.keys(D).forEach(function (k) { delete D[k]; }); Object.assign(D, c); }
    function undo() { if (!undoStack.length) return toast('Nothing to undo.'); redoStack.push(JSON.stringify(cleanContent())); replaceD(undoStack.pop()); changed(true); toast('Undone.'); }
    function redo() { if (!redoStack.length) return toast('Nothing to redo.'); undoStack.push(JSON.stringify(cleanContent())); replaceD(redoStack.pop()); changed(true); toast('Redone.'); }
    /* Every edit: change(fn) takes an undo snapshot, applies fn, re-indexes, re-renders (keeping the scroll
       position) and schedules a save of the draft. */
    function change(fn, opts) {
      if (!IS_DRAFT) { toast('Open the draft to edit (you are viewing the live version).'); return false; }
      snapshot();
      try { fn(); } catch (e) { replaceD(undoStack.pop()); toast(e.message || 'That change could not be made.'); return false; }
      changed(!(opts && opts.noRender));
      return true;
    }
    function changed(render) {
      A.reindex();
      markDirty();
      if (render) rerender();
      updateBar();
    }
    function rerender() { var y = window.scrollY; A.route(); setTimeout(function () { window.scrollTo(0, y); }, 0); }
    function markDirty() { dirty = true; saveErr = ''; updateBar(); clearTimeout(saveT); saveT = setTimeout(save, 1500); }
    function save(checkpoint) {
      clearTimeout(saveT);
      if (!IS_DRAFT) return Promise.resolve(false);
      if (saving) { saveT = setTimeout(function () { save(checkpoint); }, 500); return Promise.resolve(false); }
      if (!dirty && !checkpoint) return Promise.resolve(true);
      saving = true; dirty = false; updateBar();
      return CX.api('vulvaAdminContentSave', { content: cleanContent(), baseRev: rev, checkpoint: !!checkpoint }).then(function (r) {
        saving = false;
        if (r.ok) { rev = r.rev; lastSaved = r.at; saveErr = ''; CX.fromLive = false; updateBar(); return true; }
        dirty = true;
        if (r.code === 'conflict') { saveErr = 'conflict'; conflict(); }
        else saveErr = r.error + (r.issues ? ' ' + r.issues.slice(0, 3).join(' · ') : '');
        updateBar(); return false;
      });
    }
    function conflict() {
      A.modal('The draft was changed elsewhere', '<p>Another tab or another teacher saved the draft after you opened it.</p><p><b>Reload</b> to continue from the latest draft (your last unsaved changes here are lost), or <b>Keep my version</b> to overwrite the draft with what you see now.</p>',
        [{ label: 'Reload', onClick: function () { dirty = false; location.reload(); } }, { label: 'Keep my version', cls: 'primary', onClick: function () {
          CX.api('vulvaAdminContentGet').then(function (s) { if (!s.ok) return toast(s.error); rev = s.draft ? s.draft.rev : 0; dirty = true; save(true); });
        } }]);
    }
    window.addEventListener('beforeunload', function (e) { if (dirty || saving || openPanel) { e.preventDefault(); e.returnValue = ''; } });
    HOOKS.beforeLogout = function () { if (dirty || saving) { toast('Saving your changes first…'); save().then(function (ok) { if (ok) CX.logout(); }); return false; } return true; };
    // Changes made by the Presentation Mode slide editor (it keeps its own undo history).
    HOOKS.contentChanged = function () { if (!IS_DRAFT) return Promise.reject(new Error('Open the draft to edit slides.')); A.reindex(); markDirty(); return Promise.resolve(); };
    HOOKS.uploadImage = function (dataUrl) {
      if (!IS_DRAFT) return Promise.reject(new Error('Open the draft to add pictures.'));
      return prepareMedia([dataUrl]).then(function (list) { return putMedia(list); }).then(function (list) {
        var f = list[0]; D.media = D.media || {};
        if (!D.media[f.file]) D.media[f.file] = { title: '', alt: '', description: '', type: f.type, bytes: f.bytes, uploadedAt: Date.now() };
        markDirty();
        return 'media/' + f.file;
      });
    };
    var MT = window.VULVA_MEDIA(CX), prepareMedia = MT.prepare, putMedia = MT.put, b64 = MT.b64;
    function setImg(img, src) { if (/^media\//.test(src)) { img.removeAttribute('src'); img.setAttribute('data-media', src); } else { img.removeAttribute('data-media'); img.src = src; } }

    /* ================= small helpers ================= */
    function rid(p) { return p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6); }
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function moveIn(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }
    function idx() { return A.index(); }
    function confirmDel(title, text, label, fn) { A.confirmBox(title, text, label || 'Delete', fn, true); }
    function fmtTime(ts) { return ts ? new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

    /* ================= Editor bar ================= */
    var bar = h('<div class="edbar noprint" role="region" aria-label="Teacher editing bar"><div class="edbar-in">' +
      '<span class="ed-ver"></span>' +
      '<label class="ed-switch"><input type="checkbox" class="ed-on"><span>✏️ Edit mode</span></label>' +
      '<button class="btn ed-undo" type="button" title="Undo (Ctrl+Z)">↶<span class="lbl"> Undo</span></button><button class="btn ed-redo" type="button" title="Redo (Ctrl+Y)">↷<span class="lbl"> Redo</span></button>' +
      '<span class="ed-status" aria-live="polite"></span><span class="spacer"></span>' +
      '<button class="btn ed-save" type="button">💾<span class="lbl"> Save draft</span></button><button class="btn ed-prev" type="button">👁<span class="lbl"> Preview</span></button><button class="btn primary ed-pub" type="button">🚀<span class="lbl"> Publish…</span></button>' +
      '<button class="btn ed-view" type="button"></button></div></div>');
    $('.topbar').appendChild(bar); // sticks to the top together with the navigation
    $('.ed-on', bar).onchange = function (e) { setEditing(e.target.checked); };
    $('.ed-undo', bar).onclick = undo; $('.ed-redo', bar).onclick = redo;
    $('.ed-save', bar).onclick = function () { save(true).then(function (ok) { if (ok) toast('Draft saved.'); }); };
    $('.ed-prev', bar).onclick = function () { setPreview(true); };
    $('.ed-pub', bar).onclick = publishDialog;
    $('.ed-view', bar).onclick = function () {
      if (IS_DRAFT && (dirty || saving)) return save().then(function () { CX.setView('live'); });
      CX.setView(IS_DRAFT ? 'live' : 'draft');
    };
    var exitPrev = h('<button class="btn primary ed-exitprev noprint" type="button">✕ Exit preview</button>');
    exitPrev.onclick = function () { setPreview(false); };
    document.body.appendChild(exitPrev);
    function setEditing(on) {
      if (on && !IS_DRAFT) { $('.ed-on', bar).checked = false; return A.modal('Editing happens in the draft', '<p>You are looking at the <b>live</b> version (what students see now). Switch to the draft to edit; students will not see your changes until you publish.</p>', [{ label: 'Cancel' }, { label: 'Open the draft', cls: 'primary', onClick: function () { sessionStorage.setItem(EDIT_KEY, '1'); CX.setView('draft'); } }]); }
      editing = on; sessionStorage.setItem(EDIT_KEY, on ? '1' : '0'); document.body.classList.toggle('editing-on', isEditing()); rerender(); updateBar();
    }
    function setPreview(on) { preview = on; document.body.classList.toggle('ed-preview', on); document.body.classList.toggle('editing-on', isEditing()); rerender(); updateBar(); if (on) toast('Preview: this is exactly what students will see after you publish.'); }
    function updateBar() {
      var ver = $('.ed-ver', bar);
      ver.className = 'ed-ver ' + (IS_DRAFT ? 'draft' : 'live');
      ver.textContent = IS_DRAFT ? 'DRAFT' : 'LIVE';
      ver.title = IS_DRAFT ? 'You are viewing the draft — students do not see it until you publish.' : 'You are viewing the live version students see.';
      $('.ed-on', bar).checked = editing; $('.ed-on', bar).parentNode.hidden = !IS_DRAFT;
      $('.ed-undo', bar).disabled = !undoStack.length; $('.ed-redo', bar).disabled = !redoStack.length;
      $('.ed-undo', bar).hidden = $('.ed-redo', bar).hidden = $('.ed-save', bar).hidden = $('.ed-prev', bar).hidden = !IS_DRAFT;
      $('.ed-view', bar).textContent = IS_DRAFT ? '🌐 View live' : '✏️ Open draft';
      var st = $('.ed-status', bar);
      if (!IS_DRAFT) st.innerHTML = '<span class="muted">Viewing what students see.</span>';
      else if (saveErr === 'conflict') st.innerHTML = '<span class="bad">⚠ Draft changed elsewhere</span>';
      else if (saveErr) { st.innerHTML = '<span class="bad">⚠ Not saved</span> <button class="btn small ed-retry" type="button">Retry</button>'; st.title = saveErr; $('.ed-retry', st).onclick = function () { save(); }; }
      else if (saving) st.textContent = 'Saving…';
      else if (dirty) st.textContent = 'Unsaved changes…';
      else st.innerHTML = lastSaved ? '<span class="good">✓ Draft saved ' + esc(fmtTime(lastSaved)) + '</span>' : (CX.fromLive ? '<span class="muted">No changes yet (draft = live)</span>' : '');
      document.body.classList.toggle('editing-on', isEditing());
    }
    document.addEventListener('keydown', function (e) {
      if (!isEditing() || openPanel || document.querySelector('.modal-bg') || document.querySelector('.pres')) return;
      var t = (e.target || {}).tagName; if (/INPUT|TEXTAREA|SELECT/.test(t)) return;
      if ((e.ctrlKey || e.metaKey) && /^z$/i.test(e.key) && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (/^y$/i.test(e.key) || (/^z$/i.test(e.key) && e.shiftKey))) { e.preventDefault(); redo(); }
    });

    /* ================= Panel (side drawer; full screen on phones) ================= */
    var openPanel = null, panels = [];
    function panel(title, body, buttons, opts) {
      opts = opts || {};
      // A panel replaces the open one, unless it is opened on top of it (e.g. a picture from a question editor).
      if (!opts.stackOn) while (panels.length) panels[panels.length - 1].close(true);
      var prev = document.activeElement;
      var el = h('<div class="ed-panel-bg' + (panels.length ? ' stacked' : '') + '"><aside class="ed-panel' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><h3>' + esc(title) + '</h3><button class="btn ed-x" type="button" aria-label="Close">✕</button></header><div class="ed-pbody"></div><footer></footer></aside></div>');
      $('.ed-pbody', el).appendChild(body);
      var foot = $('footer', el);
      var P = { el: el, dirty: false, close: close };
      function close(force) {
        if (!force && P.dirty) { if (!window.confirm('Discard the changes in this editor?')) return; }
        el.remove(); document.removeEventListener('keydown', onk, true);
        panels.splice(panels.indexOf(P), 1); openPanel = panels[panels.length - 1] || null;
        if (prev && prev.focus) prev.focus();
        if (opts.onClose) opts.onClose();
      }
      function onk(e) {
        if (document.querySelector('.modal-bg') || openPanel !== P) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { var p = $('footer .btn.primary', el); if (p) { e.preventDefault(); p.click(); } }
      }
      (buttons || []).forEach(function (b) {
        if (b.spacer) return foot.appendChild(h('<span class="spacer"></span>'));
        var btn = h('<button class="btn ' + (b.cls || '') + '" type="button">' + esc(b.label) + '</button>');
        btn.onclick = function () { var r = b.onClick ? b.onClick(P) : undefined; if (r !== false) close(true); };
        foot.appendChild(btn);
      });
      $('.ed-x', el).onclick = function () { close(); };
      el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
      body.addEventListener('input', function () { P.dirty = true; });
      body.addEventListener('change', function () { P.dirty = true; });
      document.addEventListener('keydown', onk, true);
      document.body.appendChild(el);
      panels.push(P); openPanel = P;
      setTimeout(function () { var f = $('input:not([type=hidden]):not([type=file]):not([type=range]):not([type=checkbox]):not([type=radio]),textarea', body); if (f && !opts.noFocus) f.focus(); }, 30);
      return P;
    }
    function field(label, inner, help) { return '<div class="field"><label>' + label + '</label>' + inner + (help ? '<span class="small muted">' + help + '</span>' : '') + '</div>'; }

    /* ================= MdField: text with formatting toolbar and live preview ================= */
    var CALLOUTS = [['**HIGH-YIELD FACT:** ', '🟩 High-yield fact box'], ['**EXAM TRAP:** ', '🟥 Exam trap box'], ['**Remember:** ', '🟦 Remember box'], ['**Why:** ', '❔ Why box'], ['[CLARIFICATION] ', '🟣 Clarification box'], ['[SUPP] ', '⚪ Supplementary note (collapsed)']];
    var BADGES = ['COURSE + EXAM', 'COURSE', 'CLARIFICATION', 'COURSE THRESHOLD', 'SUPP'];
    function mdField(value, opts) {
      opts = opts || {};
      var w = h('<div class="mdf"><div class="mdf-tools" role="toolbar" aria-label="Formatting">' +
        '<button type="button" data-c="b" title="Bold (Ctrl+B)"><b>B</b></button><button type="button" data-c="i" title="Italic (Ctrl+I)"><i>I</i></button>' +
        (opts.inline ? '' : '<button type="button" data-c="h2" title="Heading">H</button><button type="button" data-c="h3" title="Subheading">h</button><button type="button" data-c="ul" title="Bulleted list">• List</button><button type="button" data-c="ol" title="Numbered list">1. List</button>') +
        '<button type="button" data-c="link" title="Insert or edit a link">🔗 Link</button>' +
        (opts.inline ? '' : '<button type="button" data-c="table" title="Insert or edit a table">▦ Table</button><select data-c="callout" aria-label="Highlight box"><option value="">Box ▾</option>' + CALLOUTS.map(function (c, i) { return '<option value="' + i + '">' + c[1] + '</option>'; }).join('') + '</select>') +
        '<select data-c="badge" aria-label="Label"><option value="">Label ▾</option>' + BADGES.map(function (b) { return '<option value="' + b + '">' + esc(LABEL_TEXT[b] || b) + '</option>'; }).join('') + '</select>' +
        (opts.inline || opts.noImage ? '' : '<button type="button" data-c="img" title="Insert a picture">🖼 Picture</button>') +
        '<span class="spacer"></span><button type="button" data-c="help" title="Formatting help">?</button></div>' +
        '<textarea rows="' + (opts.rows || 8) + '" spellcheck="true" aria-label="' + esc(opts.label || 'Text') + '"></textarea>' +
        (opts.noPreview ? '' : '<div class="mdf-prev-h small muted">Preview</div><div class="mdf-prev"></div>') + '</div>');
      var ta = $('textarea', w), pv = $('.mdf-prev', w);
      ta.value = value || '';
      function render() { if (pv) pv.innerHTML = opts.inline ? '<div class="md"><p>' + inl(ta.value) + '</p></div>' : md(ta.value); }
      ta.addEventListener('input', render); render();
      function sel() { return { a: ta.selectionStart, z: ta.selectionEnd, t: ta.value.slice(ta.selectionStart, ta.selectionEnd) }; }
      // execCommand keeps the browser's own undo (Ctrl+Z) working inside the text box.
      function insert(text, a, z, selA, selZ) {
        ta.focus(); ta.setSelectionRange(a, z);
        if (!document.execCommand || !document.execCommand('insertText', false, text)) ta.setRangeText(text, a, z, 'end');
        if (selA != null) ta.setSelectionRange(a + selA, a + (selZ == null ? selA : selZ));
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function wrap(mark) { var s = sel(); var t = s.t || 'text'; insert(mark + t + mark, s.a, s.z, mark.length, mark.length + t.length); }
      function lineRange() { var v = ta.value, a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1, z = v.indexOf('\n', ta.selectionEnd); if (z < 0) z = v.length; return { a: a, z: z, lines: v.slice(a, z).split('\n') }; }
      function prefixLines(fn) { var r = lineRange(); var out = r.lines.map(function (l, i) { return fn(l.replace(/^(#{2,4} |- |\d+\. )/, ''), i, l); }).join('\n'); insert(out, r.a, r.z, 0, out.length); }
      function block(text) {
        // insert as its own paragraph (blank lines around)
        var v = ta.value, p = ta.selectionEnd, before = v.slice(0, p), after = v.slice(p);
        var pre = !before || /\n\n$/.test(before) ? '' : (/\n$/.test(before) ? '\n' : '\n\n'), post = !after || /^\n\n/.test(after) ? '' : (/^\n/.test(after) ? '\n' : '\n\n');
        insert(pre + text + post, p, p, pre.length, pre.length + text.length);
      }
      $$('.mdf-tools button', w).forEach(function (b) {
        b.onclick = function () {
          var c = b.dataset.c;
          if (c === 'b') wrap('**'); else if (c === 'i') wrap('*');
          else if (c === 'h2') prefixLines(function (l, i, orig) { return /^## /.test(orig) ? l : '## ' + l; });
          else if (c === 'h3') prefixLines(function (l, i, orig) { return /^### /.test(orig) ? l : '### ' + l; });
          else if (c === 'ul') prefixLines(function (l, i, orig) { return /^- /.test(orig) ? l : '- ' + l; });
          else if (c === 'ol') prefixLines(function (l, i, orig) { return /^\d+\. /.test(orig) ? l : (i + 1) + '. ' + l; });
          else if (c === 'link') linkDialog(ta, insert);
          else if (c === 'table') tableDialog(ta, insert, block);
          else if (c === 'img') { var desc = 'pic:' + rid('u'); pictureDialog(desc, { isNew: true, onSaved: function () { block('**Image:** ' + desc); } }); }
          else if (c === 'help') A.modal('Formatting help', '<div class="md"><ul><li><code>**bold**</code> and <code>*italic*</code></li><li>A line starting with <code>## </code> is a heading, <code>### </code> a subheading</li><li>Lines starting with <code>- </code> make a bulleted list, <code>1. </code> a numbered list; indent with two spaces for a sub-list</li><li>Links: <code>[text](https://…)</code></li><li>Tables: use the ▦ Table button (it opens a grid)</li><li>Start a paragraph with <code>**HIGH-YIELD FACT:**</code>, <code>**EXAM TRAP:**</code>, <code>**Remember:**</code> or <code>**Why:**</code> for a coloured box; end it with a colon to include the list that follows</li><li><code>[SUPP] text</code> makes a collapsed supplementary note; <code>[COURSE + EXAM]</code> etc. show labels</li><li>Leave an empty line between paragraphs</li><li>Paste from Word or a web page: bold, italics, lists, links and tables are kept</li></ul></div>');
        };
      });
      $$('.mdf-tools select', w).forEach(function (s) {
        s.onchange = function () {
          if (s.value === '') return;
          if (s.dataset.c === 'callout') { var pre = CALLOUTS[+s.value][0]; prefixLines(function (l, i, orig) { return i === 0 ? pre + orig.replace(/^(\*\*(HIGH-YIELD FACT|EXAM TRAPS?|Remember|Why):?\*\*:?\s*|\[(CLARIFICATION|SUPP)\]\s*)/, '') : orig; }); }
          else { var st = sel(); insert('[' + s.value + '] ', st.a, st.a); }
          s.value = '';
        };
      });
      ta.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && /^b$/i.test(e.key)) { e.preventDefault(); wrap('**'); }
        if ((e.ctrlKey || e.metaKey) && /^i$/i.test(e.key)) { e.preventDefault(); wrap('*'); }
        if ((e.ctrlKey || e.metaKey) && /^k$/i.test(e.key)) { e.preventDefault(); linkDialog(ta, insert); }
      });
      ta.addEventListener('paste', function (e) {
        var html = e.clipboardData && e.clipboardData.getData('text/html');
        if (!html) return;
        var m = htmlToMd(html, !!opts.inline);
        if (m == null) return;
        e.preventDefault(); var s = sel(); insert(m, s.a, s.z);
      });
      return { el: w, ta: ta, get value() { return ta.value; }, set value(v) { ta.value = v; render(); } };
    }
    function linkDialog(ta, insert) {
      var a = ta.selectionStart, z = ta.selectionEnd, t = ta.value.slice(a, z);
      var m = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(t);
      var body = h('<div>' + field('Text shown', '<input class="lk-t">') + field('Web address', '<input class="lk-u" placeholder="https://…" inputmode="url">', 'Must start with https:// or http://') + '<p class="err lk-e"></p></div>');
      $('.lk-t', body).value = m ? m[1] : t; $('.lk-u', body).value = m ? m[2] : '';
      var dlg = A.modal(m ? 'Edit link' : 'Insert link', '', [{ label: 'Cancel' }, { label: m ? 'Update link' : 'Insert link', cls: 'primary', onClick: function (bg) {
        var tx = $('.lk-t', bg).value.trim(), u = $('.lk-u', bg).value.trim();
        if (!/^https?:\/\/[^\s)]+\.[^\s)]+$/.test(u)) { $('.lk-e', bg).textContent = 'Enter a full web address, e.g. https://www.example.org/page'; return false; }
        insert('[' + (tx || u).replace(/[\[\]]/g, '') + '](' + u + ')', a, z);
      } }]);
      $('.mbody', dlg.el).appendChild(body); $('.lk-t', body).focus();
    }
    /* Paste from Word / web pages: keep bold, italics, headings, lists, links and tables. */
    function htmlToMd(html, inlineOnly) {
      var doc = new DOMParser().parseFromString(html, 'text/html'), b = doc.body;
      if (!b || !b.textContent.trim()) return null;
      $$('script,style,meta,link,title,xml', b).forEach(function (x) { x.remove(); });
      function txt(s) { return s.replace(/\s+/g, ' '); }
      function inlines(n) {
        var out = '';
        n.childNodes.forEach(function (c) {
          if (c.nodeType === 3) { out += txt(c.nodeValue); return; }
          if (c.nodeType !== 1) return;
          var tag = c.tagName, inner = inlines(c), st = c.getAttribute('style') || '';
          if (!inner.trim() && tag !== 'BR') { out += inner; return; }
          if (tag === 'BR') out += ' ';
          else if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(st)) out += '**' + inner.trim() + '** ';
          else if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(st)) out += '*' + inner.trim() + '* ';
          else if (tag === 'A' && /^https?:/.test(c.getAttribute('href') || '')) out += '[' + inner.trim() + '](' + c.getAttribute('href') + ')';
          else out += inner;
        });
        return out;
      }
      if (inlineOnly) return inlines(b).replace(/\s+/g, ' ').trim();
      var blocks = [];
      function walk(n, depth) {
        n.childNodes.forEach(function (c) {
          if (c.nodeType === 3) { if (c.nodeValue.trim()) blocks.push(txt(c.nodeValue).trim()); return; }
          if (c.nodeType !== 1) return;
          var tag = c.tagName;
          if (/^H[1-6]$/.test(tag)) blocks.push((+tag[1] <= 2 ? '## ' : '### ') + inlines(c).trim());
          else if (tag === 'UL' || tag === 'OL') {
            var lines = [];
            (function list(el, d) { var k = 0; el.childNodes.forEach(function (li) { if (li.tagName !== 'LI') return; var sub = []; var clone = li.cloneNode(true); $$('ul,ol', clone).forEach(function (x) { sub.push(x); x.remove(); }); lines.push(new Array(d + 1).join('  ') + (el.tagName === 'OL' ? (++k) + '. ' : '- ') + inlines(clone).trim()); $$(':scope > ul, :scope > ol', li).forEach(function (x) { list(x, d + 1); }); }); })(c, 0);
            blocks.push(lines.join('\n'));
          } else if (tag === 'TABLE') {
            var rows = $$('tr', c).map(function (tr) { return $$('th,td', tr).map(function (td) { return inlines(td).trim().replace(/\|/g, '/'); }); }).filter(function (r) { return r.length; });
            if (rows.length) { var n2 = Math.max.apply(null, rows.map(function (r) { return r.length; })); rows = rows.map(function (r) { while (r.length < n2) r.push(''); return r; }); blocks.push(['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |'].concat(rows.slice(1).map(function (r) { return '| ' + r.join(' | ') + ' |'; })).join('\n')); }
          } else if (/^(P|LI|BLOCKQUOTE|PRE)$/.test(tag) || (/^(DIV|SECTION|ARTICLE)$/.test(tag) && !$('p,div,ul,ol,table,h1,h2,h3,h4', c))) { var t = inlines(c).replace(/\s+/g, ' ').trim(); if (t) blocks.push(t); }
          else walk(c, depth + 1);
        });
      }
      walk(b, 0);
      return blocks.join('\n\n').replace(/\*\* +\*\*/g, ' ').replace(/ +([.,;:])/g, '$1');
    }
    /* Table grid editor: edits the Markdown table under the cursor, or inserts a new one. */
    function tableDialog(ta, insert, block) {
      var v = ta.value, lines = v.split('\n'), pos = 0, cur = 0;
      for (var i = 0; i < lines.length; i++) { if (pos + lines[i].length >= ta.selectionStart) { cur = i; break; } pos += lines[i].length + 1; }
      var a = cur, z = cur;
      var isT = function (l) { return /^\s*\|/.test(l || ''); };
      var rows;
      if (isT(lines[cur])) {
        while (a > 0 && isT(lines[a - 1])) a--; while (z < lines.length - 1 && isT(lines[z + 1])) z++;
        rows = lines.slice(a, z + 1).map(function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); }).filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c); }); });
      } else rows = [['Heading 1', 'Heading 2', 'Heading 3'], ['', '', ''], ['', '', '']];
      var body = h('<div><p class="small muted">The first row is the header. Use the buttons to add or remove rows and columns.</p><div class="tg-wrap"><table class="tg"></table></div><div class="row" style="margin-top:8px"><button class="btn tg-ar" type="button">＋ Row</button><button class="btn tg-ac" type="button">＋ Column</button><button class="btn tg-dr" type="button">− Last row</button><button class="btn tg-dc" type="button">− Last column</button></div></div>');
      function draw() { $('.tg', body).innerHTML = rows.map(function (r, ri) { return '<tr>' + r.map(function (c, ci) { return '<td><input data-r="' + ri + '" data-c="' + ci + '" value="' + esc(c) + '"' + (ri === 0 ? ' class="th"' : '') + ' aria-label="Row ' + (ri + 1) + ' column ' + (ci + 1) + '"></td>'; }).join('') + '</tr>'; }).join(''); }
      function read() { $$('input', body).forEach(function (inp) { rows[+inp.dataset.r][+inp.dataset.c] = inp.value.replace(/\|/g, '/'); }); }
      draw();
      $('.tg-ar', body).onclick = function () { read(); rows.push(rows[0].map(function () { return ''; })); draw(); };
      $('.tg-ac', body).onclick = function () { read(); rows.forEach(function (r, i) { r.push(i ? '' : 'Heading'); }); draw(); };
      $('.tg-dr', body).onclick = function () { read(); if (rows.length > 2) rows.pop(); draw(); };
      $('.tg-dc', body).onclick = function () { read(); if (rows[0].length > 1) rows.forEach(function (r) { r.pop(); }); draw(); };
      var m = A.modal(isT(lines[cur]) ? 'Edit table' : 'Insert table', '', [{ label: 'Cancel' }, { label: 'Done', cls: 'primary', onClick: function () {
        read();
        var out = ['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |'].concat(rows.slice(1).map(function (r) { return '| ' + r.join(' | ') + ' |'; })).join('\n');
        if (isT(lines[cur])) { var s0 = lines.slice(0, a).join('\n').length + (a ? 1 : 0), s1 = lines.slice(0, z + 1).join('\n').length; insert(out, s0, s1); }
        else block(out);
      } }]);
      $('.mbody', m.el).appendChild(body); m.el.querySelector('.modal').classList.add('wide');
    }

    /* ================= FormEditor: schema-driven record editor ================= */
    function placeOptions(sel, withSections, withSubs) {
      var I = idx(), out = '';
      D.lectures.forEach(function (L) {
        out += '<optgroup label="Lecture ' + L.num + ': ' + esc(L.title) + '">';
        L.sections.forEach(function (s) {
          if (withSections) out += '<option value="' + esc(s.id) + '"' + (sel === s.id ? ' selected' : '') + '>' + esc(A.num(s.id) + ' ' + s.title) + '</option>';
          if (withSubs) s.subs.forEach(function (u) { out += '<option value="' + esc(u.id) + '"' + (sel === u.id ? ' selected' : '') + '>' + (withSections ? '   ' : '') + esc(A.num(u.id) + ' ' + u.title) + '</option>'; });
        });
        out += '</optgroup>';
      });
      void I;
      return out;
    }
    function conceptOptions(sel) {
      return '<option value="">— none —</option>' + Object.keys(D.concepts).sort(function (a, b) { return D.concepts[a].name.localeCompare(D.concepts[b].name); }).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(D.concepts[k].name) + '</option>'; }).join('') + '<option value="__new">＋ New concept…</option>';
    }
    function formEditor(title, spec, rec, onSave, opts) {
      opts = opts || {};
      var body = h('<div class="ed-form"></div>'), mdf = {};
      if (opts.intro) body.appendChild(h('<p class="small muted">' + opts.intro + '</p>'));
      if (opts.top) body.appendChild(opts.top);
      spec.forEach(function (f) {
        var v = rec[f.k], el;
        if (f.type === 'md' || f.type === 'inline') {
          var m = mdField(v || '', { inline: f.type === 'inline', rows: f.rows, label: f.label, noImage: f.noImage, noPreview: f.noPreview });
          mdf[f.k] = m; el = h('<div class="field"><label>' + esc(f.label) + (f.required ? ' *' : '') + '</label></div>'); el.appendChild(m.el);
          if (f.help) el.appendChild(h('<span class="small muted">' + f.help + '</span>'));
        } else {
          var inner;
          if (f.type === 'select') inner = '<select data-k="' + f.k + '">' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
          else if (f.type === 'place') inner = '<select data-k="' + f.k + '">' + (f.allowNone ? '<option value="">— none —</option>' : '') + placeOptions(v, f.sections !== false, f.subs !== false) + '</select>';
          else if (f.type === 'concept') inner = '<select data-k="' + f.k + '">' + conceptOptions(v) + '</select>';
          else if (f.type === 'check') inner = '<label class="chk"><input type="checkbox" data-k="' + f.k + '"' + (v ? ' checked' : '') + '> ' + esc(f.text || '') + '</label>';
          else if (f.type === 'textarea' || f.type === 'lines') inner = '<textarea data-k="' + f.k + '" rows="' + (f.rows || 3) + '">' + esc(f.type === 'lines' ? (v || []).join('\n') : v || '') + '</textarea>';
          else inner = '<input data-k="' + f.k + '" type="' + (f.type === 'number' ? 'number' : 'text') + '" value="' + esc(v == null ? '' : v) + '"' + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + '>';
          el = h(field(esc(f.label) + (f.required ? ' *' : ''), inner, f.help));
        }
        body.appendChild(el);
      });
      body.appendChild(h('<p class="err ed-ferr" role="alert"></p>'));
      $$('select[data-k]', body).forEach(function (s) { if (s.querySelector('option[value=__new]')) s.addEventListener('change', function () { if (s.value === '__new') newConcept(s); }); });
      function values() {
        var out = {};
        spec.forEach(function (f) {
          if (mdf[f.k]) { out[f.k] = mdf[f.k].value; return; }
          var el = $('[data-k="' + f.k + '"]', body); if (!el) return;
          if (f.type === 'check') out[f.k] = el.checked;
          else if (f.type === 'number') out[f.k] = el.value === '' ? null : +el.value;
          else if (f.type === 'lines') out[f.k] = el.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          else out[f.k] = el.value;
        });
        return out;
      }
      var buttons = (opts.extraButtons || []).concat([{ spacer: true }, { label: 'Cancel' }, { label: opts.saveLabel || 'Save', cls: 'primary', onClick: function () {
        var v = values(), miss = spec.filter(function (f) { return f.required && (v[f.k] == null || !String(v[f.k]).trim()); });
        if (miss.length) { $('.ed-ferr', body).textContent = 'Please fill in: ' + miss.map(function (f) { return f.label; }).join(', ') + '.'; return false; }
        var r = onSave(v);
        if (typeof r === 'string') { $('.ed-ferr', body).textContent = r; return false; }
        return r;
      } }]);
      return panel(title, body, buttons, opts);
    }
    function newConcept(selectEl) {
      var name = window.prompt('Name of the new concept (e.g. “Lichen sclerosus”):');
      if (!name || !name.trim()) { selectEl.value = ''; return; }
      var key = A.slug(name) || rid('c');
      while (D.concepts[key]) key += '-2';
      // Added to D straight away (part of the same draft); harmless if the question is then cancelled.
      D.concepts[key] = { name: name.trim(), subs: [], sections: [] };
      $$('select', selectEl.ownerDocument).forEach(function (s) { if (s.querySelector('option[value=__new]')) { var cur = s === selectEl ? key : s.value; s.innerHTML = conceptOptions(cur); } });
      markDirty();
    }

    /* ================= Learn Mode ================= */
    var PRIO_OPTS = [['3', '★★★ MUST KNOW'], ['2', '★★ HIGH-YIELD'], ['1', '★ SUPPORTING']];
    var LABEL_OPTS = [['COURSE', '🔵 COURSE CORE'], ['COURSE + EXAM', '🟢 EXAM ESSENTIAL'], ['COURSE THRESHOLD', 'COURSE-SPECIFIC EXAM FACT'], ['CLARIFICATION', '🟣 CLARIFICATION'], ['SUPP', '⚪ SUPPLEMENTARY']];
    function lectureOf(n) { return D.lectures.filter(function (L) { return L.num === n; })[0]; }
    function findSection(id) { var r = null; D.lectures.forEach(function (L) { L.sections.forEach(function (s, i) { if (s.id === id) r = { L: L, s: s, i: i }; }); }); return r; }
    function findSub(id) { var r = null; D.lectures.forEach(function (L) { L.sections.forEach(function (s) { s.subs.forEach(function (u, i) { if (u.id === id) r = { L: L, s: s, u: u, i: i }; }); }); }); return r; }
    function allPlaceIds() { var m = {}; D.lectures.forEach(function (L) { L.sections.forEach(function (s) { m[s.id] = 1; s.subs.forEach(function (u) { m[u.id] = 1; }); }); }); return m; }
    function newSectionId() { var n = 0; D.lectures.forEach(function (L) { L.sections.forEach(function (s) { if (/^\d+$/.test(s.id)) n = Math.max(n, +s.id); }); }); var ids = allPlaceIds(), id = String(n + 1); while (ids[id]) id = String(+id + 1); return id; }
    function newSubId(sec) { var n = 0, ids = allPlaceIds(); Object.keys(ids).forEach(function (k) { var m = new RegExp('^' + sec.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.(\\d+)$').exec(k); if (m) n = Math.max(n, +m[1]); }); var id = sec.id + '.' + (n + 1); while (ids[id]) id = sec.id + '.' + (++n + 1); return id; }
    /* When a block or section is deleted, everything linked to it (questions, checks, concepts, review items,
       topics) is re-linked to a neighbouring place so nothing points at content that no longer exists. */
    function refsTo(ids) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      var n = { practice: 0, checks: 0, questions: 0, review: 0 };
      (idx().PR || []).forEach(function (x) { if (set[x.sub] || set[x.section]) n.practice++; });   // in the question bank: re-link them there
      D.checks.forEach(function (c) { if (set[c.sec]) n.checks++; });
      ['facts', 'traps', 'comparisons', 'morphology'].forEach(function (k) { (D.review[k] || []).forEach(function (x) { if (set[x.sub]) n.review++; }); });
      return n;
    }
    function remapRefs(ids, toSub, toSec) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      var sec = findSection(toSec), L = sec ? sec.L.num : null;
      void L;
      D.checks.forEach(function (c) { if (set[c.sec]) c.sec = toSub; });
      ['facts', 'traps', 'comparisons', 'morphology'].forEach(function (k) { (D.review[k] || []).forEach(function (x) { if (set[x.sub]) x.sub = toSub; }); });
      Object.keys(D.concepts).forEach(function (k) {
        var c = D.concepts[k];
        c.subs = (c.subs || []).filter(function (s) { return !set[s]; }); c.sections = (c.sections || []).filter(function (s) { return !set[s]; });
        if (!c.subs.length && !c.sections.length) { c.subs = toSub !== toSec ? [toSub] : []; c.sections = [toSec]; }
      });
      Object.keys(D.topics).forEach(function (k) { var t = D.topics[k]; var had = t.sections.some(function (s) { return set[s]; }); t.sections = t.sections.filter(function (s) { return !set[s]; }); if (had && t.sections.indexOf(toSec) < 0) t.sections.push(toSec); });
    }
    function pqNote(n) { return n.practice ? ' Note: ' + n.practice + ' practice question(s) in the question bank are linked here — re-link them in Teacher portal → Question bank.' : ''; }
    function refText(n) {
      var parts = [];
      if (n.checks) parts.push(n.checks + ' section check(s)'); if (n.questions) parts.push(n.questions + ' assessment question(s)'); if (n.review) parts.push(n.review + ' review item(s)');
      return parts.join(', ');
    }

    function editLecture(n) {
      var L = lectureOf(n); if (!L) return;
      formEditor('Lecture ' + n, [
        { k: 'title', label: 'Lecture title', required: true },
        { k: 'intro', label: '“How to use this lecture” text (optional)', type: 'md', rows: 8 }
      ], { title: L.title, intro: L.intro ? L.intro.intro : '' }, function (v) {
        change(function () { L.title = v.title.trim(); if (v.intro.trim()) { L.intro = L.intro || { id: 'intro', title: 'How to use this lecture', subs: [] }; L.intro.intro = v.intro; } else delete L.intro; });
      }, { extraButtons: [{ label: '🗑 Delete lecture', cls: 'danger', onClick: function () { deleteLecture(n); return false; } }] });
    }
    function addLecture() {
      var n = Math.max.apply(null, D.lectures.map(function (L) { return L.num; }).concat([0])) + 1;
      formEditor('New lecture', [{ k: 'title', label: 'Lecture title', required: true }], { title: '' }, function (v) {
        var sid = newSectionId();
        change(function () { D.lectures.push({ num: n, title: v.title.trim(), sections: [{ id: sid, title: 'New section', intro: '', subs: [] }], facts: [] }); });
        location.hash = '#/lecture/' + D.lectures.length;
      }, { intro: 'A new lecture starts with one empty section. Add learning blocks to it in Edit Mode.' });
    }
    function deleteLecture(n) {
      var L = lectureOf(n);
      if (D.lectures.length <= 1) return toast('The course needs at least one lecture.');
      if (L.sections.some(function (s) { return s.subs.length || (s.intro || '').trim(); })) return A.modal('Lecture is not empty', '<p>Delete or move its sections first (Edit section → Lecture). This protects you from deleting a whole lecture by accident.</p>');
      confirmDel('Delete lecture ' + n + '?', 'Delete the empty lecture “' + L.title + '”? Undo is available.', 'Delete lecture', function () {
        var ids = []; L.sections.forEach(function (s) { ids.push(s.id); });
        change(function () {
          var other = D.lectures.filter(function (x) { return x !== L; })[0].sections[0];
          if (other) remapRefs(ids, (other.subs[0] || other).id, other.id);
          D.lectures.splice(D.lectures.indexOf(L), 1);
          // keep lecture numbers 1..n (lecture pages and slide decks are numbered by position)
          var oldDecks = D.decks || {}, nd = {};
          D.lectures.forEach(function (x, i) { if (oldDecks[x.num]) nd[i + 1] = oldDecks[x.num]; x.num = i + 1; });
          D.decks = nd;
        });
        if (openPanel) openPanel.close(true);
        location.hash = '#/learn';
      });
    }
    function editSection(id) {
      var f = findSection(id); if (!f) return;
      formEditor('Section ' + A.num(id), [
        { k: 'title', label: 'Section title', required: true },
        { k: 'priority', label: 'Priority shown next to the title', type: 'select', options: [['', '— none —']].concat(PRIO_OPTS) },
        { k: 'lecture', label: 'Lecture', type: 'select', options: D.lectures.map(function (L) { return [String(L.num), 'Lecture ' + L.num + ': ' + L.title]; }) },
        { k: 'intro', label: 'Introduction text (shown before the learning blocks)', type: 'md', rows: 6 }
      ], { title: f.s.title, priority: f.s.priority ? String(f.s.priority) : '', lecture: String(f.L.num), intro: f.s.intro || '' }, function (v) {
        change(function () {
          f.s.title = v.title.trim(); if (v.priority) f.s.priority = +v.priority; else delete f.s.priority; f.s.intro = v.intro;
          if (+v.lecture !== f.L.num) { f.L.sections.splice(f.L.sections.indexOf(f.s), 1); lectureOf(+v.lecture).sections.push(f.s); }
        });
        if (+v.lecture !== f.L.num) location.hash = '#/lecture/' + v.lecture + '/' + id;
      }, { extraButtons: [{ label: '🗑 Delete section', cls: 'danger', onClick: function () { deleteSection(id); return false; } }] });
    }
    function addSection(afterId, lectureNum) {
      var L = lectureOf(lectureNum);
      formEditor('New section', [
        { k: 'title', label: 'Section title', required: true },
        { k: 'intro', label: 'Introduction text (optional)', type: 'md', rows: 5 },
        { k: 'firstBlock', label: 'Also add a first learning block', type: 'check', text: 'Yes, add an empty learning block I can fill in' }
      ], { title: '', intro: '', firstBlock: true }, function (v) {
        var id = newSectionId();
        change(function () {
          var s = { id: id, title: v.title.trim(), intro: v.intro, subs: [] };
          if (v.firstBlock) s.subs.push({ id: id + '.1', title: 'New learning block', label: 'COURSE', priority: 2, md: 'Type the text of this block here.' });
          var at = afterId ? L.sections.findIndex(function (x) { return x.id === afterId; }) + 1 : L.sections.length;
          L.sections.splice(at, 0, s);
        });
        setTimeout(function () { var e = document.getElementById('s-' + id); if (e) e.scrollIntoView({ block: 'start' }); }, 50);
      });
    }
    function deleteSection(id) {
      var f = findSection(id);
      var total = D.lectures.reduce(function (n, L) { return n + L.sections.length; }, 0);
      if (total <= 1) return toast('The course needs at least one section.');
      var ids = [id].concat(f.s.subs.map(function (u) { return u.id; }));
      var nb = f.L.sections[f.i - 1] || f.L.sections[f.i + 1];
      if (!nb) D.lectures.some(function (L) { return L !== f.L && L.sections.length && (nb = L.sections[0]); });
      var n = refsTo(ids), rt = refText(n);
      confirmDel('Delete section ' + A.num(id) + '?', 'Delete “' + f.s.title + '” and its ' + f.s.subs.length + ' learning block(s)?' + (rt ? ' ' + rt + ' linked to it will be re-linked to section ' + A.num(nb.id) + ' “' + nb.title + '”.' : '') + ' You can undo this until you leave the page; nothing reaches students until you publish.' + pqNote(n), 'Delete section', function () {
        change(function () { remapRefs(ids, (nb.subs[0] || nb).id, nb.id); f.L.sections.splice(f.L.sections.indexOf(f.s), 1); });
        if (openPanel) openPanel.close(true);
      });
    }
    function moveSection(id, d) { var f = findSection(id); change(function () { if (!moveIn(f.L.sections, f.i, d)) throw new Error(d < 0 ? 'Already the first section of this lecture.' : 'Already the last section of this lecture.'); }); }
    function duplicateSection(id) {
      var f = findSection(id), nid = newSectionId();
      change(function () { var c = clone(f.s); c.id = nid; c.title += ' (copy)'; c.subs.forEach(function (u, i) { u.id = nid + '.' + (i + 1); }); f.L.sections.splice(f.i + 1, 0, c); });
    }
    function editSub(id) {
      var f = findSub(id); if (!f) return;
      var P = formEditor('Learning block ' + A.num(id), [
        { k: 'title', label: 'Title', required: true },
        { k: 'priority', label: 'Priority', type: 'select', options: PRIO_OPTS },
        { k: 'label', label: 'Label', type: 'select', options: LABEL_OPTS },
        { k: 'section', label: 'Section (move the block)', type: 'place', subs: false },
        { k: 'md', label: 'Text of the block', type: 'md', rows: 16, help: 'Tip: in Edit Mode you can also click any single paragraph, list, table or picture to edit just that part.' }
      ], { title: f.u.title, priority: String(f.u.priority || 2), label: f.u.label || 'COURSE', section: f.s.id, md: f.u.md }, function (v) {
        change(function () {
          f.u.title = v.title.trim(); f.u.priority = +v.priority; f.u.label = v.label; f.u.md = v.md;
          if (v.section !== f.s.id) { f.s.subs.splice(f.s.subs.indexOf(f.u), 1); findSection(v.section).s.subs.push(f.u); }
        });
      }, { wide: true, extraButtons: [{ label: '🗑 Delete block', cls: 'danger', onClick: function () { deleteSub(id); return false; } }] });
      return P;
    }
    function addSub(secId, afterId) {
      var f = findSection(secId); var id = newSubId(f.s);
      formEditor('New learning block', [
        { k: 'title', label: 'Title', required: true },
        { k: 'priority', label: 'Priority', type: 'select', options: PRIO_OPTS },
        { k: 'label', label: 'Label', type: 'select', options: LABEL_OPTS },
        { k: 'md', label: 'Text', type: 'md', rows: 12 }
      ], { title: '', priority: '2', label: 'COURSE', md: '**Definition/overview:** ' }, function (v) {
        change(function () {
          var u = { id: id, title: v.title.trim(), label: v.label, priority: +v.priority, md: v.md };
          var at = afterId ? f.s.subs.findIndex(function (x) { return x.id === afterId; }) + 1 : f.s.subs.length;
          f.s.subs.splice(at, 0, u);
        });
        setTimeout(function () { var e = document.getElementById('u-' + id); if (e) e.scrollIntoView({ block: 'start' }); }, 50);
      }, { wide: true });
    }
    function deleteSub(id) {
      var f = findSub(id), nb = f.s.subs[f.i - 1] || f.s.subs[f.i + 1];
      var to = nb ? nb.id : f.s.id, n = refsTo([id]), rt = refText(n);
      confirmDel('Delete block ' + A.num(id) + '?', 'Delete the learning block “' + f.u.title + '”?' + (rt ? ' ' + rt + ' linked to it will move to ' + (nb ? 'block ' + A.num(nb.id) + ' “' + nb.title + '”' : 'section ' + A.num(f.s.id)) + '.' : '') + ' Undo is available until you leave the page.' + pqNote(n), 'Delete block', function () {
        change(function () { remapRefs([id], to, f.s.id); f.s.subs.splice(f.s.subs.indexOf(f.u), 1); });
        if (openPanel) openPanel.close(true);
      });
    }
    function moveSub(id, d) { var f = findSub(id); change(function () { if (!moveIn(f.s.subs, f.i, d)) throw new Error(d < 0 ? 'Already the first block of this section (use Edit block → Section to move it elsewhere).' : 'Already the last block of this section (use Edit block → Section to move it elsewhere).'); }); }
    function duplicateSub(id) { var f = findSub(id), nid = newSubId(f.s); change(function () { var c = clone(f.u); delete c.section; delete c.lecture; c.id = nid; c.title += ' (copy)'; f.s.subs.splice(f.i + 1, 0, c); }); }

    /* ---- single blocks inside a text (paragraph, heading, list, table, box, picture) ---- */
    function textRef(el) {
      var subEl = el.closest('[data-sub]'), introEl = el.closest('[data-intro]'), lecEl = el.closest('[data-lec]');
      if (subEl) { var f = findSub(subEl.dataset.sub); return f && { where: 'block ' + A.num(f.u.id) + ' “' + f.u.title + '”', get: function () { return f.u.md; }, set: function (v) { f.u.md = v; } }; }
      if (introEl) { var s = findSection(introEl.dataset.intro); return s && { where: 'the introduction of section ' + A.num(s.s.id), get: function () { return s.s.intro || ''; }, set: function (v) { s.s.intro = v; } }; }
      if (lecEl) { var L = lectureOf(+lecEl.dataset.lec); return L && L.intro && { where: 'the lecture introduction', get: function () { return L.intro.intro; }, set: function (v) { L.intro.intro = v; } }; }
      return null;
    }
    function segments(mdEl, text) {
      var lines = String(text).replace(/\r/g, '').split('\n');
      return $$(':scope > [data-l]', mdEl).map(function (b) { var r = b.dataset.l.split('-'); return lines.slice(+r[0], +r[1]).join('\n').trim(); });
    }
    function blockKind(b) {
      var t = b.tagName;
      if (/^H\d$/.test(t)) return 'Heading';
      if (t === 'UL' || t === 'OL') return 'List';
      if (t === 'FIGURE') return 'Picture';
      if (b.classList.contains('tablewrap')) return 'Table';
      if (b.classList.contains('co')) return 'Highlight box';
      if (t === 'DETAILS') return 'Supplementary note';
      if (b.classList.contains('src')) return 'Source line';
      return 'Paragraph';
    }
    var TEMPLATES = {
      p: ['Paragraph', 'Type the new paragraph here.'], h: ['Heading', '## New heading'], ul: ['Bulleted list', '- First point\n- Second point'], ol: ['Numbered list', '1. First step\n2. Second step'],
      table: ['Table', '| Feature | Lesion A | Lesion B |\n| --- | --- | --- |\n| … | … | … |'], hy: ['High-yield fact box', '**HIGH-YIELD FACT:** type the fact here.'], trap: ['Exam trap box', '**EXAM TRAP:** type the trap here.'],
      rem: ['Remember box', '**Remember:** type the point here.'], clar: ['Clarification', '[CLARIFICATION] type the clarification here.'], supp: ['Supplementary note', '[SUPP] Additional note (not assessable).'], src: ['Source line', '*Source: lecture p. …*']
    };
    function addMenuHtml() { return '<select class="ed-addsel" aria-label="Add new content here"><option value="">＋ Add here…</option>' + Object.keys(TEMPLATES).map(function (k) { return '<option value="' + k + '">' + TEMPLATES[k][0] + '</option>'; }).join('') + '<option value="img">Picture</option></select>'; }
    function insertBlock(mdEl, ref, at, kind) {
      // at: insert before segment index `at` (segments length = append)
      if (kind === 'img') {
        var desc = 'pic:' + rid('u');
        return pictureDialog(desc, { isNew: true, onSaved: function () { change(function () { var sg = segments(mdEl, ref.get()); sg.splice(at, 0, '**Image:** ' + desc); ref.set(sg.join('\n\n')); }); } });
      }
      var T = TEMPLATES[kind];
      blockEditor(mdEl, ref, at, T[1], true);
    }
    function blockEditor(mdEl, ref, i, initial, isNew) {
      var sg = segments(mdEl, ref.get()), b = isNew ? null : $$(':scope > [data-l]', mdEl)[i];
      var kind = isNew ? 'New content' : blockKind(b);
      var body = h('<div><p class="small muted">' + esc(kind) + ' in ' + esc(ref.where) + '.</p>' + (isNew ? '' : '<div class="ed-row ed-blkacts"><button class="btn small b-up" type="button"' + (i === 0 ? ' disabled' : '') + '>↑ Move up</button><button class="btn small b-dn" type="button"' + (i >= sg.length - 1 ? ' disabled' : '') + '>↓ Move down</button><button class="btn small b-dup" type="button">⧉ Duplicate</button>' + addMenuHtml() + '</div>') + '</div>');
      var m = mdField(isNew ? initial : sg[i], { rows: kind === 'Table' ? 8 : 10, label: kind });
      body.appendChild(m.el);
      function apply(fn) { change(function () { var s2 = segments(mdEl, ref.get()); fn(s2); ref.set(s2.filter(function (x) { return x.trim(); }).join('\n\n')); }); }
      var P = panel(isNew ? 'Add content' : 'Edit ' + kind.toLowerCase(), body, (isNew ? [] : [{ label: '🗑 Delete', cls: 'danger', onClick: function () { confirmDel('Delete this ' + kind.toLowerCase() + '?', 'Remove it from ' + ref.where + '? You can undo this.', 'Delete', function () { apply(function (s2) { s2.splice(i, 1); }); P.close(true); }); return false; } }])
        .concat([{ spacer: true }, { label: 'Cancel' }, { label: isNew ? 'Add' : 'Save', cls: 'primary', onClick: function () {
          var v = m.value.trim();
          if (!v) { if (isNew) return; return window.confirm('The text is empty. Delete this ' + kind.toLowerCase() + '?') ? (apply(function (s2) { s2.splice(i, 1); }), true) : false; }
          migratePicKeys(isNew ? '' : sg[i], v);
          apply(function (s2) { if (isNew) s2.splice(i, 0, v); else s2[i] = v; });
        } }]));
      if (!isNew) {
        $('.b-up', body).onclick = function () { apply(function (s2) { moveIn(s2, i, -1); }); P.close(true); };
        $('.b-dn', body).onclick = function () { apply(function (s2) { moveIn(s2, i, 1); }); P.close(true); };
        $('.b-dup', body).onclick = function () { apply(function (s2) { s2.splice(i + 1, 0, s2[i]); }); P.close(true); };
        $('.ed-addsel', body).onchange = function (e) { var k = e.target.value; if (!k) return; P.close(true); insertBlock(mdEl, ref, i + 1, k); };
      }
      return P;
    }
    /* A picture slot is found by its description (e.g. "pic:vu012"). If a teacher edits that description in
       the text, carry the picture over to the new description so the reference never breaks. */
    function migratePicKeys(before, after) {
      var re = /\*\*Image:\*\*\s*(.*)/g, a = [], z = [], m;
      while ((m = re.exec(before))) a.push(m[1].trim());
      while ((m = re.exec(after))) z.push(m[1].trim());
      if (a.length !== z.length) return;
      a.forEach(function (d, k) {
        if (d === z[k]) return;
        var ok = A.picKey(d), nk = A.picKey(z[k]);
        if (D.pics[ok] && !D.pics[nk]) D.pics[nk] = clone(D.pics[ok]);
      });
    }

    function decorateLecture() {
      var app = A.app();
      var head = $('.lec-head', app);
      if (head) {
        var n = +head.dataset.lec;
        var hb = h('<div class="ed-row ed-bar2 noprint"><button class="btn small" type="button" data-a="lec">✏️ Edit lecture title & intro</button><button class="btn small" type="button" data-a="addsec">＋ Add section at the end</button></div>');
        hb.onclick = function (e) { var a = e.target.dataset.a; if (a === 'lec') editLecture(n); if (a === 'addsec') addSection(null, n); };
        head.appendChild(hb);
      }
      $$('section[data-sec]', app).forEach(function (sec) {
        var id = sec.dataset.sec, f = findSection(id);
        var sb = h('<div class="ed-row ed-bar2 noprint"><button class="btn small" type="button" data-a="edit">✏️ Edit section</button><button class="btn small" type="button" data-a="up" title="Move section up">↑</button><button class="btn small" type="button" data-a="dn" title="Move section down">↓</button><button class="btn small" type="button" data-a="dup">⧉ Duplicate</button><button class="btn small" type="button" data-a="addsub">＋ Learning block</button><button class="btn small" type="button" data-a="addsec">＋ Section after</button><button class="btn small danger" type="button" data-a="del">🗑</button></div>');
        sb.onclick = function (e) {
          var a = e.target.dataset.a;
          if (a === 'edit') editSection(id); if (a === 'up') moveSection(id, -1); if (a === 'dn') moveSection(id, 1); if (a === 'dup') duplicateSection(id);
          if (a === 'addsub') addSub(id); if (a === 'addsec') addSection(id, f.L.num); if (a === 'del') deleteSection(id);
        };
        sec.insertBefore(sb, $('h2', sec).nextSibling);
        if (!f.s.intro) { var ai = h('<div class="ed-addrow noprint"><button class="btn small ghost" type="button">＋ Add an introduction to this section</button></div>'); $('button', ai).onclick = function () { editSection(id); }; sec.insertBefore(ai, sb.nextSibling); }
      });
      $$('details[data-sub]', app).forEach(function (d) {
        var id = d.dataset.sub, body = $('.body', d);
        var ub = h('<div class="ed-row ed-bar2 noprint"><button class="btn small" type="button" data-a="edit">✏️ Edit block</button><button class="btn small" type="button" data-a="up" title="Move block up">↑</button><button class="btn small" type="button" data-a="dn" title="Move block down">↓</button><button class="btn small" type="button" data-a="dup">⧉ Duplicate</button><button class="btn small" type="button" data-a="add">＋ Block after</button><button class="btn small" type="button" data-a="q">＋ Question</button><button class="btn small danger" type="button" data-a="del">🗑</button></div>');
        ub.onclick = function (e) {
          var a = e.target.dataset.a, f = findSub(id);
          if (a === 'edit') editSub(id); if (a === 'up') moveSub(id, -1); if (a === 'dn') moveSub(id, 1); if (a === 'dup') duplicateSub(id); if (a === 'add') addSub(f.s.id, id); if (a === 'del') deleteSub(id);
          if (a === 'q') addQuestionMenu(id);
        };
        body.insertBefore(ub, body.firstChild);
      });
      // every text area: clickable blocks + an "add here" menu at the end
      $$('.md', app).forEach(function (mdEl) {
        // Only the lecture texts themselves (block text, section intro, lecture intro) — not question stems or feedback.
        var own = mdEl.matches('[data-intro]') || (mdEl.parentNode.classList.contains('body') && mdEl.parentNode.parentNode.matches('details[data-sub], .lec-head details'));
        var ref = own && textRef(mdEl); if (!ref) return;
        $$(':scope > [data-l]', mdEl).forEach(function (b, i) {
          b.classList.add('ed-blk'); b.tabIndex = 0; b.title = 'Click to edit';
          function open(e) {
            if (e.target.closest('.pic-tools, summary')) return;
            e.preventDefault(); e.stopPropagation();
            if (b.tagName === 'FIGURE') return pictureDialog(b.getAttribute('data-desc'), { block: { mdEl: mdEl, ref: ref, i: i } });
            blockEditor(mdEl, ref, i);
          }
          b.addEventListener('click', open, true);
          b.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === b) open(e); });
        });
        var add = h('<div class="ed-addrow noprint">' + addMenuHtml() + '</div>');
        $('select', add).onchange = function (e) { var k = e.target.value; e.target.value = ''; if (k) insertBlock(mdEl, ref, segments(mdEl, ref.get()).length, k); };
        mdEl.appendChild(add);
      });
    }
    function decorateLearn() {
      var app = A.app();
      var b = h('<div class="ed-row ed-bar2 noprint" style="margin-top:14px"><button class="btn" type="button">＋ Add a lecture</button></div>');
      $('button', b).onclick = addLecture; app.appendChild(b);
    }

    /* ================= Questions ================= */
    // Section checks are part of the Learn content (this draft). Practice and assessment questions live in the
    // backend question bank (versioned; answers never published) and are edited through the Teacher portal.
    var BANKS = { checks: 'Section check' };
    var BANK = null;   // cached vulvaAdminBank reply
    function getBank(force) {
      if (BANK && !force) return Promise.resolve(BANK);
      return CX.api('vulvaAdminBank').then(function (r) { if (!r.ok) throw new Error(r.error || 'The question bank could not be loaded.'); BANK = r.questions; return BANK; });
    }
    HOOKS.bankChanged = function () { BANK = null; };
    HOOKS.questionImages = function () {
      return (BANK || []).filter(function (q) { return q.image; }).map(function (q) { return { group: q.kind === 'assess' ? 'Assessment questions' : 'Practice questions', where: q.qid, desc: q.image }; });
    };
    function serverQuestion(qid, mode) {
      getBank().then(function (list) { var x = list.filter(function (q) { return q.qid === qid; })[0]; if (!x) return toast('Question ' + qid + ' was not found in the bank.'); A.editServerQuestion(x, mode); }, function (e) { toast(e.message); });
    }
    function newServerQuestion(kind, place) {
      var pi = placeInfo(place || A.index().ORDER[0]), topic = A.index().SEC_TOPIC[pi.section] || Object.keys(D.topics)[0];
      var concept = (Object.keys(D.concepts).filter(function (k) { return (D.concepts[k].subs || []).indexOf(pi.sub) >= 0; })[0]) || '';
      A.editServerQuestion({ kind: kind, lecture: 'L' + (pi.lecture || 1), section: pi.section, sub: pi.sub, topic: topic, concept: concept, objective: '', difficulty: 'Application', priority: 2, label: 'COURSE CORE', previousExam: false, integrated: false, image: '', stem: '', options: ['', '', '', ''], answer: 0, explanation: '', trap: '', ref: '' }, 'new');
    }
    var DIFF = [['Basic', 'Basic'], ['Intermediate', 'Intermediate'], ['Advanced', 'Advanced']];
    function bankArr(b) { return D[b]; }
    function findQ(id) { var r = null; Object.keys(BANKS).forEach(function (b) { D[b].forEach(function (x, i) { if (x.id === id) r = { bank: b, arr: D[b], i: i, x: x }; }); }); return r; }
    function newQid(bank) { var p = { practice: 'PQ-', checks: 'CK-', questions: 'AQ-' }[bank], id; do { id = p + rid(''); } while (findQ(id)); return id; }
    function newOptId(ids) { var id; do { id = 'o' + Math.random().toString(36).slice(2, 7); } while (ids.indexOf(id) >= 0); return id; }
    function groupFn(bank, x) { return bank === 'practice' ? function (y) { return y.sub === x.sub; } : bank === 'checks' ? function (y) { return y.sec === x.sec; } : function (y) { return y.test === x.test; }; }
    function placeInfo(id) { var u = findSub(id), s = u ? u.s : (findSection(id) || {}).s, L = u ? u.L : (findSection(id) || {}).L; return { sub: id, section: s ? s.id : id, lecture: L ? L.num : null }; }
    function nextCode(test) { var n = 0; D.questions.forEach(function (q) { var m = /(\d+)\D*$/.exec(q.code || ''); if (q.test === test && m) n = Math.max(n, +m[1]); }); var pre = ((D.questions.filter(function (q) { return q.test === test; })[0] || {}).code || 'Q000').replace(/\d+\D*$/, ''); return pre + String(n + 1).padStart(3, '0'); }
    function template(bank, place) {
      var pi = placeInfo(place || A.index().ORDER[0]), ids = ['o1', 'o2', 'o3', 'o4'].map(function () { return 'o' + Math.random().toString(36).slice(2, 7); });
      if (bank === 'checks') return { id: newQid(bank), sec: pi.sub, type: 'mcq', q: '', options: ['', '', '', ''], optionIds: ids, answer: 0, expl: '', ref: '' };
      var concept = (Object.keys(D.concepts).filter(function (k) { return (D.concepts[k].subs || []).indexOf(pi.sub) >= 0; })[0]) || '';
      if (bank === 'practice') return { id: newQid(bank), sub: pi.sub, section: pi.section, lecture: pi.lecture, concept: concept, stem: '', image: null, options: ['', '', '', ''], optionIds: ids, answer: 0, explanation: '', difficulty: 'Intermediate', ref: (D.practice[0] || {}).ref || '', previousExam: false, spotter: false };
      var test = Object.keys(D.tests)[0], topic = Object.keys(D.topics).filter(function (k) { return D.topics[k].sections.indexOf(pi.section) >= 0; })[0] || Object.keys(D.topics)[0];
      return { id: newQid(bank), code: nextCode(test), test: test, topic: topic, style: 'SBA', stem: [''], image: null, imgQuery: null, options: ['', '', '', ''], optionIds: ids, answer: 0, correctAnswer: 'A', explanation: '', trap: '', source: (D.questions[0] || {}).source || '', sections: [pi.sub], section: pi.section, sub: pi.sub, lecture: pi.lecture, concept: concept, difficulty: 'Intermediate', objective: '', sourceType: 'New SBA', previousExam: false, imageBased: false, integrated: false };
    }
    function addQuestionMenu(place) {
      var m = A.modal('Add a question', '<p>Which kind of question?</p>', [{ label: 'Cancel' }]);
      var box = h('<div class="ed-col"><button class="btn" type="button" data-b="practice">🧠 Practice question <span class="small muted">(Test yourself + Practice; single best answer; saved in the question bank)</span></button><button class="btn" type="button" data-b="checks">🧩 Section check <span class="small muted">(Pathology Challenge; true/false, fill-in, matching, sorting, select-all, single best answer)</span></button><button class="btn" type="button" data-b="assess">📝 Assessment question <span class="small muted">(graded papers; saved in the question bank)</span></button></div>');
      box.onclick = function (e) { var b = e.target.closest('[data-b]'); if (!b) return; m.close(); if (b.dataset.b === 'checks') questionEditor(template('checks', place), 'checks', true); else newServerQuestion(b.dataset.b, place); };
      $('.mbody', m.el).appendChild(box);
    }

    /* Answer options: each option keeps its permanent id while its text, position or correctness changes. */
    function optionsEditor(x, multi) {
      var rows = x.options.map(function (t, k) { return { id: x.optionIds[k], text: t, ok: multi ? (x.answer || []).indexOf(k) >= 0 : x.answer === k }; });
      var el = h('<div class="opted"><div class="opted-rows"></div><button class="btn small opted-add" type="button">＋ Add answer option</button><p class="small muted">' + (multi ? 'Tick every correct option.' : 'Choose the one correct answer with the round button.') + ' Moving or rewording options never changes how earlier answers are scored.</p></div>');
      var name = rid('r');
      function draw() {
        $('.opted-rows', el).innerHTML = '';
        rows.forEach(function (r, k) {
          var row = h('<div class="opted-row' + (r.ok ? ' ok' : '') + '"><label class="opted-ok" title="Correct answer"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="' + name + '"' + (r.ok ? ' checked' : '') + ' aria-label="Option ' + LETTERS[k] + ' is correct"><span class="L">' + LETTERS[k] + '</span></label><input class="opted-t" aria-label="Option ' + LETTERS[k] + ' text" placeholder="Answer option ' + LETTERS[k] + '"><button class="btn small" type="button" data-a="up" title="Move up"' + (k ? '' : ' disabled') + '>↑</button><button class="btn small" type="button" data-a="dn" title="Move down"' + (k < rows.length - 1 ? '' : ' disabled') + '>↓</button><button class="btn small danger" type="button" data-a="rm" title="Remove option">✕</button></div>');
          $('.opted-t', row).value = r.text;
          $('.opted-t', row).oninput = function (e) { r.text = e.target.value; };
          $('input[type=radio],input[type=checkbox]', row).onchange = function (e) { if (!multi) rows.forEach(function (o) { o.ok = false; }); r.ok = e.target.checked; draw(); };
          row.onclick = function (e) {
            var a = e.target.dataset.a; if (!a) return;
            if (a === 'up') moveIn(rows, k, -1); if (a === 'dn') moveIn(rows, k, 1);
            if (a === 'rm') { if (rows.length <= 2) return toast('A question needs at least two options.'); if (r.ok && !window.confirm('This is a correct answer. Remove it anyway?')) return; rows.splice(k, 1); }
            draw();
          };
          $('.opted-rows', el).appendChild(row);
        });
        $('.opted-add', el).disabled = rows.length >= 7;
      }
      $('.opted-add', el).onclick = function () { rows.push({ id: newOptId(rows.map(function (r) { return r.id; })), text: '', ok: false }); draw(); var t = $$('.opted-t', el).pop(); if (t) t.focus(); };
      draw();
      return {
        el: el,
        read: function () {
          if (rows.length < 2) return 'Add at least two answer options.';
          var empty = rows.map(function (r, k) { return r.text.trim() ? null : LETTERS[k]; }).filter(Boolean);
          if (empty.length) return 'Answer option ' + empty.join(', ') + ' is empty.';
          var ok = rows.map(function (r, k) { return r.ok ? k : -1; }).filter(function (k) { return k >= 0; });
          if (!ok.length) return 'Mark the correct answer.';
          if (!multi && ok.length !== 1) return 'Choose exactly one correct answer.';
          return { options: rows.map(function (r) { return r.text.trim(); }), optionIds: rows.map(function (r) { return r.id; }), answer: multi ? ok : ok[0] };
        }
      };
    }
    function seededShuffle(n, seed) { var a = []; for (var i = 0; i < n; i++) a.push(i); var x = 0; for (var j = 0; j < seed.length; j++) x = (x * 31 + seed.charCodeAt(j)) >>> 0; for (var k = n - 1; k > 0; k--) { x = (x * 1103515245 + 12345) >>> 0; var r = x % (k + 1); var t = a[k]; a[k] = a[r]; a[r] = t; } return a; }
    /* Type-specific answer editors for section checks. Each returns { el, read() → fields | error string }. */
    function checkAnswerEditor(x, type, qField) {
      if (type === 'mcq' || type === 'select') {
        var base = x.options && x.optionIds ? x : { options: ['', '', '', ''], optionIds: ['o1', 'o2', 'o3', 'o4'], answer: type === 'select' ? [] : 0 };
        if (type === 'select' && !Array.isArray(base.answer)) base = Object.assign({}, base, { answer: base.answer == null ? [] : [base.answer] });
        if (type === 'mcq' && Array.isArray(base.answer)) base = Object.assign({}, base, { answer: base.answer[0] || 0 });
        return optionsEditor(base, type === 'select');
      }
      if (type === 'tf') {
        var el = h('<div class="field"><label>Correct answer</label><label class="chk"><input type="radio" name="tf" value="1"' + (x.answer === true ? ' checked' : '') + '> True</label><label class="chk"><input type="radio" name="tf" value="0"' + (x.answer === false ? ' checked' : '') + '> False</label></div>');
        return { el: el, read: function () { var c = $('input:checked', el); return c ? { answer: c.value === '1' } : 'Choose True or False.'; } };
      }
      if (type === 'fill') {
        var ans = (x.answers || []).map(function (a) { return a.join('; '); });
        var fe = h('<div class="field"><label>Accepted answers for each blank</label><p class="small muted">Write <code>[ blank ]</code> in the question where the student types. For each blank list the accepted answers separated by <b>;</b> (not case-sensitive).</p><button class="btn small fe-ins" type="button">＋ Insert a blank in the question</button><div class="fe-rows"></div></div>');
        function blanks() { return (qField.value.match(/\[ blank \]/g) || []).length; }
        function draw() {
          var rows = $('.fe-rows', fe); $$('input', rows).forEach(function (inp, k) { ans[k] = inp.value; });
          rows.innerHTML = '';
          for (var k = 0; k < blanks(); k++) rows.appendChild(h('<div class="field"><label>Blank ' + (k + 1) + '</label><input value="' + esc(ans[k] || '') + '" placeholder="e.g. 4; four"></div>'));
          if (!blanks()) rows.appendChild(h('<p class="small err">The question has no [ blank ] yet.</p>'));
        }
        qField.ta.addEventListener('input', draw); draw();
        $('.fe-ins', fe).onclick = function () { var t = qField.ta, p = t.selectionEnd; t.focus(); t.setSelectionRange(p, p); if (!document.execCommand('insertText', false, '[ blank ]')) t.setRangeText('[ blank ]', p, p, 'end'); t.dispatchEvent(new Event('input')); };
        return { el: fe, read: function () {
          var n = blanks(); if (!n) return 'Add at least one [ blank ] to the question.';
          var a = $$('.fe-rows input', fe).map(function (inp) { return inp.value.split(';').map(function (s) { return s.trim(); }).filter(Boolean); });
          if (a.length !== n || a.some(function (x2) { return !x2.length; })) return 'Give at least one accepted answer for every blank.';
          return { answers: a };
        } };
      }
      if (type === 'match') {
        var pairs = (x.left || []).map(function (l, i) { return [l, (x.right || [])[x.key[i]] || '']; });
        var used = (x.key || []).slice(), extras = (x.right || []).filter(function (r, j) { return used.indexOf(j) < 0; });
        if (!pairs.length) pairs = [['', ''], ['', ''], ['', '']];
        var me = h('<div class="field"><label>Matching pairs</label><p class="small muted">Each row is an item and its correct match. The matches are shuffled for students automatically.</p><div class="me-rows"></div><button class="btn small me-add" type="button">＋ Add pair</button><div class="field" style="margin-top:10px"><label>Extra wrong matches (optional, one per line)</label><textarea class="me-x" rows="2">' + esc(extras.join('\n')) + '</textarea></div></div>');
        function drawM() {
          var rows = $('.me-rows', me); rows.innerHTML = '';
          pairs.forEach(function (p, k) {
            var r = h('<div class="me-row"><input placeholder="Item ' + (k + 1) + '" aria-label="Item ' + (k + 1) + '"><span>→</span><input placeholder="Its match" aria-label="Match for item ' + (k + 1) + '"><button class="btn small danger" type="button" title="Remove pair">✕</button></div>');
            var ins = $$('input', r); ins[0].value = p[0]; ins[1].value = p[1];
            ins[0].oninput = function () { p[0] = ins[0].value; }; ins[1].oninput = function () { p[1] = ins[1].value; };
            $('button', r).onclick = function () { if (pairs.length <= 2) return toast('Keep at least two pairs.'); pairs.splice(k, 1); drawM(); };
            rows.appendChild(r);
          });
        }
        $('.me-add', me).onclick = function () { pairs.push(['', '']); drawM(); };
        drawM();
        return { el: me, read: function () {
          if (pairs.length < 2 || pairs.some(function (p) { return !p[0].trim() || !p[1].trim(); })) return 'Fill in every item and its match (at least two pairs).';
          var right = pairs.map(function (p) { return p[1].trim(); }).concat($('.me-x', me).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean));
          var order = seededShuffle(right.length, x.id), shuffled = order.map(function (j) { return right[j]; });
          return { left: pairs.map(function (p) { return p[0].trim(); }), right: shuffled, key: pairs.map(function (p, i) { return order.indexOf(i); }) };
        } };
      }
      if (type === 'sort') {
        var groups = (x.groups || ['Group 1', 'Group 2']).slice(), items = (x.items || [['', 0], ['', 1]]).map(function (it) { return it.slice(); });
        var se = h('<div class="field"><label>Groups (one per line, at least two)</label><textarea class="se-g" rows="2">' + esc(groups.join('\n')) + '</textarea><label style="margin-top:8px">Items and the group each belongs to</label><div class="se-rows"></div><button class="btn small se-add" type="button">＋ Add item</button></div>');
        function drawS() {
          groups = $('.se-g', se).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
          var rows = $('.se-rows', se); rows.innerHTML = '';
          items.forEach(function (it, k) {
            var r = h('<div class="me-row"><input placeholder="Item" aria-label="Item ' + (k + 1) + '"><select aria-label="Group for item ' + (k + 1) + '">' + groups.map(function (g, gi) { return '<option value="' + gi + '"' + (gi === it[1] ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select><button class="btn small danger" type="button" title="Remove item">✕</button></div>');
            $('input', r).value = it[0]; $('input', r).oninput = function (e) { it[0] = e.target.value; };
            $('select', r).onchange = function (e) { it[1] = +e.target.value; };
            $('button', r).onclick = function () { if (items.length <= 2) return toast('Keep at least two items.'); items.splice(k, 1); drawS(); };
            rows.appendChild(r);
          });
        }
        $('.se-g', se).addEventListener('change', drawS);
        $('.se-add', se).onclick = function () { items.push(['', 0]); drawS(); };
        drawS();
        return { el: se, read: function () {
          drawS();
          if (groups.length < 2) return 'Give at least two groups.';
          if (items.length < 2 || items.some(function (it) { return !it[0].trim(); })) return 'Fill in every item (at least two).';
          return { groups: groups, items: items.map(function (it) { return [it[0].trim(), Math.min(it[1], groups.length - 1)]; }) };
        } };
      }
    }
    function questionEditor(orig, bank, isNew, ctx) {
      var x = clone(orig), body = h('<div class="ed-form qed"></div>');
      body.appendChild(h('<p class="small muted">' + BANKS[bank] + (isNew ? ' (new)' : '') + ' · permanent question ID <code>' + esc(x.id) + '</code> — it never changes, so results stay linked to this question.</p>'));
      var typeSel = null;
      if (bank === 'checks') {
        typeSel = h(field('Question type', '<select class="q-type">' + Object.keys(A.TYPE_NAMES).map(function (t) { return '<option value="' + t + '"' + (t === x.type ? ' selected' : '') + '>' + A.TYPE_NAMES[t] + '</option>'; }).join('') + '</select>'));
        body.appendChild(typeSel);
      }
      var stemVal = bank === 'questions' ? x.stem.filter(function (p) { return p !== '[[IMAGE]]'; }).join('\n\n') : bank === 'checks' ? x.q : x.stem;
      var stem = mdField(stemVal, { inline: bank !== 'questions', rows: 4, label: 'Question text', noPreview: bank === 'questions' });
      var sf = h('<div class="field"><label>Question text *</label></div>'); sf.appendChild(stem.el);
      if (bank === 'questions') sf.appendChild(h('<span class="small muted">Separate paragraphs (e.g. the case, then the question) with an empty line.</span>'));
      body.appendChild(sf);
      // picture
      var picBox = null;
      if (bank !== 'checks') {
        picBox = h('<div class="field"><label>Picture (optional)</label><div class="q-pic"></div></div>');
        var drawPic = function () {
          var b = $('.q-pic', picBox);
          if (x.image) { b.innerHTML = A.figCard(x.image) + '<div class="ed-row"><button class="btn small q-pe" type="button">🖼 Edit / replace picture</button><button class="btn small danger q-pr" type="button">Remove from question</button></div>'; $('.pic-tools', b) && $('.pic-tools', b).remove(); }
          else b.innerHTML = '<button class="btn small q-pa" type="button">＋ Add a picture</button>';
          var pe = $('.q-pe', b), pr = $('.q-pr', b), pa = $('.q-pa', b);
          if (pe) pe.onclick = function () { pictureDialog(x.image, { onSaved: drawPic, stack: true }); };
          if (pr) pr.onclick = function () { x.image = null; drawPic(); };
          if (pa) pa.onclick = function () { var d = 'pic:' + rid('q'); pictureDialog(d, { isNew: true, stack: true, onSaved: function () { x.image = d; drawPic(); } }); };
        };
        drawPic();
        body.appendChild(picBox);
      }
      var ansBox = h('<div class="q-ans"></div>'); body.appendChild(ansBox);
      var ansEd;
      function drawAns() { ansBox.innerHTML = ''; ansEd = bank === 'checks' ? checkAnswerEditor(x, x.type, stem) : optionsEditor(x, false); if (bank !== 'checks') ansBox.appendChild(h('<label class="q-lbl">Answer options *</label>')); ansBox.appendChild(ansEd.el); }
      drawAns();
      if (typeSel) $('select', typeSel).onchange = function (e) {
        var t = e.target.value;
        if (!window.confirm('Change the question type to “' + A.TYPE_NAMES[t] + '”? The answer part will need to be filled in again (question text, explanation and reference are kept).')) { e.target.value = x.type; return; }
        var keepOpts = (x.type === 'mcq' || x.type === 'select') && (t === 'mcq' || t === 'select');
        ['answer', 'answers', 'left', 'right', 'key', 'items', 'groups'].concat(keepOpts ? [] : ['options', 'optionIds']).forEach(function (k) { delete x[k]; });
        x.type = t; drawAns();
      };
      var expl = mdField(bank === 'checks' ? x.expl : x.explanation, { inline: true, rows: 3, label: 'Explanation' });
      var ef = h('<div class="field"><label>Explanation / feedback shown after answering</label></div>'); ef.appendChild(expl.el); body.appendChild(ef);
      var trap = null;
      if (bank !== 'checks') { trap = mdField(x.trap || '', { inline: true, rows: 2, label: 'Exam trap', noPreview: true }); var tf = h('<div class="field"><label>Exam trap / extra feedback (optional)</label></div>'); tf.appendChild(trap.el); body.appendChild(tf); }
      var meta = h('<div class="grid g2 q-meta"></div>');
      meta.appendChild(h(field('Linked learning block', '<select class="q-place">' + placeOptions(bank === 'checks' ? x.sec : x.sub || (x.sections || [])[0], true, true) + '</select>')));
      meta.appendChild(h(field('Reference / source', '<input class="q-ref">')));
      if (bank !== 'checks') {
        meta.appendChild(h(field('Concept (for revision queue)', '<select class="q-concept">' + conceptOptions(x.concept) + '</select>')));
        meta.appendChild(h(field('Difficulty', '<select class="q-diff">' + DIFF.map(function (d) { return '<option' + (d[0] === x.difficulty ? ' selected' : '') + '>' + d[0] + '</option>'; }).join('') + '</select>')));
        meta.appendChild(h(field('Previous-exam concept', '<label class="chk"><input type="checkbox" class="q-prev"' + (x.previousExam ? ' checked' : '') + '> Re-tests a concept from a previous exam</label>')));
      }
      if (bank === 'questions') {
        meta.appendChild(h(field('Question code (shown to students)', '<input class="q-code">')));
        meta.appendChild(h(field('Assessment', '<select class="q-test">' + Object.keys(D.tests).map(function (t) { return '<option value="' + esc(t) + '"' + (t === x.test ? ' selected' : '') + '>' + esc(D.tests[t].title) + '</option>'; }).join('') + '</select>')));
        meta.appendChild(h(field('Topic (for results by topic)', '<select class="q-topic">' + Object.keys(D.topics).map(function (k) { return '<option value="' + esc(k) + '"' + (k === x.topic ? ' selected' : '') + '>' + esc(D.topics[k].name) + '</option>'; }).join('') + '</select>')));
        meta.appendChild(h(field('Learning objective', '<input class="q-obj">')));
      }
      body.appendChild(meta);
      $('.q-ref', meta).value = bank === 'questions' ? x.source || '' : x.ref || '';
      if ($('.q-code', meta)) $('.q-code', meta).value = x.code || '';
      if ($('.q-obj', meta)) $('.q-obj', meta).value = x.objective || '';
      if ($('.q-concept', meta)) $('.q-concept', meta).addEventListener('change', function (e) { if (e.target.value === '__new') newConcept(e.target); });
      body.appendChild(h('<p class="err q-err" role="alert"></p>'));

      function read() {
        var y = clone(x), err = $('.q-err', body);
        var st = stem.value.trim(); if (!st) return (err.textContent = 'The question text is empty.'), null;
        var a = ansEd.read(); if (typeof a === 'string') return (err.textContent = a), null;
        Object.assign(y, a);
        var place = $('.q-place', meta).value, pi = placeInfo(place), ref = $('.q-ref', meta).value.trim();
        if (bank === 'checks') { y.q = st; y.expl = expl.value.trim(); y.ref = ref; y.sec = place; }
        else {
          y.explanation = expl.value.trim(); y.trap = trap.value.trim(); if (!y.trap && bank === 'practice') delete y.trap;
          y.sub = pi.sub; y.section = pi.section; y.lecture = pi.lecture;
          y.concept = $('.q-concept', meta).value === '__new' ? '' : $('.q-concept', meta).value;
          y.difficulty = $('.q-diff', meta).value; y.previousExam = $('.q-prev', meta).checked;
        }
        if (bank === 'practice') { y.stem = st; y.ref = ref; }
        if (bank === 'questions') {
          var paras = st.split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
          // keep the picture where it was in the question (or after the text)
          var oldAt = x.stem.indexOf('[[IMAGE]]');
          if (y.image) paras.splice(oldAt >= 0 ? Math.min(oldAt, paras.length) : paras.length, 0, '[[IMAGE]]');
          y.stem = paras; y.source = ref; y.sections = [pi.sub]; y.imageBased = !!y.image;
          y.code = $('.q-code', meta).value.trim() || x.code; y.test = $('.q-test', meta).value; y.topic = $('.q-topic', meta).value; y.objective = $('.q-obj', meta).value.trim();
          y.correctAnswer = LETTERS[y.answer];
        }
        return y;
      }
      var P = panel((isNew ? 'New ' : 'Edit ') + BANKS[bank].toLowerCase(), body, (isNew ? [] : [{ label: '🗑 Delete', cls: 'danger', onClick: function () { deleteQuestion(x.id); return false; } }]).concat([{ spacer: true }, { label: 'Cancel' }, { label: isNew ? 'Add question' : 'Save question', cls: 'primary', onClick: function () {
        var y = read(); if (!y) return false;
        if (!(bank === 'checks' ? y.expl : y.explanation) && !window.confirm('There is no explanation. Students learn most from the explanation. Save without one?')) return false;
        if (bank === 'questions' && !isNew && (orig.answer !== y.answer || orig.optionIds.join() !== y.optionIds.join()) && !window.confirm('You changed the answer options or the correct answer of a graded question. New attempts use the new key; result files that students already downloaded are re-scored with it when you import them. Continue?')) return false;
        change(function () {
          if (isNew) {
            var arr = bankArr(bank), g = groupFn(bank, y), lastInGroup = -1;
            arr.forEach(function (it, k) { if (g(it)) lastInGroup = k; });
            var at = ctx && ctx.after ? arr.findIndex(function (it) { return it.id === ctx.after; }) + 1 : lastInGroup >= 0 ? lastInGroup + 1 : arr.length;
            arr.splice(at, 0, y);
          } else { var f = findQ(x.id); f.arr[f.i] = y; }
        });
        toast(isNew ? 'Question added to the draft.' : 'Question saved to the draft.');
      } }]), { wide: true });
      return P;
    }
    function deleteQuestion(id) {
      var f = findQ(id); if (!f) return;
      if (f.bank === 'questions') {
        var m = A.modal('Remove assessment question?', '<p>Students may already have results that include this question.</p><ul><li><b>Retire</b> (recommended): it is left out of new attempts, but past results still show it and its score.</li><li><b>Delete permanently</b>: past results will no longer list this question (their saved scores stay as they were).</li></ul>', [{ label: 'Cancel' },
          { label: 'Delete permanently', cls: 'danger', onClick: function () { change(function () { f.arr.splice(f.i, 1); }); if (openPanel) openPanel.close(true); } },
          { label: f.x.retired ? 'Already retired' : 'Retire', cls: 'primary', onClick: function () { if (f.x.retired) return; change(function () { f.x.retired = true; }); if (openPanel) openPanel.close(true); toast('Question retired. You can bring it back from Question banks.'); } }]);
        void m; return;
      }
      confirmDel('Delete this ' + BANKS[f.bank].toLowerCase() + '?', 'Delete it from the draft? You can undo this until you leave the page; students keep seeing it until you publish.', 'Delete question', function () { change(function () { f.arr.splice(f.i, 1); }); if (openPanel) openPanel.close(true); });
    }
    function duplicateQuestion(id) {
      var f = findQ(id); var c = clone(f.x); c.id = newQid(f.bank); delete c.retired;
      if (f.bank === 'questions') c.code = nextCode(c.test);
      change(function () { f.arr.splice(f.i + 1, 0, c); }); toast('Copy added below the original.');
    }
    function moveQuestion(id, d, gf) {
      var f = findQ(id), g = gf || groupFn(f.bank, f.x), pos = [];
      f.arr.forEach(function (it, k) { if (g(it)) pos.push(k); });
      var k = pos.indexOf(f.i), j = pos[k + d];
      change(function () { if (j == null) throw new Error(d < 0 ? 'Already first.' : 'Already last.'); var t = f.arr[f.i]; f.arr[f.i] = f.arr[j]; f.arr[j] = t; });
    }
    function qToolbar(id, gf) {
      var f = findQ(id);
      var t = h('<div class="ed-row ed-qbar noprint"><button class="btn small" type="button" data-a="e">✏️ Edit question</button><button class="btn small" type="button" data-a="d">⧉ Duplicate</button><button class="btn small" type="button" data-a="u" title="Move up">↑</button><button class="btn small" type="button" data-a="n" title="Move down">↓</button><button class="btn small danger" type="button" data-a="x">🗑</button>' + (f && f.x.retired ? '<span class="pill warn">retired</span>' : '') + '</div>');
      t.onclick = function (e) {
        var a = e.target.dataset.a; if (!a) return; e.stopPropagation();
        var q = findQ(id); if (!q) return;
        if (a === 'e') questionEditor(q.x, q.bank, false); if (a === 'd') duplicateQuestion(id); if (a === 'u') moveQuestion(id, -1, gf); if (a === 'n') moveQuestion(id, 1, gf); if (a === 'x') deleteQuestion(id);
      };
      return t;
    }
    function serverToolbar(qid) {
      var t = h('<div class="ed-row ed-qbar noprint"><button class="btn small" type="button" data-a="e">✏️ Edit question</button><button class="btn small" type="button" data-a="d">⧉ Duplicate</button><button class="btn small danger" type="button" data-a="x">Deactivate</button><span class="small muted">question bank · ' + esc(qid) + '</span></div>');
      t.onclick = function (e) {
        var a = e.target.dataset.a; if (!a) return; e.stopPropagation();
        if (a === 'e') serverQuestion(qid, 'edit'); if (a === 'd') serverQuestion(qid, 'duplicate');
        if (a === 'x') confirmDel('Deactivate ' + qid + '?', 'Students stop seeing it in practice at once (it stays in the bank with its history and can be activated again in Teacher portal → Question bank).', 'Deactivate', function () {
          CX.api('vulvaAdminSetActive', { qid: qid, active: false }).then(function (r) { if (!r.ok) return toast(r.error); BANK = null; toast(qid + ' deactivated.'); A.refreshServer(true).then(rerender); });
        });
      };
      return t;
    }
    function decorateQuestions(root) {
      $$('[data-qid]', root).forEach(function (el) {
        if (el.querySelector(':scope > .ed-qbar') || el.closest('.qbank')) return;
        if (findQ(el.dataset.qid)) el.insertBefore(qToolbar(el.dataset.qid), el.firstChild);
        else if (el.dataset.bank === 'practice') el.insertBefore(serverToolbar(el.dataset.qid), el.firstChild);
      });
      // "Test yourself" boxes render their questions on first open — decorate them then.
      $$('details.ty', root).forEach(function (d) {
        if (d.dataset.edq) return; d.dataset.edq = 1;
        d.addEventListener('toggle', function () { setTimeout(function () { decorateQuestions(d); }, 0); });
      });
    }

    /* ---- Question banks page ---- */
    function viewQuestionBanks(bank) {
      var app = A.app(); bank = 'checks';
      app.appendChild(h('<p class="small noprint"><a href="#/faculty">← Faculty tools</a></p>'));
      app.appendChild(h('<div class="row"><h1>Section checks</h1><div class="spacer"></div>' + (IS_DRAFT ? '<button class="btn primary qb-add" type="button">＋ Add section check</button>' : '') + '</div>'));
      if (!IS_DRAFT) app.appendChild(liveNotice());
      app.appendChild(h('<div class="tabs" role="tablist"><a class="btn navy" href="#/faculty/questions/checks">Section checks (' + D.checks.length + ')</a> <a class="btn" href="#/teacher/bank">Practice & assessment questions → Question bank</a></div>'));
      var ctl = h('<div class="card row qbank-ctl"><div class="field" style="margin:0;flex:1;min-width:200px"><label>Learning block</label><select class="qb-f"><option value="">All</option>' + placeOptions('', true, true) + '</select></div><div class="field" style="margin:0;flex:1;min-width:180px"><label>Search</label><input class="qb-s" type="search" placeholder="Words in the question, or its code…"></div></div>');
      app.appendChild(ctl);
      if (bank === 'questions') app.appendChild(h('<p class="small muted">This is the order of the graded paper. New attempts use this order; saved results keep the questions they had.</p>'));
      var list = h('<div class="qbank"></div>'); app.appendChild(list);
      var S = sessionStorage, fk = 'vp_qbf_' + bank;
      $('.qb-f', ctl).value = S.getItem(fk) || '';
      function placeOf(x) { return bank === 'checks' ? x.sec : x.sub || (x.sections || [])[0]; }
      function inPlace(x, f) { if (!f) return true; var p = placeOf(x); if (p === f) return true; var u = findSub(p); return !!u && u.s.id === f; }
      function draw() {
        var f = $('.qb-f', ctl).value, q = $('.qb-s', ctl).value.trim().toLowerCase(); S.setItem(fk, f);
        list.innerHTML = '';
        var items = D[bank].filter(function (x) { var t = JSON.stringify([x.stem, x.q, x.options, x.id, x.code]).toLowerCase(); return inPlace(x, f) && (!q || t.indexOf(q) >= 0); });
        if (!items.length) list.appendChild(h('<div class="card">No questions here yet.' + (IS_DRAFT ? ' Use “＋ Add question”.' : '') + '</div>'));
        var gf = function (y) { return inPlace(y, f); };
        items.forEach(function (x, k) {
          var stemT = bank === 'questions' ? x.stem.filter(function (p) { return p !== '[[IMAGE]]'; }).join(' ') : bank === 'checks' ? x.q : x.stem;
          var c = h('<div class="card qrow' + (x.retired ? ' retired' : '') + '"><div class="small muted">' + (k + 1) + '. ' + esc(bank === 'checks' ? A.TYPE_NAMES[x.type] : bank === 'questions' ? x.code : 'Single best answer') + ' · ' + esc(A.num(placeOf(x)) + ' ' + ((findSub(placeOf(x)) || {}).u || (findSection(placeOf(x)) || {}).s || { title: '(no longer exists)' }).title) + (x.image ? ' · 🖼' : '') + (x.retired ? ' · <span class="pill warn">retired</span>' : '') + '</div><div class="qstem">' + inl(stemT.length > 400 ? stemT.slice(0, 400) + '…' : stemT) + '</div>' + (x.options ? '<div class="small qopts">' + x.options.map(function (o, j) { var ok = Array.isArray(x.answer) ? x.answer.indexOf(j) >= 0 : x.answer === j; return '<span class="' + (ok ? 'good' : '') + '">' + LETTERS[j] + '. ' + inl(o) + (ok ? ' ✓' : '') + '</span>'; }).join('') + '</div>' : '') + '</div>');
          if (IS_DRAFT) { c.appendChild(qToolbar(x.id, gf)); if (x.retired) { var rb = h('<button class="btn small" type="button">↺ Bring back into the paper</button>'); rb.onclick = function () { change(function () { delete findQ(x.id).x.retired; }); }; $('.ed-qbar', c).appendChild(rb); } }
          list.appendChild(c);
        });
      }
      $('.qb-f', ctl).onchange = draw; $('.qb-s', ctl).oninput = draw;
      var add = $('.qb-add', app); if (add) add.onclick = function () { questionEditor(template(bank, $('.qb-f', ctl).value || null), bank, true); };
      draw();
    }

    /* ================= Pictures & media library ================= */
    HOOKS.pictureDialog = function (desc, opts) { return pictureDialog(desc, Object.assign({ stack: !!openPanel }, opts || {})); };
    getBank().catch(function () {});   // question pictures for the picture library
    HOOKS.figTools = function (key, p) { return '<div class="pic-tools noprint"><button class="btn pic-edit" type="button">🖼 ' + (p ? 'Edit / replace picture' : 'Add picture') + '</button><span class="small muted">or drop / paste a picture here</span></div>'; };
    function slotUsage(key) { var s = A.allPicSlots().filter(function (x) { return x.key === key; })[0]; return s ? s.where : []; }
    function fileUsage() {
      var use = {};
      function add(src, where) { var m = /^media\/(.+)$/.exec(src || ''); if (m) (use[m[1]] = use[m[1]] || []).push(where); }
      var slots = {}; A.allPicSlots().forEach(function (s) { slots[s.key] = s; });
      Object.keys(D.pics).forEach(function (k) { if (D.pics[k]) add(D.pics[k].src, slots[k] ? slots[k].where.join(', ') : 'Unused picture slot'); });
      Object.keys(D.decks || {}).forEach(function (n) { (D.decks[n].slides || []).forEach(function (s, i) { (s.images || []).forEach(function (im) { add(im.src, 'Lecture ' + n + ' slide ' + (i + 1)); }); }); });
      return use;
    }
    function libraryFiles() {
      var seen = {}, out = [];
      function add(f) { if (f && !seen[f]) { seen[f] = 1; var m = (D.media || {})[f] || {}; out.push({ file: f, bytes: m.bytes || 0, uploadedAt: m.uploadedAt || 0 }); } }
      Object.keys(D.media || {}).forEach(add);
      Object.keys(fileUsage()).forEach(add);
      return out.sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });
    }
    function pickFromLibrary(cb) {
      var m = A.modal('Choose a picture from the library', '<p class="small muted">Loading…</p>', [{ label: 'Cancel' }]);
      m.el.querySelector('.modal').classList.add('wide');
      Promise.resolve({ ok: true, files: libraryFiles() }).then(function (r) {
        var b = $('.mbody', m.el);
        var use = fileUsage();
        b.innerHTML = '<input type="search" class="lib-q" placeholder="Filter by title or caption…" style="width:100%;margin-bottom:10px"><div class="libgrid"></div>';
        function draw() {
          var q = $('.lib-q', b).value.toLowerCase(), g = $('.libgrid', b); g.innerHTML = '';
          r.files.forEach(function (f) {
            var meta = (D.media || {})[f.file] || {}, label = meta.title || (use[f.file] || [])[0] || f.file;
            if (q && (label + ' ' + (meta.description || '')).toLowerCase().indexOf(q) < 0) return;
            var c = h('<button type="button" class="libcard"><img alt="" loading="lazy"><span class="small">' + esc(label) + '</span></button>');
            setImg($('img', c), 'media/' + f.file);
            c.onclick = function () { m.close(); cb('media/' + f.file, meta); };
            g.appendChild(c);
          });
          if (!g.children.length) g.innerHTML = '<p class="muted">No pictures match.</p>';
        }
        $('.lib-q', b).oninput = draw; draw();
      });
    }
    /* Picture dialog: Replace → Upload/Select → Preview → Save. Edits the shared picture slot, so the same
       picture changes everywhere the slot is used (lecture, questions, slides). */
    function pictureDialog(desc, opts) {
      opts = opts || {};
      if (!IS_DRAFT) return toast('Open the draft to change pictures.');
      var key = A.picKey(desc), cur = D.pics[key] ? clone(D.pics[key]) : null;
      var p = cur || { src: '', caption: '', credit: '', title: '', alt: '', description: '', width: null, align: 'center' };
      var removed = false;
      var used = slotUsage(key);
      var body = h('<div class="ed-form picdlg">' +
        (used.length > 1 ? '<p class="note small">This picture is shown in ' + used.length + ' places: ' + esc(used.join(' · ')) + '. Changes apply to all of them.</p>' : '') +
        '<div class="picprev" tabindex="0" aria-label="Picture preview — drop or paste a picture here"></div>' +
        '<div class="ed-row"><label class="btn primary">⬆ Upload new picture<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden class="pd-file"></label><button class="btn pd-lib" type="button">📚 Choose from library</button><button class="btn danger pd-rm" type="button">🗑 Remove picture</button></div>' +
        '<p class="small muted">JPG, PNG, GIF or WebP. Large photos are reduced automatically. You can also drop a file on the preview or paste one (Ctrl+V). Use pictures you are allowed to use and give the source.</p>' +
        field('Caption (shown under the picture)', '<input class="pd-cap" placeholder="e.g. Lichen sclerosus, H&E ×200">') +
        field('Title above the picture (optional)', '<input class="pd-title">') +
        field('Description (optional, shown under the caption)', '<textarea class="pd-desc" rows="2"></textarea>') +
        field('Alternative text (read aloud by screen readers)', '<input class="pd-alt" placeholder="Describe what the picture shows">', 'If empty, the caption is used.') +
        field('Source / credit', '<input class="pd-credit" placeholder="e.g. Own collection, Pathology Dept.">') +
        '<div class="grid g2">' + field('Display size: <b class="pd-wv"></b>', '<input type="range" class="pd-w" min="20" max="100" step="5">') +
        field('Alignment', '<select class="pd-al"><option value="center">Centred</option><option value="left">Left, text flows around</option><option value="right">Right, text flows around</option><option value="full">Full width</option></select>') + '</div>' +
        (opts.block ? '<div class="ed-sec"><b>This picture in the text</b><div class="ed-row"><button class="btn small pd-up" type="button">↑ Move up</button><button class="btn small pd-dn" type="button">↓ Move down</button><button class="btn small danger pd-delblk" type="button">Remove from the text</button></div></div>' : '') +
        '<p class="err pd-err"></p></div>');
      function v(sel) { return $(sel, body); }
      v('.pd-cap').value = p.caption || ''; v('.pd-title').value = p.title || ''; v('.pd-desc').value = p.description || ''; v('.pd-alt').value = p.alt || ''; v('.pd-credit').value = p.credit || '';
      v('.pd-w').value = p.width || 100; v('.pd-al').value = p.align || 'center';
      function drawPrev() {
        v('.pd-wv').textContent = v('.pd-al').value === 'full' ? 'full width' : v('.pd-w').value + '%';
        var pv = v('.picprev');
        if (p.src && !removed) { pv.innerHTML = '<img alt="Preview">'; setImg($('img', pv), p.src); $('img', pv).style.width = v('.pd-al').value === 'full' ? '100%' : v('.pd-w').value + '%'; }
        else pv.innerHTML = '<div class="muted">No picture yet — upload one or choose from the library.</div>';
        v('.pd-rm').disabled = !p.src || removed;
      }
      v('.pd-w').oninput = drawPrev; v('.pd-al').onchange = drawPrev; drawPrev();
      function useFile(file) {
        v('.pd-err').textContent = ''; v('.picprev').innerHTML = '<div class="muted">⏳ Uploading…</div>';
        A.storeImage(file).then(function (src) { p.src = src; removed = false; P.dirty = true; drawPrev(); }).catch(function (e) { v('.pd-err').textContent = e.message; drawPrev(); });
      }
      v('.pd-file').onchange = function (e) { if (e.target.files[0]) useFile(e.target.files[0]); e.target.value = ''; };
      v('.pd-lib').onclick = function () { pickFromLibrary(function (src, meta) { p.src = src; removed = false; P.dirty = true; if (!v('.pd-cap').value && meta.title) v('.pd-cap').value = meta.title; if (!v('.pd-alt').value && meta.alt) v('.pd-alt').value = meta.alt; drawPrev(); }); };
      v('.pd-rm').onclick = function () { removed = true; P.dirty = true; drawPrev(); };
      var pv = v('.picprev');
      pv.addEventListener('dragover', function (e) { e.preventDefault(); pv.classList.add('drop'); });
      pv.addEventListener('dragleave', function () { pv.classList.remove('drop'); });
      pv.addEventListener('drop', function (e) { e.preventDefault(); pv.classList.remove('drop'); var f = e.dataTransfer.files[0]; if (f) useFile(f); });
      body.addEventListener('paste', function (e) { var it = Array.prototype.filter.call((e.clipboardData || {}).items || [], function (x) { return /^image\//.test(x.type); })[0]; if (it) { e.preventDefault(); useFile(it.getAsFile()); } });
      var P = panel(opts.isNew ? 'Add picture' : 'Picture', body, [{ spacer: true }, { label: 'Cancel' }, { label: 'Save picture', cls: 'primary', onClick: function () {
        if (!p.src && !removed && opts.isNew) { v('.pd-err').textContent = 'Upload a picture or choose one from the library first.'; return false; }
        var rec = removed ? null : { src: p.src, caption: v('.pd-cap').value.trim(), credit: v('.pd-credit').value.trim(), title: v('.pd-title').value.trim(), alt: v('.pd-alt').value.trim(), description: v('.pd-desc').value.trim(), width: v('.pd-al').value === 'full' || +v('.pd-w').value >= 100 ? null : +v('.pd-w').value, align: v('.pd-al').value, updatedAt: Date.now() };
        if (rec) Object.keys(rec).forEach(function (k) { if (rec[k] === '' || rec[k] == null) delete rec[k]; });
        if (rec && !rec.src) { v('.pd-err').textContent = 'There is no picture to save.'; return false; }
        if (removed && !window.confirm('Remove the picture from this slot' + (used.length > 1 ? ' (in all ' + used.length + ' places)' : '') + '? The slot stays and the file remains in the library.')) return false;
        change(function () { if (rec) D.pics[key] = rec; else delete D.pics[key]; }, { noRender: !!opts.stack });
        if (opts.onSaved) opts.onSaved();
      } }], { stackOn: opts.stack });
      if (opts.block) {
        var b = opts.block;
        function blk(fn) { change(function () { var s2 = segments(b.mdEl, b.ref.get()); fn(s2); b.ref.set(s2.filter(function (x) { return x.trim(); }).join('\n\n')); }); P.close(true); }
        v('.pd-up').onclick = function () { blk(function (s2) { moveIn(s2, b.i, -1); }); };
        v('.pd-dn').onclick = function () { blk(function (s2) { moveIn(s2, b.i, 1); }); };
        v('.pd-delblk').onclick = function () { confirmDel('Remove this picture from the text?', 'The picture stays in the media library and can be added again.', 'Remove', function () { blk(function (s2) { s2.splice(b.i, 1); }); }); };
      }
      return P;
    }
    // Picture tools on cards (edit mode): button, drag & drop, paste onto a selected picture.
    var activeFig = null;
    document.addEventListener('click', function (e) {
      var fig = e.target.closest && e.target.closest('.fig[data-pic]');
      activeFig = fig && isEditing() ? fig : null;
      if (fig && e.target.closest('.pic-edit') && isEditing()) { e.preventDefault(); pictureDialog(fig.getAttribute('data-desc'), { stack: !!openPanel }); }
    });
    document.addEventListener('dragover', function (e) { var f = isEditing() && e.target.closest && e.target.closest('.fig[data-pic]'); if (f) { e.preventDefault(); f.classList.add('drop'); } });
    document.addEventListener('dragleave', function (e) { var f = e.target.closest && e.target.closest('.fig[data-pic]'); if (f) f.classList.remove('drop'); });
    document.addEventListener('drop', function (e) {
      var f = isEditing() && e.target.closest && e.target.closest('.fig[data-pic]'); if (!f || openPanel) return;
      e.preventDefault(); f.classList.remove('drop'); var file = e.dataTransfer.files && e.dataTransfer.files[0]; if (!file) return;
      var P = pictureDialog(f.getAttribute('data-desc')); var inp = P && $('.pd-file', P.el); if (inp) { var dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }
    });
    document.addEventListener('paste', function (e) {
      if (!activeFig || openPanel || !document.body.contains(activeFig) || activeFig.closest('.pres')) return;
      var it = Array.prototype.filter.call((e.clipboardData || {}).items || [], function (x) { return /^image\//.test(x.type); })[0];
      if (!it) return; e.preventDefault();
      var file = it.getAsFile(), P = pictureDialog(activeFig.getAttribute('data-desc')), inp = P && $('.pd-file', P.el);
      if (inp) { var dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }
    });

    function viewMedia(tab) {
      var app = A.app(); tab = tab === 'library' ? 'library' : 'slots';
      app.appendChild(h('<p class="small noprint"><a href="#/faculty">← Faculty tools</a></p>'));
      app.appendChild(h('<h1>🖼 Pictures & media library</h1>'));
      if (!IS_DRAFT) app.appendChild(liveNotice());
      app.appendChild(h('<p class="muted">Every picture is stored once in the media library and can be reused in any picture slot. A slot is a place in the lectures, questions or slides that shows a picture; editing a slot changes it everywhere it is used.</p>'));
      app.appendChild(h('<div class="tabs"><a class="btn' + (tab === 'slots' ? ' navy' : '') + '" href="#/faculty/media">Picture slots</a> <a class="btn' + (tab === 'library' ? ' navy' : '') + '" href="#/faculty/media/library">Library files</a></div>'));
      var body = h('<div></div>'); app.appendChild(body);
      if (tab === 'slots') {
        var filt = h('<div class="tabs"><button class="on" data-f="all" type="button">All slots</button><button data-f="todo" type="button">Without a picture</button><button data-f="done" type="button">With a picture</button></div>');
        var list = h('<div></div>'); body.appendChild(filt); body.appendChild(list);
        var draw = function (f) {
          $$('button', filt).forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
          list.innerHTML = ''; var last = null, all = A.allPicSlots();
          all.forEach(function (x) {
            var has = !!D.pics[x.key]; if (f === 'todo' && has) return; if (f === 'done' && !has) return;
            if (x.group !== last) { list.appendChild(h('<h2>' + esc(x.group) + '</h2>')); last = x.group; }
            var c = h('<div class="card picslot"><div class="small muted">' + x.where.map(esc).join(' · ') + '</div>' + A.figCard(x.desc) + (IS_DRAFT ? '<div class="ed-row"><button class="btn small primary" type="button">🖼 ' + (has ? 'Edit / replace' : 'Add picture') + '</button></div>' : '') + '</div>');
            var pt = $('.pic-tools', c); if (pt) pt.remove();
            var btn = $('.ed-row button', c); if (btn) btn.onclick = function () { pictureDialog(x.desc, { onSaved: function () { setTimeout(function () { draw(f); }, 0); } }); };
            list.appendChild(c);
          });
          if (!list.children.length) list.appendChild(h('<div class="card">Nothing here.</div>'));
        };
        $$('button', filt).forEach(function (b) { b.onclick = function () { draw(b.dataset.f); }; });
        draw('all');
        return;
      }
      var top = h('<div class="row" style="margin-bottom:10px">' + (IS_DRAFT ? '<label class="btn primary">⬆ Upload pictures to the library<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden class="lib-up"></label>' : '') + '<span class="small muted lib-n"></span></div>');
      var grid = h('<div class="libgrid big"><p class="muted">Loading…</p></div>');
      body.appendChild(top); body.appendChild(grid);
      function load() {
        Promise.resolve({ ok: true, files: libraryFiles() }).then(function (r) {
          var use = fileUsage(); grid.innerHTML = '';
          $('.lib-n', top).textContent = r.files.length + ' file(s) · ' + Math.round(r.files.reduce(function (n, f) { return n + f.bytes; }, 0) / 1048576 * 10) / 10 + ' MB';
          r.files.forEach(function (f) {
            var meta = (D.media || {})[f.file] || {}, u = use[f.file] || [];
            var c = h('<div class="card libitem"><img alt="" loading="lazy"><div class="small"><b>' + esc(meta.title || (u[0] || 'Untitled picture')) + '</b></div><div class="small muted">' + Math.round(f.bytes / 1024) + ' KB · ' + (u.length ? 'used in ' + u.length + ' place(s)' : 'not used') + '' + '</div>' +
              (u.length ? '<details class="small"><summary>Where</summary>' + u.map(esc).join('<br>') + '</details>' : '') +
              (IS_DRAFT ? '<div class="ed-row"><button class="btn small li-ed" type="button">✏️ Details</button>' + (u.length ? '' : '<button class="btn small danger li-rm" type="button">Remove from library</button>') + '</div>' : '') + '</div>');
            setImg($('img', c), 'media/' + f.file); $('img', c).onclick = function (e) { A.lightbox(e.target.src, meta.title || ''); };
            var ed = $('.li-ed', c); if (ed) ed.onclick = function () {
              formEditor('Library picture details', [{ k: 'title', label: 'Title' }, { k: 'alt', label: 'Default alternative text' }, { k: 'description', label: 'Description / notes', type: 'textarea' }], meta, function (v2) {
                change(function () { D.media = D.media || {}; D.media[f.file] = Object.assign({}, D.media[f.file] || { uploadedAt: Date.now() }, v2); }, { noRender: true }); load();
              });
            };
            var rm = $('.li-rm', c); if (rm) rm.onclick = function () { confirmDel('Remove from library?', 'This picture is not used anywhere. Remove it from the library list? (The encrypted file stays in the repository, so earlier versions keep working.)', 'Remove', function () { change(function () { if (D.media) delete D.media[f.file]; }, { noRender: true }); c.remove(); }); };
            grid.appendChild(c);
          });
          if (!r.files.length) grid.innerHTML = '<p class="muted">The library is empty.</p>';
        });
      }
      var up = $('.lib-up', top);
      if (up) up.onchange = function (e) {
        var files = Array.prototype.slice.call(e.target.files); e.target.value = '';
        toast('Uploading ' + files.length + ' picture(s)…');
        files.reduce(function (pr, file) { return pr.then(function () { return A.storeImage(file).then(function (src) { var fn = src.slice(6); D.media[fn].title = D.media[fn].title || file.name.replace(/\.[^.]+$/, ''); }).catch(function (er) { toast(file.name + ': ' + er.message); }); }); }, Promise.resolve())
          .then(function () { markDirty(); load(); toast('Upload finished. Use “Add picture” on any slot and choose “Choose from library”.'); });
      };
      load();
    }

    /* ================= Last-minute review items ================= */
    var RV_SPEC = {
      facts: { name: 'high-yield fact', prefix: 'fa', fields: [{ k: 'q', label: 'Question (active recall)', type: 'inline', required: true }, { k: 'a', label: 'Answer', type: 'inline', required: true }, { k: 'why', label: 'Why it matters', type: 'inline' }, { k: 'sub', label: 'Taught in', type: 'place' }, { k: 'concept', label: 'Concept', type: 'concept' }] },
      comparisons: { name: 'comparison', prefix: 'cmp', fields: [{ k: 'title', label: 'Title', required: true }, { k: 'md', label: 'Comparison (usually a table)', type: 'md', required: true, rows: 10 }, { k: 'sub', label: 'Taught in', type: 'place' }] },
      morphology: { name: 'morphology association', prefix: 'mo', fields: [{ k: 'finding', label: 'Finding', type: 'inline', required: true }, { k: 'dx', label: 'Diagnosis / meaning', type: 'inline', required: true }, { k: 'how', label: 'Type (e.g. Microscopic, Gross)' }, { k: 'sub', label: 'Taught in', type: 'place' }] },
      traps: { name: 'exam trap', prefix: 'tr', fields: [{ k: 'trap', label: 'Trap (the wrong belief)', type: 'inline', required: true }, { k: 'remember', label: 'Remember instead', type: 'inline', required: true }, { k: 'sub', label: 'Taught in', type: 'place' }, { k: 'concept', label: 'Concept', type: 'concept' }] },
      review15: { name: '15-minute block', prefix: 'r15', fields: [{ k: 'mins', label: 'Time label (e.g. 0–5 min)' }, { k: 'title', label: 'Title', required: true }, { k: 'points', label: 'Points (one per line)', type: 'lines', rows: 8 }] }
    };
    function editReview(kind, i, isNew) {
      var S = RV_SPEC[kind], list = D.review[kind], rec = isNew ? { id: S.prefix + rid('') } : clone(list[i]);
      formEditor((isNew ? 'New ' : 'Edit ') + S.name, S.fields, rec, function (v) {
        change(function () { var y = Object.assign(rec, v); if (isNew) list.push(y); else list[i] = y; });
      }, { wide: kind === 'comparisons', extraButtons: isNew ? [] : [{ label: '🗑 Delete', cls: 'danger', onClick: function () { confirmDel('Delete this ' + S.name + '?', 'Delete it from the draft? Undo is available.', 'Delete', function () { change(function () { list.splice(i, 1); }); if (openPanel) openPanel.close(true); }); return false; } }] });
    }
    function decorateReview(tab) {
      var app = A.app(), kind = { facts: 'facts', compare: 'comparisons', morph: 'morphology', traps: 'traps', '15': 'review15' }[tab];
      if (!kind) return;
      var add = h('<div class="ed-row ed-bar2 noprint"><button class="btn small primary" type="button">＋ Add ' + RV_SPEC[kind].name + '</button></div>');
      $('button', add).onclick = function () { editReview(kind, 0, true); };
      var h1 = $('h1', app); if (h1) h1.parentNode.insertBefore(add, h1.nextSibling.nextSibling || null);
      $$('[data-rv="' + kind + '"]', app).forEach(function (el) {
        var i = +el.dataset.i;
        var t = h('<div class="ed-row ed-qbar noprint"><button class="btn small" type="button" data-a="e">✏️ Edit</button><button class="btn small" type="button" data-a="d">⧉ Duplicate</button><button class="btn small" type="button" data-a="u">↑</button><button class="btn small" type="button" data-a="n">↓</button><button class="btn small danger" type="button" data-a="x">🗑</button></div>');
        t.onclick = function (e) {
          var a = e.target.dataset.a, list = D.review[kind]; if (!a) return; e.stopPropagation();
          if (a === 'e') editReview(kind, i); if (a === 'u') change(function () { if (!moveIn(list, i, -1)) throw new Error('Already first.'); }); if (a === 'n') change(function () { if (!moveIn(list, i, 1)) throw new Error('Already last.'); });
          if (a === 'd') change(function () { var c = clone(list[i]); c.id = RV_SPEC[kind].prefix + rid(''); list.splice(i + 1, 0, c); });
          if (a === 'x') confirmDel('Delete this ' + RV_SPEC[kind].name + '?', 'Delete it from the draft? Undo is available.', 'Delete', function () { change(function () { list.splice(i, 1); }); });
        };
        el.insertBefore(t, el.firstChild);
      });
    }

    /* ================= Content & publishing ================= */
    function liveNotice() {
      var n = h('<div class="note ed-livenote">You are viewing the <b>live</b> version (what students see). <button class="btn small primary" type="button">✏️ Open the draft to make changes</button></div>');
      $('button', n).onclick = function () { CX.setView('draft'); };
      return n;
    }
    /* What changed between two versions of the content (by stable ids), for the publish summary. */
    function diffContent(a, b) {
      function blocks(c) { var m = {}; (c.lectures || []).forEach(function (L) { L.sections.forEach(function (s) { m['s:' + s.id] = JSON.stringify([s.title, s.intro, s.label]); s.subs.forEach(function (u) { m[u.id] = JSON.stringify(u); }); }); }); return m; }
      function byId(list) { var m = {}; (list || []).forEach(function (x, i) { m[x.id || i] = JSON.stringify(x); }); return m; }
      function keyed(o) { var m = {}; Object.keys(o || {}).forEach(function (k) { m[k] = JSON.stringify(o[k]); }); return m; }
      function cmp(area, x, y) { var r = { area: area, added: 0, changed: 0, removed: 0 }; Object.keys(y).forEach(function (k) { if (!(k in x)) r.added++; else if (x[k] !== y[k]) r.changed++; }); Object.keys(x).forEach(function (k) { if (!(k in y)) r.removed++; }); return r; }
      var rv = function (c, k) { return byId(((c.review || {})[k]) || []); };
      return [cmp('Lecture sections & learning blocks', blocks(a), blocks(b)), cmp('Section checks', byId(a.checks), byId(b.checks)),
        cmp('Key facts', rv(a, 'facts'), rv(b, 'facts')), cmp('Comparisons', rv(a, 'comparisons'), rv(b, 'comparisons')), cmp('Morphology', rv(a, 'morphology'), rv(b, 'morphology')), cmp('Exam traps', rv(a, 'traps'), rv(b, 'traps')), cmp('15-minute review', rv(a, 'review15'), rv(b, 'review15')),
        cmp('Pictures', keyed(a.pics), keyed(b.pics)), cmp('Slides', keyed(a.decks), keyed(b.decks)), cmp('Concepts & topics', keyed(Object.assign({}, a.concepts, a.topics)), keyed(Object.assign({}, b.concepts, b.topics))), cmp('Course settings', keyed(a.meta), keyed(b.meta))]
        .filter(function (r) { return r.added || r.changed || r.removed; });
    }
    /* The same structural checks as the backend, so problems are shown before anything is sent. */
    function checkContent(c) {
      var errs = [], warns = [], MEDIA = /^media\/[a-f0-9]{32}\.(jpg|png|gif|webp)$/;
      Object.keys(c.pics || {}).forEach(function (k) { var p = c.pics[k]; if (p && !MEDIA.test(String(p.src || ''))) errs.push('A picture (' + (p.caption || k) + ') is not in the media library yet — open it and upload it again.'); });
      Object.keys(c.decks || {}).forEach(function (n) { ((c.decks[n] || {}).slides || []).forEach(function (sl, i) { (sl.images || []).forEach(function (im) { if (!MEDIA.test(String(im.src || ''))) errs.push('Lecture ' + n + ', slide ' + (i + 1) + ': a picture is not in the media library yet.'); }); }); });
      var ids = {}; c.lectures.forEach(function (L) { L.sections.forEach(function (s) { ids[s.id] = 1; s.subs.forEach(function (u) { ids[u.id] = 1; if (!u.md.trim()) warns.push('Block ' + u.id + ' “' + u.title + '” is empty.'); }); }); });
      c.checks.forEach(function (k) { if (!ids[k.sec]) errs.push('Section check ' + k.id + ' points to a section that no longer exists.'); if (!k.expl) warns.push('Section check ' + k.id + ' has no explanation.'); });
      return { errors: errs, warnings: warns };
    }
    function publishDialog() {
      if (!IS_DRAFT) return A.modal('Publish', '<p>Open the draft to review and publish changes.</p>', [{ label: 'Cancel' }, { label: 'Open the draft', cls: 'primary', onClick: function () { CX.setView('draft'); } }]);
      var m = A.modal('Review & publish', '<p class="muted">⏳ Saving the draft and checking it…</p>', [{ label: 'Close' }]);
      m.el.querySelector('.modal').classList.add('wide');
      var b = $('.mbody', m.el);
      save(true).then(function (ok) {
        if (!ok) { b.innerHTML = '<p class="err">The draft could not be saved, so it cannot be published yet. ' + esc(saveErr) + '</p>'; return; }
        if (CX.fromLive && !rev) { b.innerHTML = '<p>There is nothing to publish: you have not changed anything since the last published version.</p>'; return; }
        return Promise.all([CX.loadPublished().catch(function () { return null; }), CX.api('vulvaAdminContentGet')]).then(function (res) {
          var live = res[0], st = res[1], cur = cleanContent(), chk = checkContent(cur);
          if (!st.ok) { b.innerHTML = '<p class="err">' + esc(st.error) + '</p>'; return; }
          var ch = live ? diffContent(live, cur) : null;
          b.innerHTML = (ch ? '<p>Students will see these changes after you publish:</p>' + (ch.length ? '<div class="tablewrap"><table class="data"><thead><tr><th>Area</th><th>Added</th><th>Changed</th><th>Removed</th></tr></thead><tbody>' + ch.map(function (c) { return '<tr><td>' + esc(c.area) + '</td><td>' + c.added + '</td><td>' + c.changed + '</td><td>' + c.removed + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No differences from the published version.</p>') : '<p>This will be the <b>first</b> published version of the course.</p>') +
            (chk.errors.length ? '<div class="co trap"><p><b>Fix these before publishing:</b></p><ul>' + chk.errors.slice(0, 30).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' : '') +
            (chk.warnings.length ? '<details class="small"><summary>' + chk.warnings.length + ' note(s) — publishing is still possible</summary><ul>' + chk.warnings.slice(0, 50).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></details>' : '') +
            (!st.github.configured ? '<p class="err">Publishing needs the GitHub settings in your Apps Script project (Script Properties GITHUB_TOKEN and GITHUB_REPO). See SETUP.md, step 4.</p>' : '<p class="small">🔒 The course is encrypted in this browser, then the platform commits it to <b>' + esc(st.github.repo) + '</b> (branch ' + esc(st.github.branch) + '). Every published version is kept in the history.</p>') +
            (chk.errors.length || !st.github.configured ? '' : field('Short description of the changes (saved in the history)', '<input class="pub-msg" maxlength="200" placeholder="e.g. Updated VIN classification and added 3 section checks">') +
              '<label class="chk"><input type="checkbox" class="pub-ok"> I have previewed the draft and want students to see it now.</label><p class="err pub-err"></p>' +
              '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn pub-prev" type="button">👁 Preview first</button><button class="btn primary pub-go" type="button">🚀 Publish now</button></div>');
          var pv = $('.pub-prev', b); if (pv) pv.onclick = function () { m.close(); setPreview(true); };
          var go = $('.pub-go', b);
          if (go) go.onclick = function () {
            if (!$('.pub-ok', b).checked) { $('.pub-err', b).textContent = 'Please confirm that you have previewed the draft.'; return; }
            go.disabled = true; go.textContent = 'Encrypting & publishing…';
            CX.encrypt(new TextEncoder().encode(JSON.stringify(cur))).then(function (enc) {
              return CX.api('vulvaAdminPublish', { rev: rev, encrypted: b64(enc), message: $('.pub-msg', b).value });
            }).then(function (x) {
              if (!x.ok) { go.disabled = false; go.textContent = '🚀 Publish now'; $('.pub-err', b).textContent = x.error + (x.issues ? ' ' + x.issues.slice(0, 5).join(' · ') : ''); return; }
              rev = 0; dirty = false; lastSaved = null; CX.fromLive = true; undoStack = []; redoStack = []; updateBar();
              b.innerHTML = '<p class="good"><b>✓ Published.</b> Students get the new version the next time they open or reload the platform (GitHub Pages usually updates within a minute or two).</p>' + (x.url ? '<p>Saved to GitHub: <a href="' + esc(x.url) + '" target="_blank" rel="noopener">commit ' + esc(String(x.commit).slice(0, 7)) + '</a></p>' : '');
            }, function (e) { go.disabled = false; go.textContent = '🚀 Publish now'; $('.pub-err', b).textContent = e.message || String(e); });
          };
        });
      });
    }
    function viewContentAdmin() {
      var app = A.app();
      app.appendChild(h('<p class="small noprint"><a href="#/faculty">← Faculty tools</a></p>'));
      app.appendChild(h('<h1>✏️ Content & publishing</h1>'));
      app.appendChild(h('<div class="card"><h2 style="margin-top:0">How it works</h2><ol class="steps"><li><b>Edit</b> — turn on <b>✏️ Edit mode</b> in the bar at the top, then click any text, picture or question. Changes are saved automatically to the <b>draft</b> (kept in your private spreadsheet).</li><li><b>Preview</b> — 👁 Preview shows the draft exactly as students will see it.</li><li><b>Publish</b> — 🚀 Publish encrypts the draft in your browser and the platform commits it to GitHub; GitHub Pages then serves it to students.</li></ol><p class="small muted">Students never see the draft. Practice and assessment questions are not part of this content: they stay in the question bank on the platform (Teacher portal), so answers are never published.</p></div>'));
      var st = h('<div class="card" style="margin-top:14px"><h2 style="margin-top:0">Status</h2><div class="st-body muted">Loading…</div></div>');
      app.appendChild(st);
      var acts = h('<div class="row" style="margin:14px 0">' + (IS_DRAFT ? '<button class="btn" type="button" data-a="edit">' + (editing ? '✓ Edit mode is on' : '✏️ Turn on Edit mode') + '</button><button class="btn" type="button" data-a="prev">👁 Preview as student</button><button class="btn primary" type="button" data-a="pub">🚀 Review & publish…</button><button class="btn danger" type="button" data-a="discard">Discard the draft…</button>' : '<button class="btn primary" type="button" data-a="draft">✏️ Open the draft</button>') + '<button class="btn" type="button" data-a="settings">⚙️ Course settings</button>' + (IS_DRAFT ? '<button class="btn" type="button" data-a="import">⬆ Import course from a file…</button>' : '') + '</div>');
      acts.onclick = function (e) {
        var a = e.target.dataset.a;
        if (a === 'edit') { setEditing(true); location.hash = '#/learn'; } if (a === 'prev') setPreview(true); if (a === 'pub') publishDialog(); if (a === 'draft') CX.setView('draft'); if (a === 'settings') courseSettings();
        if (a === 'import') window.VULVA_IMPORT(CX, function (content) { snapshot(); replaceD(JSON.stringify(content)); changed(true); save(true).then(function (ok) { if (ok) toast('Imported into the draft. Preview it, then publish.'); }); });
        if (a === 'discard') confirmDel('Discard the draft?', 'Throw away every change that has not been published and go back to the published version? A copy of the draft is kept in the history, so you can restore it later.', 'Discard draft', function () {
          clearTimeout(saveT); dirty = false;
          CX.api('vulvaAdminContentDiscard').then(function (r) { if (r.ok) { toast('Draft discarded.'); location.reload(); } else toast(r.error); });
        });
      };
      app.appendChild(acts);
      var hist = h('<div class="card"><h2 style="margin-top:0">History & rollback</h2><p class="small muted">Restoring a version copies it into the draft (your current draft is kept in the history first). Nothing reaches students until you preview and publish.</p><div class="hist-body muted">Loading…</div></div>');
      app.appendChild(hist);
      CX.api('vulvaAdminContentGet').then(function (s) {
        if (!s.ok) { $('.st-body', st).textContent = s.error; return; }
        var lp = s.lastPublished;
        $('.st-body', st).classList.remove('muted');
        $('.st-body', st).innerHTML = '<table class="data"><tbody>' +
          '<tr><td>You are viewing</td><td>' + (IS_DRAFT ? '<span class="pill warn">Draft</span> (not visible to students)' : '<span class="pill good">Live</span> (what students see)') + '</td></tr>' +
          '<tr><td>Draft</td><td>' + (s.draft ? 'Unpublished changes · last saved ' + esc(fmtTime(s.draft.at)) : 'No unpublished changes') + '</td></tr>' +
          '<tr><td>Last published</td><td>' + (lp ? esc(fmtTime(lp.at)) + (lp.message ? ' — “' + esc(lp.message) + '”' : '') + (lp.url ? ' · <a href="' + esc(lp.url) + '" target="_blank" rel="noopener">GitHub commit</a>' : '') : 'Not yet published from the editor') + '</td></tr>' +
          '<tr><td>GitHub</td><td>' + (s.github.configured ? '✓ Publishing to <b>' + esc(s.github.repo) + '</b> (branch ' + esc(s.github.branch) + ')' : '<span class="bad">Not set up</span> — add GITHUB_TOKEN and GITHUB_REPO to the Script Properties of your Apps Script project (SETUP.md, step 4).') + '</td></tr>' +
          '<tr><td>Content key</td><td>' + (s.keyOk ? '✓ Set (CONTENT_KEYS in Code.gs)' : '<span class="bad">Missing or malformed</span> — see SETUP.md, step 3.') + '</td></tr></tbody></table>';
      });
      CX.api('vulvaAdminHistory').then(function (r) {
        var b = $('.hist-body', hist); b.classList.remove('muted');
        if (!r.ok) { b.textContent = r.error; return; }
        var rows = r.local.map(function (x) { return { t: x.at, label: x.kind === 'published' ? '🚀 Published' + (x.message ? ': “' + x.message + '”' : '') : '💾 Draft' + (x.note ? ' (' + x.note + ')' : ''), id: x.id }; });
        b.innerHTML = '';
        if (Array.isArray(r.github) && r.github.length) {
          b.appendChild(h('<h3>Published versions on GitHub</h3>'));
          var tg = h('<div class="tablewrap"><table class="data"><tbody></tbody></table></div>');
          r.github.forEach(function (c) { var tr = h('<tr><td>' + esc(fmtTime(Date.parse(c.date))) + '</td><td>' + esc(c.message) + '</td><td><a href="' + esc(c.url) + '" target="_blank" rel="noopener">view</a></td><td>' + (IS_DRAFT ? '<button class="btn small" type="button">Restore into draft</button>' : '') + '</td></tr>'); var bt = $('button', tr); if (bt) bt.onclick = function () { restore(function () { return CX.loadCommit(c.sha); }, 'the GitHub version from ' + fmtTime(Date.parse(c.date))); }; $('tbody', tg).appendChild(tr); });
          b.appendChild(tg);
        } else if (r.github && r.github.error) b.appendChild(h('<p class="small err">GitHub history could not be loaded: ' + esc(r.github.error) + '</p>'));
        b.appendChild(h('<h3>Saved in your spreadsheet</h3>'));
        if (!rows.length) b.appendChild(h('<p class="muted small">No saved versions yet.</p>'));
        var t = h('<div class="tablewrap"><table class="data"><tbody></tbody></table></div>');
        rows.forEach(function (x) { var tr = h('<tr><td>' + esc(fmtTime(x.t)) + '</td><td>' + esc(x.label) + '</td><td>' + (IS_DRAFT ? '<button class="btn small" type="button">Restore into draft</button>' : '') + '</td></tr>'); var bt = $('button', tr); if (bt) bt.onclick = function () { restore(function () { return CX.api('vulvaAdminSnapshot', { id: x.id }).then(function (y) { if (!y.ok) throw new Error(y.error); return y.content; }); }, 'the version from ' + fmtTime(x.t)); }; $('tbody', t).appendChild(tr); });
        if (rows.length) b.appendChild(t);
      });
      function restore(load, label) {
        A.confirmBox('Restore ' + label + '?', 'This replaces the current draft with that version (the current draft stays in the history). Students see nothing until you publish.', 'Restore into draft', function () {
          load().then(function (content) {
            if (!content || !content.lectures) throw new Error('That version could not be read.');
            snapshot(); replaceD(JSON.stringify(content)); changed(false);
            return save(true).then(function (ok) { if (ok) { toast('Restored into the draft.'); setTimeout(function () { location.reload(); }, 600); } });
          }).catch(function (e) { toast(e.message || String(e)); });
        });
      }
    }
    function courseSettings() {
      if (!IS_DRAFT) return toast('Open the draft to change settings.');
      var M = D.meta, spec = [
        { k: 'title', label: 'Course title (home page)', required: true }, { k: 'short', label: 'Short title (top bar)', required: true }, { k: 'subject', label: 'Subject (in sentences, lower case)' },
        { k: 'audience', label: 'Audience' }, { k: 'author', label: 'Teacher' }, { k: 'role', label: 'Teacher role' }, { k: 'dept', label: 'Department' }, { k: 'contentNote', label: 'Content source note (footer)' }
      ], rec = Object.assign({}, M);
      Object.keys(D.topics).forEach(function (k) { spec.push({ k: 'topic_' + k, label: 'Results topic: ' + D.topics[k].name }); rec['topic_' + k] = D.topics[k].name; });
      formEditor('Course settings', spec, rec, function (v) {
        change(function () {
          ['title', 'short', 'subject', 'audience', 'author', 'role', 'dept', 'contentNote'].forEach(function (k) { M[k] = v[k]; });
          Object.keys(D.topics).forEach(function (k) { if (v['topic_' + k]) D.topics[k].name = v['topic_' + k]; });
        });
        toast('Settings saved to the draft. Assessment titles and times are set in Teacher portal → Assessments.');
      }, { wide: true });
    }

    /* ================= wiring into the app ================= */
    HOOKS.route = function (v, parts) {
      if (v !== 'faculty') return false;
      if (parts[1] === 'content') { viewContentAdmin(); return true; }
      if (parts[1] === 'questions') { viewQuestionBanks(parts[2]); return true; }
      if (parts[1] === 'media' || parts[1] === 'pictures') { viewMedia(parts[2]); return true; }
      return false;
    };
    HOOKS.afterRender = function (v, parts) {
      updateBar();
      if (!isEditing()) return;
      var app = A.app();
      if (v === 'lecture') decorateLecture();
      if (v === 'learn') decorateLearn();
      if (v === 'review' || v === 'facts') decorateReview(v === 'facts' ? 'facts' : parts[1]);
      if (v !== 'faculty') decorateQuestions(app);
      if (v === 'practice' && parts[1] === 'checks' || v === 'revision') {
        // Pathology Challenge list: add a question to any section
        var b = h('<div class="ed-row ed-bar2 noprint"><button class="btn small primary" type="button">＋ Add section check</button><a class="btn small" href="#/faculty/questions/checks">Open the question bank</a></div>');
        $('button', b).onclick = function () { questionEditor(template('checks'), 'checks', true); };
        var tabs = $('.tabs', app); if (tabs) tabs.parentNode.insertBefore(b, tabs.nextSibling);
      }
    };
    // Re-decorate question cards that appear later (practice runner, Pathology Challenge tab switches).
    var mo = new MutationObserver(function () { if (isEditing() && !openPanel) decorateQuestions(A.app()); });
    mo.observe(A.app(), { childList: true, subtree: true });
    updateBar();
  };
})();
(function () {
  'use strict';
  /* ---------- pictures: data: URL → content-addressed, encrypted file; uploaded in batches ---------- */
  var EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  function b64(u8) { var s = '', CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function mediaTools(CX) {
    /* data: URL → { file: '<sha-256, 32 hex>.<ext>', type, bytes, blob, enc (base64 of IV ‖ AES-GCM ciphertext) } */
    function prepare(dataUrls) {
      return Promise.all(dataUrls.map(function (dataUrl) {
        var m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl); if (!m || !EXT[m[1]]) return Promise.reject(new Error('Use a JPG, PNG, GIF or WebP picture.'));
        var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return crypto.subtle.digest('SHA-256', u8).then(function (hb) {
          var hex = Array.prototype.map.call(new Uint8Array(hb), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 32);
          return CX.encrypt(u8).then(function (enc) { return { file: hex + '.' + EXT[m[1]], type: m[1], bytes: u8.length, blob: new Blob([u8], { type: m[1] }), enc: b64(enc) }; });
        });
      }));
    }
    /* Sends encrypted pictures to the backend in batches (one GitHub commit per batch). */
    function put(list, onProgress) {
      var batches = [], cur = [], size = 0;
      list.forEach(function (f) { if (cur.length && (cur.length >= 12 || size + f.enc.length > 6e6)) { batches.push(cur); cur = []; size = 0; } cur.push(f); size += f.enc.length; });
      if (cur.length) batches.push(cur);
      var done = 0;
      return batches.reduce(function (pr, batch) {
        return pr.then(function () {
          return CX.api('vulvaAdminMediaPut', { files: batch.map(function (f) { return { path: 'content/media/' + f.file + '.enc', base64: f.enc }; }) }).then(function (r) {
            if (!r.ok) throw new Error(r.error || 'The pictures could not be saved.');
            batch.forEach(function (f) { CX.media.prime('media/' + f.file, f.blob); });
            done += batch.length; if (onProgress) onProgress(done, list.length);
          });
        });
      }, Promise.resolve()).then(function () { return list; });
    }
    return { prepare: prepare, put: put, b64: b64 };
  }
  window.VULVA_MEDIA = mediaTools;

  /* ---------- import a course from a file ----------
     Accepts: the connected edition page (…-connected.html: content encrypted with this module's key, opened here
     with the key from the sign-in), the offline edition page (content embedded in plain text), or a content .json.
     Practice/assessment questions are never put into the published content — they belong in the question bank. */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function scriptText(html, id) {
    var m = new RegExp('<script[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</script>').exec(html);
    return m ? m[1].trim() : null;
  }
  function readCourse(CX, text) {
    var t = text.trim();
    if (t.charAt(0) === '{') return Promise.resolve(JSON.parse(t));
    var data = scriptText(t, 'cvs-data'), enc = scriptText(t, 'cvs-enc'), extraPics = scriptText(t, 'cvs-pics');
    var p = data ? Promise.resolve(JSON.parse(data)) : enc ? CX.decrypt(Uint8Array.from(atob(enc), function (c) { return c.charCodeAt(0); }).buffer).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () {
      throw new Error('This page is encrypted with a different key than this module’s (CONTENT_KEYS in Code.gs). Use the connected page of THIS module.');
    }) : Promise.reject(new Error('No course content was found in this file.'));
    return p.then(function (D) { if (extraPics) { try { D.pics = Object.assign(D.pics || {}, JSON.parse(extraPics)); } catch (e) { } } return D; });
  }
  function convert(CX, D, log) {
    if (!D || !Array.isArray(D.lectures) || !D.meta) return Promise.reject(new Error('This file does not contain a course.'));
    var notes = [], q = (D.questions || []).length, pr = (D.practice || []).length;
    if (q || pr) notes.push(q + ' assessment and ' + pr + ' practice question(s) in the file were NOT put into the content (their answers must stay private). The question bank on the platform is managed in Teacher portal → Question bank / Import.');
    delete D.questions; delete D.practice; delete D.tests;
    D.checks = D.checks || []; D.review = D.review || {}; D.concepts = D.concepts || {}; D.topics = D.topics || {}; D.pics = D.pics || {}; D.media = D.media || {};
    D.meta.edition = 'connected';
    // every embedded picture (picture slots and slide pictures) becomes an encrypted library file
    var refs = [];
    Object.keys(D.pics).forEach(function (k) { var p = D.pics[k]; if (!p) { delete D.pics[k]; return; } if (/^data:image\//.test(p.src || '')) refs.push({ o: p, title: p.caption || '' }); });
    Object.keys(D.decks || {}).forEach(function (n) { ((D.decks[n] || {}).slides || []).forEach(function (s) { (s.images || []).forEach(function (im) { if (/^data:image\//.test(im.src || '')) refs.push({ o: im, title: im.caption || '' }); }); }); });
    var bad = Object.keys(D.pics).filter(function (k) { return !/^(data:image\/|media\/[a-f0-9]{32}\.)/.test(D.pics[k].src || ''); });
    bad.forEach(function (k) { delete D.pics[k]; });
    if (bad.length) notes.push(bad.length + ' picture(s) pointed to files outside the library and were left out (add them again with “Add picture”).');
    var T = mediaTools(CX), uniq = {}, list = [];
    log('Encrypting ' + refs.length + ' picture(s)…');
    return T.prepare(refs.map(function (r) { return r.o.src; })).then(function (files) {
      files.forEach(function (f, i) { refs[i].o.src = 'media/' + f.file; if (!uniq[f.file]) { uniq[f.file] = 1; list.push(f); D.media[f.file] = D.media[f.file] || { title: refs[i].title, alt: '', description: '', type: f.type, bytes: f.bytes, uploadedAt: Date.now() }; } });
      log('Uploading ' + list.length + ' encrypted picture(s) to GitHub…');
      return T.put(list, function (n, all) { log('Uploading encrypted pictures to GitHub… ' + n + ' / ' + all); });
    }).then(function () { return { content: D, notes: notes, pictures: list.length }; });
  }
  function importCourse(CX, onDone, opts) {
    opts = opts || {};
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true" aria-label="Import the course"><h3>' + (opts.first ? 'Set up the course' : 'Import course from a file') + '</h3><div class="mbody">' +
      (opts.first ? '<p>Nothing has been published from this platform yet. Choose the course file to start from:</p>' : '<p>This replaces the draft with the course in the file (the current draft stays in the history).</p>') +
      '<ul class="small"><li><b>Your connected page</b> (for example <code>' + esc(CX.module) + '-connected.html</code>) — recommended. It is opened here with this module’s key; nothing readable leaves your browser.</li><li>Or the offline edition page, or a content <code>.json</code> file.</li></ul>' +
      '<p class="small muted">Pictures are encrypted in this browser and stored in the GitHub repository by the platform (this needs the GitHub settings — SETUP.md, step 4). Practice and assessment questions are not imported here: they stay in the question bank (Teacher portal → Import).</p>' +
      '<label class="btn primary">📄 Choose the file<input type="file" accept=".html,.htm,.json,text/html,application/json" hidden></label><div class="imp-log small" style="margin-top:12px" aria-live="polite"></div></div>' +
      '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn imp-x" type="button">' + (opts.first ? 'Sign out' : 'Cancel') + '</button></div></div>';
    document.body.appendChild(bg);
    var logEl = bg.querySelector('.imp-log'), busy = false;
    function log(t, cls) { logEl.innerHTML = '<p class="' + (cls || '') + '">' + esc(t) + '</p>'; }
    bg.querySelector('.imp-x').onclick = function () { if (busy) return; if (opts.first) CX.logout(); else bg.remove(); };
    bg.querySelector('input').onchange = function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f || busy) return;
      busy = true; log('Reading ' + f.name + '…');
      f.text().then(function (text) { return readCourse(CX, text); }).then(function (D) { return convert(CX, D, log); }).then(function (r) {
        busy = false;
        logEl.innerHTML = '<p class="good"><b>✓ Ready:</b> ' + r.content.lectures.length + ' lecture(s), ' + r.content.checks.length + ' section check(s), ' + r.pictures + ' picture(s) uploaded (encrypted).</p>' + r.notes.map(function (n) { return '<p class="note">' + esc(n) + '</p>'; }).join('') + '<button class="btn primary imp-go" type="button">Put it into the draft</button>';
        logEl.querySelector('.imp-go').onclick = function () { bg.remove(); onDone(r.content); };
      }).catch(function (er) { busy = false; log(er.message || String(er), 'err'); });
    };
  }
  window.VULVA_IMPORT = importCourse;
  /* boot.js calls this for a teacher when there is no content anywhere yet (first-time setup). */
  window.VULVA_SETUP = function (CX) {
    var admin = CX.admin || {};
    if (admin.github && !admin.github.configured) {
      var bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>Almost there</h3><div class="mbody"><p>Before the course can be set up, the platform needs to be able to publish to GitHub. Add <b>GITHUB_TOKEN</b> and <b>GITHUB_REPO</b> to the Script Properties of your Apps Script project (SETUP.md, step 4), then reload this page.</p></div><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary" type="button">Reload</button></div></div>';
      bg.querySelector('button').onclick = function () { location.reload(); };
      document.body.appendChild(bg); return;
    }
    importCourse(CX, function (content) {
      CX.api('vulvaAdminContentSave', { content: content, baseRev: CX.rev || 0, checkpoint: true }).then(function (r) {
        if (!r.ok) { window.alert((r.error || 'The draft could not be saved.') + (r.issues ? '\n• ' + r.issues.join('\n• ') : '')); location.reload(); return; }
        CX.setView('draft');
      });
    }, { first: true });
  };
})();
