---
phase: 1
title: "Core notifier"
status: in-progress
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Core notifier

<!-- Updated: Validation Session 1 - notifyServerError nhận { error, request, statusCode } và tự lấy method và route -->

## Goal

Lib có hàm `notifyServerError()` dựng và gửi tin Teams cho một lỗi 500: đọc cấu hình, chống spam, lọc message, ghép
link trace, gửi ngầm có timeout.

## Key insights

- Payload Workflows: `{ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive",
  content: <AdaptiveCard 1.4> }] }`. Grafana gửi đúng dạng này và đã hiện được trong group chat "Test notification v1".
- `trace.getActiveSpan()?.spanContext()` cho `traceId` và cờ sampled. Không sampled thì không gắn link.
- Service và env đọc từ `OTEL_SERVICE_NAME` và `deployment.environment` trong `OTEL_RESOURCE_ATTRIBUTES`. Đây là ngoại
  lệ có chủ đích với quy tắc "không tự đọc `OTEL_*`": chỉ đọc để hiển thị, không cấu hình SDK.
- Link trace: `${grafanaUrl}/explore?schemaVersion=1&orgId=1&panes=<urlencoded JSON>` với query là `traceId`, datasource
  là uid Tempo. Đây là đúng dạng link mà panel Exceptions trên agf đang dùng.
- Span mất khoảng 5–10 giây mới vào Tempo, nên bấm link quá sớm có thể chưa thấy trace.

## Files to Create / Modify

- Modify: `packages/node/src/config.ts`: thêm các biến:
  - `ABC_ALERT_TEAMS_WEBHOOK_URL` (bật tính năng)
  - `ABC_ALERT_GRAFANA_URL`, `ABC_ALERT_TEMPO_DATASOURCE_UID` (link trace, thiếu thì không có link)
  - `ABC_ALERT_INCLUDE_MESSAGE` (mặc định `true`, `false` thì bỏ message)
- Create: `packages/node/src/alerts/notify.ts`: `notifyServerError({ error, request, statusCode })`, dedupe, gửi.
- Create: `packages/node/src/alerts/teams-card.ts`: dựng Adaptive Card.
- Create: `packages/node/src/alerts/sanitize.ts`: lọc và cắt message.
- Modify: `packages/node/src/index.ts`: export `notifyServerError` và kiểu input.
- Create: `packages/node/test/unit/alerts-notify.spec.ts`, `alerts-sanitize.spec.ts`, `alerts-teams-card.spec.ts`.

## Tasks & Steps

1. `config.ts`: hàm đọc cấu hình alert, trả `undefined` khi không có webhook URL. URL phải là `https:`; sai thì tắt và
   cảnh báo một lần.
2. `sanitize.ts`:
   - Bỏ phần credential trong URL (`https://user:pass@host` → `https://***@host`).
   - Giá trị query `key|token|secret|password|signature|sig|api_key|access_token` thành `***`.
   - `Bearer <token>` thành `Bearer ***`. Chuỗi dạng JWT thành `***`. Chuỗi hex/base64 dài từ 32 ký tự trở lên thành
     `***`.
   - Cắt ngắn còn `MAX_MESSAGE_LENGTH = 300` ký tự.
3. `teams-card.ts`:
   - Tiêu đề: `🔴 500 · METHOD route · service (env)`.
   - Các dòng: loại lỗi, message (nếu bật), thời điểm, trace_id.
   - Nút `Action.OpenUrl` "Xem trace" khi có link.
   - Tin tổng kết: `Lặp lại N lần trong 60 giây`.
4. `notify.ts`:
   - Chữ ký: `notifyServerError({ error, request, statusCode })`.
     - `request` là kiểu tối thiểu `{ method?, originalUrl?, url?, baseUrl?, route?: { path? } }`, khớp với
       `express.Request` mà không phụ thuộc vào Express.
     - Route ưu tiên `baseUrl + route.path`, không có thì lấy path bỏ query string.
     - `errorType` lấy từ `error.name`, hoặc `error.constructor.name`.
   - Khoá dedupe là `service|method|route|errorType`.
   - Lần đầu gửi ngay. Các lần sau trong `DEDUPE_WINDOW_MS = 60_000` chỉ đếm. Hết cửa sổ, nếu đếm > 0 thì gửi tin tổng
     kết.
   - Giới hạn số khoá đang theo dõi (ví dụ 500) để không phình bộ nhớ.
   - Gửi bằng `fetch` với `AbortSignal.timeout(SEND_TIMEOUT_MS = 3000)`, không `await` ở phía người gọi. Mọi lỗi được
     nuốt, stderr chỉ cảnh báo một lần cho mỗi đợt lỗi.
   - Timer dùng `unref()`.
5. Test, dùng server HTTP cục bộ làm webhook giả:
   - Không có URL thì không gửi gì.
   - Payload đúng dạng, có link khi có traceId sampled, không link khi không sampled hoặc thiếu cấu hình.
   - Dedupe: 20 lần thì ra 1 tin đầu và 1 tin tổng kết (dùng fake timers).
   - Webhook trả 500 hoặc treo quá 3 giây thì `notifyServerError` vẫn trả về ngay, không throw.
   - Sanitize từng mẫu ở bước 2, `ABC_ALERT_INCLUDE_MESSAGE=false` thì không có message.

## Verification

- `npm run test -w @devops-abcdigital/observability-node`
- `npm run verify -w @devops-abcdigital/observability-node`
- Gửi thử một card thật vào group chat bằng script tạm chạy ngoài repo, dùng URL thật từ biến môi trường. Chụp kết quả,
  không commit script hay URL.

## Risk

- Workflows có thể từ chối card nếu thiếu trường. Biện pháp: bám đúng dạng payload mà Grafana đã gửi thành công, rồi gửi
  thử thật ở bước Verification.
- Tin tổng kết bị mất nếu process dừng trước khi hết cửa sổ. Chấp nhận được, ghi rõ trong README.

## Rollback

Chưa publish thì revert commit.
