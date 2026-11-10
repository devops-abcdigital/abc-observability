---
title: Plan abc-observability tracing library
date: 2026-11-09
summary: "Lập và validate plan thư viện tracing dùng chung, cảnh báo Teams, áp dụng đầu tiên cho awp-product-hub"
---

# Plan abc-observability tracing library

## What happened
- Lập plan `plans/261109-0718-abc-observability-tracing` (5 phase): chuyển repo sang library monorepo, viết `@devops-abcdigital/observability-node` (chỉ traces, Node 24), app mẫu + release GitHub Packages, cảnh báo Teams, áp dụng cho awp-product-hub.
- Repo `abc-observability` đã tồn tại, sinh từ template Backstage dạng service (server.js, Dockerfile): phase 1 đổi thành chuyển đổi repo, không tạo mới.
- ai-benchmark-tool chỉ có `sdk-node` + exporter, không auto-instrumentation; `monitoring/config.alloy` không được commit.
- Job connector của awp-product-hub (`tick()`, `onProjectConnectorsSaved()`, `ConnectorSyncRun.read()`) bắt lỗi rồi chỉ log, nên lỗi job không lên trace nếu không có `markSpanError()`.

## Decision
- Alloy ngoài phạm vi (DevOps giữ). Cảnh báo một kênh Teams chung, gồm lỗi request và lỗi job (span `job.*`).
- Repo đổi sang loại `library`, xóa app mẫu. Kiểm chứng phase 5 chỉ với `otel-lgtm` local.

## Next steps
- Xác nhận với DevOps: Tempo bật TraceQL metrics, quyền alert rule; với người quản lý Backstage: loại `library`.
- Bắt đầu `/ak-cook` từ phase 1.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
