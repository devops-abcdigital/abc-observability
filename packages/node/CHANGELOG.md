# @devops-abcdigital/observability-node

## 0.2.0

### Minor Changes

- 8039839: Report 500 errors to a Microsoft Teams chat. `teamsErrorNotifier()` (Express middleware), `TeamsExceptionFilter`
  (NestJS, from the new `@devops-abcdigital/observability-node/nestjs` entry point) and `notifyServerError()` post an
  Adaptive Card with the service, environment, route pattern, error type, sanitized message and a link to the trace in
  Grafana. Off unless `ABC_ALERT_TEAMS_WEBHOOK_URL` is set; the same error is sent at most once per 60 seconds plus a
  repeat summary. `@nestjs/common` and `@nestjs/core` are optional peer dependencies, needed only for the NestJS filter.

## 0.1.1

### Patch Changes

- 1c92167: Published to npmjs.com as a public package: `npm install @devops-abcdigital/observability-node` needs no token,
  no `.npmrc` and no Docker build secret. No code change from 0.1.0.

## 0.1.0

### Minor Changes

- e343528: First release: zero-code OpenTelemetry tracing for Node 24 services. Load with
  `node --import @devops-abcdigital/observability-node/register`, enable with `OTEL_EXPORTER_OTLP_ENDPOINT`.
  Auto-instruments HTTP, Express, NestJS, `pg`, `fetch`/undici, gRPC and pino log correlation; exports traces only.
  Adds `withSpan()`, `@Traced()` and `markSpanError()` for business spans and background jobs.

  Built on `@opentelemetry/sdk-node` 0.301, `@opentelemetry/auto-instrumentations-node` 0.83,
  `@opentelemetry/exporter-trace-otlp-http` 0.301 and `@opentelemetry/api` 1.10.
