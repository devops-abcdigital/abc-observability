---
phase: 2
title: "Express middleware và NestJS filter"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Express middleware và NestJS filter

<!-- Updated: Validation Session 1 - thêm test thứ tự filter khi app có filter @Catch(HttpException) riêng như AWP -->

## Goal

App gắn một dòng là lỗi 500 được báo: Express dùng `teamsErrorNotifier()` làm error middleware, NestJS dùng
`TeamsExceptionFilter` làm global filter. Cả hai gọi `notifyServerError()` và không đổi response.

## Key insights

- NestJS tự xử lý exception trong filter của nó, nên error middleware của Express không bao giờ thấy lỗi của Nest. Vì
  vậy cần filter riêng cho Nest.
- Filter phải kế thừa `BaseExceptionFilter` và gọi `super.catch()` để response giữ nguyên như mặc định của Nest. Status
  lấy từ `HttpException.getStatus()`, các lỗi khác coi là 500.
- awp-product-hub chạy NestJS 11 trên Express và build ra CommonJS (theo phase 5 của plan tracing).
- Route lấy dạng mẫu để không lộ ID: Express `req.baseUrl + req.route?.path`. Không có thì lấy path bỏ query string.
- Tách subpath `@devops-abcdigital/observability-node/nestjs` để app Express không phải cài `@nestjs/*`.

## Files to Create / Modify

- Create: `packages/node/src/alerts/express.ts`: `teamsErrorNotifier()` trả về `(err, req, res, next)`, báo khi status
  ≥ 500 (`err.status ?? err.statusCode ?? 500`) rồi gọi `next(err)`.
- Create: `packages/node/src/nestjs.ts`: `TeamsExceptionFilter extends BaseExceptionFilter`.
- Modify: `packages/node/src/index.ts`: export `teamsErrorNotifier`.
- Modify: `packages/node/package.json`:
  - Thêm export `"./nestjs"`.
  - `peerDependencies` + `peerDependenciesMeta.optional` cho `@nestjs/common` và `@nestjs/core` (`>=10`).
  - devDependencies `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata` để test.
- Create: `packages/node/test/unit/alerts-express.spec.ts`, `packages/node/test/unit/alerts-nestjs.spec.ts`.
- Modify: `examples/multi-service/src/users.mjs` (hoặc service đang trả lỗi): gắn `teamsErrorNotifier()` làm ví dụ.

## Tasks & Steps

1. Viết `express.ts`. Middleware không bao giờ throw: bọc `notifyServerError` trong try/catch.
2. Viết `nestjs.ts`:
   - `catch(exception, host)`: lấy request từ `host.switchToHttp()`. Status ≥ 500 thì gọi `notifyServerError`.
   - Luôn gọi `super.catch(exception, host)`.
   - Context không phải HTTP (RPC, WS) thì chỉ gọi `super.catch`.
3. Cập nhật `package.json` exports và peer dependencies tuỳ chọn. Kiểm tra `require('@devops-abcdigital/observability-node')`
   không kéo `@nestjs/*` vào.
4. Test Express: app Express thật trong test.
   - Route throw lỗi thì webhook giả nhận 1 card, response vẫn là 500 như cũ.
   - Lỗi 404/400 thì không gửi.
5. Test NestJS: app Nest tối thiểu với `app.useGlobalFilters(new TeamsExceptionFilter(httpAdapter))`.
   - `throw new Error()` thì có card, body response giống hệt khi không có filter.
   - `NotFoundException` thì không có card.
   - Mô phỏng AWP: đăng ký `useGlobalFilters(new TeamsExceptionFilter(adapter), new AppHttpExceptionFilter())`, trong đó
     filter thứ hai là `@Catch(HttpException)` trả body riêng.
     - `BadRequestException` ra đúng body riêng và không có card.
     - `throw new Error()` có card và trả 500 mặc định.
     - Cách này đồng thời kiểm chứng giả định "Nest kiểm tra global filter theo thứ tự ngược lúc đăng ký". Nếu giả định
       sai thì ghi lại thứ tự đúng trong README trước khi sang phase 3.
6. Thêm ví dụ vào `examples/multi-service`.

## Verification

- `npm run test -w @devops-abcdigital/observability-node`
- `npm run verify`
- `npm pack --dry-run -w @devops-abcdigital/observability-node`: có `dist/nestjs.js`, không có test.

## Risk

- Nest có thể đổi chữ ký của `BaseExceptionFilter`. Biện pháp: peer range `>=10`, test trên Nest 11 (bản app đang dùng).
- App đã có global filter riêng bắt `HttpException`, như AWP: `HttpException` có status ≥ 500 sẽ không đi qua
  `TeamsExceptionFilter`. App phải gọi `notifyServerError({ error, request, statusCode })` trong filter đó. README có ví
  dụ cho trường hợp này.

## Rollback

Chưa publish thì revert commit.
