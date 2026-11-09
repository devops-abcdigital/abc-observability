# Teams error alerts

Grafana alert rules that post to one shared Microsoft Teams channel when a service's failed requests or failed
background jobs (`job.*` spans) pass a threshold in 5 minutes.

| File                 | Content                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `server-errors.yaml` | the two alert rules, Grafana provisioning format                    |
| `teams-message.tmpl` | the Teams message template (`abc.teams.title`, `abc.teams.message`) |

Setup, prerequisites from DevOps, and the reasons behind each choice:
[docs/alerts.md](../docs/alerts.md) (also on the Backstage **Docs** tab).

The Teams webhook URL never goes into this repository; it only lives in Grafana's contact point.
