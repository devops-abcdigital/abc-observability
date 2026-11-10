# Build context is the repository root so the example uses the library from the workspace.
# docker compose -f examples/multi-service/docker-compose.yml up --build
FROM node:24-slim

WORKDIR /repo
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/node/package.json packages/node/
COPY examples/multi-service/package.json examples/multi-service/
RUN npm ci --no-audit --no-fund

COPY packages/node packages/node
RUN npm run build -w packages/node

COPY examples/multi-service examples/multi-service
WORKDIR /repo/examples/multi-service
ENV NODE_ENV=production
