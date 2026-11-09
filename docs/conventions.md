# Conventions

Shared names keep traces from different projects searchable side by side, and the Teams error alert relies on
some of them. Follow these in every project that uses `@devops-abcdigital/observability-node`.

## Service name

Set with `OTEL_SERVICE_NAME`.

- Format: `<project>-<component>`, lowercase, words separated by `-`. Examples: `awp-product-hub-api`,
  `hrm-be`, `ums-api`.
- Add the suffix `-local` when running on a developer machine: `awp-product-hub-api-local`. Local traces then
  never mix with server traces.
- One name per deployable process. A worker that runs separately from the API gets its own name
  (`awp-product-hub-worker`).

## Environment

Set with `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=<value>`.

| Value         | Use               |
| ------------- | ----------------- |
| `local`       | developer machine |
| `development` | shared dev server |
| `staging`     | staging / UAT     |
| `production`  | production        |

Alerts group by service name and environment, so spell them exactly like this.

## Span names

Auto-instrumentation names HTTP, database and framework spans; do not rename them. For spans you create with
`withSpan()` or `@Traced()`:

- Use `<area>.<action>`, lowercase, with `-` inside words: `report.generate`, `gateway.create-session`,
  `invoice.send-reminder`.
- Keep names low-cardinality. Never put IDs, emails or URLs in a span name; put them in attributes.
- `@Traced()` without an argument uses `ClassName.methodName`, which is fine for service classes.

### Background jobs: `job.<area>.<task>`

Every run of a cron job, queue consumer or event listener is wrapped in a span whose name starts with `job.`:

```
job.connector.sync
job.invoice.reminder
job.example.cleanup
```

This prefix is defined here once. The shared Teams error alert counts failed spans that are either server spans
(failed requests) or spans whose name starts with `job.` (failed jobs). A job that is not named this way, or
that swallows its errors without calling `markSpanError()`, is invisible to the alert.

## Attributes

- Prefer the OpenTelemetry semantic conventions when one exists (`user.id`, `http.route`, `db.system`, …).
- Otherwise use `<area>.<field>` in lowercase: `connector.type`, `project.id`, `connector.trigger`.
- Values are short identifiers or enums (`ga4`, `scheduled`), not free text.

## Never put in a span

Span names, attributes, events and status messages are stored in Tempo and visible to everyone with Grafana
access. Never include:

- passwords, API keys, tokens, cookies, `Authorization` headers, session IDs;
- URLs that carry credentials or keys in the query string;
- request or response bodies;
- personal data beyond an internal user ID (no emails, phone numbers, names, addresses);
- raw error objects from third-party clients: they often embed the request URL and headers. Pass a sanitized
  message to `markSpanError()` instead.

The library never captures headers or bodies on its own; this list is about what your code adds.
