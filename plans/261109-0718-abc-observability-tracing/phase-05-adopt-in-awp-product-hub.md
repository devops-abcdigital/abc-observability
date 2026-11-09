---
phase: 5
title: "Phase 5: Adopt in awp-product-hub"
status: todo
priority: P1
effort: "0.5d"
dependencies: [3]
---

# Phase 5: Adopt in awp-product-hub

<!-- Updated: Validation Session 1 - local otel-lgtm verification only; wrap background connector syncs as job spans so job errors are alertable -->

## Overview

Cài `@devops-abcdigital/observability-node@0.1.0` vào backend của repo **awp-product-hub** (`D:\Workspace\abc\awp-product-hub\awp-product-hub`), bọc các job đồng bộ connector chạy nền thành span `job.*`, và kiểm chứng trace **chỉ với `otel-lgtm` ở máy dev**. Cấu hình để sẵn sao cho khi deploy lên VPS chỉ cần đổi biến môi trường. Mọi đường dẫn trong phase này tính từ gốc repo awp-product-hub.

## Key Insights

- Backend: NestJS 11 + Express, MikroORM 7 (`@mikro-orm/postgresql` dùng `kysely` + `pg` 8.23), `nestjs-pino`, `@google-analytics/data` (gRPC, `@grpc/grpc-js` có trong lockfile), gọi HTTP ra ngoài bằng `fetch` (`hrm-client.service.ts`, `asc-client.service.ts`). Build ra **CommonJS**.
- Lệnh chạy production là `exec node dist/main` ở dòng cuối `docker-entrypoint.sh`, sau `mikro-orm migration:up` và `seeder:run`. Chỉ thêm `--import` cho lệnh chạy API, không dùng `NODE_OPTIONS` trong image để migration không bị trace lẫn.
- App **không có handler SIGTERM** và không gọi `enableShutdownHooks` (grep `be/src` không thấy), nên logic shutdown của lib (phase 2) phải tự trả lại hành vi thoát mặc định.
- Dockerfile chạy `npm ci` ở hai stage (`build` dòng 10, `prod-deps` dòng 21). Package private nên cần BuildKit secret, token không được nằm trong layer.
- Repo chưa có pipeline build image nào (không có `.github/workflows`, không có `Jenkinsfile`, `jenkinsBuildStatus: NOT_CONFIGURED`). Luồng chuẩn của công ty là Backstage + Jenkins, nên khả năng cao image sẽ được build bằng **Jenkins**. Dockerfile phải nhận token theo cùng một cách (`--secret id=npmrc`) bất kể pipeline là Jenkins, GitHub Actions hay máy dev.
<!-- Updated: Validation Session 2 - image build may run on Jenkins; document read:packages credential for Jenkins and GitHub Actions -->

- Job chạy nền: `ConnectorSchedulerService.tick()` (`@Cron`, `connector-scheduler.service.ts`) và `ConnectorFirstSyncListener.onProjectConnectorsSaved()` (`@OnEvent`, `connector-first-sync.listener.ts`). Cả hai **bắt lỗi rồi chỉ ghi log**. Ngoài ra `ConnectorSyncRun.read()` (`connector-sync-run.ts`) bắt lỗi của provider, lưu thông điệp đã làm sạch và trả về kết quả có `error`, không ném. Vì vậy phải dùng `markSpanError()` thì lỗi job mới hiện trên trace và kích hoạt cảnh báo.
- `infra_info.json`: `"environment": "unconfigured"`, `"serverId": null`: chưa deploy lên server nào. Không có file `.env.example` nào được track; biến môi trường được ghi trong `README.md`.
- Backend chạy local ở cổng 3002 (`README.md`), trong container ở 3000; `otel-lgtm` dùng 3001.
- Health check container gọi `/api/v1/health` mỗi 10 giây: lib mặc định bỏ qua.

## Requirements

- [ ] `be/package.json` có `@devops-abcdigital/observability-node` (`^0.1.0`) và `@opentelemetry/api` (peer).
- [ ] `.npmrc` ở gốc repo chỉ chứa dòng registry của scope `@devops-abcdigital`.
- [ ] `docker-entrypoint.sh` chạy API bằng `node --import @devops-abcdigital/observability-node/register dist/main`.
- [ ] Dockerfile cài được package private bằng BuildKit secret `npmrc`; image cuối không chứa token.
- [ ] `README.md` ghi cách truyền token `read:packages` khi build image cho cả ba nơi:
  - **Máy dev:** `docker build --secret id=npmrc,src=$HOME/.npmrc .`
  - **Jenkins:** DevOps tạo credential loại *Secret file* (file `.npmrc` chứa token `read:packages` của tài khoản bot); Jenkinsfile dùng `withCredentials([file(credentialsId: '<id>', variable: 'NPMRC')])` rồi chạy `DOCKER_BUILDKIT=1 docker build --secret id=npmrc,src=$NPMRC .`
  - **GitHub Actions** (nếu org cho phép): cấp quyền cho repo trong trang package (Package settings → Manage Actions access → Add repository), tạo file `.npmrc` từ `GITHUB_TOKEN` trong job rồi truyền bằng `--secret`.
- [ ] Mỗi lần đồng bộ một connector trong `tick()` và `onProjectConnectorsSaved()` chạy trong `withSpan('job.connector.sync', …)` với attribute `connector.type`, `project.id`, `connector.trigger` (`scheduled` hoặc `first-sync`).
- [ ] `ConnectorSyncRun.read()` gọi `markSpanError(message)` với thông điệp đã làm sạch hiện có khi provider lỗi.
- [ ] Không đặt biến `OTEL_*` thì backend chạy y như trước (lib tự tắt, `withSpan` vẫn chạy hàm bình thường).
- [ ] `infra_info.json` → `defaults.environmentKeys` thêm `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`.
- [ ] `README.md` có mục "Bật tracing ở local".

## Architecture

```
Máy dev (phạm vi phase này)                VPS (sau này, ngoài plan)
be (npm run dev -w be,                     container awp-product-hub
    NODE_OPTIONS=--import=...register)       node --import ...register dist/main
   │ OTLP → localhost:4318                    │ OTLP → alloy-shared:4318
   ▼                                          ▼
otel-lgtm (Grafana localhost:3001)         Alloy → gateway → Tempo → agf.abcdigital.io

Job span:
job.connector.sync  (connector.type=ga4, project.id=…, trigger=scheduled)
 ├─ pg: SELECT …
 ├─ grpc / fetch tới provider   ← lỗi provider
 └─ markSpanError("…")          ← span job thành ERROR
```

## Related Code Files

- Modify: `be/package.json`, `package-lock.json`, `docker-entrypoint.sh`, `Dockerfile`, `infra_info.json`, `README.md`.
- Modify: `be/src/modules/connectors/application/connector-scheduler.service.ts`, `be/src/modules/connectors/application/connector-first-sync.listener.ts`, `be/src/modules/connectors/application/connector-sync-run.ts`, cùng unit test tương ứng nếu có.
- Create: `.npmrc` (gốc repo, chỉ dòng registry).

## Implementation Steps

1. Tạo nhánh mới từ `main` (ví dụ `feat/tracing`), không làm trên `test-01`.
2. Thêm `.npmrc` gốc, cấu hình token cá nhân ở `~/.npmrc`, chạy `npm i -w be @devops-abcdigital/observability-node @opentelemetry/api`.
3. Bọc job: trong vòng lặp của `tick()` và `onProjectConnectorsSaved()`, đặt lời gọi sync bên trong `withSpan('job.connector.sync', …)`; giữ nguyên `try/catch` và log hiện có (withSpan ném lại lỗi nên log vẫn chạy).
4. Trong `catch` của `ConnectorSyncRun.read()`, gọi `markSpanError(message)` với biến `message` đã làm sạch sẵn.
5. Sửa `docker-entrypoint.sh`: dòng cuối thành `exec node --import @devops-abcdigital/observability-node/register dist/main`.
6. Sửa Dockerfile: các lệnh `npm ci` dùng `RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci ...`; ghi lệnh build mẫu `docker build --secret id=npmrc,src=$HOME/.npmrc .`.
7. Cập nhật `infra_info.json` và `README.md`.
8. Kiểm chứng ở local:
   - `docker run -d --name otel-lgtm -p 3001:3000 -p 4318:4318 grafana/otel-lgtm:<tag>`.
   - Chạy backend với `OTEL_SERVICE_NAME=awp-product-hub-api-local`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, `NODE_OPTIONS=--import=@devops-abcdigital/observability-node/register`.
   - Gọi một API cần đăng nhập có đọc DB, một API có gọi ra ngoài (HRM hoặc đồng bộ GA4), và `/api/v1/health`.
   - Kích hoạt một lần đồng bộ connector với key sai để có job lỗi.
   - Mở Grafana `localhost:3001` → Explore → Tempo → Search theo service name.
9. Chạy toàn bộ kiểm tra của repo, build image Docker với secret, rồi dừng `otel-lgtm` (`docker rm -f otel-lgtm`) khi xong.

## Todo

- [ ] Nhánh mới từ `main`
- [ ] `.npmrc` + cài package
- [ ] Bọc job trong `tick()` và `onProjectConnectorsSaved()`
- [ ] `markSpanError` trong `ConnectorSyncRun.read()`
- [ ] Unit test: job lỗi vẫn được log như cũ; không có `OTEL_*` thì sync chạy bình thường
- [ ] `docker-entrypoint.sh`
- [ ] Dockerfile dùng BuildKit secret
- [ ] `infra_info.json` + `README.md`
- [ ] Kiểm chứng trace: span HTTP → controller NestJS → truy vấn `pg`
- [ ] Kiểm chứng trace: span gọi ra ngoài (fetch hoặc gRPC tới GA4)
- [ ] Kiểm chứng: span `job.connector.sync` có status ERROR khi provider lỗi, OK khi thành công
- [ ] Kiểm chứng: `/api/v1/health` không sinh span
- [ ] Kiểm chứng: log của `nestjs-pino` có `trace_id` khớp với trace
- [ ] Kiểm chứng: không đặt `OTEL_*` thì không có kết nối nào tới 4318 và app chạy bình thường
- [ ] `npm run verify && npm test` (gốc repo) pass, `npm run test:e2e -w be` pass
- [ ] `docker build --secret id=npmrc,...` thành công trên máy dev; `docker history` không lộ token
- [ ] `README.md` có hướng dẫn truyền token cho Jenkins và GitHub Actions

## Success Criteria

- [ ] Grafana local thấy trace của `awp-product-hub-api-local` gồm span HTTP, NestJS, `pg`, và span gọi API ngoài, cùng một `trace_id`.
- [ ] Đồng bộ connector lỗi tạo span `job.connector.sync` status ERROR, không chứa key hay URL có key.
- [ ] Toàn bộ test và verify của repo vẫn xanh.
- [ ] Image build được; chạy container không có biến `OTEL_*` thì health check vẫn healthy.

## Risk Assessment

- Instrumentation `pg` không bắt được truy vấn qua `kysely` của MikroORM: ghi lại kết quả, quay lại phase 2 bổ sung (không vá tại dự án).
- `@CreateRequestContext()` của MikroORM bọc method job: đặt `withSpan` bên trong thân method để span nằm trong ORM context, không đổi thứ tự decorator.
- Pipeline build image thiếu quyền đọc package: với Jenkins, cần DevOps tạo credential Secret file từ tài khoản bot (không dùng token cá nhân); với GitHub Actions, cấp quyền cho repo trong Package settings → Manage Actions access. Chưa có pipeline nào nên phase này chỉ kiểm chứng build bằng máy dev, phần Jenkins/Actions ghi trong `README.md` để làm khi dựng pipeline.
- Token bot của Jenkins hết hạn làm build hỏng: ghi ngày hết hạn và người chịu trách nhiệm xoay vòng trong `README.md`.
- `nest start --watch` không nhận `NODE_OPTIONS`: dùng `nest start --watch --exec "node --import ..."` nếu cần, ghi vào `README.md`.

## Security Considerations

- Token chỉ nằm ở `~/.npmrc` của dev, Jenkins Credentials hoặc `GITHUB_TOKEN` của Actions. BuildKit secret không ghi vào layer. Token cho build image chỉ cần `read:packages`, không cấp `write:packages`.
- `markSpanError` chỉ nhận thông điệp đã làm sạch (`connectorErrorMessage`), không nhận lỗi gốc của provider.
- Hậu tố `-local` cho service name ở máy dev.

## Next Steps

- Khi awp-product-hub được deploy lên VPS: thêm `OTEL_SERVICE_NAME=awp-product-hub-api`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy-shared:4318`, `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=<env>` và network `abc_telemetry_network` vào compose deploy. Không cần sửa code.
