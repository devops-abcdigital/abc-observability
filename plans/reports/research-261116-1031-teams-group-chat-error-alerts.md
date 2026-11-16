# Gửi cảnh báo lỗi vào group chat Teams

Thời điểm nghiên cứu: 2026-11-16 10:31 (Asia/Saigon). Grafana `agf.abcdigital.io` v12.2.0, Tempo v2.10.10.

## Kết luận

Làm được mà không cần thêm hạ tầng. Có ba việc:

1. Trong group chat Teams, tạo một Workflow từ template **"Send webhook alerts to a chat"** để lấy webhook URL.
2. Trong Grafana, tạo contact point **Microsoft Teams** dùng URL đó, kèm notification template và notification policy.
3. Tạo alert rule truy vấn **thẳng Tempo bằng TraceQL metrics (instant)**, thay cho cách dùng span metrics qua
   Prometheus đang mô tả trong `docs/alerts.md`.

Điểm 3 là thay đổi so với thiết kế cũ. Lý do: Grafana `agf` **chỉ có một datasource là Tempo**, không có
Prometheus/Mimir, nên `alerts/server-errors.yaml` (dựa trên `traces_spanmetrics_calls_total`) không chạy được ở đây.

## Hiện trạng đã kiểm tra trên Grafana

| Hạng mục             | Hiện trạng                                                    |
| -------------------- | ------------------------------------------------------------- |
| Alert rules          | không có                                                      |
| Contact points       | chỉ `email receiver` mặc định                                 |
| Notification template | không có                                                     |
| Notification policy  | default → `grafana-default-email`, không có child policy      |
| Datasources          | chỉ `tempo` (uid `ag2roz0cmsxs0a`)                            |

## Alert trên TraceQL metrics: đã thử trên Grafana 12.2

`docs/alerts.md` ghi rằng trên Grafana 12.1, TraceQL metrics không dùng được cho alert (lỗi
`input data must be a wide series but got type long` do exemplar frames). Tôi đã gọi `POST /api/v1/eval`, tức chạy
thử một rule mà không lưu, trên `agf` với chuỗi query → Reduce → Threshold:

- **Instant query: chạy được.** Query
  `{resource.service.name=~"awp-product-hub-api-.*" && kind = server} | count_over_time() by (resource.service.name)`
  trả về mỗi service một series, cụ thể production 68 và stage 25 trong 24 giờ. Threshold cũng đánh giá riêng cho
  từng service. Vậy là đã alert được nhiều chiều.
- **Range query: lỗi**, vì Tempo giới hạn khung thời gian của metrics query tối đa 24h. Cửa sổ 5 phút của alert
  không bị ảnh hưởng.
- Chưa test riêng với `status = error`, vì 2 ngày gần đây không có lỗi 500 nào. Cấu trúc query giống hệt, chỉ khác
  điều kiện lọc.

Query đề xuất cho hai rule, cửa sổ 5 phút (relativeTimeRange 300s), instant:

```traceql
# Failed requests (5xx hoặc exception không bắt)
{kind = server && status = error} | count_over_time() by (resource.service.name, resource.deployment.environment)

# Failed background jobs
{status = error && name =~ "job[.].*"} | count_over_time() by (resource.service.name, resource.deployment.environment)
```

Reduce `Last` (hoặc `Sum`) → Threshold `> 10` (requests) hoặc `> 3` (jobs), giữ nguyên ngưỡng hiện có.

## Teams: group chat thay cho channel

- Office 365 Connectors (`*.webhook.office.com`) đã bị tắt hẳn, Microsoft tắt đợt cuối khoảng 18–22/05/2026. Chỉ
  còn cách dùng **Workflows**.
- Workflows có template riêng cho chat: **"Send webhook alerts to a chat"**. Khi tạo, chọn đúng group chat, rồi
  copy URL. Microsoft lưu ý template này có thể không hiện, tuỳ loại tổ chức. Khi đó cần IT admin bật.
- Contact point Microsoft Teams của Grafana gửi Adaptive Card, đúng định dạng Workflows cần. Tài liệu Grafana chỉ
  hướng dẫn cho channel. **Chưa có nguồn chính thức xác nhận với group chat**, nên phải bấm **Test** để kiểm tra.
- Lỗi đã biết: thông báo xem trước không hiện nội dung card. Workaround cộng đồng hay dùng là mở bước
  "Post card … as the Flow bot" và đổi **Post as** sang User. Nhược điểm là tin sẽ hiện dưới tên người tạo flow.
- Workflow chạy dưới tài khoản người tạo. Người đó rời chat hoặc rời công ty thì cảnh báo ngừng. Nên tạo bằng
  tài khoản dùng chung hoặc tài khoản của nhóm.

```
spans ─▶ Tempo ─(TraceQL metrics, instant, mỗi 1m)─▶ Grafana alert rule
                                                       ▼
                                  contact point "abc-observability-teams"
                                                       ▼
                         Workflows "Send webhook alerts to a chat" ─▶ group chat
```

## Các bước tiếp theo

1. Người quản lý group chat: **⋯ → Workflows → "Send webhook alerts to a chat"**, chọn chat, copy URL rồi gửi qua
   kênh riêng. Không commit URL vào repo.
2. Grafana: tạo notification template từ `alerts/teams-message.tmpl`, contact point Teams dùng URL đó, child policy
   `notify = abc-observability-teams`, theo các bước 3–5 trong `docs/alerts.md`. Bấm **Test**.
3. Tạo hai alert rule dùng query TraceQL ở trên, datasource `tempo`.
4. Cập nhật repo: thêm biến thể `alerts/server-errors.yaml` cho TraceQL, và sửa `docs/alerts.md`. Mục ghi "TraceQL
   không alert được" chỉ đúng với 12.1. Nhãn trong template (`.Labels.service`, `.Labels.deployment_environment`)
   phải khớp với tên nhãn TraceQL thực sự sinh ra.
5. Test: tạo ra 11 lỗi trở lên trong 5 phút trên stage, xác nhận FIRING rồi RESOLVED trong group chat.

## Câu hỏi còn mở

- Grafana đặt tên nhãn của series TraceQL `by(resource.service.name)` là gì (`resource.service.name` hay
  `service.name`)? Bước 4 phụ thuộc vào điều này. Tôi mới thấy giá trị, chưa thấy tên nhãn.
- Có muốn giữ thiết kế span metrics (cần DevOps bật Tempo metrics-generator và thêm Prometheus/Mimir), hay chuyển
  hẳn sang TraceQL?
- Có cần hai nơi nhận khác nhau không, ví dụ production vào group chat còn stage vào nơi khác?
- Template "Send webhook alerts to a chat" có bật trong tenant Microsoft 365 của công ty không?

## Nguồn

- Grafana, Configure Microsoft Teams: https://grafana.com/docs/grafana/v12.4/alerting/configure-notifications/manage-contact-points/integrations/configure-teams/
- Microsoft, Create incoming webhooks with Workflows: https://support.microsoft.com/en-US/teams/apps-service/create-incoming-webhooks-with-workflows-for-microsoft-teams
- Microsoft, Send messages in Teams using incoming webhooks: https://support.microsoft.com/en-us/workflows/send-messages-in-teams-using-incoming-webhooks
- Grafana community, Teams Workflows message previews: https://community.grafana.com/t/configure-grafana-notifications-for-teams-workflows-with-message-previews/163145
- Microsoft Q&A, cùng chủ đề: https://learn.microsoft.com/en-us/answers/questions/5911372/configure-grafana-notifications-for-teams-workflow
- Tóm tắt lịch tắt Office 365 connectors (MC1181996): https://www.itelio.com/en/microsoft-message-center/MC1181996
