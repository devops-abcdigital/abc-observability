---
title: Triển khai báo lỗi 500 vào Teams trong observability-node
date: 2026-11-16
summary: "Phase 1-3 xong trong lib, agf đã gỡ cấu hình cũ, code AWP sẵn trên nhánh; review bắt được sanitizer chậm và sai quy tắc status của Nest"
---

# Triển khai báo lỗi 500 vào Teams trong observability-node

## What happened
- Lib `packages/node` có `notifyServerError()`, `teamsErrorNotifier()` (Express) và `TeamsExceptionFilter` (subpath `/nestjs`). Gửi Adaptive Card thẳng vào webhook Teams Workflows, chống spam 60 giây, lọc message, link trace Grafana.
- Thứ tự global filter của Nest đã xác minh bằng test: Nest thử filter đăng ký sau trước. Đăng ký Teams filter trước filter `@Catch(HttpException)` của app.
- Phát hiện khi viết integration test: không suppress tracing thì instrumentation undici ghi client span chứa URL webhook (có chữ ký) vào Tempo. Đã suppress; test xác nhận fail khi bỏ suppress.
- Code review tìm ra hai lỗi thật:
  - Regex sanitizer chạy bậc hai: 160 KB mất khoảng 5,6 giây, chạy trên request path và trước dedupe. Sửa bằng cách chỉ quét 2.000 ký tự đầu, giới hạn độ dài pattern và chỉ sanitize khi thật sự gửi card.
  - Nest không dùng `status`, chỉ dùng `statusCode` khi có message. Vì vậy AxiosError 404 bị Nest trả 500 mà không có card. Đã đổi quy tắc status cho Express và Nest khớp đúng với cách từng framework trả lời.
- Đã xoá trên agf (người dùng xác nhận): child policy, contact point, template `abc-observability-teams`, và folder `Observability.` (tên thật có dấu chấm cuối, folder trống).
- AWP: nhánh `ABCDG-0000-teams-500-notifications` từ `origin/main`. Đã sửa `app-setup.ts` và `http-exception.filter.ts`, ép webhook rỗng trong config e2e. Kiểm tra bằng tarball cục bộ cài `--no-save`.

## Decision
- Chấp nhận `http://localhost` cho webhook để test chạy với server cục bộ. Mọi URL khác phải là https.
- Lỗi kéo dài chỉ ra một tin tổng kết mỗi cửa sổ 60 giây.
- Filter Nest ném lại exception ở context không phải HTTP.

## Next steps
- Gửi thử card thật (chờ người dùng cung cấp URL qua file trong scratchpad).
- Commit, release `0.2.0`, nâng AWP lên `^0.2.0`, đặt biến `ABC_ALERT_*` trên Backstage, kiểm chứng trên stage. e2e của AWP chưa chạy vì không có Postgres.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
