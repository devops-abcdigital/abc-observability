---
'@devops-abcdigital/observability-node': minor
---

Report 500 errors to a Microsoft Teams chat. `teamsErrorNotifier()` (Express middleware), `TeamsExceptionFilter`
(NestJS, from the new `@devops-abcdigital/observability-node/nestjs` entry point) and `notifyServerError()` post an
Adaptive Card with the service, environment, route pattern, error type, sanitized message and a link to the trace in
Grafana. Off unless `ABC_ALERT_TEAMS_WEBHOOK_URL` is set; the same error is sent at most once per 60 seconds plus a
repeat summary. `@nestjs/common` and `@nestjs/core` are optional peer dependencies, needed only for the NestJS filter.
