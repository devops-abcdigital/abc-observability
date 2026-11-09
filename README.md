# abc-observability

abc-observability

This repository was generated using a project template in Backstage.
It is registered in the Backstage Software Catalog.

## Catalog and infrastructure metadata

`catalog-info.yaml` registers this project and links its source code and TechDocs.
The JSON file [`infra_info.json`](infra_info.json) records the Catalog reference,
owner, repository, branch, documentation paths and Docker image repository.
Its `defaults` section contains public Compose runtime, image, port and health
check settings. `.env.example` lists `PROJECT_NAME` and `PORT` for local use.
Provisioning initializes these keys in secret storage using the selected internal
port; deployment injects the saved environment without writing an env file on the host.
The repository metadata starts with an empty `environments` list.
Fill it with the real server, branch, resource limits and host/app ports after setup.
The Environments & Servers tab currently reads backend setup records; it does not
read or synchronize this repository file automatically.

## Documentation

Documentation is available in [docs/index.md](docs/index.md).
See the [Backstage Catalog & TechDocs Guide](docs/index.md) to configure Catalog and TechDocs.
Navigation is configured in `mkdocs.yml`; open the Component's **Docs** tab in Backstage to read it.

## Getting Started

```bash
npm install
cp .env.example .env
npm start
```

This starter uses the ABC Digital Express application with its static dashboard.
Use Node.js 24 or later. The server loads the optional root `.env` file on startup;
existing process variables supplied by Jenkins or Docker take precedence.
Restart the server after changing `.env`.
Open `http://localhost:3000`, `/api/health` and `/api/infra` after starting it.
Use `npm ci` for reproducible installation with the included lockfile.

The dashboard reads the root `infra_info.json` through `/api/infra`.
The badge above the page heading displays the container's `PROJECT_NAME`, falling
back to `projectName` in `infra_info.json` when unset or blank. Only this display
name is exposed from the environment. After editing or uploading environment
variables in Backstage, save and deploy again, then reload the page.
For existing generated repositories, copy the updated `server.js` and
`public/index.html` from this starter into the application repository and rebuild
its image; updating the Backstage template alone does not update existing apps.
Unallocated servers, ports and resources remain unset; update the file with actual
environment settings after provisioning. No production server values are copied
from the original demo. Never store credentials in this public metadata file.

```bash
docker build -t abc-observability .
docker run --rm -p 3000:3000 abc-observability
```
