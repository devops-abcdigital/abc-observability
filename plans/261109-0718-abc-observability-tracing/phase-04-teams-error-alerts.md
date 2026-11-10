---
phase: 4
title: "Phase 4: Teams Error Alerts"
status: in-progress
priority: P2
effort: "0.5d"
dependencies: [3]
---

# Phase 4: Teams Error Alerts

<!-- 2026-11-09: rules use Tempo span metrics (TraceQL metrics cannot feed Grafana 12.1 alerts because of exemplar frames). Verified on grafana/otel-lgtm (Grafana 12.1.1, Tempo 2.8.2) with a local stand-in for the Teams webhook: FIRING for request and job errors, RESOLVED ~6 min later, committed YAML loads via file provisioning. Remaining on the shared Grafana: DevOps prerequisites (metrics-generator span metrics + deployment.environment dimension), Teams Workflow, contact point, policy, rules, real FIRING/RESOLVED test. Full guide: docs/alerts.md. -->

<!-- Updated: Validation Session 1 - Alloy migration removed from scope; one shared Teams channel; alerts cover failed requests and failed background jobs -->

## Overview

Gửi cảnh báo vào **một kênh Microsoft Teams chung** khi một service có lỗi vượt ngưỡng, gồm cả **request lỗi phía server** và **job chạy nền lỗi**. Cảnh báo do Grafana Alerting tạo dựa trên trace trong Tempo. Repo chỉ lưu rule mẫu, mẫu tin nhắn và hướng dẫn; URL webhook không nằm trong repo.

## Key Insights

- Cảnh báo do Grafana gửi, không gửi thẳng từ lib: có ngưỡng, gom nhóm, tin "đã hết lỗi", tạm tắt khi bảo trì, và app không phải giữ URL webhook.
- Teams đã bỏ "Incoming Webhook" (Office 365 Connectors). Dùng **Workflows** với mẫu "Post to a channel when a webhook request is received".
- Request lỗi: auto-instrumentation tự đặt span server status ERROR khi trả 5xx hoặc có exception chưa bắt.
- Job chạy nền **không có request HTTP**, nên không có span gốc. Lỗi job chỉ thấy được khi job được bọc bằng `withSpan('job.<khu-vuc>.<viec>', …)` (quy ước ở `docs/conventions.md`) và lỗi được ghi lên span bằng `markSpanError()` (phase 2). Phase 5 làm việc này cho awp-product-hub.
- Truy vấn cảnh báo dựa trên trace cần Tempo phía server bật TraceQL metrics. Dashboard của ai-benchmark-tool đã dùng TraceQL metrics, nên khả năng cao đã bật, nhưng phải kiểm tra lại.
- Quản lý Alloy không thuộc plan này. Cảnh báo chỉ cần trace đã vào Tempo.

## Requirements

- [ ] `alerts/server-errors.yaml`: rule đếm span lỗi thuộc một trong hai loại: span `kind = server` (request) hoặc span có tên bắt đầu bằng `job.` (job chạy nền); nhóm theo `resource.service.name` và `deployment.environment`; báo khi vượt ngưỡng trong 5 phút.
- [ ] Truy vấn dự kiến (phải kiểm chứng cú pháp với version Tempo thật): `{ status = error && (kind = server || name =~ "job\\..*") } | rate() by (resource.service.name, resource.deployment.environment)`. [UNVERIFIED]
- [ ] Tin nhắn Teams có tên service, môi trường, loại lỗi (request hay job), số lỗi, và link mở Grafana Explore với truy vấn trace lỗi tương ứng.
- [ ] Notification policy: một contact point Teams chung, gom theo service + môi trường, lặp lại tối đa 4 giờ một lần, có tin RESOLVED.
- [ ] `alerts/README.md`: tạo Workflow trong Teams (bấm **⋯** cạnh tên kênh → **Workflows** → mẫu webhook), tạo contact point và notification policy trong Grafana (**Alerting → Contact points**, **Alerting → Notification policies**), import rule (**Alerting → Alert rules**).

## Architecture

```
Tempo (trace của mọi dự án)
   ▼
Grafana agf.abcdigital.io: alert rule (đánh giá mỗi 1 phút)
   │ span lỗi (request hoặc job.*) vượt ngưỡng trong 5 phút
   ▼
Contact point Microsoft Teams (URL Workflows, cấu hình trong Grafana)
   ▼
Kênh Teams cảnh báo chung
```

## Related Code Files

- Create (repo abc-observability): `alerts/server-errors.yaml`, `alerts/teams-message.tmpl`, `alerts/README.md`.
- Modify: `docs/conventions.md` (quy ước tên span `job.*`, đã tạo ở phase 3), `mkdocs.yml` (thêm trang alerts nếu đưa vào TechDocs).

## Implementation Steps

1. Hỏi DevOps: Tempo đã bật TraceQL metrics chưa, và xin quyền tạo alert rule, contact point trên Grafana.
2. Tạo Workflow trong kênh Teams chung, gửi URL cho người quản trị Grafana qua kênh an toàn.
3. Tạo contact point Teams và notification policy.
4. Viết rule, thử truy vấn trong **Explore → Tempo** với trace từ `examples/multi-service` (phase 3) và một job mẫu; chỉnh truy vấn cho đúng cú pháp version Tempo thật.
5. Export rule ra `alerts/server-errors.yaml`, viết `teams-message.tmpl` và `alerts/README.md`.
6. Kiểm thử: gọi route lỗi của example liên tục, và chạy một job mẫu cố ý lỗi, cho tới khi vượt ngưỡng; sau đó dừng để nhận RESOLVED.

## Todo

- [ ] Xác nhận TraceQL metrics + quyền trên Grafana
- [ ] Workflow Teams + contact point + notification policy
- [ ] Rule cảnh báo, kiểm chứng truy vấn trên Tempo thật
- [x] `alerts/server-errors.yaml`, `teams-message.tmpl`, `alerts/README.md`
- [ ] Kiểm thử FIRING/RESOLVED cho request lỗi
- [ ] Kiểm thử FIRING/RESOLVED cho job lỗi

## Success Criteria

- [ ] Request lỗi vượt ngưỡng tạo tin FIRING trong kênh Teams trong vòng 2 phút, hết lỗi thì có tin RESOLVED.
- [ ] Job `job.*` lỗi vượt ngưỡng cũng tạo tin FIRING/RESOLVED, tin ghi rõ là lỗi job.
- [ ] Không có URL webhook hay token trong `git ls-files`.

## Risk Assessment

- Tempo chưa bật TraceQL metrics: nhờ DevOps bật, hoặc bật metrics-generator để có metric span; ghi lựa chọn vào `alerts/README.md`.
- Trace prod chưa vào Tempo (Alloy và gateway do DevOps quản lý, ngoài plan): kiểm thử bằng trace gửi từ example; nếu chưa có đường gửi, đánh dấu phase là chờ hạ tầng.
- Một lỗi sinh nhiều span lỗi (span con và span cha): truy vấn chỉ đếm span server và span `job.*` để mỗi lần lỗi tính khoảng một lần.
- Cảnh báo quá nhiều: bắt đầu với ngưỡng cao, chỉnh sau một tuần chạy thật.

## Security Considerations

- URL webhook Teams chỉ nằm trong cấu hình contact point của Grafana.
- Tin nhắn chỉ chứa tên service, môi trường, số lỗi và link; không chèn nội dung exception để tránh lộ dữ liệu ra kênh chat.

## Next Steps

- Khi dự án mới áp dụng lib, chỉ cần đặt đúng `service.name`, `deployment.environment` và đặt tên job theo quy ước là được cảnh báo tự động.
