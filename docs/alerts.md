# Teams error alerts

Grafana posts to **one shared Microsoft Teams channel** when a service has too many failures in 5 minutes:

| Alert                    | Counts                                                      | Fires when            |
| ------------------------ | ----------------------------------------------------------- | --------------------- |
| `Failed requests`        | server spans with status ERROR (5xx or unhandled exception) | more than 10 in 5 min |
| `Failed background jobs` | spans named `job.*` with status ERROR                       | more than 3 in 5 min  |

Each alert is per service (`service.name`) and environment (`deployment.environment`). The message shows the
service, environment, kind (request or job), error count and a link that opens Grafana Explore on the failing
traces. It never includes exception text. When errors drop back under the threshold a RESOLVED message follows;
while an alert keeps firing it repeats at most every 4 hours.

Files, in [`alerts/`](https://github.com/devops-abcdigital/abc-observability/tree/main/alerts):

- `server-errors.yaml`: the two alert rules (Grafana provisioning format);
- `teams-message.tmpl`: the Teams message template.

The Teams webhook URL is **not** in the repository. It only lives in the Grafana contact point.

## What a project needs to do

Nothing beyond the library conventions:

- set `OTEL_SERVICE_NAME` and `deployment.environment` as described in [Conventions](conventions.md);
- wrap background jobs in `withSpan('job.<area>.<task>', …)` and call `markSpanError()` where errors are caught
  and not rethrown.

Failed requests are detected automatically.

## How it works

```
service spans ──▶ Tempo ──metrics-generator──▶ traces_spanmetrics_calls_total (Prometheus/Mimir)
                                                    │  alert rule, evaluated every minute
                                                    ▼
                                    Grafana contact point "abc-observability-teams"
                                                    ▼
                                         Teams Workflows webhook ──▶ alert channel
```

The rules count error spans through Tempo's **span metrics** (`traces_spanmetrics_calls_total`, labels
`service`, `span_name`, `span_kind`, `status_code`) rather than a TraceQL metrics query:

- A TraceQL metrics query works in Explore, but in Grafana 12.1 its result always carries exemplar frames, which
  the alert expression engine rejects (`input data must be a wide series but got type long`). Tempo ignores
  `exemplars=0` and `with(exemplars=false)`, so the query cannot feed a multi-dimensional alert.
- Span metrics are plain Prometheus counters, so the alert is a normal PromQL rule.

Only server spans and `job.*` spans are counted, so one failure counts roughly once per service it passes through
instead of once per child span. A failure deep in a call chain (gateway → auth → users) still raises one alert per
service whose server span failed; the Explore link on each shows the same trace, and the deepest red span with an
exception is the origin.

## One-time setup (Grafana admin)

### 1. Prerequisites from DevOps

- Tempo **metrics-generator** with the `span-metrics` processor enabled, writing to the Prometheus/Mimir data
  source in Grafana. Check: `traces_spanmetrics_calls_total` returns data in Explore.
- `deployment.environment` added to the span-metrics **dimensions**, so the metric carries a
  `deployment_environment` label:

  ```yaml
  metrics_generator:
    processor:
      span_metrics:
        dimensions:
          - deployment.environment
  ```

  Without it the alerts still work but group by service only, and messages say "unknown env".

- Permission to create alert rules, contact points and notification policies in Grafana.

### 2. Teams webhook

In the alert channel: **⋯** next to the channel name → **Workflows** → template **"Post to a channel when a
webhook request is received"** → choose the team and channel → **Add workflow**. Copy the URL it shows and send it
to the Grafana admin over a private channel. Do not commit it or paste it in tickets.

### 3. Message template

**Alerting → Contact points → Notification Templates → Add notification template**, name
`abc-observability-teams`, content: the whole of `alerts/teams-message.tmpl`.

### 4. Contact point

**Alerting → Contact points → Add contact point**:

- Name: `abc-observability-teams`
- Integration: **Microsoft Teams**, URL: the Workflows URL from step 2
- Optional settings → Title: `{{ template "abc.teams.title" . }}`
- Optional settings → Message: `{{ template "abc.teams.message" . }}`
- Leave "Disable resolved message" off.

Use **Test** to check a message reaches the channel.

### 5. Notification policy

**Alerting → Notification policies → New child policy** under the default policy:

- Matcher: `notify` `=` `abc-observability-teams`
- Contact point: `abc-observability-teams`
- Override grouping: `alertname`, `service`, `deployment_environment`
- Override timings: group wait `30s`, group interval `1m`, repeat interval `4h`

### 6. Alert rules

Replace the placeholders in `alerts/server-errors.yaml` with the data source UIDs (Connections → Data sources →
open the data source; the UID is the last part of the URL):

```bash
sed -e 's/PROMETHEUS_DS_UID/<prometheus uid>/g' -e 's/TEMPO_DS_UID/<tempo uid>/g' \
  alerts/server-errors.yaml > server-errors.local.yaml
```

Then either:

- **File provisioning** (DevOps, recommended): put `server-errors.local.yaml` in Grafana's
  `provisioning/alerting/` directory and restart Grafana. The rules appear in folder **Observability**, read-only in
  the UI; change them by editing the file.
- **By hand**: **Alerting → Alert rules → New alert rule**, once per rule, copying from the file: the PromQL query
  (instant), Reduce `Last`, Threshold `> 10` (requests) or `> 3` (jobs), folder `Observability`, group
  `abc-observability-errors` evaluated every `1m`, pending period `0s`, no data → `OK`, error → `Error`, the labels
  `notify` and `error_kind`, and the annotations `summary` and `explore_url`.

### 7. Test

Send failures from a test service until the threshold is passed, for example with
[examples/multi-service](https://github.com/devops-abcdigital/abc-observability/tree/main/examples/multi-service)
pointed at the shared Alloy:

```bash
for i in $(seq 1 15); do curl -s -o /dev/null "http://localhost:8080/login?id=broken"; done
for i in $(seq 1 5); do curl -s -o /dev/null -X POST "http://localhost:8082/jobs/cleanup?fail=1"; done
```

A FIRING message arrives within about two minutes; once the failures stop, RESOLVED follows after the 5-minute
window drains (about 5–7 minutes).

## Tuning

The thresholds start high on purpose. After a week of real traffic, adjust `params` in `server-errors.yaml` (or in
the UI) per what the channel shows. To silence a service during maintenance use **Alerting → Silences** with matcher
`service = <name>`.
