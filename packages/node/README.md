# @devops-abcdigital/observability-node

Zero-code OpenTelemetry **tracing** for ABC Digital Node.js services. Load it with `node --import`, set a few `OTEL_*` variables, and every incoming request, framework handler, database query and outgoing call shows up as one connected trace in Grafana (Tempo), across services.

Only traces are exported. Logs and metrics are not sent.

## Install

The package lives on GitHub Packages. Add this line to the project's `.npmrc` (registry only, never a token):

```ini
@devops-abcdigital:registry=https://npm.pkg.github.com
```

Put a GitHub token with `read:packages` in your user-level `~/.npmrc`:

```ini
//npm.pkg.github.com/:_authToken=<your token>
```

Then install the library and its peer dependency:

```bash
npm install @devops-abcdigital/observability-node @opentelemetry/api
```

Requires Node.js 24.

## Enable

Start the app with the register hook, before any other module loads:

```bash
node --import @devops-abcdigital/observability-node/register dist/main.js
```

It works for CommonJS and ESM apps. In development you can pass it through `NODE_OPTIONS=--import=@devops-abcdigital/observability-node/register`.

Then set the standard OpenTelemetry variables:

| Variable                                          | Example                            | Notes                                                                                                        |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                     | `http://localhost:4318`            | **Required.** Without it (and without `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) the library does nothing at all. |
| `OTEL_SERVICE_NAME`                               | `awp-product-hub-api`              | See [naming conventions](../../docs/conventions.md).                                                         |
| `OTEL_RESOURCE_ATTRIBUTES`                        | `deployment.environment=staging`   | Comma-separated `key=value` pairs.                                                                           |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio` / `0.2` | Default `parentbased_always_on`.                                                                             |
| `ABC_OTEL_IGNORE_PATHS`                           | `/health,/ready`                   | Incoming paths that produce no span. Replaces the default `/health,/api/v1/health`.                          |

Any other standard `OTEL_*` variable supported by the OpenTelemetry Node SDK also works.

## What is traced automatically

Official OpenTelemetry auto-instrumentations, including: incoming and outgoing HTTP, Express, NestJS, PostgreSQL (`pg`), `fetch`/undici, gRPC, and pino (adds `trace_id`/`span_id` to log lines). Noisy low-level instrumentations (`fs`, `dns`, `net`) are off. Headers and bodies are never captured.

## Business spans

```ts
import { markSpanError, Traced, withSpan } from '@devops-abcdigital/observability-node';

// Wrap any block, sync or async.
const report = await withSpan('report.generate', async (span) => build(projectId), { 'project.id': projectId });

// Or decorate a method; the span name defaults to ClassName.methodName.
class InvoiceService {
  @Traced()
  async issue(id: string) {
    /* ... */
  }
}
```

`withSpan` and `@Traced` record the exception, set the span status to `ERROR`, rethrow, and always end the span. When tracing is disabled they simply run the function. `@Traced` needs `experimentalDecorators` (the NestJS default).

### Errors that are caught, not thrown

If code catches an error and returns a result instead of throwing, the span never sees the failure. Call `markSpanError` with a message that is already safe to store:

```ts
try {
  rows = await provider.fetch();
} catch (error) {
  const message = sanitize(error); // no keys, tokens or URLs with credentials
  markSpanError(message);
  return { error: message };
}
```

It takes a string on purpose: raw errors from HTTP clients often carry request URLs with keys or headers.

### Background jobs

Cron jobs and event listeners have no incoming request, so they have no root span. Wrap each run and name it `job.<area>.<task>`; the shared Teams error alert counts failed `job.*` spans:

```ts
@Cron('*/5 * * * *')
async tick() {
  for (const connector of await this.dueConnectors()) {
    try {
      await withSpan('job.connector.sync', () => this.sync(connector), {
        'connector.type': connector.type,
        'project.id': connector.projectId,
      });
    } catch (error) {
      this.logger.error(error);
    }
  }
}
```

## Shutdown

Queued spans are flushed (at most 3 seconds) when the app stops:

- **`SIGTERM`/`SIGINT`:** if the app has no signal handler of its own, the process then exits exactly as it would without the library; if it has one (for example NestJS `enableShutdownHooks()`), the app stays in charge of exiting.
- **A script or one-off job that finishes on its own:** the flush runs when the event loop empties, then the process exits normally. Calling `process.exit()` skips it, like any pending work.

## Safety

- A failure to start the SDK or to export spans never crashes the app; at most one warning is written to stderr.
- The library reads no secrets. Exporter credentials, if any, belong to the shared Alloy collector.

More: [getting started](../../docs/getting-started.md), [conventions](../../docs/conventions.md).
