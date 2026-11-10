# Releasing

Packages are published as **public** packages to npmjs.com under the `@devops-abcdigital` organization, so
installing them needs no token. Releases run on GitHub Actions through the
[Release workflow](https://github.com/devops-abcdigital/abc-observability/blob/main/.github/workflows/release.yml), which
calls one guarded script, `npm run release`
([`scripts/release.mjs`](https://github.com/devops-abcdigital/abc-observability/blob/main/scripts/release.mjs)).

## One-time setup (npm organization owner)

The Release workflow publishes through npm **trusted publishing** (OIDC): npmjs.com trusts this repository's
workflow, so no npm token exists anywhere. npm is retiring tokens that bypass 2FA for publishing, so do not add one.

1. The npm organization `devops-abcdigital` exists on npmjs.com (free plan, public packages). Keep at least two
   owners so it never depends on one account; every owner has 2FA on.
2. A package must exist before trusted publishing can be configured, so a new package's first version is published
   once from a release owner's machine (see [fallback](#cut-a-release-from-your-machine-fallback)).
3. On npmjs.com → the package → **Settings** → **Trusted publishing**, add a **GitHub Actions** publisher:
   organization `devops-abcdigital`, repository `abc-observability`, workflow `release.yml`, environment `release`.
4. Optionally, in the same settings, set **Publishing access** to "Require two-factor authentication and disallow
   tokens", so only the workflow (or a person with 2FA) can publish.

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

1. Be a member of the `devops-abcdigital` npm organization with publish rights, and run `npm login`.
2. Check: `npm whoami` prints your npm username.
3. Install and log in to the GitHub CLI (`gh auth login`); the script creates the GitHub Release with it.
4. Use Node 24 (`nvm use`).

### Run

```bash
git checkout main
git pull
npm run release -- --dry-run   # all checks + npm publish --dry-run, changes nothing
npm run release
```

## What the script checks and does

Both routes run the same script. It stops **before publishing** if any check fails:

| Check                                                                          | Fix                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Node major matches `engines` (24)                                              | `nvm use`                                           |
| current branch is `main`                                                       | `git checkout main`                                 |
| no uncommitted changes                                                         | commit or stash                                     |
| `main` equals `origin/main` after fetch                                        | `git pull` (or push your local commits via a PR)    |
| at least one pending changeset                                                 | nothing to release, or add one with `npx changeset` |
| registry login: `npm whoami` works (on Actions: the job has `id-token: write`) | `npm login`, or fix the workflow permissions        |
| `npm run verify`, `npm test`, `npm run build` pass                             | fix the failure on `main` first                     |

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
  `npm deprecate @devops-abcdigital/observability-node@<version> "<reason>"` to warn users off the bad one.

## Verify a published version

```bash
npm view @devops-abcdigital/observability-node version
mkdir /tmp/try && cd /tmp/try && npm init -y && npm install @devops-abcdigital/observability-node @opentelemetry/api
```

The install must work with no `.npmrc` and no token, as project developers, image builds and CI use it.

Version 0.1.0 was published to GitHub Packages before the move to npmjs.com; use 0.1.1 or later.
