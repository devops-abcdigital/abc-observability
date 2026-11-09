---
title: "abc-observability: thư viện tracing dùng chung"
description: "Chuyển repo abc-observability thành thư viện OpenTelemetry cho Node chỉ xuất traces, cảnh báo lỗi request và job vào Teams, và áp dụng đầu tiên cho awp-product-hub."
status: pending
priority: P1
effort: 4d
branch: main
tags: [infra, backend, observability, experimental]
blockedBy: []
blocks: []
created: 2026-11-09
---

# abc-observability: thư viện tracing dùng chung

## Overview

Repo `devops-abcdigital/abc-observability` (`D:\Workspace\abc\abc-observability`, đang là template Backstage dạng service) được chuyển thành monorepo chứa thư viện `@devops-abcdigital/observability-node`. Mọi dự án Node cài lib, nạp bằng `node --import`, đặt vài biến `OTEL_*` là có trace xuyên service trên Grafana, thấy được service nào gọi service nào và lỗi ở bước nào. Repo cũng giữ rule cảnh báo gửi vào một kênh Microsoft Teams chung khi request hoặc job chạy nền lỗi. awp-product-hub là dự án áp dụng đầu tiên.

## Outcome, constraints, non-goals

- **Outcome:** một dự án Node tích hợp trong 3 bước, không viết code trace thủ công, vẫn thấy trace HTTP → framework → DB → gọi API ngoài, nối qua nhiều service; lỗi request và job được báo vào Teams.
- **Constraints:** chỉ traces, chỉ backend Node 24; test bằng `grafana/otel-lgtm` ở local; phát hành qua GitHub Packages, bản đầu release từ máy người được giao quyền bằng `npm run release` có kiểm tra an toàn (pipeline CI để sau khi DevOps chốt Actions hay Jenkins); lib không bao giờ làm app crash; không commit token hay URL webhook.
- **Non-goals:** quản lý hoặc cấu hình Alloy (DevOps giữ), logs và metrics gửi về Grafana, package frontend (Faro), dashboard, thư viện cho ngôn ngữ khác, Kubernetes, tự động provision Grafana, deploy awp-product-hub lên VPS.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Convert Repository to Library Monorepo](./phase-01-start.md) | Pending |
| 2 | [Node Tracing Library](./phase-02-node-tracing-library.md) | Pending |
| 3 | [Examples, Docs and Release](./phase-03-examples-docs-and-release.md) | Pending |
| 4 | [Teams Error Alerts](./phase-04-teams-error-alerts.md) | Pending |
| 5 | [Adopt in awp-product-hub](./phase-05-adopt-in-awp-product-hub.md) | Pending |

Phụ thuộc: 1 → 2 → 3, sau đó phase 4 và 5 làm song song được (cả hai chỉ cần phase 3).

## Success Criteria

- [ ] `@devops-abcdigital/observability-node@0.1.0` có trên GitHub Packages, CI của repo xanh, Backstage hiển thị component loại `library`.
- [ ] App mẫu 3 service cho ra một trace duy nhất, span lỗi nằm đúng service gây lỗi.
- [ ] awp-product-hub có trace HTTP → NestJS → `pg` → API ngoài trên Grafana local; job đồng bộ connector lỗi có span `job.connector.sync` status ERROR; không đặt `OTEL_*` thì chạy như cũ; test của repo vẫn xanh.
- [ ] Request lỗi và job lỗi vượt ngưỡng tạo tin FIRING/RESOLVED trong kênh Teams chung.

## Code quality rules

- [ ] Không tự đọc lại các biến `OTEL_*` chuẩn: để `NodeSDK` xử lý. Chỉ `config.ts` đọc biến riêng `ABC_OTEL_IGNORE_PATHS`.
- [ ] Một nguồn sự thật cho mỗi quy tắc: đường dẫn bỏ qua là hằng số `DEFAULT_IGNORED_PATHS` trong `config.ts`; `@Traced()` dùng lại `withSpan()`; tiền tố `job.` định nghĩa một lần trong `docs/conventions.md` và rule cảnh báo dựa vào đó.
- [ ] File nhỏ, một việc (`sdk.ts`, `shutdown.ts`, `instrumentations.ts`…), không có `any`, hằng số có tên.
- [ ] Các bước release chỉ nằm trong `scripts/release.mjs`; pipeline CI sau này gọi lại script đó, không chép lại các bước.
- [ ] Dùng lại công cụ có sẵn: auto-instrumentation chính thức của OTel, changesets, cấu hình ESLint/Prettier của awp-product-hub, thông điệp lỗi đã làm sạch `connectorErrorMessage` của awp-product-hub; không tự viết instrumentation cho MikroORM.
- [ ] Không commit token, `.env`, URL webhook.

## Dependencies

- Quyền publish package trong org `devops-abcdigital`: token `write:packages` cho người release, token `read:packages` cho dev và pipeline build image của dự án.
- DevOps: xác nhận org có cho phép GitHub Actions không, hoặc tạo job Jenkins kèm tài khoản bot giữ token (cần cho pipeline release tự động sau này và cho build image của awp-product-hub).
- Người quản lý Backstage: xác nhận đổi `componentType`/`spec.type` sang `library`.
- DevOps: Tempo bật TraceQL metrics, quyền tạo alert rule và contact point trên Grafana.
- Tham khảo: `devops-abcdigital/ai-benchmark-tool` (`server/src/telemetry.ts`, `server/src/services/inference.ts`).

## Validation Log

### Session 1 — 2026-11-09
**Trigger:** người dùng yêu cầu chạy validate ngay sau khi lập plan.
**Questions asked:** 7

#### Verification Results
- **Tier:** Full (5 phases)
- **Claims checked:** 33
- **Verified:** 26 | **Failed:** 3 (đã sửa sau phỏng vấn) | **Unverified:** 4
- Đã xác minh: `be/package.json` không có `"type"` + tsconfig `nodenext` (CommonJS); NestJS 11, MikroORM 7, `nestjs-pino`, `@google-analytics/data`; lockfile có `kysely` + `pg` 8.23.1 dưới `@mikro-orm/postgresql` và `@grpc/grpc-js`; `docker-entrypoint.sh` kết thúc bằng `exec node dist/main` sau migration + seed; Dockerfile `npm ci` ở dòng 10 và 21; healthcheck `/api/v1/health`; `infra_info.json` `unconfigured`/`serverId: null`; không có `.env.example` được track; không có handler SIGTERM hay `enableShutdownHooks`; `fetch` trong `hrm-client.service.ts`, `asc-client.service.ts`; job `tick()` (`@Cron`) và `onProjectConnectorsSaved()` (`@OnEvent`); `ConnectorSyncRun.read()` bắt lỗi và dùng `connectorErrorMessage`; repo `abc-observability` có `server.js`, `Dockerfile`, `catalog-info.yaml` `spec.type: service`, `mkdocs.yml`; ai-benchmark-tool không có auto-instrumentation và thiếu `config.alloy`; gateway trả 200.
- Failures (đã sửa):
  1. [Fact Checker] Phase 1 định tạo repo mới, nhưng `D:\Workspace\abc\abc-observability` đã tồn tại (commit `017cd60 initial commit`, remote `devops-abcdigital/abc-observability`).
  2. [Fact Checker] Phase 5 ghi backend chạy local ở cổng 3000; thực tế `README.md` dòng 36 là 3002 (container mới là 3000).
  3. [Flow Tracer] Lỗi job không lên trace: `tick()`, `onProjectConnectorsSaved()` và `ConnectorSyncRun.read()` đều bắt lỗi không ném lại; cần `markSpanError()`.
- Unverified: cú pháp TraceQL của rule cảnh báo trên version Tempo thật; `nest start --watch` có nhận `NODE_OPTIONS`; Tempo đã bật TraceQL metrics; Backstage chấp nhận `library` trong `infra_info.json`.

#### Questions & Answers

1. **[Scope]** Đặt tên repo thư viện tracing là gì?
   - Options: abc-observability | observability-kit
   - **Answer:** abc-observability
   - **Custom input:** "chọn 1 và sau khi xong chuyển plan qua repo này \"D:\Workspace\abc\abc-observability\""
   - **Rationale:** quyết định tên package và nơi lưu plan.
2. **[Scope]** Phase 4 có chuyển cấu hình alloy-shared về repo mới không?
   - Options: Chuyển về ngay | Chỉ viết config mẫu | Bỏ khỏi plan
   - **Answer:** Bỏ khỏi plan
   - **Rationale:** Alloy do DevOps giữ; plan chỉ còn lib, cảnh báo, áp dụng.
3. **[Architecture]** Cảnh báo Teams gửi theo cách nào?
   - Options: Một kênh chung | Mỗi dự án một kênh
   - **Answer:** Một kênh chung
   - **Rationale:** một contact point, notification policy đơn giản.
4. **[Assumptions]** Thế nào thì tính là lỗi để cảnh báo?
   - Options: Chỉ lỗi request phía server | Cả lỗi job chạy nền
   - **Answer:** Cả lỗi job chạy nền
   - **Rationale:** cần span gốc cho job và `markSpanError()` vì code hiện bắt lỗi không ném.
5. **[Architecture]** Xử lý file template Backstage của repo thế nào?
   - Options: Xóa app mẫu, đổi thành library | Giữ nguyên app mẫu
   - **Answer:** Xóa app mẫu, đổi thành library
   - **Rationale:** repo không deploy; giữ Catalog và TechDocs.
6. **[Risks]** Phase 5 kiểm chứng trace ở đâu?
   - Options: Chỉ otel-lgtm ở local | Thêm gửi lên gateway thật
   - **Answer:** Chỉ otel-lgtm ở local
   - **Rationale:** không ghi vào hệ thống chung; dự án chưa deploy.
7. **[Tradeoffs]** Phát hành thư viện qua đâu?
   - Options: GitHub Packages | Cài từ git tag
   - **Answer:** GitHub Packages
   - **Rationale:** có semver; dev và CI cần token `read:packages`.

#### Confirmed Decisions
- Tên repo `abc-observability`, package `@devops-abcdigital/observability-node`, plan lưu trong repo này.
- Alloy ngoài phạm vi; cảnh báo Teams một kênh chung, gồm lỗi request và lỗi job.
- Repo chuyển sang loại `library`, xóa app mẫu.
- Phase 5 chỉ kiểm chứng local; phát hành qua GitHub Packages.

#### Impact on Phases
- Phase 1: chuyển đổi repo có sẵn thay vì tạo mới; bỏ thư mục `alloy/`; đổi Backstage sang `library`.
- Phase 2: thêm `markSpanError()` và hướng dẫn bọc job.
- Phase 3: quy ước tên span `job.*`, thêm trang docs vào `mkdocs.yml`, ví dụ có job.
- Phase 4: đổi thành "Teams Error Alerts" (file `phase-04-teams-error-alerts.md`), phụ thuộc phase 3.
- Phase 5: bọc job connector, `markSpanError` trong `read()`, sửa cổng local 3002.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-start.md, phase-02-node-tracing-library.md, phase-03-examples-docs-and-release.md, phase-04-teams-error-alerts.md, phase-05-adopt-in-awp-product-hub.md
- Decision deltas checked: 7
- Reconciled stale references: 6 (thư mục `alloy/`, `config.alloy`, tên phase 4, phụ thuộc phase 4, tạo repo mới, cổng 3000)
- Unresolved contradictions: 0

### Session 2 — 2026-11-09
**Trigger:** người dùng hỏi release bằng GitHub Actions hay Jenkins, rồi yêu cầu sửa phase 3 và phase 5.
**Evidence:** awp-product-hub và ai-benchmark-tool có 0 lần chạy GitHub Actions, không có `.github/workflows` hay `Jenkinsfile`; `infra_info.json` có các trường Jenkins `NOT_CONFIGURED`; token của người dùng không đủ quyền xem cấu hình Actions của org.

#### Confirmed Decisions
- Bản đầu release từ máy người được giao quyền bằng `npm run release` (`scripts/release.mjs`) với các kiểm tra chặn và chế độ `--dry-run`.
- Pipeline release tự động (GitHub Actions hoặc Jenkins) để sau, gọi lại cùng script.
- Build image của dự án truyền token `read:packages` bằng `--secret id=npmrc` cho máy dev, Jenkins (credential Secret file) và GitHub Actions.

#### Impact on Phases
- Phase 1: thêm rủi ro `ci.yml` không chạy nếu org chưa bật Actions.
- Phase 3: bỏ `release.yml`; thêm `scripts/release.mjs`, `docs/releasing.md`, kiểm thử từng điều kiện chặn.
- Phase 5: thêm hướng dẫn token cho Jenkins và GitHub Actions trong `README.md`; chỉ kiểm chứng build trên máy dev.

### Whole-Plan Consistency Sweep (Session 2)
- Files reread: plan.md, phase-01-start.md, phase-03-examples-docs-and-release.md, phase-05-adopt-in-awp-product-hub.md
- Decision deltas checked: 3
- Reconciled stale references: 3 (`release.yml`, luồng changesets/action, giả định CI build image chỉ là GitHub Actions)
- Unresolved contradictions: 0

<!-- slug: abc-observability-tracing -->
