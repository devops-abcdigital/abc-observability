#!/usr/bin/env node
// Guarded release: the single source of truth for releasing packages from this repo.
// A future CI pipeline (GitHub Actions or Jenkins) must call `npm run release` instead of copying these steps.
//
//   npm run release             check, version, commit, publish, tag, push, GitHub Release
//   npm run release -- --dry-run   run every check plus `npm publish --dry-run`; no commit, no push
//
// Every check stops the script before anything is published. Tokens are never printed.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://npm.pkg.github.com';
const RELEASE_BRANCH = 'main';
const REMOTE = 'origin';
const RELEASE_COMMIT_MESSAGE = 'chore(release): version packages';
const DRY_RUN = process.argv.includes('--dry-run');

class ReleaseError extends Error {}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
}

function run(command, args, { capture = false } = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

/** npm through the running npm CLI: works on Windows, where `npm` is a .cmd shim that needs a shell. */
function npm(args, options) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new ReleaseError('Run this through npm: `npm run release`.');
  return run(process.execPath, [npmCli, ...args], options);
}

function git(args) {
  return run('git', args, { capture: true }).trim();
}

function step(message) {
  process.stdout.write(`\n▶ ${message}\n`);
}

// ---------------------------------------------------------------------------- checks

function checkNodeVersion() {
  const required = String(readJson('package.json').engines.node);
  const current = process.versions.node.split('.')[0];
  if (current !== required)
    throw new ReleaseError(`Node ${required} is required, this is Node ${process.versions.node}.`);
}

function checkBranch() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== RELEASE_BRANCH) throw new ReleaseError(`Release from "${RELEASE_BRANCH}", not "${branch}".`);
}

function checkCleanTree() {
  const status = git(['status', '--porcelain']);
  if (status !== '') throw new ReleaseError(`Uncommitted changes:\n${status}`);
}

function checkInSyncWithRemote() {
  git(['fetch', REMOTE, RELEASE_BRANCH]);
  const local = git(['rev-parse', 'HEAD']);
  const remote = git(['rev-parse', `${REMOTE}/${RELEASE_BRANCH}`]);
  if (local !== remote) {
    throw new ReleaseError(
      `Local ${RELEASE_BRANCH} (${local.slice(0, 7)}) differs from ${REMOTE}/${RELEASE_BRANCH} (${remote.slice(0, 7)}).`,
    );
  }
}

function pendingChangesets() {
  const dir = path.join(ROOT, '.changeset');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith('.md') && file !== 'README.md');
}

function checkHasChangeset() {
  if (pendingChangesets().length === 0)
    throw new ReleaseError('No pending changeset: nothing to release. Add one with `npx changeset`.');
}

function checkRegistryLogin() {
  try {
    const user = npm(['whoami', `--registry=${REGISTRY}`], { capture: true }).trim();
    process.stdout.write(`  logged in to ${REGISTRY} as ${user}\n`);
  } catch {
    throw new ReleaseError(
      `Not logged in to ${REGISTRY}. Put a token with write:packages in ~/.npmrc (see docs/releasing.md).`,
    );
  }
}

function checkQualityGates() {
  npm(['run', 'verify']);
  npm(['test']);
  npm(['run', 'build']);
}

// ---------------------------------------------------------------------------- release

function publishablePackages() {
  const workspace = path.join(ROOT, 'packages');
  return readdirSync(workspace)
    .map((dir) => path.join('packages', dir))
    .filter((dir) => existsSync(path.join(ROOT, dir, 'package.json')))
    .filter((dir) => readJson(path.join(dir, 'package.json')).private !== true);
}

function releaseNotes(packageDir, version) {
  const changelog = path.join(ROOT, packageDir, 'CHANGELOG.md');
  if (!existsSync(changelog)) return `Release ${version}`;
  const lines = readFileSync(changelog, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return `Release ${version}`;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function dryRunPublish() {
  for (const dir of publishablePackages()) {
    step(`npm publish --dry-run (${dir})`);
    npm(['publish', '--dry-run', `--workspace=${dir}`]);
  }
}

function release() {
  step('changeset version');
  npm(['exec', '--', 'changeset', 'version']);
  git(['add', '-A']);
  git(['commit', '-m', RELEASE_COMMIT_MESSAGE]);

  const tagsBefore = new Set(git(['tag', '--list']).split('\n'));
  step('changeset publish');
  npm(['exec', '--', 'changeset', 'publish']);
  const newTags = git(['tag', '--list'])
    .split('\n')
    .filter((tag) => tag !== '' && !tagsBefore.has(tag));

  step(`git push ${REMOTE} ${RELEASE_BRANCH} + ${newTags.length} tag(s)`);
  run('git', ['push', REMOTE, RELEASE_BRANCH]);
  for (const tag of newTags) run('git', ['push', REMOTE, tag]);

  for (const dir of publishablePackages()) {
    const { name, version } = readJson(path.join(dir, 'package.json'));
    const tag = `${name}@${version}`;
    if (!newTags.includes(tag)) continue;
    step(`gh release create ${tag}`);
    run('gh', ['release', 'create', tag, '--title', tag, '--notes', releaseNotes(dir, version)]);
  }
  if (newTags.length === 0) process.stdout.write('\nNothing new was published (versions already on the registry).\n');
}

// ---------------------------------------------------------------------------- main

const CHECKS = [
  ['Node version matches engines', checkNodeVersion],
  [`on branch ${RELEASE_BRANCH}`, checkBranch],
  ['working tree is clean', checkCleanTree],
  [`in sync with ${REMOTE}/${RELEASE_BRANCH}`, checkInSyncWithRemote],
  ['pending changeset exists', checkHasChangeset],
  ['registry token is valid', checkRegistryLogin],
  ['verify, test and build pass', checkQualityGates],
];

try {
  for (const [label, check] of CHECKS) {
    step(`check: ${label}`);
    check();
  }
  if (DRY_RUN) {
    dryRunPublish();
    process.stdout.write('\n✔ Dry run passed. Nothing was committed, published or pushed.\n');
  } else {
    release();
    process.stdout.write('\n✔ Release finished.\n');
  }
} catch (error) {
  const message = error instanceof ReleaseError ? error.message : `Command failed: ${error.message}`;
  process.stderr.write(`\n✖ Release stopped: ${message}\n`);
  process.exit(1);
}
