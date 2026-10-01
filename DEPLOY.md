# Deploying the private platform

This platform used to be a single public `index.html` on GitHub Pages. That design cannot keep content private, check passwords on a server, or hold a GitHub token safely, because GitHub Pages only serves files. The platform now runs as a **small Node.js server**. The server:

- shows a sign-in page (Student: one shared class password; Teacher: username and password);
- sends the course content and pictures **only to signed-in users**;
- checks the user's role **on the server** for every editing, upload and publishing request;
- keeps the teacher's work in a **draft** that students never see;
- **publishes** to students and commits the new version to GitHub. The GitHub token stays on the server.

The server has **no dependencies** beyond Node.js 18 or newer.

---

## 1. Make the content private on GitHub (important)

All the educational content (`content/content.json`) and pictures (`content/media/`) are stored in this repository. While the repository is **public**, anyone can read them on github.com, whatever the platform's login does.

1. **Make the repository private:** GitHub → repository **Settings** → **General** → *Danger Zone* → **Change visibility** → Private.
2. **Turn off GitHub Pages:** **Settings** → **Pages** → *Source*: **None**. GitHub Pages would otherwise serve every file in the repository, including `content/`, to anyone.

The old public link now only shows a short notice (`index.html`). The original single-file platform is still in the Git history (commit `2e8d5c7`).

## 2. Choose a host

Any service that runs Node.js and gives you a **persistent disk** works. Examples: Render, Railway, Fly.io, a university server, or a small VPS. The disk is where drafts, pictures not yet published, history and sign-in sessions are kept.

### Example: Render

1. render.com → **New** → **Web Service** → connect this GitHub repository.
2. **Runtime:** Node. **Build command:** *(leave empty)*. **Start command:** `npm start`.
3. **Disks** → Add disk → mount path `/var/data` (1 GB is plenty).
4. **Environment** → add the variables from section 3. Set `DATA_DIR=/var/data`, `TRUST_PROXY=1` and `COOKIE_SECURE=1`.
5. Deploy. Render gives you an `https://…onrender.com` address; that is the link for students. You can attach your own domain.

### Docker (any host)

```
docker build -t pathology-platform .
docker run -d -p 3000:3000 -v pathology-data:/data --env-file .env pathology-platform
```

Put the server behind HTTPS (the hosting service usually does this). Then set `TRUST_PROXY=1` and `COOKIE_SECURE=1`.

## 3. Environment variables

Set these in the host's dashboard. They are never in the code or the repository. `.env.example` lists them all.

| Variable | What it is |
|---|---|
| `STUDENT_PASSWORD_HASH` | The shared class password, as a hash (see below). |
| `ADMIN_USERNAME` | Teacher sign-in name (default `admin`). |
| `ADMIN_NAME` | Name shown in the platform and in publish history. |
| `ADMIN_PASSWORD_HASH` | Teacher password, as a hash. |
| `DATA_DIR` | Folder on the persistent disk (e.g. `/var/data`). |
| `TRUST_PROXY` | `1` behind an HTTPS proxy (Render, Railway, Fly.io, nginx). |
| `COOKIE_SECURE` | `1` in production (cookies only over HTTPS). |
| `GITHUB_TOKEN` | Token used to publish to GitHub (see section 4). |
| `GITHUB_REPO` | `third-year-med/Vulvar-pathology` |
| `GITHUB_BRANCH` | Branch that holds the live content, usually `main`. |
| `SESSION_HOURS_STUDENT` / `SESSION_HOURS_ADMIN` | How long a sign-in lasts (defaults 168 and 12 hours). |

**Making a password hash.** On any computer with Node.js, in this folder, run `npm run hash-password`. Type the password (it is not shown), then copy the line that starts with `scrypt$…` into the variable. Passwords must be at least 8 characters.

**Changing a password.** Put the new hash in the variable and restart. Everyone who signed in with the old password is signed out automatically.

## 4. GitHub publishing (the token)

1. GitHub → your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. *Repository access*: **Only select repositories** → this repository.
3. *Permissions* → *Repository permissions* → **Contents: Read and write**. Nothing else is needed.
4. Copy the token into the host's `GITHUB_TOKEN` variable. Do **not** put it in any file, chat or email. If it is ever exposed, delete it on GitHub and make a new one.

Each **Publish** then makes one commit that contains `content/content.json` and any new pictures. The commit message is the description you typed. These commits are your version history, and the platform can restore any of them (Faculty tools → Content & publishing → History).

If the token is missing, publishing still works, but only on this server. The editor warns you about this.

**Auto-deploy.** If the host redeploys on every push to `main`, each publish causes a short restart. That is harmless because drafts, sessions and the live copy are on the persistent disk. You may turn auto-deploy off, because the server already updates itself when you publish.

## 5. More teacher accounts

Create `users.json` in `DATA_DIR`:

```json
[
  { "username": "colleague", "name": "Dr Colleague", "role": "admin", "passwordHash": "scrypt$…" }
]
```

Every account is checked on the server. Removing an account, or changing its hash, signs it out.

## 6. Local test run

```
cp .env.example .env        # then fill in the passwords (or STUDENT_PASSWORD / ADMIN_PASSWORD for a quick test)
npm start                   # http://localhost:3000
npm test                    # server tests
npm install && npm run test:e2e   # browser tests (needs Chromium; set PW_CHROMIUM=/path/to/chrome)
```

## 7. How it fits together (for a developer)

```
public/            app shell, served to everyone (no content inside)
  index.html, app.css
  boot.js          sign-in screen; loads content after sign-in; loads the editor for teachers
  app.js           the learner app (Learn, Practice, Assessments, Review, Presentation)
server/
  server.js        HTTP routes, security headers, CSRF and origin checks
  auth.js          shared student login, teacher accounts, sessions, roles → permissions
  content-store.js live content, draft, history, media, publish
  validate.js      content validation (question/option/answer integrity), change summary
  github.js        commits through the GitHub Git Data API (token stays here)
  admin/editor.js  teacher editor, sent ONLY to teacher sessions (/admin/editor.js)
content/
  content.json     all educational content (the source of truth students see)
  media/           pictures, named by their SHA-256 (stored once, reused anywhere)
tools/             migrate-legacy.js (one-off import from the old file), hash-password.js
test/              api.test.js (server), e2e.test.js (browser)
```

**Roles and permissions** are defined in `server/auth.js` (`ROLES`). Every API route declares the permission it needs. To add **individual student accounts** later:

1. add principals with role `student` to `findUser()` (for example from `users.json` or a database);
2. add a username field to the Student tab in `boot.js`.

Sessions, permissions and the app already work per user. Per-student progress can then move from the browser to a new API (`/api/progress`), keyed by the session's user id. The shared password never identifies a student, so it is not used for progress or results.

**Questions** have permanent ids (`id`). Every answer option has a permanent id (`optionIds`, kept in step with `options`). The correct answer is `answer`: an option index, or a list of indexes for select-all. The server rejects any draft in which these do not match. Assessment attempts store `{ questionId: optionId }`, never positions.
