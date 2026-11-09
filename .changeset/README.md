# Changesets

Every PR that changes a published package adds a changeset: run `npx changeset`, pick the package and the bump
(patch / minor / major), and describe the change for the CHANGELOG. Releases are cut by the Release workflow on GitHub Actions (`npm run release`); see
[docs/releasing.md](../docs/releasing.md).
