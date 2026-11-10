# Getting started

Add distributed tracing to a Node.js 24 service in four steps, with no tracing code. Traces go to the shared
Grafana (Tempo) and show which service called which, and at which step a request failed.

## 1. Install

The package is private on GitHub Packages, so npm needs to know the registry and have a token.

**Project `.npmrc`** (commit this, registry only):

```ini
@devops-abcdigital:registry=https://npm.pkg.github.com
```

**Your `~/.npmrc`** (never commit this):

```ini
//npm.pkg.github.com/:_authToken=<token>
```

Create the token at GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens
(classic)** with the `read:packages` scope, and authorize it for the `devops-abcdigital` organization (SSO) if
asked. Check it with `npm whoami --registry=https://npm.pkg.github.com`.

```bash
npm install @devops-abcdigital/observability-node @opentelemetry/api
```

Docker builds need the same token; pass it as a BuildKit secret so it never lands in an image layer:

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc .
```

## 2. Load it with `--import`

The library must load before the app imports anything else:

```bash
node --import @devops-abcdigital/observability-node/register dist/main.js
```

- In a Dockerfile or entrypoint, put `--import` on the command that starts the API only, not on migration or seed
  commands.
- For `npm run dev` or tools that start Node for you, use
  `NODE_OPTIONS=--import=@devops-abcdigital/observability-node/register`.

## 3. Set the environment

```bash
OTEL_SERVICE_NAME=myproject-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy-shared:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=staging
```

Without `OTEL_EXPORTER_OTLP_ENDPOINT` the library does nothing, so the same image runs fine where tracing is not
set up. Naming rules for `OTEL_SERVICE_NAME` and `deployment.environment` are in [Conventions](conventions.md).
The full list of variables is in the
[package README](https://github.com/devops-abcdigital/abc-observability/tree/main/packages/node#readme).

That is all for HTTP, Express, NestJS, PostgreSQL (`pg`), `fetch`, gRPC and pino log correlation.

## 4. Join the shared Alloy

Traces go to the shared Alloy collector (`alloy-shared`) that DevOps runs on each server; it forwards them to Tempo
behind `agf.abcdigital.io`, where you view them (**Explore** → **Tempo** → **Search**). The app container joins the
external `abc_telemetry_network` Docker network so it can reach `alloy-shared`:

```yaml
services:
  app:
    environment:
      OTEL_SERVICE_NAME: myproject-api
      OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy-shared:4318
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=staging
    networks: [default, telemetry]
networks:
  telemetry:
    external: true
    name: abc_telemetry_network
```

The app holds no Grafana credential; only Alloy does. `alloy-shared` is reachable only on the server it runs on, so
an app on a server without it needs DevOps to start one there first. On a developer machine leave
`OTEL_EXPORTER_OTLP_ENDPOINT` unset: tracing stays off and the app runs as before.

A full three-service trace is in
[examples/multi-service](https://github.com/devops-abcdigital/abc-observability/tree/main/examples/multi-service).

## Background jobs and caught errors

Cron jobs and event listeners have no incoming request, so wrap each run in a span named `job.<area>.<task>`.
When code catches an error and returns a result instead of throwing, call `markSpanError()` with a sanitized
message. Both are needed for the [Teams error alert](alerts.md)
to see job failures.

```ts
import { markSpanError, withSpan } from '@devops-abcdigital/observability-node';

await withSpan('job.invoice.reminder', async () => {
  const result = await sendReminders();
  if (result.error) markSpanError(result.error);
});
```

## Troubleshooting

- **No traces at all:** check that `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the process that runs the app, that
  `--import` is on that same command, and that the container is on `abc_telemetry_network`
  (`docker exec <app> wget -qO- http://alloy-shared:4318` must connect, even if it answers 404 or 405). Set `OTEL_LOG_LEVEL=debug` to see exporter errors.
- **Only HTTP spans, no database or framework spans:** the library loaded too late. It must be loaded with
  `--import`, not imported from application code.
- **Health checks fill the trace list:** the defaults ignore `/health` and `/api/v1/health`; set
  `ABC_OTEL_IGNORE_PATHS` to your paths.
