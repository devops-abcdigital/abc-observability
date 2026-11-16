# Teams error notifications

When a request answers **500 or above**, the app posts a card to a Microsoft Teams chat within a few seconds:

```
🔴 500 · GET /api/v1/projects/:id · awp-product-hub-api (staging)
16/11/2026 12:45
Loại lỗi   QueryFailedError
Message    sorry, too many clients already
trace_id   4bf92f3577b34da6a3ce929d0e0e4736
[ Xem trace ]
```

**Xem trace** opens that exact trace in Grafana (Tempo). The library sends the card itself, straight to a Teams
Workflows webhook: there is no alert rule, contact point or other service in between.

Not covered: 4xx responses, failed background jobs, and logs. Background job failures are still visible in the
traces (`job.*` spans with status ERROR, see [Conventions](conventions.md)).

## 1. Create the Teams webhook (once per chat)

In the target chat (a group chat or a channel): **⋯** → **Workflows** → template **"Send webhook alerts to a
chat"** (for a channel: **"Post to a channel when a webhook request is received"**) → **Add workflow**. Copy the URL
it shows.

The URL contains its own signature: anyone who has it can post to the chat. Store it only as a secret in the
deployment system. Never commit it, put it in a `.env` file that is committed, or paste it in tickets.

## 2. Set the environment

| Variable                         | Example                     | Notes                                                                 |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `ABC_ALERT_TEAMS_WEBHOOK_URL`    | (secret)                    | **Turns the feature on.** Unset: nothing is ever sent. Must be https. |
| `ABC_ALERT_GRAFANA_URL`          | `https://agf.abcdigital.io` | With the next variable, adds the **Xem trace** button.                |
| `ABC_ALERT_TEMPO_DATASOURCE_UID` | `ag2roz0cmsxs0a`            | UID of the Tempo data source in that Grafana.                         |
| `ABC_ALERT_INCLUDE_MESSAGE`      | `false`                     | Leaves the error message out of the card. Default: included.          |

The card shows `OTEL_SERVICE_NAME` and `deployment.environment` from `OTEL_RESOURCE_ATTRIBUTES`, so set them as
described in [Conventions](conventions.md) even when tracing is off.

## 3. Hook it into the app

### Express

Register the middleware after the routes and before the app's own error handler. It reports, then passes the error
on unchanged:

```js
const { teamsErrorNotifier } = require('@devops-abcdigital/observability-node');

app.use('/api', router);
app.use(teamsErrorNotifier());
app.use(myErrorHandler);
```

The status is the one Express answers with: `err.status` or `err.statusCode` when between 400 and 599 (http-errors,
body-parser), else the status already set on the response, else 500.

### NestJS

The filter comes from a separate entry point, so Express apps never load `@nestjs/*`:

```ts
import { HttpAdapterHost } from '@nestjs/core';
import { TeamsExceptionFilter } from '@devops-abcdigital/observability-node/nestjs';

app.useGlobalFilters(new TeamsExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
```

It reports exceptions answered with 500 or above and leaves the response exactly as Nest's default. The status is the
one Nest answers with: `getStatus()` of an `HttpException`, `statusCode` of an error that also has a message, else 500.
An error that only has `status` (for example an `AxiosError` from an upstream 404) is answered 500 by Nest, so it is
reported. The filter is for HTTP only: in GraphQL, microservice or WebSocket contexts it rethrows the exception
untouched. With the Fastify adapter there is no route pattern, so the card shows the path with IDs masked.

**If the app has its own global filter**, for example `@Catch(HttpException)` that writes a custom body, Nest tries
global filters from the last registered to the first. Register the Teams filter **first**, so the app's filter still
handles the exceptions it catches:

```ts
app.useGlobalFilters(new TeamsExceptionFilter(app.get(HttpAdapterHost).httpAdapter), new HttpExceptionFilter());
```

Exceptions that the app's filter catches never reach the Teams filter. Report the 5xx ones from inside it with one
line:

```ts
import { notifyServerError } from '@devops-abcdigital/observability-node';

const status = exception.getStatus();
if (status >= 500) notifyServerError({ error: exception, request: ctx.getRequest(), statusCode: status });
```

`notifyServerError()` is also the way to report from any other place that turns an error into a 500 response.

## What is sent, and when

- **Route**: the route pattern (`/api/v1/projects/:id`), so IDs stay out of the chat. When no route matched, the path
  without its query string, with numbers, UUIDs, hex and long tokens replaced by `:id`.
- **Error type**: the error class name (`QueryFailedError`, `InternalServerErrorException`).
- **Message**: the error message after removing credentials in URLs, values of secret-looking names in `name=value`,
  `name: value` and JSON form (`password`, `client_secret`, `refresh_token`, `x-api-key`, `key`, `sig`, …), Bearer and
  Basic credentials, JWTs and long key-like strings, cut to 300 characters. Only the first 2,000 characters are
  scanned, and only when a card is actually sent. Markdown links in it are not clickable. Stack traces are never sent;
  they are in the trace.
- **Trace link**: only when the request was traced and sampled. Spans take about 5–10 seconds to reach Tempo, so a
  link opened right away may show "trace not found" for a moment.

**Anti-spam**: the same error (service, method, route, error type) is sent once per 60 seconds. If it repeats in that
window, one summary follows at the end: _"Lặp lại 19 lần trong 60 giây"_, with the link to the last occurrence. An
error that keeps happening gives one summary per minute. A summary pending when the process stops is lost.

## Safety

- Building the card costs little and sending happens in the background with a 3 second timeout. A slow, failing or unreachable webhook never delays,
  changes or crashes the response; it only prints one warning to stderr until a delivery succeeds again.
- The webhook call is excluded from tracing, so the signed URL never ends up in Tempo.
- Works with tracing on or off. With tracing off the card has no trace link.

## Turning it off

Remove `ABC_ALERT_TEAMS_WEBHOOK_URL` and restart. No code change is needed.
