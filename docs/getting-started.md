# Getting started

Add distributed tracing to a Node.js 24 service in three steps, with no tracing code. Traces go to the shared
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

## Test locally with otel-lgtm

`grafana/otel-lgtm` runs Grafana, Tempo and an OTLP receiver in one container:

```bash
docker run -d --name otel-lgtm -p 3001:3000 -p 4318:4318 grafana/otel-lgtm:0.11.10
```

Start your app with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and a service name ending in `-local`, send
a few requests, then open <http://localhost:3001> → **Explore** → **Tempo** → **Search** and pick your service.
Remove the container with `docker rm -f otel-lgtm` when done.

In this repository, `docker compose -f docker-compose.dev.yml up -d` starts the same container, and
[examples/multi-service](https://github.com/devops-abcdigital/abc-observability/tree/main/examples/multi-service)
shows a full three-service trace.

## Switch to the shared Alloy

On a server, traces go to the shared Alloy collector that DevOps runs; it forwards them to Tempo behind
`agf.abcdigital.io`. Only the environment changes:

```bash
OTEL_SERVICE_NAME=myproject-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy-shared:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

and the app container joins the `abc_telemetry_network` Docker network so it can reach `alloy-shared`. Ask DevOps to
confirm the network and endpoint for your server. No code change is needed.

## Troubleshooting

- **No traces at all:** check that `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the process that runs the app, and that
  `--import` is on that same command. Set `OTEL_LOG_LEVEL=debug` to see exporter errors.
- **Only HTTP spans, no database or framework spans:** the library loaded too late. It must be loaded with
  `--import`, not imported from application code.
- **Health checks fill the trace list:** the defaults ignore `/health` and `/api/v1/health`; set
  `ABC_OTEL_IGNORE_PATHS` to your paths.
