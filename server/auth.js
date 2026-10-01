'use strict';
/* Authentication and authorization.
   - Principals: the shared student login (one common password, no personal identity) and named
     teacher/admin accounts. Individual student accounts can be added later as more principals with
     role "student" — sessions, permissions and every API check already work per principal.
   - Sessions: random 256-bit tokens in an HttpOnly cookie; only a SHA-256 of the token is stored.
   - Every protected API call is checked here, on the server, against the role's permissions. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLES = {
  student: ['content:read'],
  admin: ['content:read', 'content:edit', 'media:write', 'draft:write', 'publish', 'admin']
};
function can(role, perm) { return (ROLES[role] || []).indexOf(perm) >= 0; }

/* ---------- passwords (scrypt) ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), dk.toString('base64')].join('$');
}
function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = +parts[1], r = +parts[2], p = +parts[3], salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  if (!want.length) return false;
  const dk = crypto.scryptSync(String(pw), salt, want.length, { N: N, r: r, p: p, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(dk, want);
}
// A plain password from the environment is hashed once at start-up so all checks take the same path.
function credential(c) { return c.hash || (c.plain ? hashPassword(c.plain) : ''); }
function fingerprint(h) { return crypto.createHash('sha256').update(String(h)).digest('hex').slice(0, 16); }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function createAuth(cfg) {
  const studentHash = credential(cfg.studentPassword);
  const admins = cfg.admins.filter(function (a) { return a.username && (a.hash || a.plain); })
    .map(function (a) { return { username: a.username, name: a.name, role: 'admin', hash: credential(a) }; });
  // Optional extra teacher accounts: DATA_DIR/users.json = [{ "username", "name", "role": "admin", "passwordHash" }]
  const usersFile = path.join(cfg.dataDir, 'users.json');
  function extraUsers() {
    try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')).filter(function (u) { return u && u.username && u.passwordHash && ROLES[u.role]; }); } catch (e) { return []; }
  }
  function findUser(username) {
    username = String(username || '').trim().toLowerCase();
    const a = admins.filter(function (x) { return x.username === username; })[0];
    if (a) return a;
    const u = extraUsers().filter(function (x) { return String(x.username).toLowerCase() === username; })[0];
    return u ? { username: username, name: u.name || username, role: u.role, hash: u.passwordHash } : null;
  }
  const DUMMY = hashPassword(crypto.randomBytes(8).toString('hex'));

  /* ---------- sessions ---------- */
  const sessFile = path.join(cfg.dataDir, 'sessions.json');
  let sessions = {};
  try { sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8')) || {}; } catch (e) { sessions = {}; }
  let saveT = null;
  function persist() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(sessFile + '.tmp', JSON.stringify(sessions)); fs.renameSync(sessFile + '.tmp', sessFile); } catch (e) { /* sessions then live in memory only */ }
    }, 200);
    if (saveT.unref) saveT.unref();
  }
  function credVersion(p) { return p.role === 'student' && p.shared ? fingerprint(studentHash) : fingerprint(p.hash); }
  function createSession(p) {
    const token = crypto.randomBytes(32).toString('base64url');
    const hours = cfg.sessionHours[p.role] || 12;
    sessions[sha(token)] = { uid: p.uid, role: p.role, name: p.name, shared: !!p.shared, csrf: crypto.randomBytes(24).toString('base64url'), created: Date.now(), expires: Date.now() + hours * 3600e3, cv: credVersion(p) };
    persist();
    return { token: token, maxAge: hours * 3600 };
  }
  function getSession(token) {
    if (!token) return null;
    const k = sha(token), s = sessions[k];
    if (!s) return null;
    // A changed password (student or teacher) ends the sessions made with the old one.
    let valid = s.expires > Date.now();
    if (valid && s.shared) valid = s.cv === fingerprint(studentHash);
    else if (valid) { const u = findUser(s.uid); valid = !!u && u.role === s.role && s.cv === fingerprint(u.hash); }
    if (!valid) { delete sessions[k]; persist(); return null; }
    return Object.assign({ key: k }, s);
  }
  function destroySession(token) { if (token && sessions[sha(token)]) { delete sessions[sha(token)]; persist(); } }
  setInterval(function () { const now = Date.now(); let ch = false; Object.keys(sessions).forEach(function (k) { if (sessions[k].expires < now) { delete sessions[k]; ch = true; } }); if (ch) persist(); }, 3600e3).unref();

  /* ---------- login with rate limiting ---------- */
  const fails = {};
  // Per IP and sign-in type. A whole class may share one IP address (campus network), so students get more
  // attempts than the teacher login; both still stop password guessing.
  function limited(key) { const f = fails[key], max = /\|student$/.test(key) ? 40 : 8; return f && f.n >= max && Date.now() - f.first < 15 * 60e3; }
  function fail(key) { const f = fails[key]; if (!f || Date.now() - f.first > 15 * 60e3) fails[key] = { n: 1, first: Date.now() }; else f.n++; }
  function login(kind, username, password, ip) {
    const key = ip + '|' + kind;
    if (limited(key)) return { ok: false, status: 429, error: 'Too many failed attempts. Wait 15 minutes and try again.' };
    let principal = null;
    if (kind === 'student') {
      if (!studentHash) return { ok: false, status: 503, error: 'Student access is not configured on the server yet (STUDENT_PASSWORD_HASH).' };
      if (verifyPassword(password, studentHash)) principal = { uid: 'shared-student', role: 'student', name: 'Student', shared: true };
    } else if (kind === 'admin') {
      const u = findUser(username);
      const okPw = verifyPassword(password, u ? u.hash : DUMMY); // same work whether or not the user exists
      if (u && okPw) principal = { uid: u.username, role: u.role, name: u.name, hash: u.hash };
    } else return { ok: false, status: 400, error: 'Unknown sign-in type.' };
    if (!principal) { fail(key); return { ok: false, status: 401, error: kind === 'student' ? 'Incorrect password.' : 'Incorrect username or password.' }; }
    delete fails[key];
    return { ok: true, principal: principal, session: createSession(principal) };
  }

  return {
    login: login, getSession: getSession, destroySession: destroySession,
    configured: { student: !!studentHash, admin: admins.length > 0 || extraUsers().length > 0 }
  };
}

module.exports = { createAuth: createAuth, hashPassword: hashPassword, verifyPassword: verifyPassword, can: can, ROLES: ROLES };
