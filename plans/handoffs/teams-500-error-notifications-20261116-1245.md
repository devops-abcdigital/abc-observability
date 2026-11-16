---
handoff-version: 1
generated: 2026-11-16T05:45:00Z
generator: ak-handoff
focus: "triển khai plan báo lỗi 500 vào Teams"
workspace: D:/Workspace/abc/abc-observability
branch: main
head: 2e1ed4b
---

# HANDOFF: Báo lỗi 500 vào Teams từ middleware của lib

## Mission and current status

Mục tiêu: lỗi 500 của các app Node dùng `@devops-abcdigital/observability-node` được báo vào group chat Teams trong
khoảng 10 giây. Tin gồm service, env, method, route, loại lỗi, message đã lọc và nút "Xem trace" mở Grafana. Luồng
Grafana alert cũ bị gỡ bỏ.

Done:
- Plan đã viết và validate: `plans/261116-1229-teams-500-error-notifications/` (4 phase, Validation Log Session 1).
- Webhook Teams Workflows ("Send webhook alerts to a chat") cho group chat "Test notification v1" đã chạy: Grafana gửi
  thử Adaptive Card thành công.
- Trên Grafana agf: dashboard "AWP Product Hub - Traces" (uid `li6jnpk`) có thêm panel "Exceptions" (id 2), cho mỗi
  trace một dòng gồm status, exception type và message.
- Đã ghi journal.

Remaining:
- Phase 1–4 của plan: chưa viết dòng code nào.
- Commit các file plan, report, journal (đang untracked) khi người dùng yêu cầu.

Urgency: P1 theo plan.

## Scope and guardrails

- Workspace: `D:/Workspace/abc/abc-observability` (monorepo npm workspaces, lib ở `packages/node`). App áp dụng:
  `D:/Workspace/abc/awp-product-hub/awp-product-hub/be` (repo riêng).
- In scope: theo plan, gồm core notifier, Express middleware, NestJS filter (subpath `/nestjs`), docs, xoá `alerts/`,
  release minor, rollout cho AWP.
- Out of scope: Sentry, báo 4xx, lỗi job, log hay Loki, span processor (đã cân nhắc và không chọn).
- Constraints (người dùng đã chốt):
  - Middleware + Nest filter, đặt trong lib.
  - Kèm message đã lọc.
  - Chống spam 60 giây.
  - Bỏ hẳn Grafana alert.
  - Stage chỉ dùng để test, sau này chỉ còn production.
- Safety boundaries:
  - Không commit URL webhook hay secret.
  - Xoá cấu hình trên Grafana agf (contact point, policy, template, folder) phải hỏi người dùng trước.
  - Commit hoặc push chỉ khi người dùng yêu cầu. Đang ở `main`, nên tạo branch trước.
  - Theo quy tắc của người dùng: conventional commit, không nhắc AI trong commit.

## Current state

- Branch: `main`
- HEAD: `2e1ed4b414002eccfb95bfd1fb003d873cca72cc` (chore(release): version packages)
- Working tree: chỉ có file untracked
- Changed files: không có
- Untracked files:
  - `plans/261116-1229-teams-500-error-notifications/` (plan.md, phase-01..04)
  - `plans/journals/2026-11-16-plan-bo-li-500-vo-teams-thay-cho-grafana-alert.md`
  - `plans/reports/research-261116-1031-teams-group-chat-error-alerts.md` (nghiên cứu luồng Grafana, nay đã lỗi thời)
  - `plans/handoffs/` (file này)
- Intentional local modifications: yes (tài liệu plan, chưa commit)

Trạng thái ngoài repo (quan sát qua API Grafana agf, ngày 2026-11-16):
- Grafana 12.2.0. Datasource duy nhất: `tempo` (uid `ag2roz0cmsxs0a`). Tempo v2.10.10.
- `appUrl` = `http://localhost:8002`, nên link Grafana tự tạo bị hỏng. Lib sẽ tự ghép link từ `ABC_ALERT_GRAFANA_URL`
  nên không bị ảnh hưởng.
- Đã có notification template `abc-observability-teams`. Người dùng đã tạo trên UI contact point
  `abc-observability-teams` (dùng URL webhook) và child policy `notify = abc-observability-teams`. Folder
  `Observability` đã tạo. Chưa có alert rule nào.

## Decisions and rationale

| Quyết định | Lý do | Phương án bị loại | Tham chiếu |
|---|---|---|---|
| Gửi thẳng webhook Teams từ lib | Dự án nhỏ, không muốn host thêm gì. Webhook đã chạy | Grafana alert (cần `tempoAlerting`, chỉ báo theo đợt) | plan.md |
| Không dùng Sentry | Không có server Sentry. `@sentry/node` v8+ tự dựng OTel, đụng NodeSDK của lib | Sentry SDK kèm transport tự viết, hoặc sentry.io free | plan.md Overview |
| Middleware + Nest filter | Người dùng chọn rõ | Span processor (AWP không phải sửa code, nhưng phụ thuộc tracing bật) | Validation Log |
| `notifyServerError({ error, request, statusCode })` | Filter riêng của app gọi được bằng một dòng | Chữ ký `{ method, route }` | phase-01 |
| Filter Teams đăng ký trước filter của AWP | AWP có `HttpExceptionFilter` `@Catch(HttpException)` ở `be/src/app-setup.ts:21`. Nest kiểm tra global filter theo thứ tự ngược (chưa xác minh) | Chỉ một filter Teams (sẽ phá body riêng của AWP) | phase-02, phase-04 |

## Work performed

- Kiểm tra Tempo qua proxy của Grafana: lỗi 500 gần nhất là 18 trace lúc 16:39 ngày 13/11 (giờ VN),
  `PostgreSQL error code 53300` (too many clients) ở `/api/v1/dashboard` và `/api/v1/projects`.
- `POST /api/v1/eval` trên agf: TraceQL metrics dạng instant
  `count_over_time() by (resource.service.name, resource.deployment.environment)` chạy được. Dạng range lỗi vì giới hạn
  24h. Tên nhãn trả về là `resource.service.name`, `resource.deployment.environment`, giá trị kèm dấu ngoặc kép. Env của
  stage là `staging`.
- Lưu dashboard `li6jnpk` nhiều lần qua `/api/dashboards/db`. Panel Exceptions dùng transformation groupBy theo
  `traceIdHidden`, Spans Limit (spss) = 100.
- Viết plan, report nghiên cứu, journal.

## Verification

- Đã chạy: chỉ đối chiếu plan với code (12 khẳng định: 11 đúng, 1 sai đã sửa, 1 chưa xác minh). Kiểm tra panel
  Exceptions hiển thị đúng bằng screenshot.
- Chưa chạy: build, test, lint (chưa có code mới).
- Chưa xác minh: thứ tự kiểm tra global filter của Nest. Phase 2 có test mô phỏng AWP để chặn.

## Open risks and blockers

- Giả định về thứ tự filter của Nest. Nếu sai, phải đổi hướng dẫn tích hợp AWP.
- Teams Workflows throttle khi có đợt lỗi lớn. Chống spam 60 giây giảm rủi ro này.
- Xoá cấu hình Grafana cũ cần người dùng xác nhận.
- Release npm cần người có quyền, qua trusted publishing (`docs/releasing.md`).
- Report nghiên cứu `plans/reports/research-261116-1031-...` mô tả luồng Grafana đã bị bỏ. Người dùng chưa quyết giữ hay
  xoá.

## Exact next actions

1. **First safe step**: đọc `plans/261116-1229-teams-500-error-notifications/plan.md` và 4 phase. Đối chiếu Current state
   (`git status`, HEAD `2e1ed4b`) trước khi sửa gì.
2. Tạo branch mới, ví dụ `feat/teams-500-notifications`, rồi chạy `/ak-cook <abs path>/plan.md`, bắt đầu từ phase 1
   (`packages/node/src/alerts/*`, `config.ts`, test).
3. Phase 2: viết Express middleware và `TeamsExceptionFilter`, kèm test thứ tự filter theo kiểu AWP.
4. Phase 3: docs, xoá `alerts/`, sửa `verify:repo`, changeset. Sau đó `npm run verify && npm run test`.
5. Phase 4: hỏi người dùng trước khi xoá cấu hình agf, rồi tích hợp AWP (`app-setup.ts`, `http-exception.filter.ts`, biến
   `ABC_ALERT_*`).

## Source pointers

- Plan: `plans/261116-1229-teams-500-error-notifications/plan.md`, `phase-01-core-notifier.md`,
  `phase-02-capture-points.md`, `phase-03-docs-cleanup-release.md`, `phase-04-rollout.md`
- Plan cũ (phase 4 bị thay): `plans/261109-0718-abc-observability-tracing/`
- Lib: `packages/node/src/{sdk,config,index,tracing,instrumentations}.ts`, `packages/node/package.json`,
  `packages/node/vitest.config.ts`
- Alert cũ cần gỡ: `alerts/`, `docs/alerts.md`, `mkdocs.yml`, `package.json` (`verify:repo`), `README.md`,
  `catalog-info.yaml`, `docs/conventions.md`, `docs/getting-started.md`
- AWP: `D:/Workspace/abc/awp-product-hub/awp-product-hub/be/src/app-setup.ts`,
  `be/src/common/filters/http-exception.filter.ts`
- Journal: `plans/journals/2026-11-16-plan-bo-li-500-vo-teams-thay-cho-grafana-alert.md`
- Grafana: `https://agf.abcdigital.io`, Tempo uid `ag2roz0cmsxs0a`, dashboard uid `li6jnpk`
