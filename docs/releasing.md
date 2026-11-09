# Releasing

Packages are published to GitHub Packages (`https://npm.pkg.github.com`) under the `@devops-abcdigital` scope.
Releases run on GitHub Actions through the
[Release workflow](https://github.com/devops-abcdigital/abc-observability/blob/main/.github/workflows/release.yml), which
calls one guarded script, `npm run release`
([`scripts/release.mjs`](https://github.com/devops-abcdigital/abc-observability/blob/main/scripts/release.mjs)). The
workflow's own `GITHUB_TOKEN` publishes, so nobody needs a personal `write:packages` token.

## Release owners

Only these people publish. Keep the list at one or two names, and add them as required reviewers of the `release`
environment (Settings → Environments → `release`, created by the first run) so a run waits for their approval.

| Name             | GitHub           |
| ---------------- | ---------------- |
| _to be assigned_ | _to be assigned_ |

## Day to day: changesets

Every PR that changes `packages/*` includes a changeset:

```bash
npx changeset          # pick the package, patch/minor/major, write the CHANGELOG line
```

Commit the generated `.changeset/*.md` with the PR.

## Cut a release (GitHub Actions)

1. Merge the PRs with their changesets into `main`.
2. Open **Actions → Release → Run workflow**, keep the branch `main`, leave **Dry run** ticked, and run it. It runs
   every check and `npm publish --dry-run`, and changes nothing.
3. When the dry run is green, run the workflow again with **Dry run** unticked. It publishes, pushes the
   `chore(release): version packages` commit and the tag to `main`, and creates the GitHub Release.

The workflow needs `main` to accept pushes from GitHub Actions. If `main` gets branch protection, allow the
`github-actions[bot]` to bypass it or the push step fails after publishing (see below).

## Cut a release from your machine (fallback)

### One-time setup

1. Create a GitHub personal access token (classic) with the `write:packages` scope (it includes
   `read:packages`). Authorize it for the `devops-abcdigital` organization if SSO asks.
2. Put it in your user-level `~/.npmrc`, never in the repository:

   ```ini
   //npm.pkg.github.com/:_authToken=<token>
   ```

3. Check: `npm whoami --registry=https://npm.pkg.github.com` prints your GitHub username.
4. Install and log in to the GitHub CLI (`gh auth login`); the script creates the GitHub Release with it.
5. Use Node 24 (`nvm use`).

### Run

```bash
git checkout main
git pull
npm run release -- --dry-run   # all checks + npm publish --dry-run, changes nothing
npm run release
```

## What the script checks and does

Both routes run the same script. It stops **before publishing** if any check fails:

| Check                                                         | Fix                                                 |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Node major matches `engines` (24)                             | `nvm use`                                           |
| current branch is `main`                                      | `git checkout main`                                 |
| no uncommitted changes                                        | commit or stash                                     |
| `main` equals `origin/main` after fetch                       | `git pull` (or push your local commits via a PR)    |
| at least one pending changeset                                | nothing to release, or add one with `npx changeset` |
| registry token: `npm whoami` works (on Actions: token is set) | fix the token in `~/.npmrc`                         |
| `npm run verify`, `npm test`, `npm run build` pass            | fix the failure on `main` first                     |

When every check passes it runs, in order:

1. `changeset version`: bumps versions and writes `CHANGELOG.md`;
2. commits `chore(release): version packages`;
3. `changeset publish`: publishes new versions and creates git tags such as
   `@devops-abcdigital/observability-node@0.1.0`;
4. pushes `main` and the new tags to `origin`;
5. `gh release create` for each new tag, with the notes from the CHANGELOG.

The script never prints `~/.npmrc` or token values.

## If a release fails halfway

npm never allows republishing a version, so do not bump versions by hand.

On GitHub Actions the runner is thrown away after each run, so a run that fails **before publishing** leaves nothing
behind: fix the cause on `main` and run the workflow again. If it fails **after publishing** (push or GitHub Release),
the package is out but the version commit is lost; recover from your machine as below, starting with
`git checkout main && git pull && npx changeset version` to recreate the same version commit.

- **Failed before `changeset version`:** nothing changed. Fix the cause and run again.
- **Version commit made, publish failed** (network, token): fix the cause, then run `npx changeset publish`
  yourself. It skips versions already on the registry and publishes the rest. Then push and create the release:

  ```bash
  git push origin main
  git push origin --tags
  gh release create @devops-abcdigital/observability-node@<version> --title @devops-abcdigital/observability-node@<version> --notes "See CHANGELOG.md"
  ```

- **Published, push rejected** (someone pushed to `main` meanwhile): do not rewrite the published version. Rebase
  the release commit (`git pull --rebase`), push `main` and the tags, then create the GitHub Release.
- **A bad version went out:** publish a fixed patch version through a new changeset. Use
  `npm deprecate @devops-abcdigital/observability-node@<version> "<reason>" --registry=https://npm.pkg.github.com` to
  warn users off the bad one.

## Verify a published version

```bash
npm view @devops-abcdigital/observability-node version --registry=https://npm.pkg.github.com
mkdir /tmp/try && cd /tmp/try && npm init -y && npm install @devops-abcdigital/observability-node @opentelemetry/api
```

The install must work with a `read:packages`-only token, as project developers and image builds use.
