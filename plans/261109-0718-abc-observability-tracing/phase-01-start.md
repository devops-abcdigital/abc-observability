---
phase: 1
title: "Phase 1: Convert Repository to Library Monorepo"
status: todo
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Convert Repository to Library Monorepo

<!-- Updated: Validation Session 1 - repo already exists from a Backstage service template; convert it instead of creating it, drop Alloy folder -->

## Overview

Repo `devops-abcdigital/abc-observability` đã có sẵn ở `D:\Workspace\abc\abc-observability` (một commit `initial commit`), sinh từ template Backstage dạng **service**: app Express mẫu, Dockerfile, docker-compose chạy cổng 3000. Phase này chuyển nó thành **monorepo thư viện** dùng npm workspaces, giữ phần Backstage Catalog và TechDocs, thêm môi trường test local bằng `grafana/otel-lgtm`. Chưa có code thư viện.

## Key Insights

- File template hiện có: `server.js`, `public/`, `Dockerfile`, `.dockerignore`, `docker-compose.yml` (app `ghcr.io/devops-abcdigital/abc-observability`), `infra_info.json` (`componentType: "service"`, `healthCheckPath: /api/health`), `catalog-info.yaml` (`spec.type: "service"`, annotation `abc.io/infra-info-path`), `mkdocs.yml` + `docs/` (TechDocs), `package.json` (`type: module`, dependency `express`).
- Repo là thư viện, **không deploy**, nên app mẫu và các file chạy container là thừa.
- GitHub Packages bắt buộc npm scope trùng tên org: `@devops-abcdigital`.
- awp-product-hub dùng Node 24, npm workspaces, ESLint 10, Prettier 3, Vitest 4: dùng cùng bộ công cụ.
- Backend awp-product-hub chạy local ở cổng 3002 và trong container ở cổng 3000; Grafana của `otel-lgtm` map ra **3001** để không đụng.

## Requirements

- [ ] Xóa app mẫu: `server.js`, `public/`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, dependency `express`.
- [ ] `catalog-info.yaml`: `spec.type` đổi thành `library`, mô tả rõ mục đích repo. `infra_info.json`: `componentType` đổi thành `library`, bỏ các giá trị chỉ dành cho service chạy container nếu Backstage cho phép (hỏi người quản lý Backstage trước khi xóa trường nào).
- [ ] Giữ `mkdocs.yml`, `docs/` để TechDocs tiếp tục hoạt động.
- [ ] `package.json` gốc: `private: true`, `engines.node: "24"`, workspaces `packages/*` và `examples/*`.
- [ ] `npm ci && npm run verify && npm test` chạy được trên repo chưa có package (test dùng `--passWithNoTests`).
- [ ] Không commit token hay `.env`.

## Architecture

```
abc-observability/
├── packages/                (phase 2 thêm packages/node)
├── examples/                (phase 3)
├── alerts/                  (phase 4)
├── docs/                    ← giữ, TechDocs (mkdocs.yml)
├── plans/                   ← plan này được chuyển về đây
├── .github/workflows/ci.yml
├── docker-compose.dev.yml   ← otel-lgtm: 3001:3000, 4318:4318
├── catalog-info.yaml        ← spec.type: library
├── infra_info.json          ← componentType: library
├── mkdocs.yml
├── package.json             ← workspaces
├── tsconfig.base.json
├── eslint.config.mjs
├── .prettierrc
├── .npmrc                   ← @devops-abcdigital:registry=https://npm.pkg.github.com
├── .nvmrc
├── .gitignore               ← thêm dist/, .cache/
└── README.md                ← viết lại: mục đích, sơ đồ, link docs
```

## Related Code Files

- Delete: `server.js`, `public/`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`.
- Modify: `package.json`, `package-lock.json`, `catalog-info.yaml`, `infra_info.json`, `.gitignore`, `README.md`.
- Create: `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.npmrc`, `.nvmrc`, `docker-compose.dev.yml`, `.github/workflows/ci.yml`.
- Tham khảo cấu hình: `awp-product-hub/package.json`, `awp-product-hub/be/eslint.config.mjs`, `awp-product-hub/be/tsconfig.json`.

## Implementation Steps

1. Tạo nhánh làm việc trong `D:\Workspace\abc\abc-observability` (ví dụ `feat/library-scaffold`).
2. Xóa các file app mẫu ở Requirements.
3. Viết lại `package.json` gốc: bỏ `type`, `main`, `express`; thêm workspaces và script `build`, `verify`, `test`, `fix` chạy theo workspaces (giống awp-product-hub). Chạy `npm install` để làm mới `package-lock.json`.
4. Thêm `tsconfig.base.json` (strict, `target: ES2023`, `module/moduleResolution: nodenext`, `experimentalDecorators: true` vì `@Traced()` dùng decorator kiểu cũ như NestJS).
5. Copy và rút gọn cấu hình ESLint, Prettier từ awp-product-hub.
6. Cập nhật `catalog-info.yaml` và `infra_info.json` sang `library`.
7. Thêm `docker-compose.dev.yml` chạy `grafana/otel-lgtm` (ghim tag cụ thể), map `3001:3000` và `4318:4318`.
8. Thêm `.github/workflows/ci.yml`: Node 24, `npm ci`, `npm run verify`, `npm test`.
9. Viết lại `README.md`: mục đích repo, sơ đồ App → Alloy → Tempo → Grafana, link sang `docs/`.

## Todo

- [ ] Nhánh làm việc
- [ ] Xóa app mẫu
- [ ] `package.json` gốc + workspaces + lockfile mới
- [ ] `tsconfig.base.json`, ESLint, Prettier, `.nvmrc`, `.gitignore`, `.npmrc`
- [ ] `catalog-info.yaml`, `infra_info.json` sang `library`
- [ ] `docker-compose.dev.yml` với `otel-lgtm`
- [ ] CI workflow
- [ ] README mới

## Success Criteria

- [ ] `npm ci && npm run verify && npm test` pass ở local và trên CI.
- [ ] `docker compose -f docker-compose.dev.yml up -d` mở được Grafana tại `http://localhost:3001`, datasource Tempo có sẵn.
- [ ] Component trên Backstage hiển thị loại `library`, tab Docs vẫn mở được.
- [ ] `git ls-files` không chứa `.env` hay token.

## Risk Assessment

- Backstage dựa vào một số trường của `infra_info.json`: chỉ đổi `componentType`, không xóa trường khác khi chưa hỏi người quản lý Backstage.
- Version `otel-lgtm` đổi cổng hoặc datasource: ghim tag cụ thể, không dùng `latest`.
- Org có thể chưa cho phép GitHub Actions (các repo khác chưa từng chạy): khi đó `ci.yml` không chạy. Không chặn plan, vì script release ở phase 3 tự chạy `verify` và `test` trước khi publish; báo DevOps để quyết định Actions hay Jenkins.
<!-- Updated: Validation Session 2 - GitHub Actions availability unconfirmed -->


## Security Considerations

- Repo private. `.npmrc` trong repo chỉ chứa dòng registry; token để ở `~/.npmrc` của từng người hoặc secret của CI.

## Next Steps

- Phase 2 thêm `packages/node`.
