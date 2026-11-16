---
title: Plan báo lỗi 500 vào Teams thay cho Grafana alert
date: 2026-11-16
summary: "Lên và validate plan gửi lỗi 500 từ middleware/Nest filter của lib vào group chat Teams, bỏ Grafana alert và Sentry"
---

# Plan báo lỗi 500 vào Teams thay cho Grafana alert

## Chuyện gì đã xảy ra
- Dashboard "AWP Product Hub - Traces" không thấy lỗi 500 vì panel chỉ lấy 20 trace mới nhất và không lọc lỗi. Lỗi 500 gần nhất là đợt `53300 too many clients` lúc 16:39 ngày 13/11. Đã thêm panel Exceptions (TraceQL đọc `event.exception.*`, gộp theo trace với status code).
- Grafana agf chỉ có datasource Tempo, không có Prometheus, nên bộ rule span metrics trong `alerts/` không chạy được ở đây. Đã chạy thử qua `/api/v1/eval`: TraceQL metrics dạng instant alert được trên Grafana 12.2, nhưng form UI cần feature toggle `tempoAlerting`. `appUrl` của Grafana đang là `http://localhost:8002`, nên link trong tin đều hỏng.
- Webhook Workflows "Send webhook alerts to a chat" đã gửi được Adaptive Card vào group chat.

## Quyết định
- Bỏ Grafana alert. Không dùng Sentry: không có server Sentry, và SDK v8+ tự dựng OpenTelemetry, đụng NodeSDK của lib.
- Lib export Express error middleware và `TeamsExceptionFilter` (subpath `/nestjs`). Message được lọc, chống spam 60 giây, có link trace tự ghép từ `ABC_ALERT_GRAFANA_URL`.
- AWP đã có `HttpExceptionFilter` `@Catch(HttpException)` ở `be/src/app-setup.ts:21`, nên filter Teams phải đăng ký trước, và filter của AWP phải gọi `notifyServerError` khi status ≥ 500. Giả định về thứ tự filter sẽ được kiểm chứng bằng test ở phase 2.

## Bước tiếp theo
- `/ak-cook plans/261116-1229-teams-500-error-notifications/plan.md`
- Xoá cấu hình alert trên agf (cần xác nhận), gắn vào AWP trên stage.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
