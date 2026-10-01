/* TEST FIXTURE — verbatim excerpts of the platform's shared Code.gs (v1.7): configuration, entry point, routing,
 * sheet plumbing, teacher authentication, student accounts, content CRUD helpers and the exam-window lock that the
 * sign-in gate consults. Engines not needed by the Gynecology module (Live Classroom, study sync, assessments,
 * attendance, practicals, exam app) are left out; the router only reaches them for other actions.
 * NOT FOR DEPLOYMENT: deploy your own Code.gs unchanged. Content keys and default passwords here are test values. */

var VERSION = '1.7';
var SESSION_TTL_MS = 12 * 3600 * 1000;
var CONTENT_JSON_COLS = 6;
var CONTENT_CHUNK_SIZE = 45000;
var DEFAULT_QUIZ_PW = {};
var DEFAULT_LIVE_PW = {};
var DRIVE_FOLDER_NAME = 'Pathology Teaching Platform — Images';
var ATTENDANCE_ROOT_FOLDER = 'Medical Education Platform';

var SHEETS = {
  CONTENT: 'Content', RESULTS: 'Results', SETTINGS: 'Settings', SESSIONS: 'Sessions',
  LIVE_CHAT: 'LiveChat', LIVE_MEMBERS: 'LiveMembers', LIVE_FILES: 'LiveFiles',
  ATT_SESSIONS: 'AttendanceSessions', ATT_RECORDS: 'AttendanceRecords',
  ASSESS: 'AssessRecords', STUDY: 'StudySync',
  STUDENTS: 'Students', STU_SESSIONS: 'StudentSessions'
};

var HEADERS = {};
HEADERS[SHEETS.CONTENT] = ['module', 'collection', 'id', 'updatedAt', 'updatedBy', 'deleted']
  .concat(Array.from({ length: CONTENT_JSON_COLS }, function (_, i) { return 'json' + (i + 1); }));
HEADERS[SHEETS.RESULTS] = ['module', 'id', 'name', 'email', 'score', 'total', 'percent', 'correct', 'incorrect',
  'unanswered', 'startedAt', 'submittedAt', 'durationSec', 'answersJson', 'receivedAt'];
HEADERS[SHEETS.SETTINGS] = ['key', 'value'];
HEADERS[SHEETS.SESSIONS] = ['module', 'token', 'createdAt', 'expiresAt'];
HEADERS[SHEETS.LIVE_CHAT] = ['module', 'id', 'kind', 'authorRole', 'authorName', 'participantId', 'body',
  'imageUrl', 'fileUrl', 'fileName', 'fileMime', 'replyToId', 'pinned', 'edited', 'deleted', 'reactionsJson', 'createdAt', 'updatedAt',
  'seq', 'ord', 'clientId', 'replyToPid', 'mentionsJson', 'mentionAll', 'attachmentsJson'];
HEADERS[SHEETS.LIVE_MEMBERS] = ['module', 'participantId', 'role', 'name', 'email', 'prefsJson', 'readUpTo', 'readIdsJson', 'readVer', 'removed', 'joinedAt', 'updatedAt'];
HEADERS[SHEETS.LIVE_FILES] = ['module', 'id', 'name', 'mime', 'size', 'uploaderPid', 'status', 'storageId', 'messageId', 'preview', 'createdAt', 'readyAt'];
HEADERS[SHEETS.STUDENTS] = ['module', 'username', 'name', 'email', 'pwSalt', 'pwHash', 'pwIter', 'active', 'mustChange', 'failed', 'lockedUntil', 'createdAt', 'updatedAt', 'lastLogin'];
HEADERS[SHEETS.STU_SESSIONS] = ['module', 'tokenHash', 'username', 'createdAt', 'expiresAt', 'remember'];
var TEXT_COLS = {};
TEXT_COLS[SHEETS.STUDENTS] = ['module', 'username', 'name', 'email', 'pwSalt', 'pwHash'];
TEXT_COLS[SHEETS.STU_SESSIONS] = ['module', 'tokenHash', 'username'];
TEXT_COLS[SHEETS.ASSESS] = ['module', 'kind', 'id', 'ref', 'email', 'status'];
HEADERS[SHEETS.ATT_SESSIONS] = ['module', 'sessionId', 'code', 'token', 'academicYear', 'course', 'chapter', 'sessionTitle',
  'teacher', 'status', 'createdAt', 'endedAt', 'driveStatus', 'driveUrl', 'driveError'];
HEADERS[SHEETS.ASSESS] = ['module', 'kind', 'id', 'ref', 'email', 'status', 'updatedAt']
  .concat(Array.from({ length: CONTENT_JSON_COLS }, function (_, i) { return 'json' + (i + 1); }));
var STUDY_JSON_COLS = 16;
HEADERS[SHEETS.STUDY] = ['module', 'key', 'pinSalt', 'pinHash', 'tokensJson', 'rev', 'share', 'lastActive', 'createdAt', 'updatedAt', 'summaryJson']
  .concat(Array.from({ length: STUDY_JSON_COLS }, function (_, i) { return 'json' + (i + 1); }));
HEADERS[SHEETS.ATT_RECORDS] = ['sessionId', 'recordId', 'participantId', 'studentName', 'studentId', 'email', 'status', 'scannedAt', 'createdAt'];

function doGet(e) {
  return ContentService.createTextOutput(
    'Pathology Teaching Platform backend is running (v' + VERSION + '). POST requests only.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Invalid JSON body.', code: 'badjson' });
  }
  try {
    if (payload && payload.action === 'liveSync') {
      if (studentAuthOn_(String(payload.module || 'default'))) {
        ensureSheets_();
        var gate = gateRequest_(String(payload.module || 'default'), payload);
        if (gate) return jsonOut_(gate);
      }
      var fast = liveSyncFast_(payload); if (fast) return jsonOut_(fast);
    }
    ensureSheets_();
    return jsonOut_(route_(payload));
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Server error: ' + (err && err.message || err), code: 'server' });
  }
}

function route_(p) {
  var module = String(p.module || 'default');
  var action = p.action;
  if (EX_PUBLIC_ACTIONS[action]) return exRoute_(module, p);
  if (!STUDENT_PUBLIC_ACTIONS[action] && studentAuthOn_(module)) {
    var gate = gateRequest_(module, p);
    if (gate) return gate;
  }

  if (typeof gynHook_ === 'function') {
    var hk3 = gynHook_(module, p);
    if (hk3) return hk3;
  }

  switch (action) {
    case 'ping': return { ok: true, version: VERSION, serverTime: Date.now(), needsSetup: !getTeacherCreds_(module).hash, studentAuth: studentAuthOn_(module) };
    case 'setup': return actionSetup_(module, p);
    case 'login': return actionLogin_(module, p);
    case 'logout': return actionLogout_(p);
    case 'changePassword': return authed_(module, p, function (tok) { return actionChangePassword_(module, p); });
    case 'studentLogin': return actionStudentLogin_(module, p);
    case 'studentLogout': return actionStudentLogout_(module, p);
    case 'studentSession': return actionStudentSession_(module, p);
    case 'studentChangePassword': return actionStudentChangePassword_(module, p);
    case 'listStudents': return authed_(module, p, function () { return actionListStudents_(module); });
    case 'saveStudent': return authed_(module, p, function () { return actionSaveStudent_(module, p); });
    case 'bulkAddStudents': return authed_(module, p, function () { return actionBulkAddStudents_(module, p); });
    case 'setStudentActive': return authed_(module, p, function () { return actionSetStudentActive_(module, p); });
    case 'resetStudentPassword': return authed_(module, p, function () { return actionResetStudentPassword_(module, p); });
    case 'deleteStudent': return authed_(module, p, function () { return actionDeleteStudent_(module, p); });
    case 'unlockStudent': return authed_(module, p, function () { return actionUnlockStudent_(module, p); });
    case 'upsert': return authed_(module, p, function () { return actionUpsert_(module, p); });
    case 'delete': return authed_(module, p, function () { return actionDelete_(module, p); });
    default: return { ok: false, error: 'Unknown action: ' + action, code: 'badaction' };
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// (platform edit for standalone projects: fall back to the SHEET_ID script property)
function getSS_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(); if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('This Apps Script project is not attached to a Google Sheet. Add the script property SHEET_ID (see SETUP.md).');
  return SpreadsheetApp.openById(id);
}

function ensureSheets_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('sheets_ok:' + VERSION)) return;
  var ss = getSS_();
  var allPresent = Object.keys(SHEETS).every(function (k) {
    var sh = ss.getSheetByName(SHEETS[k]);
    return sh && sh.getLastRow() > 0;
  });
  var headersOk = allPresent && Object.keys(SHEETS).every(function (k) { return ss.getSheetByName(SHEETS[k]).getLastColumn() >= HEADERS[SHEETS[k]].length; });
  if (allPresent && headersOk) { cache.put('sheets_ok:' + VERSION, '1', 21600); return; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    Object.keys(SHEETS).forEach(function (k) {
      var name = SHEETS[k];
      var sh = ss.getSheetByName(name);
      if (!sh) {
        sh = ss.insertSheet(name);
        sh.appendRow(HEADERS[name]);
        sh.setFrozenRows(1);
      } else if (sh.getLastRow() === 0) {
        sh.appendRow(HEADERS[name]);
        sh.setFrozenRows(1);
      }
    });
    Object.keys(SHEETS).forEach(function (k) {
      var name = SHEETS[k], sh = ss.getSheetByName(name), want = HEADERS[name];
      if (sh && sh.getLastColumn() < want.length) sh.getRange(1, 1, 1, want.length).setValues([want]);
    });
    var def = ss.getSheetByName('Sheet1');
    if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
    cache.put('sheets_ok:' + VERSION, '1', 21600);
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name) { return getSS_().getSheetByName(name); }

function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = HEADERS[name], tc = TEXT_COLS[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = row[j]; });
    if (tc) tc.forEach(function (h) { o[h] = o[h] == null ? '' : String(o[h]); });
    return o;
  });
}

function rowToArray_(name, obj) {
  return HEADERS[name].map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
}

function textFormats_(name) {
  var tc = TEXT_COLS[name];
  return tc ? [HEADERS[name].map(function (h) { return tc.indexOf(h) >= 0 ? '@' : 'General'; })] : null;
}
function appendRow_(name, obj) {
  var f = textFormats_(name);
  if (!f) { sheet_(name).appendRow(rowToArray_(name, obj)); return; }
  var sh = sheet_(name), r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  var rng = sh.getRange(r, 1, 1, HEADERS[name].length);
  rng.setNumberFormats(f); rng.setValues([rowToArray_(name, obj)]);
}

function updateRow_(name, rowIndex, obj) {
  var headers = HEADERS[name], f = textFormats_(name);
  var rng = sheet_(name).getRange(rowIndex, 1, 1, headers.length);
  if (f) rng.setNumberFormats(f);
  rng.setValues([rowToArray_(name, obj)]);
}

function deleteRow_(name, rowIndex) {
  sheet_(name).deleteRow(rowIndex);
}

function packJson_(obj) {
  var s = JSON.stringify(obj === undefined ? null : obj);
  var chunks = {};
  for (var i = 0; i < CONTENT_JSON_COLS; i++) chunks['json' + (i + 1)] = '';
  for (var i = 0, c = 1; i < s.length && c <= CONTENT_JSON_COLS; i += CONTENT_CHUNK_SIZE, c++) {
    chunks['json' + c] = s.slice(i, i + CONTENT_CHUNK_SIZE);
  }
  if (s.length > CONTENT_CHUNK_SIZE * CONTENT_JSON_COLS) {
    throw new Error('This item is too large to store (>' + (CONTENT_CHUNK_SIZE * CONTENT_JSON_COLS) + ' characters). Try removing an embedded image (use image upload instead of pasting a data URL).');
  }
  return chunks;
}
function unpackJson_(row) {
  var s = '';
  for (var i = 1; i <= CONTENT_JSON_COLS; i++) s += (row['json' + i] || '');
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function getSetting_(key) {
  var rows = readAll_(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].value;
  return null;
}
function setSetting_(key, value) {
  var sh = sheet_(SHEETS.SETTINGS);
  var rows = readAll_(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) { sh.getRange(rows[i]._row, 2).setValue(value); return; }
  }
  appendRow_(SHEETS.SETTINGS, { key: key, value: value });
}

function randomHex_(nBytes) {
  var out = '';
  while (out.length < nBytes * 2) out += sha256Hex_(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + out);
  return out.slice(0, nBytes * 2);
}
function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}
var PW_ITER = 1000;
function hashIter_(password, salt, iter) {
  var h = sha256Hex_(salt + '::' + password);
  for (var i = 0; i < iter; i++) h = sha256Hex_(salt + ':' + h);
  return h;
}
function safeEq_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + password, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function teacherHashKey_(module) { return 'teacherHash:' + module; }
function teacherSaltKey_(module) { return 'teacherSalt:' + module; }
function teacherIterKey_(module) { return 'teacherIter:' + module; }
function getTeacherCreds_(module) {
  var hash = getSetting_(teacherHashKey_(module)), salt = getSetting_(teacherSaltKey_(module));
  if (hash) return { hash: hash, salt: salt, iter: Number(getSetting_(teacherIterKey_(module))) || 0, legacy: false };
  hash = getSetting_('teacherHash'); salt = getSetting_('teacherSalt');
  return { hash: hash, salt: salt, iter: 0, legacy: !!hash };
}
function teacherPwOk_(creds, pw) { return !!creds.hash && safeEq_(creds.iter ? hashIter_(pw, creds.salt, creds.iter) : hashPassword_(pw, creds.salt), creds.hash); }
function setTeacherPw_(module, pw) {
  var salt = randomHex_(16);
  setSetting_(teacherSaltKey_(module), salt);
  setSetting_(teacherIterKey_(module), String(PW_ITER));
  setSetting_(teacherHashKey_(module), hashIter_(pw, salt, PW_ITER));
}
var T_MAX_FAILS = 8, T_LOCK_S = 900;

function actionSetup_(module, p) {
  if (getTeacherCreds_(module).hash) return { ok: false, error: 'A teacher password already exists for this module. Sign in, or use Teacher Portal → Account to change it.' };
  var pw = String(p.password || '');
  if (pw.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  setTeacherPw_(module, pw);
  return { ok: true };
}

function actionLogin_(module, p) {
  var creds = getTeacherCreds_(module);
  if (!creds.hash) return { ok: false, error: 'No teacher password has been set up yet for this module.', code: 'needsSetup' };
  var c = CacheService.getScriptCache(), fk = 'tfail:' + module, fails = Number(c.get(fk) || 0);
  if (fails >= T_MAX_FAILS) return { ok: false, code: 'locked', error: 'Too many incorrect teacher passwords. Teacher sign-in for this module is locked for 15 minutes.' };
  var pw = String(p.password || '');
  if (!teacherPwOk_(creds, pw)) { c.put(fk, String(fails + 1), T_LOCK_S); return { ok: false, error: 'Incorrect teacher password.' }; }
  c.remove(fk);
  var token = Utilities.getUuid() + '-' + randomHex_(16);
  var now = Date.now();
  appendRow_(SHEETS.SESSIONS, { module: module, token: token, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return { ok: true, token: token, expiresAt: now + SESSION_TTL_MS, contentKey: contentKey_(module) };
}

function actionLogout_(p) {
  var rows = readAll_(SHEETS.SESSIONS);
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].token === p.token) deleteRow_(SHEETS.SESSIONS, rows[i]._row);
  return { ok: true };
}

function actionChangePassword_(module, p) {
  var creds = getTeacherCreds_(module);
  if (!teacherPwOk_(creds, String(p.oldPassword || ''))) return { ok: false, error: 'Current password is incorrect.' };
  if (String(p.newPassword || '').length < 8) return { ok: false, error: 'New password must be at least 8 characters.' };
  setTeacherPw_(module, String(p.newPassword));
  return { ok: true };
}

function authed_(module, p, fn) {
  var token = p.token;
  if (!token) return { ok: false, error: 'Not signed in.', code: 'auth' };
  var rows = readAll_(SHEETS.SESSIONS);
  var found = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].token === token) { found = rows[i]; break; }
  if (!found) return { ok: false, error: 'Your session has expired — please sign in again.', code: 'auth' };
  if (Number(found.expiresAt) < Date.now()) { deleteRow_(SHEETS.SESSIONS, found._row); return { ok: false, error: 'Your session has expired — please sign in again.', code: 'auth' }; }
  if (found.module && found.module !== module) return { ok: false, error: 'This teacher account does not have access to this module — please sign in again here.', code: 'auth' };
  return fn(token);
}

/* ---- Student accounts & sign-in (1.6) — content keys here are TEST values ---- */
var STUDENT_AUTH_MODULES = {
  cellinjury: true,
  inflhealing: true,
  vulva: true,
  vagina: true
};
var CONTENT_KEYS = {
  vulva: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  vagina: '__VAGINA_CONTENT_KEY__'
};
var STU_TTL_MS = 12 * 3600 * 1000;
var STU_REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000;
var STU_MAX_FAILS = 5, STU_LOCK_MS = 15 * 60 * 1000;
var STU_MIN_PW = 8;
var STUDENT_PUBLIC_ACTIONS = { ping: 1, setup: 1, login: 1, logout: 1, studentLogin: 1, studentLogout: 1 };

function baseModule_(module) { return String(module || '').split('-')[0]; }
function studentAuthOn_(module) { return !!STUDENT_AUTH_MODULES[baseModule_(module)]; }
function contentKey_(module) { return CONTENT_KEYS[baseModule_(module)] || ''; }
function normUser_(u) { return String(u == null ? '' : u).trim().toLowerCase(); }
function validUser_(u) { return /^[a-z0-9][a-z0-9._@-]{1,63}$/.test(u); }
function studentEmail_(s) { return s.email || (s.username.replace(/[^a-z0-9._-]/g, '') + '@student.local'); }
function studentPublic_(s) { return { username: s.username, name: s.name, email: s.email || '' }; }
function findStudent_(module, username) {
  var rows = readAll_(SHEETS.STUDENTS);
  for (var i = 0; i < rows.length; i++) if (rows[i].module === module && normUser_(rows[i].username) === username) return rows[i];
  return null;
}
function isTrue_(v) { return v === true || v === 'TRUE' || v === 'true'; }
function stuTokenHash_(t) { return sha256Hex_('st|' + t); }
function stuCache_() { return CacheService.getScriptCache(); }
function revokeStudentSessions_(module, username, keepHash) {
  var rows = readAll_(SHEETS.STU_SESSIONS), c = stuCache_();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (r.module === module && r.username === username && r.tokenHash !== keepHash) { c.remove('stok:' + r.tokenHash); deleteRow_(SHEETS.STU_SESSIONS, r._row); }
  }
}
function studentFromSession_(module, stoken) {
  if (!stoken || String(stoken).length < 20) return null;
  var th = stuTokenHash_(stoken), c = stuCache_(), ck = 'stok:' + th;
  var hit = c.get(ck);
  if (hit) { try { var o = JSON.parse(hit); if (o.module === module && o.exp > Date.now()) return o; } catch (e) { } }
  var rows = readAll_(SHEETS.STU_SESSIONS), found = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].tokenHash === th) { found = rows[i]; break; }
  if (!found || found.module !== module) return null;
  if (Number(found.expiresAt) < Date.now()) { deleteRow_(SHEETS.STU_SESSIONS, found._row); return null; }
  var s = findStudent_(module, found.username);
  if (!s || !isTrue_(s.active)) return null;
  var out = { module: module, username: s.username, name: s.name, email: s.email || '', mustChange: isTrue_(s.mustChange), exp: Number(found.expiresAt), th: th };
  c.put(ck, JSON.stringify(out), 300);
  return out;
}
function gateRequest_(module, p) {
  if (p.token && liveTeacherTokenOk_(module, String(p.token))) { p.__role = 'teacher'; return null; }
  var st = studentFromSession_(module, p.stoken);
  if (!st) return p.token && !p.stoken ? { ok: false, code: 'auth', error: 'Your teacher session has expired — please sign in again.' }
    : { ok: false, code: 'studentauth', error: 'Your session has ended — please sign in again.' };
  if (st.mustChange && p.action !== 'studentChangePassword' && p.action !== 'studentSession' && p.action !== 'studentLogout')
    return { ok: false, code: 'mustchange', error: 'Please set a new password before continuing.' };
  if (p.action !== 'studentLogout') { var xl = exTeachingLock_(module, st.username); if (xl) return xl; }
  p.__role = 'student'; p.__student = st;
  var email = studentEmail_(st), a = p.action;
  if (a === 'liveJoin') { p.name = st.name; p.email = email; }
  if (/^live/.test(a)) p.participantId = LE_pidFor(module, email);
  if (a === 'submitAttendance' || a === 'submitAttendanceByCode') { p.name = st.name; p.studentId = st.username; p.email = st.email || ''; p.participantId = 'acct:' + st.username; }
  if (a === 'getMyAssessments' || a === 'startAttempt' || a === 'submitAttempt' || /^study/.test(a)) { p.email = email; if (a === 'startAttempt') p.name = st.name; }
  if (a === 'submitQuizResult' && p.result) { p.result.name = st.name; p.result.email = email; }
  return null;
}

function actionStudentLogin_(module, p) {
  if (!studentAuthOn_(module)) return { ok: false, code: 'disabled', error: 'Student sign-in is not enabled for this module.' };
  var username = normUser_(p.username), pw = String(p.password || '');
  var generic = { ok: false, code: 'badlogin', error: 'Incorrect student ID or password.' };
  if (!username || !pw) return { ok: false, code: 'badlogin', error: 'Enter your student ID and password.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, username);
    if (!s) { Utilities.sleep(300); return generic; }
    var now = Date.now();
    if (Number(s.lockedUntil) > now) return { ok: false, code: 'locked', error: 'Too many failed attempts. This account is locked for ' + Math.ceil((Number(s.lockedUntil) - now) / 60000) + ' more minute(s), or ask your teacher to unlock it.' };
    if (!safeEq_(hashIter_(pw, s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) {
      s.failed = (Number(s.failed) || 0) + 1;
      if (s.failed >= STU_MAX_FAILS) { s.lockedUntil = now + STU_LOCK_MS; s.failed = 0; }
      s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s);
      return Number(s.lockedUntil) > now ? { ok: false, code: 'locked', error: 'Too many failed attempts. This account is locked for 15 minutes, or ask your teacher to unlock it.' } : generic;
    }
    if (!isTrue_(s.active)) return { ok: false, code: 'inactive', error: 'This account has been deactivated. Please contact your teacher.' };
    var xlock = exTeachingLock_(module, s.username); if (xlock) return xlock;
    s.failed = 0; s.lockedUntil = ''; s.lastLogin = now; s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s);
    var token = randomHex_(32), remember = !!p.remember, exp = now + (remember ? STU_REMEMBER_TTL_MS : STU_TTL_MS);
    appendRow_(SHEETS.STU_SESSIONS, { module: module, tokenHash: stuTokenHash_(token), username: s.username, createdAt: now, expiresAt: exp, remember: remember });
    return { ok: true, token: token, expiresAt: exp, student: studentPublic_(s), mustChange: isTrue_(s.mustChange), contentKey: isTrue_(s.mustChange) ? '' : contentKey_(module) };
  } finally { lock.releaseLock(); }
}
function actionStudentLogout_(module, p) {
  if (!p.stoken) return { ok: true };
  var th = stuTokenHash_(p.stoken), rows = readAll_(SHEETS.STU_SESSIONS);
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].tokenHash === th) deleteRow_(SHEETS.STU_SESSIONS, rows[i]._row);
  stuCache_().remove('stok:' + th);
  return { ok: true };
}
function actionStudentSession_(module, p) {
  if (p.__role === 'teacher') return { ok: true, role: 'teacher', contentKey: contentKey_(module) };
  var st = p.__student; if (!st) return { ok: false, code: 'studentauth', error: 'Please sign in.' };
  return { ok: true, role: 'student', student: studentPublic_(st), mustChange: st.mustChange, expiresAt: st.exp, contentKey: st.mustChange ? '' : contentKey_(module) };
}
function actionStudentChangePassword_(module, p) {
  var st = p.__student; if (!st) return { ok: false, code: 'studentauth', error: 'Please sign in.' };
  var np = String(p.newPassword || '');
  if (np.length < STU_MIN_PW) return { ok: false, error: 'The new password must be at least ' + STU_MIN_PW + ' characters.' };
  if (normUser_(np) === st.username) return { ok: false, error: 'The new password must not be your student ID.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, st.username); if (!s || !isTrue_(s.active)) return { ok: false, code: 'studentauth', error: 'Please sign in again.' };
    if (!safeEq_(hashIter_(String(p.oldPassword || ''), s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) return { ok: false, error: 'Your current password is incorrect.' };
    if (np === String(p.oldPassword || '')) return { ok: false, error: 'Choose a password different from the current one.' };
    s.pwSalt = randomHex_(16); s.pwIter = PW_ITER; s.pwHash = hashIter_(np, s.pwSalt, PW_ITER); s.mustChange = false; s.updatedAt = Date.now();
    updateRow_(SHEETS.STUDENTS, s._row, s);
    revokeStudentSessions_(module, s.username, st.th);
    stuCache_().remove('stok:' + st.th);
    return { ok: true, contentKey: contentKey_(module) };
  } finally { lock.releaseLock(); }
}

function genTempPassword_() {
  var A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', h = randomHex_(24), out = '';
  for (var i = 0; i < 10; i++) out += A.charAt(parseInt(h.substr(i * 4, 4), 16) % A.length);
  return out;
}
function studentRowPublic_(r) {
  return { username: r.username, name: r.name, email: r.email || '', active: isTrue_(r.active), mustChange: isTrue_(r.mustChange),
    locked: Number(r.lockedUntil) > Date.now(), createdAt: Number(r.createdAt) || 0, lastLogin: Number(r.lastLogin) || 0 };
}
function actionListStudents_(module) {
  return { ok: true, students: readAll_(SHEETS.STUDENTS).filter(function (r) { return r.module === module; }).map(studentRowPublic_)
    .sort(function (a, b) { return a.username < b.username ? -1 : 1; }) };
}
function createStudent_(module, it) {
  var username = normUser_(it.username), name = String(it.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email = String(it.email || '').trim().toLowerCase().slice(0, 120);
  if (!validUser_(username)) return { ok: false, error: 'Student ID “' + (it.username || '') + '” is not valid — use 2–64 letters, digits, dot, dash, underscore or @.' };
  if (name.length < 2) return { ok: false, error: 'Enter the student’s name (' + username + ').' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'The email for ' + username + ' is not valid.' };
  if (findStudent_(module, username)) return { ok: false, code: 'exists', error: 'Student ID “' + username + '” already exists.' };
  var given = String(it.password || ''), temp = !given;
  if (given && given.length < STU_MIN_PW) return { ok: false, error: 'The password for ' + username + ' must be at least ' + STU_MIN_PW + ' characters.' };
  var pw = given || genTempPassword_(), salt = randomHex_(16), now = Date.now();
  appendRow_(SHEETS.STUDENTS, { module: module, username: username, name: name, email: email, pwSalt: salt, pwHash: hashIter_(pw, salt, PW_ITER), pwIter: PW_ITER,
    active: true, mustChange: it.mustChange !== false, failed: 0, lockedUntil: '', createdAt: now, updatedAt: now, lastLogin: '' });
  return { ok: true, username: username, tempPassword: temp ? pw : '' };
}
function actionSaveStudent_(module, p) {
  var it = p.student || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (p.create) return createStudent_(module, it);
    var s = findStudent_(module, normUser_(it.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    var name = String(it.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email = String(it.email || '').trim().toLowerCase().slice(0, 120);
    if (name.length < 2) return { ok: false, error: 'Enter the student’s name.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'That email address is not valid.' };
    s.name = name; s.email = email; s.updatedAt = Date.now(); updateRow_(SHEETS.STUDENTS, s._row, s);
    revokeStudentSessions_(module, s.username, '__none__');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function actionBulkAddStudents_(module, p) {
  var list = (p.students || []).slice(0, 500), results = [];
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { list.forEach(function (it) { var r = createStudent_(module, it || {}); r.input = String((it && it.username) || ''); results.push(r); }); }
  finally { lock.releaseLock(); }
  return { ok: true, created: results.filter(function (r) { return r.ok; }).length, results: results };
}
function actionSetStudentActive_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    s.active = !!p.active; s.updatedAt = Date.now(); updateRow_(SHEETS.STUDENTS, s._row, s);
    if (!p.active) revokeStudentSessions_(module, s.username, '__none__');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function actionResetStudentPassword_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    var given = String(p.password || '');
    if (given && given.length < STU_MIN_PW) return { ok: false, error: 'The password must be at least ' + STU_MIN_PW + ' characters.' };
    var pw = given || genTempPassword_();
    s.pwSalt = randomHex_(16); s.pwIter = PW_ITER; s.pwHash = hashIter_(pw, s.pwSalt, PW_ITER); s.mustChange = true; s.failed = 0; s.lockedUntil = ''; s.updatedAt = Date.now();
    updateRow_(SHEETS.STUDENTS, s._row, s);
    revokeStudentSessions_(module, s.username, '__none__');
    return { ok: true, tempPassword: given ? '' : pw };
  } finally { lock.releaseLock(); }
}
function actionUnlockStudent_(module, p) {
  var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
  s.failed = 0; s.lockedUntil = ''; s.updatedAt = Date.now(); updateRow_(SHEETS.STUDENTS, s._row, s);
  return { ok: true };
}
function actionDeleteStudent_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    revokeStudentSessions_(module, s.username, '__none__');
    deleteRow_(SHEETS.STUDENTS, s._row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function findContentRow_(module, collection, id) {
  var rows = readAll_(SHEETS.CONTENT);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].module === module && rows[i].collection === collection && String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}
function actionUpsert_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var existing = findContentRow_(module, p.collection, p.id);
    var row = { module: module, collection: p.collection, id: String(p.id), updatedAt: Date.now(), updatedBy: 'teacher', deleted: false };
    Object.assign(row, packJson_(p.data));
    if (existing) updateRow_(SHEETS.CONTENT, existing._row, row);
    else appendRow_(SHEETS.CONTENT, row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function actionDelete_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var existing = findContentRow_(module, p.collection, p.id);
    var row = { module: module, collection: p.collection, id: String(p.id), updatedAt: Date.now(), updatedBy: 'teacher', deleted: true };
    Object.assign(row, packJson_(null));
    if (existing) updateRow_(SHEETS.CONTENT, existing._row, row);
    else appendRow_(SHEETS.CONTENT, row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function liveCache_() { return CacheService.getScriptCache(); }
function liveTeacherTokenOk_(module, token) {
  if (!token) return false;
  var c = liveCache_(), k = 'tok:' + module + ':' + token;
  if (c.get(k)) return true;
  var rows = readAll_(SHEETS.SESSIONS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.token === token && Number(r.expiresAt) > Date.now() && (!r.module || r.module === module)) {
      c.put(k, '1', Math.max(60, Math.min(1800, Math.floor((Number(r.expiresAt) - Date.now()) / 1000))));
      return true;
    }
  }
  return false;
}

/* ---- Official Exams (1.7): only the parts the sign-in gate uses ---- */
var EX_PUBLIC_ACTIONS = { examInfo: 1, examLogin: 1, examStart: 1, examSave: 1, examSubmit: 1, examStatus: 1, examLogout: 1 };
var EX_LOCK_BEFORE_MS = 15 * 60 * 1000;
function exPrivAll_(module, coll) {
  var c = 'priv:' + coll, out = [];
  readAll_(SHEETS.CONTENT).forEach(function (r) { if (r.module === module && r.collection === c && !r.deleted) { var d = unpackJson_(r); if (d) out.push(d); } });
  return out;
}
function exLocks_(module) {
  var c = CacheService.getScriptCache(), k = 'exlocks:' + module, hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var now = Date.now(), list = [];
  exPrivAll_(module, 'exams').forEach(function (e) {
    if (e.status === 'published' && e.lockTeaching && Number(e.closesAt) > now)
      list.push({ id: e.id, from: Number(e.opensAt) - EX_LOCK_BEFORE_MS, to: Number(e.closesAt), all: !e.candidates || e.candidates === 'all', users: e.candidates === 'all' ? [] : (e.candidates || []).map(normUser_), title: e.title });
  });
  c.put(k, JSON.stringify(list), 60);
  return list;
}
function exTeachingLock_(module, username) {
  var locks = exLocks_(module); if (!locks.length) return null;
  var now = Date.now(), u = normUser_(username);
  for (var i = 0; i < locks.length; i++) {
    var L = locks[i];
    if (now >= L.from && now <= L.to && (L.all || L.users.indexOf(u) >= 0))
      return { ok: false, code: 'examlock', error: 'The teaching platform is closed for you while the official exam “' + L.title + '” is running. It reopens at ' + Utilities.formatDate(new Date(L.to), Session.getScriptTimeZone(), 'HH:mm') + '.' };
  }
  return null;
}
