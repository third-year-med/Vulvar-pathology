/* Sign-in and start-up.
   1. Ask the server whether this browser has a session (HttpOnly cookie; the browser cannot read it).
   2. If not, show the sign-in screen: Student (shared password) or Teacher (username + password).
      Passwords are checked by the server only — nothing secret is in this file.
   3. Load the content the server allows (students: live version; teachers: the draft or the live version),
      load the teacher editor if (and only if) the server says this is a teacher session, and start the app. */
(function () {
  'use strict';
  var VIEW_KEY = 'vp_view'; // teachers: 'draft' (default) or 'live'
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function call(method, url, body, csrf) {
    var h = { Accept: 'application/json' };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (csrf) h['X-CSRF-Token'] = csrf;
    return fetch(url, { method: method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected reply from the server (' + r.status + ').' }; }).then(function (j) { j.status = r.status; return j; }); })
      .catch(function () { return { ok: false, status: 0, error: 'The server could not be reached. Check your connection and try again.' }; });
  }
  var root = null;
  function screen(html) {
    if (!root) { root = document.createElement('div'); root.id = 'cvs-boot'; document.body.appendChild(root); }
    root.innerHTML = '<div class="boot-card"><div class="boot-brand"><svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#0e7c7b"/><path d="M20 31s-10-6.4-10-13a5.6 5.6 0 0 1 10-3.4A5.6 5.6 0 0 1 30 18c0 6.6-10 13-10 13z" fill="#fff"/></svg><div><div class="boot-t">Vulvar Pathology — Exam Review</div><div class="boot-s">Private teaching platform</div></div></div>' + html + '</div>';
    return root;
  }
  function msg(text, cls) { return text ? '<p class="' + (cls || 'boot-note') + '">' + esc(text) + '</p>' : ''; }

  function showLogin(tab, note) {
    var t = tab === 'admin' ? 'admin' : 'student';
    var r = screen(msg(note) + '<div class="boot-tabs" role="tablist"><button type="button" role="tab" data-t="student" aria-selected="' + (t === 'student') + '" class="' + (t === 'student' ? 'on' : '') + '">Student</button><button type="button" role="tab" data-t="admin" aria-selected="' + (t === 'admin') + '" class="' + (t === 'admin' ? 'on' : '') + '">Teacher</button></div>' +
      (t === 'student'
        ? '<form class="bf" novalidate><h1>Student sign-in</h1><p class="boot-muted">Enter the class password your teacher gave you.</p><label>Class password<input id="b-pw" type="password" autocomplete="current-password" required></label><p class="boot-err" id="b-e" role="alert"></p><button class="bbtn primary" type="submit">Sign in</button></form>'
        : '<form class="bf" novalidate><h1>Teacher sign-in</h1><p class="boot-muted">For teaching staff: editing, pictures, questions and publishing.</p><label>Username<input id="b-u" autocomplete="username" required></label><label>Password<input id="b-pw" type="password" autocomplete="current-password" required></label><p class="boot-err" id="b-e" role="alert"></p><button class="bbtn primary" type="submit">Sign in</button></form>') +
      '<p class="boot-foot">This platform is private. Your practice progress is kept in this browser.</p>');
    [].forEach.call(r.querySelectorAll('.boot-tabs button'), function (b) { b.onclick = function () { showLogin(b.dataset.t); }; });
    var f = r.querySelector('form'), e = r.querySelector('#b-e'), btn = f.querySelector('button[type=submit]');
    setTimeout(function () { var i = f.querySelector('input'); if (i) i.focus(); }, 0);
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var pw = f.querySelector('#b-pw').value, u = t === 'admin' ? f.querySelector('#b-u').value.trim() : '';
      if (!pw || (t === 'admin' && !u)) { e.textContent = t === 'admin' ? 'Enter your username and password.' : 'Enter the class password.'; return; }
      e.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
      call('POST', '/api/login', { kind: t, username: u, password: pw }).then(function (x) {
        btn.disabled = false; btn.textContent = 'Sign in';
        if (!x.ok) { e.textContent = x.error || 'Sign-in failed.'; f.querySelector('#b-pw').select(); return; }
        start(x);
      });
    };
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.body.appendChild(s); }); }
  function loadCss(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }

  function start(sess) {
    var admin = sess.role === 'admin';
    var view = admin ? (sessionStorage.getItem(VIEW_KEY) || 'draft') : 'live';
    screen('<p class="boot-muted">⏳ Opening the course…</p>');
    var editor = admin ? (loadCss('/admin/editor.css'), loadScript('/admin/editor.js')) : Promise.resolve();
    Promise.all([call('GET', '/api/content' + (view === 'draft' ? '?version=draft' : '')), editor]).then(function (res) {
      var c = res[0];
      if (!c.ok) { if (c.status === 401) return showLogin(admin ? 'admin' : 'student', 'Your session has ended. Please sign in again.'); return fatal(c.error || 'The course could not be loaded.'); }
      var CX = {
        role: sess.role, name: sess.name, csrf: sess.csrf, permissions: sess.permissions || [],
        view: c.version, rev: c.rev || 0, savedAt: c.savedAt || null, savedBy: c.savedBy || null, fromLive: !!c.fromLive,
        api: function (method, url, body, raw) {
          // raw: { body: Blob, type } for uploads
          var h = { Accept: 'application/json', 'X-CSRF-Token': sess.csrf };
          var opts = { method: method, headers: h, credentials: 'same-origin' };
          if (raw) { h['Content-Type'] = raw.type; opts.body = raw.body; } else if (body !== undefined) { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
          return fetch(url, opts).then(function (r) {
            return r.json().catch(function () { return { ok: false, error: 'Unexpected reply from the server (' + r.status + ').' }; }).then(function (j) {
              j.status = r.status;
              if (r.status === 401) { setTimeout(function () { location.reload(); }, 1500); j.error = 'Your session has ended — reloading to sign in again.'; }
              return j;
            });
          }, function () { return { ok: false, status: 0, error: 'The server could not be reached. Your changes are kept in this page; try again.' }; });
        },
        setView: function (v) { sessionStorage.setItem(VIEW_KEY, v); location.reload(); },
        logout: function () { call('POST', '/api/logout', {}, sess.csrf).then(function () { sessionStorage.removeItem(VIEW_KEY); location.hash = ''; location.reload(); }); }
      };
      if (root) { root.remove(); root = null; }
      window.VULVA_MAIN(c.content, CX);
    }).catch(function (e) { fatal(e.message); });
  }
  function fatal(t) {
    var r = screen(msg(t, 'boot-err') + '<button class="bbtn primary" type="button">Try again</button>');
    r.querySelector('button').onclick = boot;
  }
  function boot() {
    screen('<p class="boot-muted">⏳ Connecting…</p>');
    call('GET', '/api/session').then(function (s) {
      if (s.status === 0) return fatal(s.error);
      if (s.authenticated) return start(s);
      showLogin('student');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
