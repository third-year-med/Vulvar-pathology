'use strict';
/* Server configuration. Everything secret (passwords, the GitHub token) comes from environment variables
   or a local .env file that is never committed. Nothing here is ever sent to the browser. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv(file) {
  // Minimal KEY=VALUE parser for local development; real deployments set environment variables.
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}

function load(env) {
  if (!env) { loadDotEnv(path.join(ROOT, '.env')); env = process.env; }
  const num = function (k, d) { const v = parseFloat(env[k]); return isFinite(v) ? v : d; };
  const repo = String(env.GITHUB_REPO || '').trim();
  return {
    root: ROOT,
    port: num('PORT', 3000),
    host: env.HOST || '0.0.0.0',
    publicDir: path.join(ROOT, 'public'),
    contentDir: path.resolve(ROOT, env.CONTENT_DIR || 'content'),
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
    // Credentials: a scrypt hash (preferred; make one with `npm run hash-password`) or a plain value.
    studentPassword: { hash: env.STUDENT_PASSWORD_HASH || '', plain: env.STUDENT_PASSWORD || '' },
    admins: [{ username: String(env.ADMIN_USERNAME || 'admin').trim().toLowerCase(), name: env.ADMIN_NAME || 'Teacher', hash: env.ADMIN_PASSWORD_HASH || '', plain: env.ADMIN_PASSWORD || '' }],
    sessionHours: { student: num('SESSION_HOURS_STUDENT', 168), admin: num('SESSION_HOURS_ADMIN', 12) },
    cookieSecure: String(env.COOKIE_SECURE || 'auto').toLowerCase(), // auto | 1 | 0
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY || ''),
    maxUploadBytes: num('MAX_UPLOAD_MB', 10) * 1024 * 1024,
    github: {
      token: env.GITHUB_TOKEN || '',
      owner: repo.split('/')[0] || '',
      repo: repo.split('/')[1] || '',
      branch: env.GITHUB_BRANCH || 'main',
      apiUrl: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
      contentPath: (env.GITHUB_CONTENT_PATH || 'content').replace(/^\/+|\/+$/g, ''),
      committerName: env.GITHUB_COMMITTER_NAME || 'Pathology platform',
      committerEmail: env.GITHUB_COMMITTER_EMAIL || 'platform@users.noreply.github.com'
    }
  };
}

module.exports = { load: load };
