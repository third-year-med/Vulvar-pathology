# Vulvar Pathology — Exam Review (private teaching platform)

An interactive teaching platform covering Learn, Practice, Assessments, Last-Minute Review and Presentation Mode. Students sign in with a shared class password. The teacher signs in separately and can edit everything through the platform itself, without touching code.

- **Setting it up on a server:** see [DEPLOY.md](DEPLOY.md).
- **Using the editor:** see below.

## For the teacher: editing the platform

1. **Sign in** on the **Teacher** tab.
2. A bar appears under the menu. It shows **DRAFT**: you are looking at your working copy, which students cannot see.
3. Tick **✏️ Edit mode**.
   - **Text:** click any paragraph, heading, list, table or box in a lecture. Change it in the panel and press **Save**. The toolbar has bold, italic, headings, lists, links, tables (a grid editor), coloured boxes, labels and pictures. Pasting from Word or a web page keeps bold, italics, lists, links and tables.
   - **Sections and learning blocks:** use the buttons above each one: ✏️ Edit, ↑ ↓ to move, ⧉ Duplicate, ＋ to add, 🗑 to delete. The *＋ Add here…* menu at the end of every text adds paragraphs, headings, lists, tables, boxes or pictures.
   - **Pictures:** click a picture, then **Upload new picture** or **Choose from library**. You can also change the caption, title, description, alternative text, source, size and alignment. The same picture changes everywhere it is used.
   - **Questions:** use **✏️ Edit question** on any question, or go to **Faculty tools → Question banks**. You can change the text, answer options, correct answer, explanation, picture, linked block and difficulty. You can also add, duplicate, reorder or delete questions. Assessment questions can be **retired**, so students' past results stay intact.
   - **Last-minute review** items and **Presentation** slides are edited the same way.
4. Changes are **saved to the draft automatically**. The bar shows *Draft saved*. **↶ Undo** and **↷ Redo** are always available.
5. **👁 Preview** shows the draft exactly as students will see it.
6. **🚀 Publish…** lists what changed, checks for problems (for example a question with no correct answer), and then makes the draft live for students. It also saves the new version to GitHub.
7. **Faculty tools → Content & publishing** shows the status and the full **history**. Any earlier version can be restored into the draft, previewed and published again.

Deleting content always asks for confirmation and can be undone until you leave the page. Nothing reaches students until you publish.

## Students

Students open the platform link, choose **Student**, and enter the class password. They see the normal learning platform with no editing tools. Their practice progress and assessment results are kept in their own browser. They can download a result file and send it to the teacher (**Faculty tools → Results & item analysis**).

## Development

`npm start` runs the server. `npm test` runs the server tests, and `npm run test:e2e` runs the browser tests. The architecture is described in [DEPLOY.md](DEPLOY.md) §7.
