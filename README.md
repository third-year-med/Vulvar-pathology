# Vulvar Pathology — Exam Review (private teaching platform)

Learn, Practice, Assessments, My Progress, Last-Minute Review and Presentation Mode, for the Gynecology Pathology module.

- **Students** sign in with their own **Student ID and password** (the platform's shared account system). Questions, timing, scoring, results and progress are handled by the platform backend.
- **Teachers** sign in on the **Teacher** tab and can edit everything through the platform itself, with no code: lecture text, pictures, section checks, review items, slides, practice and assessment questions, assessments and student accounts. Changes go to a **draft**. You can **preview** it, then **publish** it. Every version is kept.
- The site runs on **GitHub Pages**. The backend is your existing **Google Apps Script** project. The published course is **encrypted**, and only signed-in users get the key. Answers never leave the backend before submission.

**Setting it up:** [SETUP.md](SETUP.md).

## For the teacher: editing

1. Sign in on the **Teacher** tab. A bar under the menu shows **DRAFT**: your working copy, which students cannot see.
2. Tick **✏️ Edit mode**:
   - **Text:** click any paragraph, heading, list, table or box. The panel has bold, italic, headings, lists, links, tables (grid editor), coloured boxes, labels and pictures. Pasting from Word or a web page keeps the formatting.
   - **Sections and learning blocks:** ✏️ edit, ↑ ↓ move, ⧉ duplicate, ＋ add, 🗑 delete (with confirmation and undo).
   - **Pictures:** click a picture → upload or choose from the library. You can also set the caption, title, description, alternative text, credit, size and alignment. The same picture changes everywhere it is used.
   - **Practice questions** (in *Test yourself*): ✏️ Edit question opens the question-bank editor. Each save is a new version, so past attempts are unaffected. **Section checks** are edited in place or under Faculty tools → Section checks.
   - **Last-minute review** items and **Presentation** slides are edited the same way.
3. Changes are saved to the draft automatically (*Draft saved*). **↶ Undo / ↷ Redo** are always available.
4. **👁 Preview** shows the draft exactly as students will see it.
5. **🚀 Publish…** shows what changed, checks for problems, encrypts the course in your browser, and the backend commits it to GitHub.
6. **Faculty tools → Content & publishing:** status, history and rollback (restore any earlier version into the draft).
7. **Faculty tools → Teacher portal:** question bank, assessments, analytics and item analysis (CSV export), student accounts, import, audit log, teacher password.

## Repository layout

| Path | |
|---|---|
| `index.html`, `config.js`, `assets/` | The website (no secrets; `config.js` holds only the public backend URL) |
| `content/` | Written by the backend when you publish: `content.enc`, `version.json`, `media/*.enc` (all encrypted) |
| `backend/` | The Apps Script files to install: `GynContent.gs` (new) and `Gyn.gs` (yours, plus a two-line hook) |
| `test/` | Tests: the real `.gs` files run in a Node harness against a simulated GitHub, plus browser tests |

## Development

`npm test` runs the backend tests (the real Apps Script files in a Node harness). `npm run test:e2e` runs the browser tests (Playwright + Chromium) against that backend: set-up, editing, pictures, question bank, assessments, publishing, the student flow, and the security rules. The test course in `test/fixtures/` is synthetic.
