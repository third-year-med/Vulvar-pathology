'use strict';
/* Server-side GitHub publishing through the Git Data API: one commit containing content.json and any
   new media files. The token is read from the server environment only; it is never logged, returned
   to the browser or written into the repository. */

function createGitHub(gh) {
  const configured = !!(gh.token && gh.owner && gh.repo);
  function api(method, p, body, accept) {
    return fetch(gh.apiUrl + '/repos/' + encodeURIComponent(gh.owner) + '/' + encodeURIComponent(gh.repo) + p, {
      method: method,
      headers: { Authorization: 'Bearer ' + gh.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pathology-platform', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (accept && r.ok) return r.text();
      return r.text().then(function (t) {
        let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!r.ok) {
          const e = new Error('GitHub ' + method + ' ' + p.split('?')[0] + ' failed (' + r.status + ')' + (j && j.message ? ': ' + j.message : ''));
          e.status = r.status; throw e;
        }
        return j;
      });
    });
  }
  function repoPath(rel) { return (gh.contentPath ? gh.contentPath + '/' : '') + rel; }

  /* files: [{ rel: 'content.json' | 'media/abc.jpg', buffer }] */
  function commitFiles(files, message, author) {
    function attempt(left) {
      let headSha;
      return api('GET', '/git/ref/heads/' + encodeURIComponent(gh.branch)).then(function (ref) {
        headSha = ref.object.sha;
        return api('GET', '/git/commits/' + headSha);
      }).then(function (head) {
        return Promise.all(files.map(function (f) {
          return api('POST', '/git/blobs', { content: f.buffer.toString('base64'), encoding: 'base64' }).then(function (b) { return { path: repoPath(f.rel), mode: '100644', type: 'blob', sha: b.sha }; });
        })).then(function (tree) { return api('POST', '/git/trees', { base_tree: head.tree.sha, tree: tree }); });
      }).then(function (tree) {
        const who = { name: author && author.name ? author.name + ' (via platform)' : gh.committerName, email: gh.committerEmail, date: new Date().toISOString() };
        return api('POST', '/git/commits', { message: message, tree: tree.sha, parents: [headSha], author: who, committer: { name: gh.committerName, email: gh.committerEmail, date: who.date } });
      }).then(function (commit) {
        return api('PATCH', '/git/refs/heads/' + encodeURIComponent(gh.branch), { sha: commit.sha, force: false }).then(function () {
          return { sha: commit.sha, url: 'https://github.com/' + gh.owner + '/' + gh.repo + '/commit/' + commit.sha };
        });
      }).catch(function (e) {
        // Someone else pushed in between (not a fast-forward): rebuild the commit on the new head once.
        if (left > 0 && (e.status === 422 || e.status === 409)) return attempt(left - 1);
        throw e;
      });
    }
    return attempt(1);
  }
  function listContentCommits(n) {
    return api('GET', '/commits?sha=' + encodeURIComponent(gh.branch) + '&path=' + encodeURIComponent(repoPath('content.json')) + '&per_page=' + (n || 20)).then(function (list) {
      return (list || []).map(function (c) { return { sha: c.sha, message: c.commit.message, date: c.commit.author && c.commit.author.date, author: c.commit.author && c.commit.author.name, url: c.html_url }; });
    });
  }
  function contentAt(sha) {
    if (!/^[a-f0-9]{7,40}$/.test(sha)) return Promise.reject(new Error('Invalid version id.'));
    return api('GET', '/contents/' + repoPath('content.json').split('/').map(encodeURIComponent).join('/') + '?ref=' + sha, null, 'application/vnd.github.raw+json').then(function (t) { return JSON.parse(t); });
  }
  return { configured: configured, commitFiles: commitFiles, listContentCommits: listContentCommits, contentAt: contentAt, info: { repo: configured ? gh.owner + '/' + gh.repo : '', branch: gh.branch } };
}

module.exports = { createGitHub: createGitHub };
