#!/usr/bin/env node
/* Prints a scrypt hash for STUDENT_PASSWORD_HASH / ADMIN_PASSWORD_HASH.
   Usage: npm run hash-password            (prompts, input hidden)
          node tools/hash-password.js "the password"   (avoid: stays in shell history) */
'use strict';
const { hashPassword } = require('../server/auth');
function out(pw) {
  if (String(pw).length < 8) { console.error('Use at least 8 characters.'); process.exit(1); }
  console.log(hashPassword(pw));
}
if (process.argv[2]) out(process.argv[2]);
else {
  process.stdout.write('Password: ');
  const stdin = process.stdin; let pw = '';
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume(); stdin.setEncoding('utf8');
  stdin.on('data', function (ch) {
    for (const c of ch) {
      if (c === '\r' || c === '\n' || c === '\u0004') { if (stdin.isTTY) stdin.setRawMode(false); process.stdout.write('\n'); stdin.pause(); return out(pw); }
      if (c === '\u0003') process.exit(1);
      if (c === '\u007f') pw = pw.slice(0, -1); else pw += c;
    }
  });
}
