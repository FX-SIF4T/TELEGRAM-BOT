import fs from 'node:fs';
import path from 'node:path';

const WATCHED_DIRS = [
  { directory: path.join(process.cwd(), 'bot-cmds', 'commands'), kind: 'cmd' },
  { directory: path.join(process.cwd(), 'bot-cmds', 'events'), kind: 'event' }
];
const timers = new Map();
const watchers = [];

function getRepositoryCoordinates(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub repo must be a valid github.com repository URL.');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('GitHub auto-push only supports https://github.com repositories.');
  }
  const [owner, rawRepo, ...extra] = url.pathname.replace(/^\/|\/$/g, '').split('/');
  const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo || extra.length || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error('GitHub repo must have the form https://github.com/owner/repository.');
  }
  return { owner, repo };
}

function getGitHubSettings(kind) {
  const config = global.settings?.github ?? {};
  if (config.enabled !== true || config.autopush?.[kind] !== true) return null;

  const tokenEnv = config.tokenEnv ?? 'GITHUB_TOKEN';
  if (!/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) {
    throw new Error('github.tokenEnv must be an environment variable name.');
  }
  const token = process.env[tokenEnv];
  if (!token) {
    throw new Error(`GitHub auto-push is enabled but the ${tokenEnv} secret is not configured.`);
  }
  const { owner, repo } = getRepositoryCoordinates(config.repo);
  return {
    owner,
    repo,
    token,
    branch: config.branch || 'main',
    authorName: config.authorName || 'Telegram Bot',
    authorEmail: config.authorEmail || 'bot@users.noreply.github.com'
  };
}

function validatePushPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const permitted = /^bot-cmds\/(commands|events)\/[A-Za-z0-9_.-]+\.js$/.test(normalized);
  if (!permitted) {
    throw new Error('GitHub auto-push is limited to JavaScript command and event files.');
  }
  return normalized;
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    let message = `GitHub API request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      if (body?.message) message = `GitHub API: ${body.message}`;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export async function pushGitHubFile(relativePath, { deleted = false } = {}) {
  const normalizedPath = validatePushPath(relativePath);
  const remotePath = normalizedPath.replace(/^bot-cmds\//, 'apps/');
  const kind = normalizedPath.startsWith('bot-cmds/commands/') ? 'cmd' : 'event';
  const config = getGitHubSettings(kind);
  if (!config) return { skipped: true };

  const apiRoot = `https://api.github.com/repos/${config.owner}/${config.repo}/contents`;
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const fileUrl = `${apiRoot}/${encodedPath}`;
  const currentUrl = new URL(fileUrl);
  currentUrl.searchParams.set('ref', config.branch);
  let currentFile = null;
  try {
    currentFile = await githubRequest(currentUrl, config.token);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const message = `${deleted ? 'Delete' : 'Update'} ${remotePath}`;
  const committer = { name: config.authorName, email: config.authorEmail };
  const body = deleted
    ? { message, sha: currentFile?.sha, branch: config.branch, committer }
    : {
        message,
        content: fs.readFileSync(path.join(process.cwd(), normalizedPath)).toString('base64'),
        branch: config.branch,
        committer
      };

  if (deleted) {
    if (!currentFile?.sha) return { skipped: true, reason: 'file-not-found' };
    return githubRequest(fileUrl, config.token, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  if (currentFile?.sha) body.sha = currentFile.sha;
  return githubRequest(fileUrl, config.token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function queuePush(filePath, kind) {
  const config = global.settings?.github;
  if (config?.enabled !== true || config.autopush?.[kind] !== true) return;
  const relativePath = path.relative(process.cwd(), filePath);
  const normalized = relativePath.split(path.sep).join('/');
  if (!/^bot-cmds\/(commands|events)\/[A-Za-z0-9_.-]+\.js$/.test(normalized)) return;

  clearTimeout(timers.get(normalized));
  const timer = setTimeout(async () => {
    timers.delete(normalized);
    try {
      await pushGitHubFile(normalized, { deleted: !fs.existsSync(filePath) });
      console.log(`GitHub auto-push completed for ${normalized}.`);
    } catch (error) {
      console.error(`GitHub auto-push failed for ${normalized}: ${error.message}`);
    }
  }, 1200);
  timers.set(normalized, timer);
}

export function startGitHubAutoPush() {
  stopGitHubAutoPush();
  const config = global.settings?.github;
  if (config?.enabled !== true) return;
  const kinds = ['cmd', 'event'].filter((kind) => config.autopush?.[kind] === true);
  if (!kinds.length) return;
  try {
    for (const kind of kinds) getGitHubSettings(kind);
  } catch (error) {
    console.warn(`GitHub auto-push is not active: ${error.message}`);
    return;
  }

  for (const { directory, kind } of WATCHED_DIRS) {
    if (!kinds.includes(kind)) continue;
    try {
      const watcher = fs.watch(directory, (eventType, filename) => {
        if (!filename) return;
        queuePush(path.join(directory, filename.toString()), kind);
      });
      watcher.on('error', (error) => {
        console.error(`GitHub auto-push watcher failed for ${directory}: ${error.message}`);
      });
      watchers.push(watcher);
    } catch (error) {
      console.error(`GitHub auto-push watcher could not start for ${directory}: ${error.message}`);
    }
  }
}

export function stopGitHubAutoPush() {
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
