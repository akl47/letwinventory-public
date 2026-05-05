/**
 * Lightweight GitHub REST client + per-feature sync logic. Uses raw https
 * (no Octokit dep) since calls are simple and we already have the helper
 * pattern elsewhere in the codebase.
 */
const https = require('https');

const PR_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;

function parsePrURL(url) {
  if (!url) return null;
  const m = url.match(PR_URL_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), number: parseInt(m[3], 10) };
}

function ghRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'letwinventory-feature-sync',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    if (body) {
      const json = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(json);
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({
          status: res.statusCode,
          data: parsed,
          rateLimit: {
            remaining: parseInt(res.headers['x-ratelimit-remaining'] || '0', 10),
            reset: parseInt(res.headers['x-ratelimit-reset'] || '0', 10),
          },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchPR({ owner, repo, number }, token) {
  return ghRequest('GET', `/repos/${owner}/${repo}/pulls/${number}`, token);
}

async function fetchAllPRCommits({ owner, repo, number }, token) {
  // GitHub paginates at 30/page by default; PR commits cap at 250 across pages.
  // ?per_page=100 keeps round-trips low; we follow Link header up to 4 pages.
  const all = [];
  let page = 1;
  while (page <= 4) {
    const res = await ghRequest('GET', `/repos/${owner}/${repo}/pulls/${number}/commits?per_page=100&page=${page}`, token);
    if (res.status !== 200) {
      throw Object.assign(new Error('GitHub commit fetch failed'), { status: res.status, data: res.data });
    }
    if (!Array.isArray(res.data)) break;
    all.push(...res.data);
    if (res.data.length < 100) break;
    page++;
  }
  return all;
}

/**
 * Given a DesignFeature and a PAT, fetch the PR + commits and return the
 * fields to write back. Throws on any GitHub error so callers can surface a
 * useful message; returns `{ updates, commitRefs }` on success.
 */
async function syncFeatureFromGitHub(feature, token) {
  if (!feature.prURL) {
    throw Object.assign(new Error('Feature has no prURL set; cannot sync'), { status: 400 });
  }
  const parsed = parsePrURL(feature.prURL);
  if (!parsed) {
    throw Object.assign(new Error(`prURL is not a recognized GitHub PR URL: ${feature.prURL}`), { status: 400 });
  }

  const prRes = await fetchPR(parsed, token);
  if (prRes.status === 401) {
    throw Object.assign(new Error('GitHub authentication failed — check that your PAT is valid and has repo access'), { status: 401 });
  }
  if (prRes.status === 404) {
    throw Object.assign(new Error(`PR not found at ${feature.prURL} — your PAT may not have access to this repo`), { status: 404 });
  }
  if (prRes.status !== 200) {
    throw Object.assign(new Error(`GitHub returned ${prRes.status}: ${JSON.stringify(prRes.data).slice(0, 200)}`), { status: prRes.status });
  }
  const pr = prRes.data;

  const ghCommits = await fetchAllPRCommits(parsed, token);

  // Derive review state from PR fields.
  // 'open' | 'closed' | 'merged'
  let prState = pr.state;
  if (prState === 'closed' && pr.merged) prState = 'merged';

  const commitRefs = ghCommits.map((c) => ({
    sha: c.sha,
    url: c.html_url,
    subject: (c.commit && c.commit.message ? c.commit.message.split('\n')[0] : '').slice(0, 200),
  }));

  return {
    updates: {
      prState,
      prTitle: (pr.title || '').slice(0, 500),
      prMergedAt: pr.merged_at || null,
      prHeadSha: pr.head && pr.head.sha ? pr.head.sha : null,
      branchName: feature.branchName || (pr.head && pr.head.ref) || null,
      lastSyncedAt: new Date(),
      commitRefs,
    },
    rateLimit: prRes.rateLimit,
  };
}

function parseRepoString(repo) {
  if (!repo || typeof repo !== 'string') return null;
  const m = repo.trim().match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function ghGraphQL(query, variables, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: '/graphql',
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'letwinventory-feature-sync',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const BRANCHES_QUERY = `
  query Branches($owner: String!, $repo: String!, $first: Int!) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef { name }
      refs(refPrefix: "refs/heads/", first: $first, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes {
          name
          target {
            ... on Commit {
              oid
              committedDate
              messageHeadline
              url
              author { name email }
              associatedPullRequests(first: 5) {
                nodes { number url state title isDraft }
              }
            }
          }
        }
      }
      closedPRs: pullRequests(first: $first, states: [CLOSED, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          url
          state
          title
          isDraft
          headRefName
          updatedAt
          mergeCommit {
            oid
            committedDate
            messageHeadline
            url
            author { name email }
          }
        }
      }
    }
  }
`;

/**
 * Returns up to `limit` branches in the repo sorted by their head commit
 * date desc, each with associated PRs.
 */
async function listBranches({ owner, repo }, token, limit = 100) {
  const res = await ghGraphQL(BRANCHES_QUERY, { owner, repo, first: Math.min(limit, 100) }, token);
  if (res.status === 401) {
    throw Object.assign(new Error('GitHub authentication failed — check that your PAT is valid and has Pull requests: Read access'), { status: 401 });
  }
  if (res.status !== 200) {
    throw Object.assign(new Error(`GitHub returned ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`), { status: res.status });
  }
  if (res.data && res.data.errors && res.data.errors.length) {
    const msg = res.data.errors.map(e => e.message).join('; ');
    throw Object.assign(new Error(`GitHub GraphQL error: ${msg}`), { status: 400 });
  }
  const repoData = res.data && res.data.data && res.data.data.repository;
  if (!repoData) {
    throw Object.assign(new Error(`Repository ${owner}/${repo} not found or not accessible with this PAT`), { status: 404 });
  }
  const defaultBranch = repoData.defaultBranchRef && repoData.defaultBranchRef.name;
  const nodes = (repoData.refs && repoData.refs.nodes) || [];
  const liveBranches = nodes
    .filter(n => n && n.target)
    .map(n => ({
      name: n.name,
      sha: n.target.oid,
      committedDate: n.target.committedDate,
      subject: n.target.messageHeadline || '',
      commitURL: n.target.url,
      author: n.target.author && n.target.author.name ? n.target.author.name : null,
      deleted: false,
      pulls: ((n.target.associatedPullRequests && n.target.associatedPullRequests.nodes) || [])
        .map(p => ({
          number: p.number,
          url: p.url,
          state: p.state ? p.state.toLowerCase() : null,
          title: p.title,
          isDraft: !!p.isDraft,
        })),
    }));

  // Synthesize "deleted branch" rows from closed/merged PRs whose head ref no
  // longer exists in refs/heads/.
  const liveNames = new Set(liveBranches.map(b => b.name));
  const closedPRs = (repoData.closedPRs && repoData.closedPRs.nodes) || [];
  const deletedByName = new Map();
  for (const pr of closedPRs) {
    if (!pr || !pr.headRefName) continue;
    if (liveNames.has(pr.headRefName)) continue;
    const existing = deletedByName.get(pr.headRefName);
    const prSummary = {
      number: pr.number,
      url: pr.url,
      state: pr.state ? pr.state.toLowerCase() : null,
      title: pr.title,
      isDraft: !!pr.isDraft,
    };
    if (!existing) {
      deletedByName.set(pr.headRefName, {
        name: pr.headRefName,
        sha: pr.mergeCommit && pr.mergeCommit.oid || null,
        committedDate: (pr.mergeCommit && pr.mergeCommit.committedDate) || pr.updatedAt,
        subject: (pr.mergeCommit && pr.mergeCommit.messageHeadline) || pr.title || '',
        commitURL: (pr.mergeCommit && pr.mergeCommit.url) || pr.url,
        author: pr.mergeCommit && pr.mergeCommit.author && pr.mergeCommit.author.name || null,
        deleted: true,
        pulls: [prSummary],
      });
    } else {
      existing.pulls.push(prSummary);
    }
  }

  return {
    defaultBranch,
    branches: [...liveBranches, ...deletedByName.values()],
  };
}

/**
 * Returns up to ~100 commits on a branch (newest first) via REST.
 */
async function listBranchCommits({ owner, repo }, branch, token, limit = 100) {
  const path = `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${Math.min(limit, 100)}`;
  const res = await ghRequest('GET', path, token);
  if (res.status === 401) {
    throw Object.assign(new Error('GitHub authentication failed — check that your PAT is valid'), { status: 401 });
  }
  if (res.status === 404) {
    throw Object.assign(new Error(`Branch '${branch}' or repo ${owner}/${repo} not found`), { status: 404 });
  }
  if (res.status !== 200) {
    throw Object.assign(new Error(`GitHub returned ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`), { status: res.status });
  }
  if (!Array.isArray(res.data)) {
    throw Object.assign(new Error('Unexpected response from GitHub commits endpoint'), { status: 500 });
  }
  return res.data.map(c => ({
    sha: c.sha,
    url: c.html_url,
    subject: (c.commit && c.commit.message ? c.commit.message.split('\n')[0] : '').slice(0, 200),
    author: c.commit && c.commit.author && c.commit.author.name || null,
    committedDate: c.commit && c.commit.author && c.commit.author.date || null,
  }));
}

module.exports = {
  syncFeatureFromGitHub,
  parsePrURL,
  parseRepoString,
  listBranches,
  listBranchCommits,
};
