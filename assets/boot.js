/* Sign-in and start-up (GitHub Pages front-end of the Apps Script backend).
   • Students sign in with their own Student ID + password; teachers with the module's teacher password.
     Passwords are checked by the backend only — nothing secret is in this file or anywhere on the site.
   • The published course on the site is ENCRYPTED (content/content.enc, content/media/*.enc). The backend
     releases the decryption key only to a signed-in session; it is kept in memory, never stored.
   • Teachers get their draft from the backend (Faculty tools), and the editor (editor.js) is loaded only for
     a teacher session — the backend re-checks the teacher session on every change anyway.
   Settings come from config.js (window.VULVA_CONFIG): backendUrl, module, repo, branch. */
(function () {
  'use strict';
  var CFG = window.VULVA_CONFIG || {};
  var MODULE = CFG.module || 'vulva';
  var ASSETS = CFG.assets || 'assets/';
  var SKEY = 'vp_' + MODULE + '_session', VIEW_KEY = 'vp_' + MODULE + '_view';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function ss(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  /* ---------- backend calls (Apps Script web app: JSON in a text/plain POST, so no CORS pre-flight) ---------- */
  function post(payload, opts) {
    if (!CFG.backendUrl) return Promise.resolve({ ok: false, code: 'config', error: 'The platform address is not configured yet (config.js → backendUrl).' });
    payload.module = MODULE;
    return fetch(CFG.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow', keepalive: !!(opts && opts.keepalive) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, code: 'badreply', error: 'Unexpected reply from the platform (' + r.status + ').' }; }); })
      .catch(function () { return { ok: false, code: 'network', error: 'The platform could not be reached. Check your connection and try again.' }; });
  }

  /* ---------- encryption (AES-GCM, 256-bit key from the backend; file = 12-byte IV ‖ ciphertext) ---------- */
  function b64ToBytes(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function makeCrypto(keyB64) {
    var keyP = crypto.subtle.importKey('raw', b64ToBytes(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return {
      decrypt: function (buf) {
        var u = new Uint8Array(buf);
        return keyP.then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, k, u.subarray(12)); });
      },
      encrypt: function (bytes) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return keyP.then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, bytes); }).then(function (ct) {
          var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12); return out;
        });
      }
    };
  }
  function siteFile(path, bust) {
    // From this site first; while GitHub Pages is still rebuilding after a publish, from the repository itself.
    var u = path + (bust ? '?v=' + encodeURIComponent(bust) : '');
    return fetch(u, { cache: bust ? 'default' : 'no-store' }).then(function (r) {
      if (r.ok) return r;
      if (CFG.repo) return fetch('https://raw.githubusercontent.com/' + CFG.repo + '/' + (CFG.branch || 'main') + '/' + path + (bust ? '?v=' + encodeURIComponent(bust) : ''), { cache: 'no-store' });
      return r;
    });
  }

  /* ---------- encrypted pictures: <img data-media="media/<hash>.jpg"> → decrypted blob URL ---------- */
  function mediaLoader(cx) {
    var cache = {}, TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    function get(src) {
      if (cache[src]) return cache[src];
      var file = String(src).replace(/^media\//, '');
      cache[src] = siteFile('content/media/' + file + '.enc', file).then(function (r) {
        if (!r.ok) throw new Error('missing');
        return r.arrayBuffer();
      }).then(cx.decrypt).then(function (plain) {
        return URL.createObjectURL(new Blob([plain], { type: TYPES[file.split('.').pop()] || 'application/octet-stream' }));
      });
      cache[src].catch(function () { delete cache[src]; });
      return cache[src];
    }
    function show(img) {
      var src = img.getAttribute('data-media'); if (!src || img.__m === src) return; img.__m = src;
      img.classList.add('loading');
      get(src).then(function (url) { if (img.getAttribute('data-media') === src) { img.src = url; img.classList.remove('loading'); } },
        function () { img.classList.remove('loading'); img.classList.add('broken'); img.title = 'This picture could not be loaded.'; });
    }
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); show(e.target); } }); }, { rootMargin: '800px 0px' }) : null;
    function scan(root) {
      var list = root.querySelectorAll ? root.querySelectorAll('img[data-media]') : [];
      if (root.matches && root.matches('img[data-media]')) list = [root].concat([].slice.call(list));
      [].forEach.call(list, function (img) { if (io && !document.querySelector('.pres, .lightbox')) io.observe(img); else show(img); });
    }
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'attributes') { m.target.__m = null; scan(m.target); }
        else [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); });
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-media'] });
    scan(document.body);
    return {
      url: get,
      /** a picture the teacher just uploaded: show it at once from memory */
      prime: function (src, blob) { cache[src] = Promise.resolve(URL.createObjectURL(blob)); }
    };
  }

  /* ---------- screens ---------- */
  var root = null;
  function screen(html) {
    if (!root) { root = document.createElement('div'); root.id = 'cvs-boot'; document.body.appendChild(root); }
    root.innerHTML = '<div class="boot-card"><div class="boot-brand"><svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#0e7c7b"/><path d="M20 31s-10-6.4-10-13a5.6 5.6 0 0 1 10-3.4A5.6 5.6 0 0 1 30 18c0 6.6-10 13-10 13z" fill="#fff"/></svg><div><div class="boot-t">' + esc(CFG.title || 'Vulvar Pathology — Exam Review') + '</div><div class="boot-s">Private teaching platform</div></div></div>' + html + '</div>';
    return root;
  }
  function msg(text, cls) { return text ? '<p class="' + (cls || 'boot-note') + '">' + esc(text) + '</p>' : ''; }
  function form(r, onSubmit) {
    var f = r.querySelector('form'), e = r.querySelector('.boot-err'), btn = f.querySelector('button[type=submit]'), label = btn.textContent;
    setTimeout(function () { var i = f.querySelector('input'); if (i) i.focus(); }, 0);
    f.onsubmit = function (ev) {
      ev.preventDefault(); e.textContent = '';
      var busy = function (on) { btn.disabled = on; btn.textContent = on ? 'Please wait…' : label; };
      onSubmit(f, function (t) { e.textContent = t || ''; }, busy);
    };
  }

  function showLogin(tab, note) {
    var t = tab === 'admin' ? 'admin' : 'student';
    var r = screen(msg(note) + '<div class="boot-tabs" role="tablist"><button type="button" role="tab" data-t="student" aria-selected="' + (t === 'student') + '" class="' + (t === 'student' ? 'on' : '') + '">Student</button><button type="button" role="tab" data-t="admin" aria-selected="' + (t === 'admin') + '" class="' + (t === 'admin' ? 'on' : '') + '">Teacher</button></div>' +
      (t === 'student'
        ? '<form class="bf" novalidate><h1>Student sign-in</h1><p class="boot-muted">Use the Student ID and password your teacher gave you.</p><label>Student ID<input id="b-u" autocomplete="username" autocapitalize="none" spellcheck="false" required></label><label>Password<input id="b-pw" type="password" autocomplete="current-password" required></label><label class="chk"><input id="b-rem" type="checkbox"> Keep me signed in on this device</label><p class="boot-err" role="alert"></p><button class="bbtn primary" type="submit">Sign in</button></form>'
        : '<form class="bf" novalidate><h1>Teacher sign-in</h1><p class="boot-muted">For teaching staff: editing, questions, assessments, results, student accounts and publishing.</p><label>Teacher password<input id="b-pw" type="password" autocomplete="current-password" required></label><p class="boot-err" role="alert"></p><button class="bbtn primary" type="submit">Sign in</button><p class="boot-muted small"><a href="#" class="b-setup">First time? Create the teacher password</a></p></form>') +
      '<p class="boot-foot">This platform is private. Your progress and results are saved to your account.</p>');
    [].forEach.call(r.querySelectorAll('.boot-tabs button'), function (b) { b.onclick = function () { showLogin(b.dataset.t); }; });
    if (t === 'admin') r.querySelector('.b-setup').onclick = function (ev) { ev.preventDefault(); showSetup(); };
    form(r, function (f, err, busy) {
      var pw = f.querySelector('#b-pw').value, u = t === 'student' ? f.querySelector('#b-u').value.trim() : '';
      if (!pw || (t === 'student' && !u)) return err(t === 'student' ? 'Enter your Student ID and password.' : 'Enter the teacher password.');
      busy(true);
      var req = t === 'student' ? { action: 'studentLogin', username: u, password: pw, remember: f.querySelector('#b-rem').checked } : { action: 'login', password: pw };
      post(req).then(function (x) {
        busy(false);
        if (!x.ok) { err(x.code === 'needsSetup' ? 'No teacher password exists yet — use “First time? Create the teacher password”.' : x.error || 'Sign-in failed.'); f.querySelector('#b-pw').select(); return; }
        if (t === 'student') {
          var sess = { role: 'student', stoken: x.token, username: x.student.username, name: x.student.name, remember: !!req.remember };
          (req.remember ? ls : ss)(SKEY, sess);
          if (x.mustChange) return showChangePassword(sess, pw);
          start(sess, x.contentKey);
        } else {
          var tsess = { role: 'admin', token: x.token, username: 'teacher', name: 'Teacher' };
          ss(SKEY, tsess); start(tsess, x.contentKey);
        }
      });
    });
  }
  function showSetup() {
    var r = screen('<form class="bf" novalidate><h1>Create the teacher password</h1><p class="boot-muted">This works only once, while no teacher password exists for this module. Use at least 8 characters; keep it private.</p><label>New teacher password<input id="b-pw" type="password" autocomplete="new-password" required></label><label>Repeat it<input id="b-pw2" type="password" autocomplete="new-password" required></label><p class="boot-err" role="alert"></p><button class="bbtn primary" type="submit">Create password</button><p class="boot-muted small"><a href="#" class="b-back">← Back to sign-in</a></p></form>');
    r.querySelector('.b-back').onclick = function (ev) { ev.preventDefault(); showLogin('admin'); };
    form(r, function (f, err, busy) {
      var a = f.querySelector('#b-pw').value, b = f.querySelector('#b-pw2').value;
      if (a.length < 8) return err('Use at least 8 characters.');
      if (a !== b) return err('The two passwords are different.');
      busy(true);
      post({ action: 'setup', password: a }).then(function (x) { busy(false); if (!x.ok) return err(x.error); showLogin('admin', 'Teacher password created. Sign in with it now.'); });
    });
  }
  function showChangePassword(sess, oldPw, optional) {
    var r = screen('<form class="bf" novalidate><h1>' + (optional ? 'Change your password' : 'Choose your own password') + '</h1><p class="boot-muted">' + (optional ? 'At least 8 characters, not your Student ID. Your other devices will be signed out.' : 'Hello ' + esc(sess.name) + '. Before you start, replace the temporary password from your teacher with one only you know (at least 8 characters, not your Student ID).') + '</p>' + (oldPw ? '' : '<label>Current password<input id="b-old" type="password" autocomplete="current-password" required></label>') + '<label>New password<input id="b-pw" type="password" autocomplete="new-password" required></label><label>Repeat it<input id="b-pw2" type="password" autocomplete="new-password" required></label><p class="boot-err" role="alert"></p><button class="bbtn primary" type="submit">' + (optional ? 'Change password' : 'Save and continue') + '</button>' + (optional ? ' <button class="bbtn b-cx" type="button">Cancel</button>' : '') + '</form>');
    if (optional) { r.classList.add('over'); r.querySelector('.b-cx').onclick = function () { r.remove(); root = null; }; }
    form(r, function (f, err, busy) {
      var o = oldPw || f.querySelector('#b-old').value, a = f.querySelector('#b-pw').value, b = f.querySelector('#b-pw2').value;
      if (a.length < 8) return err('Use at least 8 characters.');
      if (a !== b) return err('The two passwords are different.');
      busy(true);
      post({ action: 'studentChangePassword', stoken: sess.stoken, oldPassword: o, newPassword: a }).then(function (x) {
        busy(false);
        if (!x.ok) return err(x.error);
        // the backend signs out every other session; this one stays valid
        if (optional) { r.remove(); root = null; window.alert('Your password has been changed. Your other devices have been signed out.'); return; }
        start(sess, x.contentKey);
      });
    });
  }
  function fatal(t, retry) {
    var r = screen(msg(t, 'boot-err') + '<div class="row"><button class="bbtn primary" type="button">Try again</button> <button class="bbtn b-out" type="button">Sign out</button></div>');
    r.querySelector('.primary').onclick = retry || boot;
    r.querySelector('.b-out').onclick = function () { clearSession(); boot(); };
  }
  function clearSession() { ls(SKEY, null); ss(SKEY, null); ss(VIEW_KEY, null); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.body.appendChild(s); }); }
  function loadCss(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }

  /* ---------- the published (encrypted) course ---------- */
  function loadPublished(cx) {
    return siteFile('content/version.json').then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('The course could not be downloaded (' + r.status + ').');
      return r.json();
    }).then(function (v) {
      if (!v) return null;
      return siteFile('content/content.enc', v.publishedAt).then(function (r) {
        if (!r.ok) throw new Error('The course could not be downloaded (' + r.status + ').');
        return r.arrayBuffer();
      }).then(cx.decrypt).then(function (plain) {
        var D = JSON.parse(new TextDecoder().decode(plain)); D.__published = v; return D;
      }, function (e) {
        if (e && e.name === 'OperationError') throw new Error('The course could not be unlocked: the published copy was encrypted with a different key. Ask your teacher to publish again.');
        throw e;
      });
    });
  }

  function start(sess, keyB64) {
    var admin = sess.role === 'admin';
    if (!keyB64) return fatal(admin ? 'The content key for this module is missing on the platform (CONTENT_KEYS in Code.gs). See SETUP.md, step 3.' : 'The course is not available yet. Please contact your teacher.');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(keyB64)) return fatal(admin ? 'The content key for this module on the platform is not a real key yet (CONTENT_KEYS in Code.gs still holds a placeholder). See SETUP.md, step 2.' : 'The course is not available yet. Please contact your teacher.');
    var cx = makeCrypto(keyB64);
    var view = admin ? (ss(VIEW_KEY) || 'draft') : 'live';
    screen('<p class="boot-muted">⏳ Opening the course…</p>');
    var CX = {
      role: sess.role, username: sess.username, name: sess.name, module: MODULE, view: view, config: { repo: CFG.repo || '', branch: CFG.branch || 'main', assets: ASSETS },
      api: function (action, payload, opts) {
        var p = {}; for (var k in payload || {}) if (Object.prototype.hasOwnProperty.call(payload, k)) p[k] = payload[k];
        // the code names Gyn actions "vulva…"; Gyn.gs expects the module's own prefix ("vagina…" for the vagina site)
        p.action = String(action).replace(/^vulva(?=[A-Z])/, MODULE.split('-')[0]); if (admin) p.token = sess.token; else p.stoken = sess.stoken;
        return post(p, opts).then(function (j) {
          if (j && (j.code === 'auth' || j.code === 'studentauth' || j.code === 'mustchange')) {
            j.error = 'Your session has ended — please sign in again.';
            if (!CX.__ending) { CX.__ending = true; setTimeout(function () { clearSession(); location.reload(); }, 1800); }
          }
          return j;
        });
      },
      encrypt: cx.encrypt, decrypt: cx.decrypt,
      changePassword: function () { if (!admin) showChangePassword(sess, '', true); },
      setView: function (v) { ss(VIEW_KEY, v); location.reload(); },
      logout: function () {
        var done = function () { clearSession(); location.hash = ''; location.reload(); };
        (admin ? post({ action: 'logout', token: sess.token }) : post({ action: 'studentLogout', stoken: sess.stoken })).then(done, done);
      }
    };
    CX.media = mediaLoader(cx);
    CX.loadPublished = function () { return loadPublished(cx); };
    /** an earlier published version, straight from the repository history (decrypted here) */
    CX.loadCommit = function (sha) {
      if (!CFG.repo) return Promise.reject(new Error('config.js has no repo setting.'));
      return fetch('https://raw.githubusercontent.com/' + CFG.repo + '/' + encodeURIComponent(sha) + '/content/content.enc').then(function (r) {
        if (!r.ok) throw new Error('That version could not be downloaded (' + r.status + ').');
        return r.arrayBuffer();
      }).then(cx.decrypt).then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
    };
    var editor = admin ? (loadCss(ASSETS + 'editor.css'), loadScript(ASSETS + 'editor.js')) : Promise.resolve();
    var contentP;
    if (admin && view === 'draft') {
      contentP = CX.api('vulvaAdminContentGet').then(function (r) {
        if (!r.ok) throw new Error(r.error || 'Your draft could not be loaded.');
        // { draft: {rev, at, content} | null, live: {at, content} | null, github, keyOk, lastPublished }
        CX.admin = r; CX.rev = r.draft ? r.draft.rev : 0; CX.savedAt = r.draft ? r.draft.at : null; CX.fromLive = !r.draft;
        if (r.draft) return r.draft.content;
        if (r.live) return r.live.content;
        return loadPublished(cx);   // published before this spreadsheet kept copies (or by another tool)
      });
    } else contentP = loadPublished(cx);
    Promise.all([contentP, editor]).then(function (res) {
      var D = res[0];
      if (root) { root.remove(); root = null; }
      if (!D) {
        if (admin && typeof window.VULVA_SETUP === 'function') return window.VULVA_SETUP(CX);
        return fatal(admin ? 'Nothing has been published yet. Switch to your draft (Faculty tools) to set up the course.' : 'The course has not been published yet. Please check again later.', function () { if (admin) CX.setView('draft'); else boot(); });
      }
      window.VULVA_MAIN(D, CX);
    }).catch(function (e) { fatal(e.message || String(e)); });
  }

  function boot() {
    var sess = ss(SKEY) || ls(SKEY);
    if (!sess) return showLogin('student');
    screen('<p class="boot-muted">⏳ Connecting…</p>');
    // Confirms the session and fetches the content key (it is never stored in the browser).
    post({ action: 'studentSession', token: sess.role === 'admin' ? sess.token : undefined, stoken: sess.role === 'admin' ? undefined : sess.stoken }).then(function (x) {
      if (x.code === 'network' || x.code === 'config' || x.code === 'badreply') return fatal(x.error);
      if (!x.ok) { clearSession(); return showLogin(sess.role === 'admin' ? 'admin' : 'student', 'Your session has ended. Please sign in again.'); }
      if (sess.role === 'student' && x.mustChange) return showChangePassword(sess, '');
      start(sess, x.contentKey);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
