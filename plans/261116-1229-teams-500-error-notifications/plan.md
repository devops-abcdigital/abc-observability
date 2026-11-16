---
title: "Báo lỗi 500 vào Teams từ middleware của lib"
description: "Lib observability-node bắt lỗi 500 ở tầng middleware (Express) và exception filter (NestJS), gửi Adaptive Card vào group chat Teams qua webhook Workflows, kèm message đã lọc và link mở trace trên Grafana; gỡ bỏ luồng Grafana alert."
status: in-progress
priority: P1
effort: 3d
branch: ABCDG-0000-handle-notification-error-to-teams
tags: [backend, observability, notifications]
blockedBy: []
blocks: []
created: 2026-11-16
---

# Báo lỗi 500 vào Teams từ middleware của lib

## Overview

Khi một request trả 500, app gửi ngay một tin vào group chat Teams. Tin gồm service, môi trường, method, route, loại
lỗi, message đã lọc và nút **Xem trace** mở đúng trace trên Grafana. Việc bắt lỗi nằm trong lib
`@devops-abcdigital/observability-node`: một error middleware cho Express và một exception filter cho NestJS. Tin được
gửi thẳng vào webhook Teams Workflows có sẵn, không dùng Sentry hay dịch vụ ngoài nào. Luồng Grafana alert (rule,
contact point, policy, template, thư mục `alerts/`) bị gỡ bỏ.

Plan này thay cho phase 4 của [plan tracing](../261109-0718-abc-observability-tracing/plan.md) (cảnh báo qua Grafana).

## Outcome, constraints, non-goals

- **Outcome:** mỗi lỗi 500 (sau khi chống spam) xuất hiện trong group chat Teams trong khoảng 10 giây, kèm đủ thông tin
  ở trên.
- **Constraints:**
  - Gửi ngầm: không làm chậm, không đổi response, không làm crash app. Gửi lỗi thì bỏ qua và ghi tối đa một cảnh báo ra
    stderr.
  - Không có `ABC_ALERT_TEAMS_WEBHOOK_URL` thì tính năng tắt hoàn toàn. URL không bao giờ nằm trong repo.
  - Chống spam: cùng service, method, route và loại lỗi trong 60 giây chỉ gửi tin đầu, rồi một tin tổng kết số lần lặp.
  - Message lỗi được lọc (credential trong URL, token, chuỗi trông như key) và cắt ngắn trước khi gửi. Stack trace
    không gửi, xem trong trace.
  - Chạy được khi tracing tắt (khi đó không có link trace). Không đổi hành vi tracing hiện có.
  - Lib không thêm dependency bắt buộc. NestJS là peer dependency tuỳ chọn, chỉ dùng ở subpath `/nestjs`.
- **Non-goals:** báo lỗi 4xx, lỗi job chạy nền, log; Sentry; thu log vào Loki; giao diện quản lý cảnh báo.

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | [Core notifier](./phase-01-core-notifier.md) | Code xong; chờ gửi thử card thật | 1d |
| 2 | [Express middleware và NestJS filter](./phase-02-capture-points.md) | Done | 1d |
| 3 | [Docs, gỡ Grafana alert khỏi repo, release](./phase-03-docs-cleanup-release.md) | Repo xong; chờ release | 0.5d |
| 4 | [Gỡ Grafana alert trên agf và áp dụng cho awp-product-hub](./phase-04-rollout.md) | agf đã gỡ; code AWP xong trên nhánh, chờ release + biến môi trường | 0.5d |

Phụ thuộc: 1 → 2 → 3 → 4.

## Architecture

```
request lỗi 500
  ├─ Express: error middleware  ┐
  ├─ NestJS: exception filter   ┤
  └─ filter riêng của app       ┴─▶ notifyServerError({ error, request, statusCode })
                                         │  traceId lấy từ span đang chạy (nếu có)
                                         ▼
                                   dedupe 60s ──▶ sanitize ──▶ Adaptive Card ──▶ fetch POST (timeout 3s, ngầm)
                                                                                    ▼
                                                                 Teams Workflows webhook ──▶ group chat
```

## Success Criteria

- [ ] Gây lỗi 500 trên stage của awp-product-hub: tin xuất hiện trong group chat trong khoảng 10 giây, nút **Xem trace**
      mở đúng trace.
- [ ] 20 lỗi giống nhau trong 60 giây cho ra 1 tin đầu và 1 tin tổng kết "lặp lại 19 lần".
- [ ] Webhook trả lỗi hoặc treo: response của app không đổi, thời gian phản hồi không tăng.
- [ ] Không đặt `ABC_ALERT_TEAMS_WEBHOOK_URL`: không có request nào ra ngoài.
- [x] Unit test và integration test của lib xanh; `npm run verify` xanh.
- [ ] Repo không còn `alerts/`, docs mô tả luồng mới; Grafana agf không còn contact point, policy, template của luồng cũ.

## Code quality rules

- [x] Một nguồn sự thật: biến môi trường đọc ở `config.ts`; quy tắc lọc message ở một file; Express và NestJS cùng gọi
      `notifyServerError()`.
- [x] Không `any`, hằng số có tên (`DEDUPE_WINDOW_MS`, `SEND_TIMEOUT_MS`, `MAX_MESSAGE_LENGTH`).
- [x] Timer dùng `unref()` để không giữ process sống.
- [x] Không commit URL webhook, kể cả trong test (test dùng server HTTP cục bộ).

## Dependencies

- Webhook Workflows "Send webhook alerts to a chat" đã tạo cho group chat (đã kiểm chứng gửi được Adaptive Card ngày
  2026-11-16).
- Quyền publish npm (trusted publishing, theo `docs/releasing.md`).
- Repo awp-product-hub cho phase 4.

## Validation Log

### Session 1 (2026-11-16)

**Verification Results**
- Số khẳng định đã kiểm tra: 12
- Đúng: 11 | Sai: 1 | Chưa xác minh: 1
- Mức: Standard (Fact Checker + Contract Verifier)
- Đúng:
  - `packages/node/src/config.ts` và `src/index.ts` tồn tại.
  - `express` và `@types/express` có trong devDependencies.
  - `mkdocs.yml` có mục "Teams error alerts".
  - `verify:repo` trong `package.json` gốc có glob `alerts/**/*.yaml`.
  - `docs/releasing.md` tồn tại.
  - Node 24 có `fetch` và `AbortSignal.timeout`.
  - AWP dùng `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` ^11.1.16.
  - Template `abc-observability-teams` có trên agf.
  - Folder `Observability` đã được tạo.
  - Webhook Workflows nhận được Adaptive Card.
- Sai: phase 4 ghi "đăng ký filter ở `main.ts`". Thực tế AWP đăng ký global filter trong
  `be/src/app-setup.ts:21` (`configureApp`, dùng chung cho bootstrap và e2e). Ngoài ra đã có
  `be/src/common/filters/http-exception.filter.ts`, filter này chỉ bắt `HttpException` và trả body riêng
  `{ statusCode, message, code?, details? }`.
- Chưa xác minh: Nest kiểm tra global filter theo thứ tự ngược lúc đăng ký. Kiểm chứng bằng test ở phase 2.
  (Đã xác minh khi triển khai, xem Implementation Notes.)

**Câu hỏi và quyết định**

| Câu hỏi | Quyết định |
|---|---|
| Bắt lỗi bằng middleware + Nest filter hay span processor? | Middleware + Nest filter |
| Đặt code ở lib hay app AWP? | Trong lib |
| Tin có kèm nội dung lỗi? | Kèm, đã lọc |
| Cửa sổ chống spam? | 60 giây |

**Thay đổi đã lan sang các phase**
- Phase 1: `notifyServerError` nhận `{ error, request, statusCode }` và tự lấy method và route từ `request`, để filter
  riêng của app gọi được bằng một dòng.
- Phase 2: thêm test thứ tự filter khi app có filter `@Catch(HttpException)` riêng.
- Phase 4: tích hợp AWP qua `app-setup.ts` (TeamsExceptionFilter đăng ký trước HttpExceptionFilter) và thêm một dòng
  `notifyServerError` trong `HttpExceptionFilter` cho status ≥ 500.

### Whole-Plan Consistency Sweep
- Đã quét toàn bộ plan tìm các tên cũ: `main.ts`, chữ ký `{ method, route, statusCode }`, `notifyServerError(input)`.
  Phase 1 đã sửa về chữ ký mới. `main.ts` chỉ còn trong Validation Log và marker, đúng với mục đích ghi lại.
- Sơ đồ Architecture, phase 1, phase 2 và phase 4 dùng cùng chữ ký `notifyServerError({ error, request, statusCode })`.
- Không còn mâu thuẫn chưa giải quyết. Giả định về thứ tự filter là rủi ro mở duy nhất, đã có test chặn ở phase 2.

## Implementation Notes (2026-11-16)

- Thứ tự global filter của Nest **đã xác minh** bằng test `alerts-nestjs.spec.ts` (Nest 11.2): Nest thử filter đăng ký
  sau trước. Đăng ký `TeamsExceptionFilter` trước filter `@Catch(HttpException)` của app là đúng.
- Request gửi webhook chạy trong context suppress tracing. Nếu không, instrumentation undici ghi một client span chứa
  URL webhook (có chữ ký) vào Tempo. Integration test chặn việc này và đã kiểm chứng là test fail khi bỏ suppress.
- URL webhook phải là https, riêng `http://localhost|127.0.0.1|[::1]` được chấp nhận để test dùng server cục bộ.
- Lỗi kéo dài: mỗi cửa sổ 60 giây chỉ ra một tin tổng kết (không gửi lại tin "đầu" mỗi phút).
- Express xoá `req.baseUrl` khi lỗi ra khỏi router, nên route được ghép lại từ path theo số segment của pattern. Pattern
  có số segment thay đổi (`*`, `{}`, `?`, `(`) thì chỉ dùng pattern.
- Status lấy đúng như framework trả lời (sửa sau code review). Express: `err.status`/`err.statusCode` trong khoảng
  400–599, rồi `res.statusCode`, còn lại 500. Nest: `getStatus()`, hoặc `statusCode` khi có message, còn lại 500. Lỗi chỉ
  có `status` (như AxiosError 404) thì Nest trả 500 nên vẫn được báo.
- Sau code review: sanitizer chỉ quét 2.000 ký tự đầu và chỉ chạy khi thật sự gửi card (tránh chặn event loop với
  message dài), che thêm `name=value`/JSON/Basic; segment giống ID trong path được thay bằng `:id`; filter Nest ném lại
  exception ở context không phải HTTP; link markdown trong message không bấm được. Report:
  `plans/reports/code-reviewer-261116-1300-teams-500-notifier.md`.
