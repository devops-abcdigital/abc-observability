# Example: one trace across three services

`gateway` → `auth` → `users`, each a small Express app started with
`node --import @devops-abcdigital/observability-node/register`. It answers the question the library exists for:
**which service called which, and where did it fail?**

| Service   | Route                | Calls                                            |
| --------- | -------------------- | ------------------------------------------------ |
| `gateway` | `GET /login?id=…`    | `auth /token`                                    |
| `auth`    | `GET /token?id=…`    | `users /users/:id`                               |
| `users`   | `GET /users/:id`     | fails when `id=broken`                           |
| `users`   | `POST /jobs/cleanup` | runs the background job; `?fail=1` makes it fail |

`users` also runs the `job.example.cleanup` job every 30 seconds. The job catches its own errors and calls
`markSpanError()`, which is how a caught failure still turns the job span red.

The services use the library from this workspace, so no registry token is needed.

## Run

The services send traces to the shared Alloy (`http://alloy-shared:4318`) over the external `abc_telemetry_network`
Docker network, so run the example on a server where DevOps runs `alloy-shared`. From the repository root:

```bash
docker compose -f examples/multi-service/docker-compose.yml up -d --build

curl "http://localhost:8080/login?id=alice"         # OK
curl "http://localhost:8080/login?id=broken"        # fails inside users
curl -X POST "http://localhost:8082/jobs/cleanup?fail=1"  # failed background job
```

Open Grafana at <https://agf.abcdigital.io> → **Explore** → data source **Tempo** → **Search**, service name
`example-gateway`. The `broken` request is a single trace with spans from all three services:

```
example-gateway  GET /login                   ERROR (answered 502)
example-gateway    GET                        client call to auth
example-auth         GET /token               ERROR (answered 502)
example-auth           GET                    client call to users
example-users            GET /users/:id       ERROR (answered 500)
example-users              users.find         ERROR + exception "user record is corrupted"
```

The deepest red span with an exception (`users.find`) is where the failure started; the red spans above it only
passed the error on. The failed job shows up as its own trace, root span `job.example.cleanup`, status ERROR.

TraceQL to find them directly:

```
{ status = error && name = "users.find" }
{ name =~ "job\\..*" && status = error }
```

Stop with `docker compose -f examples/multi-service/docker-compose.yml down`.
