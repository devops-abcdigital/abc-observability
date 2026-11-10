# @devops-abcdigital/observability-node

## 0.1.0

### Minor Changes

- e343528: First release: zero-code OpenTelemetry tracing for Node 24 services. Load with
  `node --import @devops-abcdigital/observability-node/register`, enable with `OTEL_EXPORTER_OTLP_ENDPOINT`.
  Auto-instruments HTTP, Express, NestJS, `pg`, `fetch`/undici, gRPC and pino log correlation; exports traces only.
  Adds `withSpan()`, `@Traced()` and `markSpanError()` for business spans and background jobs.

  Built on `@opentelemetry/sdk-node` 0.301, `@opentelemetry/auto-instrumentations-node` 0.83,
  `@opentelemetry/exporter-trace-otlp-http` 0.301 and `@opentelemetry/api` 1.10.
