# @devops-abcdigital/observability-node

Zero-code OpenTelemetry **tracing** for ABC Digital Node.js services. Load it with `node --import`, set a few `OTEL_*` variables, and every incoming request, framework handler, database query and outgoing call shows up as one connected trace in Grafana (Tempo), across services.

Only traces are exported; logs and metrics are not sent. Optionally, the library also posts a Teams message for every 500 error (see [Error notifications](#error-notifications)).

## Install

The package is public on npmjs.com, so no token or `.npmrc` is needed. Install the library and its peer dependency:

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

Cron jobs and event listeners have no incoming request, so they have no root span. Wrap each run and name it `job.<area>.<task>`, so failed runs are easy to find in Grafana:

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

## Error notifications

Posts an Adaptive Card to a Microsoft Teams chat when a request answers 500 or above: service, environment, method, route pattern, error type, sanitized message and a **Xem trace** button that opens the trace in Grafana. It is off unless `ABC_ALERT_TEAMS_WEBHOOK_URL` is set, and works with tracing on or off.

| Variable                         | Example                     | Notes                                                         |
| -------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `ABC_ALERT_TEAMS_WEBHOOK_URL`    | (secret)                    | Teams Workflows webhook. **Required** to turn the feature on. |
| `ABC_ALERT_GRAFANA_URL`          | `https://agf.abcdigital.io` | With the Tempo UID, adds the trace button.                    |
| `ABC_ALERT_TEMPO_DATASOURCE_UID` | `ag2roz0cmsxs0a`            | Tempo data source UID in that Grafana.                        |
| `ABC_ALERT_INCLUDE_MESSAGE`      | `false`                     | Leaves the error message out. Default: included.              |

```ts
// Express: after the routes, before your own error handler.
import { teamsErrorNotifier } from '@devops-abcdigital/observability-node';
app.use(teamsErrorNotifier());

// NestJS: separate entry point, so Express apps never load @nestjs/*.
import { TeamsExceptionFilter } from '@devops-abcdigital/observability-node/nestjs';
app.useGlobalFilters(new TeamsExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

// Anywhere else that turns an error into a 500 response, e.g. your own exception filter.
import { notifyServerError } from '@devops-abcdigital/observability-node';
notifyServerError({ error, request, statusCode });
```

With your own global Nest filter, register `TeamsExceptionFilter` **first** (Nest tries global filters last to first) and call `notifyServerError()` in your filter for the 5xx exceptions it catches. The same error is sent at most once per 60 seconds, followed by a "repeated N times" summary. A summary still pending when the process stops is lost. Setup, the Teams Workflow and what is sent: [error notifications](../../docs/error-notifications.md).

## Shutdown

Queued spans are flushed (at most 3 seconds) when the app stops:

- **`SIGTERM`/`SIGINT`:** if the app has no signal handler of its own, the process then exits exactly as it would without the library; if it has one (for example NestJS `enableShutdownHooks()`), the app stays in charge of exiting.
- **A script or one-off job that finishes on its own:** the flush runs when the event loop empties, then the process exits normally. Calling `process.exit()` skips it, like any pending work.

## Safety

- A failure to start the SDK or to export spans never crashes the app; at most one warning is written to stderr.
- Exporter credentials, if any, belong to the shared Alloy collector. The only secret the library reads is `ABC_ALERT_TEAMS_WEBHOOK_URL`; the webhook call is excluded from tracing so the URL never reaches Tempo.
- Error notifications are sent in the background with a 3 second timeout. A failing webhook never delays or changes the response; it prints at most one warning to stderr until a delivery succeeds again.

More: [getting started](../../docs/getting-started.md), [conventions](../../docs/conventions.md), [error notifications](../../docs/error-notifications.md).
