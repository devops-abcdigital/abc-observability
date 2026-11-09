---
phase: 2
title: "Phase 2: Node Tracing Library"
status: todo
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Node Tracing Library

## Overview

Viết package `@devops-abcdigital/observability-node`: nạp bằng `node --import`, tự trace HTTP vào/ra, NestJS/Express, Postgres, gRPC, fetch, và cho phép dự án thêm span nghiệp vụ bằng `@Traced()` hoặc `withSpan()`. Chỉ xuất **traces**.

## Key Insights

- ai-benchmark-tool chỉ cài `@opentelemetry/sdk-node` + exporter, **không có auto-instrumentation**, nên Grafana chỉ thấy span `ai.inference` rời rạc. Lib phải bật auto-instrumentation thì mới có trace xuyên service.
- OTel phải khởi động **trước khi app import thư viện khác**, nếu không auto-instrumentation không vá được `http`, `pg`, `express`. Dùng `node --import`.
- `NodeSDK` đã tự đọc các biến `OTEL_*` chuẩn (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER`, `OTEL_RESOURCE_ATTRIBUTES`…). **Không tự viết lại phần đọc env đó.**
- Thêm listener `SIGTERM` vào process sẽ **tắt hành vi thoát mặc định** của Node. Nếu lib thêm listener mà app không có handler riêng, process sẽ không thoát khi bị dừng. Phải xử lý cẩn thận (xem Architecture).
- `@opentelemetry/api` phải là **peerDependency** để app và lib dùng chung một instance API, nếu không span do app tạo có thể không gắn vào trace hiện tại.
- awp-product-hub dùng: NestJS 11 (Express), MikroORM 7 + `pg`, `fetch` (undici) gọi API ngoài, `@google-analytics/data` (gRPC), `nestjs-pino`. Build ra **CommonJS** (`be/package.json` không có `"type"`, tsconfig `module: nodenext`).

## Requirements

Chức năng:
- [ ] Entry `register` dùng được với `node --import @devops-abcdigital/observability-node/register` cho cả app CommonJS và ESM.
- [ ] Không có `OTEL_EXPORTER_OTLP_ENDPOINT` và `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` thì lib **tắt hẳn**, không tạo SDK.
- [ ] Auto-instrumentation bật: `http`, `express`, `@nestjs/core`, `pg`, `undici`, `grpc`, `pino` (pino chỉ để chèn `trace_id`/`span_id` vào log, chưa gửi log đi).
- [ ] Tắt các instrumentation gây nhiễu: `fs`, `dns`, `net`.
- [ ] Bỏ qua các đường dẫn health check. Mặc định `/health`, `/api/v1/health`; cho phép ghi đè bằng biến `ABC_OTEL_IGNORE_PATHS` (danh sách phân cách bằng dấu phẩy).
- [ ] API công khai: `withSpan(name, fn, attributes?)` và decorator `@Traced(name?)`; cả hai ghi exception, đặt status `ERROR` khi lỗi, ném lại lỗi, luôn `end()` span.
- [ ] API công khai `markSpanError(message)`: đặt span đang chạy về status `ERROR` với thông điệp đã làm sạch, **không** đính kèm đối tượng lỗi gốc. Dùng cho chỗ code bắt lỗi rồi trả kết quả thay vì ném (ví dụ sync connector của awp-product-hub). Không có span đang chạy thì không làm gì.
<!-- Updated: Validation Session 1 - job errors must be alertable; add markSpanError for errors that are caught and not rethrown -->
- [ ] Job chạy nền (cron, event listener) không có span gốc tự động: README hướng dẫn bọc job bằng `withSpan('job.<khu-vuc>.<viec>', …)`.
- [ ] Sampling theo biến chuẩn `OTEL_TRACES_SAMPLER`; mặc định `parentbased_always_on`.

Phi chức năng:
- [ ] Lỗi khởi tạo hoặc exporter **không bao giờ làm app crash**, chỉ ghi một cảnh báo ra stderr.
- [ ] Không ghi header, body, query string nhạy cảm vào span (giữ mặc định của OTel, không bật capture header).
- [ ] Khi app tắt, span còn trong hàng đợi được flush (tối đa vài giây) và process vẫn thoát đúng như khi chưa cài lib.

## Architecture

```
packages/node/
├── src/
│   ├── register.ts          ← entry --import: đăng ký ESM hook rồi gọi startTracing()
│   ├── sdk.ts               ← startTracing()/stopTracing(): tạo NodeSDK, gắn trace exporter
│   ├── config.ts            ← isTracingEnabled(), ignoredPaths(): hằng số mặc định + đọc ABC_OTEL_IGNORE_PATHS
│   ├── instrumentations.ts  ← danh sách instrumentation bật/tắt, ignore health check
│   ├── shutdown.ts          ← flush khi SIGTERM/SIGINT mà không đổi hành vi thoát của app
│   ├── tracing.ts           ← withSpan(), Traced(), markSpanError()
│   └── index.ts             ← export withSpan, Traced, markSpanError (không export SDK nội bộ)
├── test/
│   ├── unit/                ← config, withSpan/Traced với InMemorySpanExporter
│   └── integration/         ← app Express thật + receiver OTLP HTTP chạy trong process
└── package.json             ← exports: "." và "./register"; peerDependencies: @opentelemetry/api
```

Luồng khởi động:
```
node --import .../register dist/main.js
  register.ts
    ├─ module.register('@opentelemetry/instrumentation/hook.mjs')  ← cho app ESM
    └─ startTracing()
         ├─ isTracingEnabled()? không → return (app chạy bình thường)
         └─ new NodeSDK({ traceExporter: OTLPTraceExporter, instrumentations }).start()
              (try/catch: lỗi → cảnh báo stderr, không throw)
```

Xử lý shutdown (`shutdown.ts`):
- Đăng ký `process.once` cho `SIGTERM`/`SIGINT`.
- Khi nhận tín hiệu: gọi `sdk.shutdown()` có timeout. Sau đó, nếu **không còn listener nào khác** của app cho tín hiệu đó, gỡ listener của lib và gửi lại tín hiệu cho chính process (`process.kill(process.pid, signal)`) để Node thoát như mặc định. Nếu app có handler riêng (ví dụ NestJS `enableShutdownHooks`) thì để app tự quyết định việc thoát.

## Related Code Files

- Create: toàn bộ file trong `packages/node/` ở sơ đồ trên.
- Tham khảo: `ai-benchmark-tool/server/src/telemetry.ts` (cách tự tắt khi thiếu endpoint), `ai-benchmark-tool/server/src/services/inference.ts` (span nghiệp vụ, `gen_ai.*`).

## Implementation Steps

1. Cài dependency với **version ổn định mới nhất tại thời điểm làm** (ghi lại version trong CHANGELOG): `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation`; `@opentelemetry/api` là peerDependency + devDependency.
2. Viết `config.ts` với hằng số đặt tên rõ (`DEFAULT_IGNORED_PATHS`), hàm thuần dễ test.
3. Viết `instrumentations.ts` dùng `getNodeAutoInstrumentations()` với cấu hình bật/tắt ở trên và `ignoreIncomingRequestHook` dựa trên `ignoredPaths()`.
4. Viết `sdk.ts` và `shutdown.ts` theo Architecture.
5. Viết `register.ts`: gọi `module.register` cho hook ESM rồi `startTracing()`.
6. Viết `tracing.ts`: `withSpan` dùng `tracer.startActiveSpan`, hỗ trợ cả hàm sync và async; `Traced` bọc method bằng `withSpan`, tên mặc định là `ClassName.methodName`; `markSpanError` lấy `trace.getActiveSpan()` và gọi `setStatus({ code: ERROR, message })`.
7. Viết test (xem Todo), build bằng `tsc` ra `dist/` CommonJS + file `register.mjs`; kiểm tra `exports` map trỏ đúng.

## Todo

- [ ] `config.ts` + unit test (bật/tắt theo env, parse `ABC_OTEL_IGNORE_PATHS`)
- [ ] `instrumentations.ts`
- [ ] `sdk.ts` + `shutdown.ts`
- [ ] `register.ts`
- [ ] `tracing.ts` + unit test (span OK, span lỗi có exception + status ERROR, span luôn kết thúc, quan hệ cha/con khi lồng nhau, `markSpanError` đặt ERROR mà không thêm event exception, gọi ngoài span không lỗi)
- [ ] Integration test: app Express có 2 route, route A gọi HTTP sang route B; receiver OTLP nhận được **một trace** gồm span server A → span client → span server B, cùng `trace_id`
- [ ] Integration test: request tới `/health` không sinh span
- [ ] Integration test: không đặt endpoint → không có request nào tới receiver, app vẫn trả 200
- [ ] Integration test: exporter trỏ tới cổng không tồn tại → app vẫn trả 200
- [ ] Integration test: process con chạy app không có handler SIGTERM, gửi SIGTERM → process thoát trong 5 giây
- [ ] `README.md` của package: cài đặt, biến môi trường, `withSpan`, `@Traced`, `markSpanError`, cách bọc job chạy nền

## Success Criteria

- [ ] `npm run verify && npm test -w packages/node` pass.
- [ ] Toàn bộ integration test ở Todo pass trên CI.
- [ ] Chạy thử với `docker-compose.dev.yml`: trace của app test hiện trong Grafana `localhost:3001` → Explore → Tempo.

## Risk Assessment

- Auto-instrumentation không bắt được MikroORM: MikroORM 7 dùng driver `pg` bên dưới, instrumentation `pg` sẽ bắt truy vấn. Kiểm chứng ở phase 5; nếu thiếu thì ghi lại, không tự viết instrumentation cho MikroORM.
- Hook ESM (`module.register`) khác nhau giữa các bản Node: chỉ hỗ trợ Node 24, ghi rõ trong `engines`.
- Logic re-raise tín hiệu sai có thể khiến app không thoát hoặc thoát hai lần: đã có integration test riêng.

## Security Considerations

- Không capture header (`Authorization`, `Cookie`) hay body. Không thêm attribute chứa token.
- Lib không cần và không đọc bất kỳ secret nào; token gateway chỉ nằm ở Alloy dùng chung do DevOps quản lý.
- `markSpanError` chỉ nhận chuỗi thông điệp đã làm sạch, không nhận đối tượng lỗi, để lỗi gốc mang chi tiết request (URL có key, header) không lọt vào trace.

## Next Steps

- Phase 3 dùng lib trong app mẫu và phát hành bản `0.1.0`.
