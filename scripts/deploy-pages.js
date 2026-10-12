#!/usr/bin/env node
/**
 * Publish the static (GitHub Pages) build of the app.
 *
 * The platform build leaves `{{appName}}` / `{{appDescription}}` /
 * `{{appAvatar}}` placeholders in dist/client/index.html because those values
 * are normally substituted by the hosting platform. GitHub Pages does not run
 * that step, so without this script the deployed page would show a literal
 * `{{appName}}` browser title and broken favicon / OG tags.
 *
 * What it does:
 *   1. substitutes the placeholders with real values,
 *   2. copies dist/client into the gh-pages branch,
 *   3. adds 404.html (SPA fallback), .nojekyll and the CNAME,
 *   4. force-pushes the branch.
 *
 * Usage:
 *   npm run build:client
 *   GITHUB_TOKEN=<pat> node scripts/deploy-pages.js [--dry-run]
 *
 * The token is only ever used to build the push URL and is stripped from any
 * error message this script prints.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'dist', 'client');
const BRANCH = 'gh-pages';
const CNAME = 'shanghaitrade.cn';

// Values the platform would normally inject. `appAvatar` points at the
// favicon that already ships in client/public.
const PLACEHOLDERS = {
  appName: '商务邀约邮件助手',
  appDescription:
    '面向海外市场调研与客户开发的智能邀约与 CRM 系统：上传名录、自动访问官网、结合项目资料生成高度个性化的本地语言邮件与即时消息。',
  appAvatar: '/favicon.svg',
  appId: '',
  userId: '',
  tenantId: '',
  userName: '',
  csrfToken: '',
  environment: 'static',
  basename: '/',
};

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts });
}

/** Never let the token reach stdout/stderr. */
function sanitize(text, token) {
  return String(text).split(token).join('***');
}

function fail(message, token) {
  console.error(`✗ ${sanitize(message, token)}`);
  process.exit(1);
}

function substitutePlaceholders() {
  const htmlPath = path.join(SOURCE_DIR, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  for (const [key, value] of Object.entries(PLACEHOLDERS)) {
    // `{{key}}` in attributes, and `{{{key}}}` (raw, unescaped) variants.
    html = html.split(`{{{${key}}}}`).join(value);
    html = html.split(`{{${key}}}`).join(value);
  }
  fs.writeFileSync(htmlPath, html);

  // `{{{__platform__}}}` is deliberately left alone: the entry script relies on
  // JSON.parse() throwing on it to detect static hosting. Everything else must
  // have been substituted.
  const leftover = html
    .replace(/\{\{\{__platform__\}\}\}/g, '')
    .match(/\{\{+[^{}]+\}+\}/g);
  if (leftover) {
    throw new Error(`unsubstituted placeholders remain: ${leftover.join(', ')}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const token =
    args.find((a) => a.startsWith('--token='))?.slice('--token='.length) ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    '';

  if (!fs.existsSync(SOURCE_DIR)) {
    fail('dist/client not found - run `npm run build:client` first.', token);
  }
  if (!fs.existsSync(path.join(SOURCE_DIR, 'index.html'))) {
    fail('dist/client/index.html not found - the client build looks incomplete.', token);
  }

  let repo;
  try {
    repo = run('git', ['remote', 'get-url', 'origin'])
      .trim()
      .replace(/\.git$/, '')
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^https:\/\/[^@/]+@/, 'https://');
  } catch (err) {
    fail(`cannot read git remote "origin": ${err.message}`, token);
  }

  console.log(`→ repo:      ${repo}`);
  console.log(`→ source:    ${path.relative(ROOT, SOURCE_DIR)}`);
  console.log(`→ branch:    ${BRANCH}`);
  console.log(`→ cname:     ${CNAME}`);

  substitutePlaceholders();
  console.log('✓ placeholders substituted in index.html');

  // SPA fallback: GitHub Pages serves /404.html for unknown paths, so make it
  // an exact copy of the entry document and the router takes over from there.
  fs.copyFileSync(
    path.join(SOURCE_DIR, 'index.html'),
    path.join(SOURCE_DIR, '404.html'),
  );
  fs.writeFileSync(path.join(SOURCE_DIR, '.nojekyll'), '');
  fs.writeFileSync(path.join(SOURCE_DIR, 'CNAME'), `${CNAME}\n`);
  console.log('✓ wrote 404.html, .nojekyll, CNAME');

  if (dryRun) {
    console.log('✓ dry run - nothing pushed');
    return;
  }
  if (!token) {
    fail('no token: set GITHUB_TOKEN or pass --token=<pat>.', token);
  }

  const worktree = path.join(
    fs.mkdtempSync(path.join(require('os').tmpdir(), 'gh-pages-')),
  );
  try {
    // Publish an orphan-free branch: start from the current gh-pages tip so the
    // history stays linear, then replace its contents wholesale.
    let base = '';
    try {
      base = run('git', ['rev-parse', `origin/${BRANCH}`]).trim();
    } catch {
      base = '';
    }

    const addArgs = ['worktree', 'add', '--detach', worktree];
    if (base) addArgs.push(base);
    else addArgs.push('--no-commit');
    run('git', addArgs);

    for (const entry of fs.readdirSync(worktree)) {
      if (entry === '.git') continue;
      fs.rmSync(path.join(worktree, entry), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(SOURCE_DIR)) {
      fs.cpSync(
        path.join(SOURCE_DIR, entry),
        path.join(worktree, entry),
        { recursive: true },
      );
    }

    run('git', ['add', '-A'], { cwd: worktree });
    const status = run('git', ['status', '--porcelain'], { cwd: worktree });
    if (!status.trim()) {
      console.log('✓ nothing to deploy - gh-pages is already up to date');
      return;
    }
    run('git', ['-c', 'user.name=deploy-bot', '-c', 'user.email=deploy-bot@users.noreply.github.com',
      'commit', '-m', 'chore: deploy static build to GitHub Pages'], { cwd: worktree });

    const pushUrl = `https://x-access-token:${token}@${repo.replace('https://github.com/', 'github.com/')}.git`;
    try {
      run('git', ['push', '--force', pushUrl, `HEAD:refs/heads/${BRANCH}`], { cwd: worktree });
    } catch (err) {
      fail(`git push failed: ${err.stderr || err.message}`, token);
    }
    console.log(`✓ pushed to ${BRANCH} (https://${CNAME}/)`);
  } finally {
    try {
      run('git', ['worktree', 'remove', '--force', worktree]);
    } catch {
      /* best effort */
    }
  }
}

try {
  main();
} catch (err) {
  const token =
    process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  fail(err.stack || err.message, token);
}
