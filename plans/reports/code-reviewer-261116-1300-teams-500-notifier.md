# Code Review: Teams 500 error notifier (uncommitted changes)

## Scope
- Source: packages/node/src/alerts/{notify,sanitize,teams-card,express}.ts, src/nestjs.ts, src/config.ts, src/index.ts, package.json
- Tests, docs, examples, plan 261116-1229-teams-500-error-notifications
- Checks run: `npm run test -w @devops-abcdigital/observability-node`: 74 passed, 1 skipped. `npm run verify`: type, lint and format all pass.
- Empirical probes (scratch scripts, no repo changes): sanitizer timing, sanitizer bypass inputs, how Nest 11 and Express 5 answer errors that carry only a `status` field.

## Overall
The structure is sound. The main entry does not load `@nestjs/*`. The webhook URL never appears in a warning or a span: the URL is validated up front, warnings only use `error.message`, and the request runs under suppressed tracing (covered by an integration test). Timers are unref'd, the number of tracked errors is capped, and the failure-streak warning works as specified. I found two real defects: one breaks the "never delay the response" rule, the other silently drops alerts in a common NestJS case. There are also some sanitizer and docs gaps.

## High

### H1. Sanitizer regex takes quadratic time and runs synchronously on the request path, on every error, even when deduped
- Code: sanitize.ts:8 (`URL_CREDENTIALS`), sanitize.ts:11 (`JWT`). notify.ts:136-138: `describeError` sanitizes before the dedupe lookup at notify.ts:193-199.
- Evidence (Node 24, src/alerts/sanitize.ts):
  - `"a.".repeat(n)` and `"x-".repeat(n)`: 40 KB takes about 340 ms, 160 KB about 5.6 s.
  - The slow regex is `\b([a-z][a-z0-9+.-]*:\/\/)`. Each `.` or `-` creates a new word boundary, and from each one `[a-z0-9+.-]*` scans to the end of the string. `\beyJ[\w-]+\.` has the same shape for `eyJ-` runs.
- Failure scenario: an unvalidated id or field hits Postgres, which echoes the value in a 500 message (`invalid input syntax for type uuid: "a-a-a-…"`, a TypeORM `QueryFailedError`). The value can be about 100 KB through a JSON body under body-parser's default limit, or about 16 KB in the URL. Each request then blocks the event loop for about 2 s inside `teamsErrorNotifier()`, before `next(error)` runs. Dedupe does not help, because sanitizing happens before the window check. With message inclusion on by default, this is an unauthenticated DoS vector. It breaks the "never block or delay the response" requirement and the docs claim "never delays" (docs/error-notifications.md, Safety).
- Fix:
  1. Bound the input before running any regex, e.g. `message.slice(0, 2_000)`. Then sanitize, then cut to 300.
  2. Make `URL_CREDENTIALS` linear: anchor on `://` instead of scanning a scheme from every boundary, or bound the scheme length, e.g. `\b([a-z][a-z0-9+.-]{0,30}:\/\/)`. Do the same for `JWT`: `{1,…}` bounds, or require a `.` within N chars.
  3. Compute the dedupe key (method, route, errorType) first. Only sanitize and build the event when a card is actually sent. For repeats, store the raw error and describe it lazily in `closeWindow`.
  4. Add a timing test, e.g. a 200 KB adversarial string must finish in under 50 ms.

### H2. NestJS filter misses 500s for errors that carry a non-5xx `status` (e.g. AxiosError)
- Code: nestjs.ts:10-17 (`statusOf`) falls back to `errorStatus()` at notify.ts:56-61, which honors `status ?? statusCode`.
- Evidence (Nest 11 with the express adapter, no custom filter): throwing `Object.assign(new Error('upstream 404'), { status: 404 })` gives the response `500 {"statusCode":500,"message":"Internal server error"}`. Nest's `BaseExceptionFilter` only respects a non-HttpException's `statusCode` (together with a truthy `message`). It ignores `status`.
- Failure scenario: a Nest service calls an upstream through `@nestjs/axios` and lets the `AxiosError` bubble up. AxiosError sets `.status` to the upstream status, e.g. 404/401/409. Nest answers 500, but the filter computes 404, so no Teams card is sent. This is probably the most common source of 500s in Nest services. It contradicts phase-02 line 23-24 ("other errors count as 500"). The decision recorded in plan.md:149 ("like Nest and Express answer") is wrong for Nest. The current test (alerts-nestjs.spec.ts `payload` route) sets both `status` and `statusCode`, which hides this.
- Fix: mirror Nest. Use `getStatus()` when it is a function. Else use `statusCode` when it is a number and `message` is truthy. Else 500. Do not reuse the Express helper here. Add a test with a status-only error.

## Medium

### M1. Express status rule differs from finalhandler for out-of-range values
- Code: notify.ts:56-61. Express 5 (finalhandler) uses `err.status` or `err.statusCode` only when the value is in 400-599, otherwise it answers 500.
- Verified: `{ status: 200 }` gives an Express response of 500, but `errorStatus` returns 200, so nothing is reported. The same applies to `status: 0`, 3xx, or 600+.
- Fix: accept a value only if it is a number in [400, 599]. Check `status` first, then `statusCode`, else 500. Update the docs sentence "The status is taken from `err.status` or `err.statusCode`".

### M2. Unmatched-route fallback sends the raw path unsanitized, which also inflates dedupe keys
- Code: notify.ts:96-103, 73-76. The route, which is also used in the title, never goes through `sanitizeMessage`.
- Scenario: a 500 thrown in middleware before routing has no `req.route`. Examples: auth or session middleware, Nest middleware via `consumer.apply`, any Fastify adapter request. The card title then contains the raw path, e.g. `/reset-password/<token>`, `/invite/<jwt>` or `/files/<signed-key>`. Every distinct id also makes a new dedupe key, so there are N cards instead of one, up to `MAX_TRACKED_ERRORS`. The docs promise "IDs stay out of the chat" only for matched routes, but the token-leak case is not mentioned.
- Fix: run the fallback path through the sanitizer (JWT and long-token rules). Also normalize segments that look like ids (numeric, UUID, hex/base64 of 16 or more characters) to `:id`.

### M3. `mountPrefix` puts real parameter values into the route when a router is mounted on a parameterized path
- Code: notify.ts:83-89.
- Scenario: `app.use('/tenants/:tenantId', router)` with `router.get('/items/:id')`, and an app-level `teamsErrorNotifier()`. A request to `/tenants/7/items/9` produces the route `/tenants/7/items/:id`. The tenant id appears in the chat, and you get one card per tenant per minute instead of one in total.
- Fix: apply the same id-segment normalization as in M2 to the rebuilt prefix. Or document that mounted parameter paths are shown literally.

### M4. NestJS filter in non-HTTP contexts (GraphQL in particular) changes Nest's behavior
- Code: nestjs.ts:33-49 always calls `super.catch(exception, host)`. The plan says the same (phase-02 line 48).
- Scenario: `app.useGlobalFilters(...)` also applies to GraphQL resolvers, and so does `APP_FILTER` for microservice and WS handlers. In those contexts `BaseExceptionFilter` calls `httpAdapter.reply(host.getArgByIndex(1), …)`, where argument 1 is not an HTTP response. This is a known Nest pitfall that ends in `response.status is not a function`. Without this filter, GraphQL would have rethrown the original error to Apollo. So adding the Teams filter to a GraphQL app replaces real errors with a TypeError. This breaks "keeps Nest's default response". I could not run it here because no GraphQL or microservices package is installed, so treat this as reasoned, not reproduced.
- Fix: for `host.getType() !== 'http'`, rethrow `exception` instead of calling `super.catch` (this is what Nest's own external filter does for GraphQL). Or document that the filter is HTTP-only and must not be registered via `APP_FILTER` in hybrid or GraphQL apps.

### M5. Sanitizer gaps for common secret shapes
Verified outputs (all returned unchanged):
- `Server=db;User Id=sa;Password=Hunter2!;`
- `login failed password=hunter2`
- `?client_secret=abcd1234&refresh_token=zzz9`: only the exact names `key`, `token`, `secret` and so on match. Prefixed names do not.
- `{"password":"hunter2","apiKey":"abc123xyz"}`
- `Basic dXNlcjpwYXNz`
- `x-api-key: 9f8e…`

Short secrets also slip past the 32-character long-token rule. The message is included by default, and the docs list ends in "…", which suggests broader coverage.

Fix:
- Match key names by suffix with any separator: `\b[\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|signature|sig)\b\s*["']?\s*[:=]\s*["']?[^"'&\s;,]+`.
- Add `Basic\s+[A-Za-z0-9+/=]+`.
- Add tests for each of these shapes.

## Low

- L1. notify.ts:168-174: `closeWindow` runs in a timer callback with no try/catch. Any synchronous throw in `repeatCard`/`send` (unlikely today) would be an uncaught exception that can crash the process. To guarantee "never throw", wrap the body like `notifyServerError`.
- L2. notify.ts:69-72: the `capacity`, `internal` and `config` warnings are never re-armed. After the first capacity overflow, later overflows (dropped alerts) are silent for the life of the process. Consider re-arming `capacity` when the window map drains.
- L3. notify.ts:63: `detail()` only prints `error.message`, so undici failures show as the bare `fetch failed`. Including `error.cause?.code` (ECONNREFUSED, ENOTFOUND, UND_ERR_*) helps diagnosis, and the cause does not contain the URL. Verify this before shipping.
- L4. teams-card.ts:54-75: the message and the raw-path route go into Adaptive Card text that Teams renders as markdown. An error that echoes user input can put a `[link](https://…)` into the internal chat. Consider escaping `[]()*_` in message and route.
- L5. Fastify-based Nest apps have no `req.route`, so every card uses the raw path (see M2). The docs do not say only the express adapter gets route patterns.

## Requirement checklist
| Requirement | Result |
|---|---|
| Never block, alter or crash the response | FAIL: H1 (CPU block); M4 for GraphQL |
| Never throw | OK on the request path; L1 for the timer path |
| One stderr warning per failure streak | OK for `send`; L2 |
| Off without the env var | OK (verified by unit and integration tests) |
| Webhook URL never in repo, logs or spans | OK (validated URL, message-only warnings, suppressed tracing, integration test) |
| 60 s dedupe and repeat summary | OK; M2/M3 inflate keys |
| Sanitize message, 300 chars, no stack | Partial: M5 gaps, route not sanitized (M2) |
| Works with tracing off | OK |
| No new mandatory dependency | OK (`@nestjs/*` are optional peers) |
| Main entry does not load `@nestjs/*` | OK |
| Nest filter keeps the default response | HTTP: OK. Non-HTTP: M4. Status logic: H2 |

## Doc claims that contradict the code
- docs/error-notifications.md, Safety: "never delays … the response". False under H1.
- docs/error-notifications.md, NestJS: "reports exceptions answered with 500 or above". False for status-only errors (H2).
- docs/error-notifications.md, Express: "taken from err.status or err.statusCode". Express itself only honors 4xx/5xx values (M1).
- plan.md:149 says the status rule matches Nest and Express. The empirical check above disproves this.

## Recommended actions
1. H1: bound the input and make the regexes linear; dedupe before sanitizing; add a timing test.
2. H2: Nest-specific status rule plus a test with an AxiosError-shaped error.
3. M1: range-check the Express status.
4. M4: rethrow for non-HTTP hosts, or document HTTP-only.
5. M2/M3/M5: sanitize and normalize the route; widen the secret patterns, with tests.

## Unresolved questions
- Does any target service use the Fastify adapter or GraphQL with Nest? This decides how urgent M4/L5 are.
- Is the message meant to stay on by default given M5, or should the default flip to off until the sanitizer is widened?
