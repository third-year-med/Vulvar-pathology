'use strict';
/* A small SYNTHETIC course with the same structure as the real one (lectures → sections → learning blocks,
   section checks of every kind, review items, topics, concepts, picture slots). It contains no real course
   text, so it can live in this public repository. Used by the browser tests. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201e2b1b1cf0000000049454e44ae426082', 'hex');
function pngOf(r, g, b) {  // a valid 2×2 PNG of one colour
  const zlib = require('zlib'), crc = function (buf) { let c, k, n, t = []; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (n = 0; n < buf.length; n++) c = t[(c ^ buf[n]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = function (type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.from([0, r, g, b, r, g, b]), raw = Buffer.concat([row, row]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG2 = pngOf(20, 120, 200), PNG3 = pngOf(200, 40, 40);

function block(id, title, md) { return { id: id, title: title, label: 'COURSE', priority: 2, md: md }; }
function course(opts) {
  opts = opts || {};
  const pic = function (buf) { return 'data:image/png;base64,' + buf.toString('base64'); };
  return {
    meta: { title: 'Test Pathology — Exam Review', short: 'Test Pathology', subject: 'test pathology', subjectTitle: 'Test pathology', author: 'Test Teacher', role: 'Lecturer', dept: 'Test Department',
      audience: 'Test module', version: '1.0', storagePrefix: 'tp_', contentNote: 'synthetic test content.', review15Desc: 'Three short blocks.' },
    lectures: [
      { num: 1, title: 'Lecture One', intro: '', facts: [], sections: [
        { id: '1', title: 'Alpha basics', intro: '', subs: [
          block('1.1', 'Alpha definition', '**Definition/overview:** Alpha is a synthetic term used only in tests. ALPHA-PARAGRAPH-ONE.\n\nSecond paragraph about alpha.\n\n**Image:** pic:t001\n\n*Source: test p.1*'),
          block('1.2', 'Alpha histology', '**Morphology:** A list follows.\n\n- First point\n- Second point\n\n| Feature | Alpha | Beta |\n|---|---|---|\n| Colour | Red | Blue |'),
          block('1.3', 'Alpha clinical', 'Clinical paragraph for alpha.') ] },
        { id: '2', title: 'Beta patterns', intro: 'Beta introduction.', subs: [
          block('2.1', 'Beta pattern one', 'Beta pattern one text. BETA-SECRET-PHRASE.\n\n**Image:** pic:t002'),
          block('2.2', 'Beta pattern two', 'Beta pattern two text.') ] } ] },
      { num: 2, title: 'Lecture Two', intro: '', facts: [], sections: [
        { id: '3', title: 'Gamma lesions', intro: '', subs: [
          block('3.1', 'Gamma benign', 'Gamma benign text.'),
          block('3.2', 'Gamma malignant', 'Gamma malignant text.') ] } ] }
    ],
    checks: [
      { id: 'TP-CK-001', sec: '1.1', type: 'mcq', q: 'Alpha is a…?', options: ['Test term', 'Bone', 'Gland', 'Nerve'], optionIds: ['o1', 'o2', 'o3', 'o4'], answer: 0, expl: 'It is a test term.', ref: '1.1' },
      { id: 'TP-CK-002', sec: '1.2', type: 'tf', q: 'Alpha is red.', answer: true, expl: 'See the table.', ref: '1.2' },
      { id: 'TP-CK-003', sec: '1.2', type: 'fill', q: 'Alpha has [ blank ] points.', answers: [['2', 'two']], expl: 'Two points.', ref: '1.2' },
      { id: 'TP-CK-004', sec: '2.1', type: 'match', q: 'Match.', left: ['Alpha', 'Beta'], right: ['Blue', 'Red'], key: [1, 0], expl: 'Colours.', ref: '2.1' },
      { id: 'TP-CK-005', sec: '2.2', type: 'sort', q: 'Sort.', groups: ['Alpha', 'Beta'], items: [['Red', 0], ['Blue', 1]], expl: 'Colours.', ref: '2.2' },
      { id: 'TP-CK-006', sec: '3.1', type: 'select', q: 'Select all gamma words.', options: ['Benign', 'Malignant', 'Alpha'], optionIds: ['o1', 'o2', 'o3'], answer: [0, 1], expl: 'Both.', ref: '3.1' }
    ],
    concepts: { 'alpha-def': { name: 'Alpha definition', subs: ['1.1'], sections: ['1'] }, 'beta-one': { name: 'Beta pattern one', subs: ['2.1'], sections: ['2'] }, 'gamma': { name: 'Gamma lesions', subs: ['3.1'], sections: ['3'] } },
    review: {
      facts: [{ id: 'fa1', sub: '1.1', concept: 'alpha-def', q: 'What is alpha?', a: 'A test term.', why: 'Tests need it.' }],
      traps: [{ id: 'tr1', sub: '2.1', concept: 'beta-one', trap: 'Beta is alpha.', remember: 'Beta is not alpha.' }],
      comparisons: [{ id: 'cmp1', sub: '1.2', title: 'Alpha vs beta', md: '| | Alpha | Beta |\n|---|---|---|\n| Colour | Red | Blue |' }],
      morphology: [{ id: 'mo1', sub: '2.1', finding: 'Blue cells', dx: 'Beta', how: 'H&E' }],
      review15: [{ id: 'r15a', mins: '0–5 min', title: 'Alpha', points: ['Alpha is a test term'] }]
    },
    topics: { s1: { name: 'Alpha basics', sections: ['1'] }, s2: { name: 'Beta patterns', sections: ['2'] }, s3: { name: 'Gamma lesions', sections: ['3'] } },
    pics: opts.noPics ? {} : {
      // keys = picKey('pic:t001') / picKey('pic:t002') (see assets/app.js)
      [picKey('pic:t001')]: { src: pic(PNG), caption: 'Alpha picture', credit: 'Test', updatedAt: 0 },
      [picKey('pic:t002')]: { src: pic(PNG2), caption: 'Beta picture', credit: 'Test', updatedAt: 0 }
    },
    decks: {}, media: {},
    // the offline edition also carried the questions — the import must leave them out of the content
    questions: opts.withQuestions ? [{ id: 'X1', stem: ['q'], options: ['a', 'b', 'c', 'd'], answer: 0 }] : undefined,
    practice: opts.withQuestions ? [{ id: 'X2', stem: 'p', options: ['a', 'b', 'c', 'd'], answer: 1 }] : undefined
  };
}
function picKey(desc) { const t = String(desc).replace(/\s+/g, ' ').trim(); let x = 5381; for (let i = 0; i < t.length; i++) x = ((x * 33) ^ t.charCodeAt(i)) >>> 0; return 'p' + x.toString(36) + t.length.toString(36); }

/** The offline-edition page format (content embedded in plain text). */
function offlinePage(c) { return '<!doctype html><html><head><title>t</title></head><body><script type="application/json" id="cvs-data">' + JSON.stringify(c).replace(/</g, '\\u003c') + '</script></body></html>'; }
/** The connected-edition page format (content encrypted with the module key: 12-byte IV ‖ AES-GCM). */
function connectedPage(c, keyB64) {
  const crypto = require('crypto'), iv = crypto.randomBytes(12), ci = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const ct = Buffer.concat([ci.update(JSON.stringify(c), 'utf8'), ci.final(), ci.getAuthTag()]);
  return '<!doctype html><html><head><title>t</title></head><body><script type="application/json" id="cvs-conf">{"module":"vulva"}</script><script type="text/plain" id="cvs-enc">' + Buffer.concat([iv, ct]).toString('base64') + '</script></body></html>';
}
/** A question-bank seed in the format of the connected edition's Import tab. */
function seed() {
  const q = function (n, kind, sub, topic, concept, ans) {
    const id = kind === 'assess' ? 'VULVA-MAIN-Q' + String(n).padStart(3, '0') : 'VULVA-PR-' + String(n).padStart(3, '0');
    return { qid: id, kind: kind, code: kind === 'assess' ? id : '', lecture: sub[0] === '3' ? 'L2' : 'L1', section: sub.split('.')[0], sub: sub, topic: topic, concept: concept, objective: 'Objective ' + n, difficulty: 'Recall', priority: 2, label: 'COURSE CORE',
      previousExam: false, integrated: false, image: n === 1 && kind === 'practice' ? 'pic:t002' : '', stem: (kind === 'assess' ? 'Assessment' : 'Practice') + ' question ' + n + ': which option is ' + ['A', 'B', 'C', 'D'][ans] + '?', options: ['Option A' + n, 'Option B' + n, 'Option C' + n, 'Option D' + n], answer: ans, explanation: 'Because it is ' + ['A', 'B', 'C', 'D'][ans] + '.', trap: '', ref: 'Test ' + sub };
  };
  return { kind: 'vulva-seed', topics: course().topics,
    questions: [q(1, 'practice', '1.1', 's1', 'alpha-def', 1), q(2, 'practice', '2.1', 's2', 'beta-one', 2), q(3, 'practice', '3.1', 's3', 'gamma', 3),
      q(1, 'assess', '1.1', 's1', 'alpha-def', 0), q(2, 'assess', '1.2', 's1', 'alpha-def', 1), q(3, 'assess', '2.1', 's2', 'beta-one', 2), q(4, 'assess', '3.1', 's3', 'gamma', 3)],
    assessments: [{ id: 'MAIN', title: 'Test Exam', subtitle: 'Four questions', lecture: 'MOCK', durationMin: 10, questionCount: 4, pool: ['VULVA-MAIN-Q001', 'VULVA-MAIN-Q002', 'VULVA-MAIN-Q003', 'VULVA-MAIN-Q004'], randomizeQuestions: false, randomizeOptions: false, passPct: 50 }] };
}
module.exports = { course: course, seed: seed, offlinePage: offlinePage, connectedPage: connectedPage, picKey: picKey, PNG: PNG, PNG2: PNG2, PNG3: PNG3 };
