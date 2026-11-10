---
title: "Implement abc-observability tracing library, alerts and awp adoption"
date: 2026-11-09
summary: "Phases 1-4 implemented and verified locally; phase 5 code done in awp, waiting for the 0.1.0 publish"
---

# Implement abc-observability tracing library, alerts and awp adoption

## What happened

- Converted the Backstage service template into an npm-workspaces library repo and built `@devops-abcdigital/observability-node` (OTel SDK 0.301 / SDK 3.x, traces only, `node --import .../register`, `withSpan`, `@Traced`, `markSpanError`). 27 tests pass on Linux (node:24); the SIGTERM-flush test is skipped on Windows.
- Added a 3-service example (gateway -> auth -> users). Tempo shows one trace across all three services, with the error and its exception on `users.find`.
- Added changesets and a guarded `scripts/release.mjs`. Each guard was tested in a scratch clone. No publish: this machine has no `write:packages` token.
- Teams alerts: TraceQL metrics cannot feed Grafana 12.1 alerts (exemplar frames give "input data must be a wide series but got type long", and Tempo ignores `exemplars=0`), so the rules use Tempo span metrics. The committed YAML was verified on otel-lgtm through file provisioning plus a local stand-in for the Teams webhook: FIRING, then RESOLVED about 6 minutes later.
- awp-product-hub: branch `ABCDG-0000-setup-tracing` wraps connector syncs in `job.connector.sync` spans and calls `markSpanError` in `ConnectorSyncRun.read()`. Also updated the entrypoint, Dockerfile secret mounts, README and infra_info. Verified with a `--no-save` tarball: the job ERROR span carries the sanitized Vietnamese message and leaks no key; unit tests (229 backend, 155 frontend) and 143 e2e tests pass.

## Surprises

- Express 5 routes through `router`, which doubled every handler span, so I disabled `instrumentation-router`.
- Short-lived processes lost their last spans, so the library now also flushes on `beforeExit`.
- awp does have a staging Jenkins pipeline (`jenkins/staging/Jenkinsfile` on the `CP-*` branches) that runs a plain `docker build`; it will need the `npmrc` secret.
- The plan's TraceQL escape `"job\..*"` is invalid; `"job[.].*"` works.
- Session mistake: a stray `git stash` stashed all tracked changes. Restored right away with `git stash pop`; nothing was lost.

## Next steps

1. Merge to main, get a `write:packages` token, run `npm run release` to publish 0.1.0.
2. awp: add the `^0.1.0` dependency and lockfile, build the image with the secret, check container health without OTEL_*.
3. DevOps: span metrics with a `deployment.environment` dimension, then the Teams Workflow, contact point, policy and rules on the shared Grafana.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
