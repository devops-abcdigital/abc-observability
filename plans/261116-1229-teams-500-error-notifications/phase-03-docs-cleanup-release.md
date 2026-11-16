---
phase: 3
title: "Docs, gỡ Grafana alert khỏi repo, release"
status: in-progress
priority: P2
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Docs, gỡ Grafana alert khỏi repo, release

## Goal

Repo mô tả đúng luồng mới, không còn dấu vết của luồng Grafana alert. Lib được publish bản minor mới.

## Files to Create / Modify

- Delete: `alerts/` (`README.md`, `server-errors.yaml`, `teams-message.tmpl`).
- Delete: `docs/alerts.md`. Create: `docs/error-notifications.md`. Nội dung:
  - Tạo Workflow "Send webhook alerts to a chat".
  - Các biến `ABC_ALERT_*`, cách gắn cho Express và NestJS.
  - Chống spam, lọc message, link trace và độ trễ 5–10 giây.
  - Chưa báo 4xx và lỗi job.
- Modify: `mkdocs.yml`: thay mục "Teams error alerts" bằng `error-notifications.md`.
- Modify: `package.json` (gốc): bỏ `"alerts/**/*.yaml"` khỏi `verify:repo`.
- Modify: `README.md` (gốc): các dòng nhắc tới `alerts` và sơ đồ "Grafana ──▶ Teams alert channel".
- Modify: `catalog-info.yaml`: description bỏ "Teams error alert rules", thay bằng "Teams 500 error notifications".
- Modify: `docs/conventions.md`, `docs/getting-started.md`: bỏ hoặc sửa các câu nói alert đếm span `job.*` và
  `markSpanError`. Quy ước `job.*` vẫn giữ để lọc trace.
- Modify: `packages/node/README.md`: mục mới "Error notifications". Đổi câu "Only traces are exported" cho đúng contract
  mới.
- Modify: `plans/261109-0718-abc-observability-tracing/plan.md` và `phase-04-teams-error-alerts.md`: ghi phase 4 bị thay
  bằng plan này.
- Create: `.changeset/<tên>.md`: minor cho `@devops-abcdigital/observability-node`.

## Tasks & Steps

1. Xoá file, cập nhật docs và nav như trên.
2. `grep -rn "alerts/\|alerts.md\|server-errors\|teams-message" --exclude-dir=node_modules --exclude-dir=plans .` không
   còn kết quả.
3. Thêm changeset, rồi release theo `docs/releasing.md` (người có quyền chạy).

## Verification

- `npm run verify`, `npm run test`
- `mkdocs` build (TechDocs) không báo link hỏng, nếu có công cụ ở máy. Không có thì kiểm tra link bằng grep.
- Phiên bản mới có trên npmjs.com.

## Risk

- Xoá nhầm nội dung vẫn cần, như quy ước `job.*` hay `markSpanError`. Biện pháp: chỉ sửa câu nói về alert, giữ quy ước.

## Rollback

Revert commit. Bản đã publish thì không gỡ, sửa bằng bản patch.
