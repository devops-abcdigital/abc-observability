# abc-observability

Shared observability for ABC Digital Node.js services:

- **[`@devops-abcdigital/observability-node`](packages/node)**: an OpenTelemetry tracing library. Install it, start the
  app with `node --import`, set a few `OTEL_*` variables, and every request, framework handler, database query and
  outgoing call becomes one connected trace across services. Traces only; no logs or metrics.
- **[Teams error alerts](alerts)**: Grafana alert rules that post to one shared Microsoft Teams channel when a
  service's failed requests or failed background jobs pass a threshold.

```
App (node --import …/register)
  │ OTLP/HTTP :4318
  ▼
Alloy (alloy-shared, run by DevOps) ──▶ Tempo ──▶ Grafana agf.abcdigital.io ──▶ Teams alert channel
```

This repository is a library: nothing here is deployed.

## Documentation

- [Getting started](docs/getting-started.md): add tracing to a service in three steps.
- [Conventions](docs/conventions.md): service names, environments, span and job names, data that must never go into a
  span.
- [Teams error alerts](docs/alerts.md): how failures become Teams messages.
- [Releasing](docs/releasing.md): publishing a new version.
- [Example](examples/multi-service): three services in one trace, a failing service and a background job.

The same pages appear on the component's **Docs** tab in Backstage (`mkdocs.yml`).

## Repository layout

| Path                     | Content                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `packages/node`          | the published library                                                     |
| `examples/multi-service` | runnable example (`gateway` → `auth` → `users`, sent to the shared Alloy) |
| `alerts`                 | Grafana alert rule, Teams message template, setup guide                   |
| `docs`                   | TechDocs pages                                                            |
| `scripts/release.mjs`    | the guarded release script                                                |

## Development

Node 24 (`.nvmrc`). npm workspaces share the root `package-lock.json`.

```bash
npm ci
npm run build      # compile packages/node
npm run verify     # types, lint, format
npm test           # unit + integration tests (spawns real Node processes)
```

The tests need no trace backend: they run their own OTLP receiver. Traces are viewed only in the shared Grafana,
through the shared Alloy on the servers.

Changes to `packages/*` need a changeset (`npx changeset`). Releases: see [docs/releasing.md](docs/releasing.md).

## Backstage

`catalog-info.yaml` registers this repository as a `library` component; `infra_info.json` holds its catalog metadata.
Neither contains secrets, and none may be added: npm publishing uses trusted publishing (no token), and the Teams
webhook URL lives only in Grafana's contact point.
