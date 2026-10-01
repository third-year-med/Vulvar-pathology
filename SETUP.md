# Setting up the platform (Google Apps Script + GitHub Pages)

The platform has two parts:

| Part | Where | What it holds |
|---|---|---|
| **Backend** | Your existing Google Apps Script project (Code.gs + Gyn.gs + **GynContent.gs**) and its Google Sheet | Teacher password, student accounts, question bank with answers, assessments, attempts, results, progress, the content **draft** and its history, the GitHub token |
| **Website** | This GitHub repository, served by GitHub Pages | `index.html`, `config.js`, `assets/` (the app), and `content/` — the published course and pictures, **encrypted** |

No other server is needed. Nothing secret is in this repository: no passwords, no content key, no GitHub token. The course content is encrypted with the module's key (`CONTENT_KEYS` in Code.gs). The backend gives that key only to a signed-in student or teacher.

You need to do steps 1–5 once. Each takes a few minutes.

---

## 1. Add the new file to your Apps Script project

1. Open your Apps Script project.
2. **Files → ＋ → Script**, and name it `GynContent`. Paste the whole content of [`backend/GynContent.gs`](backend/GynContent.gs) into it.
3. Open **Gyn.gs**, find the `default:` case at the end of the `gynTeacher_` function, and make it look like this (two lines are new):

   ```js
       default:
         if (typeof gynContentAdmin_ === 'function') { var cr = gynContentAdmin_(module, p, now); if (cr) return cr; }
         return gynErr_('Unknown action: ' + a, 'badaction');
   ```

   ([`backend/Gyn.gs`](backend/Gyn.gs) is your Gyn.gs with exactly this change, if you prefer to paste the whole file.)
4. Save.

## 2. Check Code.gs

In Code.gs, check two settings:

- `STUDENT_AUTH_MODULES` must contain `vulva: true` (and `vagina: true` for the vagina site).
- `CONTENT_KEYS.vulva` must be set. **Keep the key your connected page already uses.** The set-up in step 6 opens that page with it.
  If no key is set yet, make one: open any web page, press F12 → Console, paste
  `btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))`, and put the result (44 characters, ending in `=`) into `CONTENT_KEYS`.
  Never put this key in the repository.

## 3. GitHub token (lets the backend publish)

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access:* **Only select repositories** → this repository (and the vagina site's repository, if you will use one).
   - *Permissions → Repository permissions → **Contents: Read and write***. Nothing else.
2. In Apps Script: **Project Settings (⚙) → Script properties → Add script property**:

   | Property | Value |
   |---|---|
   | `GITHUB_TOKEN` | the token |
   | `GITHUB_REPO` | `third-year-med/Vulvar-pathology` |
   | `GITHUB_BRANCH` | `main` (the branch GitHub Pages serves) |
   | `GITHUB_REPO_VAGINA` | *(optional)* the vagina site's repository, e.g. `third-year-med/Vaginal-pathology` |

   The token stays in Script properties. It is never sent to a browser, never shown, and never committed.
3. In the editor, choose the function **`gyncAuthorize`** and press **▶ Run**. Allow the permission Google asks for ("connect to an external service"). The log should say `OK — can reach …`.
4. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** Editing the existing deployment keeps the same web-app URL.

## 4. Point the website at the backend

Edit [`config.js`](config.js) in this repository and set `backendUrl` to your web-app URL (it ends in `/exec`):

```js
window.VULVA_CONFIG = { backendUrl: 'https://script.google.com/macros/s/…/exec', module: 'vulva', repo: 'third-year-med/Vulvar-pathology', branch: 'main', title: 'Vulvar Pathology — Exam Review' };
```

This URL is not secret. Every request still needs a valid sign-in.

## 5. Turn on GitHub Pages

Go to **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
After a minute the site is at `https://third-year-med.github.io/Vulvar-pathology/`.

> GitHub Pages needs a public repository on a free plan. That is fine here: the published course and pictures are encrypted, and the questions and answers never leave the backend.

## 6. First sign-in: set up the course

1. Open the site → **Teacher** tab → sign in with the Vulvar Pathology teacher password. If the module has none yet, use *First time? Create the teacher password*.
2. Nothing has been published from the editor yet, so the set-up window opens. Choose your **connected page** (`vulva-connected.html`).
   It is decrypted in your browser with the module key. Its pictures are encrypted and stored in the repository by the backend, and the course becomes your **draft**.
   Questions in the file are never put into the published content.
3. Look around, use **👁 Preview**, then **🚀 Publish…**. Students now get the course from the site.
4. **Question bank:** if you already imported it with the connected edition, nothing more is needed. It is the same backend and the same sheets. Otherwise use **Faculty tools → Import, audit & account → Import** with your `vulva_seed.json`. Keep that file private: it contains the answer keys.
5. **Assessments** and **Student accounts** are in the Teacher portal (Faculty tools). Students use the same accounts as on the other modules of the platform.

## The vagina module

Same app, same backend. Put a copy of `index.html`, `config.js` and `assets/` into the vagina site's repository, and set `module: 'vagina'`, `repo`, and `title` in its `config.js`. Then add `GITHUB_REPO_VAGINA` (step 3), set `CONTENT_KEYS.vagina`, turn on Pages, and run step 6 with `vagina-connected.html`.

## Day to day

- **Edit:** Faculty tools → Content & publishing, or just turn on **✏️ Edit mode** in the bar at the top. Every change is saved automatically to the draft.
- **Questions:** practice and assessment questions are in the Teacher portal → **Question bank**. They can also be edited straight from Learn Mode in edit mode. Each edit becomes a new version, and attempts keep the version they were given. Section checks (Pathology Challenge) are part of the Learn content.
- **Publish:** 🚀 Publish… shows what changed, checks for problems, encrypts, and commits. GitHub Pages updates within a minute or two.
- **Undo a publication:** Content & publishing → History. Restore any spreadsheet copy or any GitHub version into the draft, then publish it.

## Troubleshooting

| Message | What to do |
|---|---|
| "The platform address is not configured yet" | Step 4 |
| "Publishing needs GitHub settings…" | Step 3 (and run `gyncAuthorize`) |
| "The content key for this module is missing…" | Step 2 |
| "…encrypted with a different key than this module's" | The page you chose belongs to another module, or `CONTENT_KEYS` was changed. Use that module's connected page, or put the old key back. |
| Students see an old version | GitHub Pages can take a couple of minutes. Reloading the page fetches the newest version. |
