---
phase: 4
title: "Gỡ Grafana alert trên agf và áp dụng cho awp-product-hub"
status: in-progress
priority: P2
effort: "0.5d"
dependencies: [3]
---

# Phase 4: Gỡ Grafana alert trên agf và áp dụng cho awp-product-hub

<!-- Updated: Validation Session 1 - tích hợp AWP qua app-setup.ts và HttpExceptionFilter thay vì main.ts -->

## Goal

awp-product-hub báo lỗi 500 vào group chat Teams trên stage và production. Grafana agf không còn cấu hình của luồng
cũ.

## Hiện trạng trên agf (kiểm tra ngày 2026-11-16)

- Có notification template `abc-observability-teams`.
- Contact point `abc-observability-teams` và child policy `notify = abc-observability-teams` đã được người dùng tạo
  trên UI. Cần kiểm tra lại trước khi xoá.
- Folder `Observability` có thể đã tạo, chưa có alert rule.
- Tin nhắn nhờ DevOps bật `tempoAlerting` không còn cần. `GF_SERVER_ROOT_URL` không còn bắt buộc, vì lib tự ghép link
  trace từ `ABC_ALERT_GRAFANA_URL`.

## Tasks & Steps

1. **Grafana agf** (xin xác nhận người dùng trước khi xoá):
   - Xoá child policy `notify = abc-observability-teams`.
   - Xoá contact point `abc-observability-teams`.
   - Xoá template `abc-observability-teams`.
   - Xoá folder `Observability` nếu trống.
   - Webhook URL vẫn giữ để dùng cho lib. Lấy lại từ Power Automate nếu cần.
2. **awp-product-hub** (repo riêng, nhánh mới):
   - Nâng `@devops-abcdigital/observability-node` lên bản mới.
   - `be/src/app-setup.ts` (`configureApp`): đổi dòng 21 thành
     `app.useGlobalFilters(new TeamsExceptionFilter(app.get(HttpAdapterHost).httpAdapter), new HttpExceptionFilter())`.
     Filter Teams phải đứng trước để `HttpException` vẫn đi vào filter của AWP.
   - `be/src/common/filters/http-exception.filter.ts`: sau khi tính `status`, thêm
     `if (status >= 500) notifyServerError({ error: exception, request: ctx.getRequest(), statusCode: status });`.
     Response không đổi.
   - e2e test dùng chung `configureApp` và không đặt webhook URL, nên không gửi gì ra ngoài.
   - Thêm biến môi trường cho stage và production: `ABC_ALERT_TEAMS_WEBHOOK_URL` (secret),
     `ABC_ALERT_GRAFANA_URL=https://agf.abcdigital.io`, `ABC_ALERT_TEMPO_DATASOURCE_UID=ag2roz0cmsxs0a`.
   - Test của repo vẫn xanh.
3. **Kiểm chứng trên stage:**
   - Gây một lỗi 500. Tin phải đến trong khoảng 10 giây, nút Xem trace mở đúng trace.
   - Gây 20 lỗi liên tiếp, chỉ ra 2 tin.
4. Bật cho production. Khi người dùng quyết định chỉ còn production, gỡ biến webhook khỏi stage.

## Verification

- Ảnh chụp tin FIRING trong group chat, kèm trace mở được từ nút.
- `GET /api/v1/provisioning/contact-points` trên agf không còn `abc-observability-teams`.

## Risk

- Xoá nhầm cấu hình Grafana khác. Biện pháp: chỉ xoá đúng tên `abc-observability-teams`, liệt kê trước khi xoá.
- Lộ URL webhook. Biện pháp: lưu như secret trong hệ thống deploy, không đưa vào `.env` commit.

## Rollback

- App: gỡ biến `ABC_ALERT_TEAMS_WEBHOOK_URL`, tính năng tắt ngay, không cần deploy lại code.
- Grafana: cấu hình đã xoá dựng lại được theo `docs/alerts.md` ở commit trước phase 3.

## Tiến độ (2026-11-16)

- **agf: xong** (người dùng xác nhận, xoá qua phiên Grafana trên Chrome). Đã xoá child policy
  `notify = abc-observability-teams`, contact point `abc-observability-teams`, template `abc-observability-teams` và folder
  `Observability.` (tên thật có dấu chấm cuối, trống, 0 rule/dashboard). Kiểm tra lại: contact point chỉ còn
  `email receiver`, policy không còn child route, không còn template và folder. Policy lưu với `X-Disable-Provenance` nên
  vẫn sửa được trên UI.
- **AWP: code xong** trên nhánh `ABCDG-0000-teams-500-notifications` (tách từ `origin/main`, chưa commit): `app-setup.ts`,
  `http-exception.filter.ts`, `vitest.e2e.config.ts` (ép webhook rỗng khi chạy e2e), README, `infra_info.json`. Đã kiểm
  tra bằng tarball lib cục bộ cài `--no-save`: `verify` và 232 unit test xanh. e2e chưa chạy vì máy không có Postgres
  (Docker tắt).
- Còn lại: release lib `0.2.0` → nâng `@devops-abcdigital/observability-node` trong AWP lên `^0.2.0` (`^0.1.1` không nhận
  0.2.0) → đặt biến `ABC_ALERT_*` trên Backstage cho stage → kiểm chứng trên stage (bước 3) → production.
