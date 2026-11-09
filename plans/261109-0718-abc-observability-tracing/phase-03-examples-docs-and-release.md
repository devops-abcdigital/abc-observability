---
phase: 3
title: "Phase 3: Examples, Docs and Release"
status: in-progress
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 3: Examples, Docs and Release

<!-- 2026-11-09: everything up to publishing is done. Guards tested in a scratch clone (branch, dirty tree, ahead of origin, no changeset, no token, Node version); dry run passes past the token check when login is stubbed. Remaining: `npm run release -- --dry-run` with a real token, publish 0.1.0 (maintainer, needs write:packages token and merge to main), install test, screenshot (trace verified through the Tempo API instead). -->

<!-- Updated: Validation Session 2 - first releases run from a maintainer machine through a guarded release script; CI pipeline (GitHub Actions or Jenkins) deferred until DevOps confirms -->

## Overview

Thêm app mẫu chứng minh trace xuyên nhiều service, viết tài liệu tích hợp và quy ước, rồi phát hành `@devops-abcdigital/observability-node@0.1.0` lên GitHub Packages. Bản đầu tiên được release **từ máy của người được giao quyền release**, qua script `npm run release` có kiểm tra an toàn. Việc tự động hóa release trên GitHub Actions hoặc Jenkins để sau, khi DevOps xác nhận hạ tầng.

## Key Insights

- Câu hỏi chính của người dùng là "service nào gọi service nào, lỗi ở bước nào" (ví dụ HRM → SSO → UMS). App mẫu phải tái hiện đúng tình huống đó.
- Các repo của org (awp-product-hub, ai-benchmark-tool) **chưa từng chạy GitHub Actions** (0 lần chạy), không có `Jenkinsfile`; `infra_info.json` có các trường Jenkins nhưng đều `NOT_CONFIGURED`. Chưa biết org có cho phép Actions không, và chưa có job Jenkins cho thư viện. Vì vậy release không được phụ thuộc vào pipeline nào ở bản đầu.
- Script release là **nguồn sự thật duy nhất** cho các bước release. Sau này pipeline CI (Actions hoặc Jenkins) chỉ cần gọi lại chính script đó, không viết lại các bước.
- npm **không cho ghi đè** một version đã publish. Publish nhầm thì chỉ sửa được bằng bản vá mới, nên các bước kiểm tra trước khi publish là bắt buộc.
- Package trên GitHub Packages là private: dev và CI của dự án cần token `read:packages`; người release cần token `write:packages`.

## Requirements

- [ ] `examples/multi-service`: 3 service Node nhỏ (`gateway` → `auth` → `users`) gọi nhau qua HTTP, mỗi service nạp lib bằng `--import`, có một route làm `users` trả lỗi 500.
- [ ] Ít nhất một service mẫu có job bọc bằng `withSpan('job.example.cleanup', …)` và một đường lỗi dùng `markSpanError`.
- [ ] `docs/getting-started.md`: tích hợp trong 3 bước (cài, `--import`, biến môi trường), cách cấu hình `.npmrc`/token `read:packages`, cách test bằng `otel-lgtm`, cách chuyển sang Alloy.
- [ ] `docs/conventions.md`: đặt tên `service.name` (`<du-an>-<thanh-phan>`, hậu tố `-local` khi chạy máy dev), giá trị `deployment.environment`, quy tắc đặt tên span và attribute, **span job chạy nền đặt tên `job.<khu-vuc>.<viec>`** (cảnh báo Teams ở phase 4 dựa vào tiền tố này), danh sách dữ liệu cấm đưa vào span.
- [x] `docs/releasing.md`: ai được release, cách tạo token `write:packages`, cách chạy `npm run release`, xử lý khi publish lỗi giữa chừng.
- [ ] Thêm `getting-started.md`, `conventions.md`, `releasing.md` vào `nav` của `mkdocs.yml` để hiện trên tab Docs của Backstage.
- [ ] Changesets quản lý version và CHANGELOG: mỗi PR thay đổi package phải kèm `.changeset/*.md`.
- [ ] `npm run release` (file `scripts/release.mjs`) **dừng và không publish** nếu một trong các điều kiện sau sai:
  - đang ở nhánh `main`;
  - không có thay đổi chưa commit;
  - `main` local trùng với `origin/main` sau khi `git fetch`;
  - có ít nhất một changeset chưa áp dụng;
  - `npm whoami --registry=https://npm.pkg.github.com` thành công (token hợp lệ);
  - `npm run verify`, `npm test`, `npm run build` đều pass.
- [ ] Khi mọi điều kiện đúng, script chạy: `changeset version` → commit `chore(release): version packages` → `changeset publish` (publish + tạo git tag) → `git push --follow-tags` → tạo GitHub Release bằng `gh release create` với nội dung lấy từ CHANGELOG.
- [ ] Script có chế độ `--dry-run`: chạy toàn bộ kiểm tra và `npm publish --dry-run`, không commit, không push.

## Architecture

```
examples/multi-service/
├── gateway/   GET /login        → gọi auth
├── auth/      GET /token        → gọi users
├── users/     GET /users/:id    → trả 500 khi id = "broken"
└── docker-compose.yml           ← 3 service + otel-lgtm, chung network
```

Luồng release (bản đầu, trên máy người release):
```
PR có .changeset/*.md → review → merge main
        ▼
Người release: git checkout main && git pull
        ▼
npm run release   (scripts/release.mjs)
  ├─ kiểm tra: nhánh main, sạch, trùng origin, có changeset, token hợp lệ
  ├─ verify + test + build
  ├─ changeset version → commit
  ├─ changeset publish → npm.pkg.github.com + git tag
  ├─ git push --follow-tags
  └─ gh release create
```

Về sau (ngoài phạm vi phase này): GitHub Actions hoặc Jenkins chạy đúng lệnh `npm run release` với token của CI. Không đổi script.

## Related Code Files

- Create: `examples/multi-service/**`, `docs/getting-started.md`, `docs/conventions.md`, `docs/releasing.md`, `.changeset/config.json`, `scripts/release.mjs`.
- Modify: `package.json` gốc (script `release`, devDependency `@changesets/cli`), `packages/node/package.json` (`publishConfig.registry`, `repository`, `files`), `README.md` gốc (link docs), `mkdocs.yml` (nav).

## Implementation Steps

1. Viết 3 service mẫu bằng Express, mỗi service dùng `@Traced()` hoặc `withSpan()` ít nhất một lần; thêm job mẫu.
2. Viết `docker-compose.yml` cho example, dùng package từ workspace (không cần registry).
3. Chạy `docker compose up`, gọi `/login` với id thường và id `broken`, xác nhận trong Grafana thấy một trace gồm 3 service, span lỗi đỏ nằm ở `users`.
4. Viết `docs/getting-started.md`, `docs/conventions.md`, cập nhật `mkdocs.yml`.
5. Cài và cấu hình changesets (`npx changeset init`, `access: restricted`, `baseBranch: main`).
6. Viết `scripts/release.mjs` theo Requirements: mỗi kiểm tra là một hàm nhỏ có thông báo lỗi rõ ràng; dùng `child_process.execFileSync`, không ghép chuỗi lệnh shell.
7. Viết `docs/releasing.md`.
8. Chạy `npm run release -- --dry-run`, sửa cho tới khi pass.
9. Tạo changeset đầu tiên, merge, chạy `npm run release` để publish `0.1.0`.
10. Cài thử `0.1.0` từ registry vào một thư mục trống bằng token `read:packages` để xác nhận publish đúng.

## Todo

- [x] 3 service mẫu + job mẫu + compose
- [ ] Kiểm chứng trace xuyên 3 service trên Grafana local (chụp ảnh đưa vào docs)
- [x] `docs/getting-started.md`, `docs/conventions.md`, `mkdocs.yml`
- [x] changesets
- [x] `scripts/release.mjs` + script `release` trong `package.json`
- [x] Kiểm thử từng điều kiện chặn: sai nhánh, có thay đổi chưa commit, lệch `origin/main`, không có changeset, token sai → script dừng, không publish
- [ ] `npm run release -- --dry-run` pass
- [ ] `docs/releasing.md`
- [ ] Publish `0.1.0`, có git tag và GitHub Release, cài thử từ registry

## Success Criteria

- [x] Một request `/login?id=broken` cho ra **một** trace có span của cả `gateway`, `auth`, `users`; span `users` có status ERROR và exception.
- [ ] `npm view @devops-abcdigital/observability-node version --registry=https://npm.pkg.github.com` trả về `0.1.0`; có tag `@devops-abcdigital/observability-node@0.1.0` và GitHub Release tương ứng.
- [x] Mỗi điều kiện chặn ở Requirements khi sai đều làm script dừng trước bước publish.
- [ ] Người chưa tham gia dự án làm theo `getting-started.md` tích hợp được vào một app Express trống.

## Risk Assessment

- Publish lỗi giữa chừng (đã commit version nhưng publish thất bại): `docs/releasing.md` hướng dẫn chạy lại `changeset publish` (lệnh này bỏ qua version đã có trên registry), không tăng version thủ công.
- Phụ thuộc token cá nhân của một người: giao quyền release cho 1–2 người, ghi tên trong `docs/releasing.md`; khi có pipeline CI thì chuyển sang token của CI.
- Máy người release khác môi trường (Node khác version): script kiểm tra `process.version` khớp `engines` trước khi chạy.
- Ảnh chụp trong docs lỗi thời khi giao diện Grafana đổi: chỉ dùng ảnh minh họa, hướng dẫn chính viết bằng chữ.

## Security Considerations

- Token `write:packages` chỉ nằm trong `~/.npmrc` của người release, không commit, không in ra log của script.
- Script không bao giờ in nội dung `.npmrc` hay biến môi trường chứa token.

## Next Steps

- Phase 4 làm cảnh báo Teams; phase 5 áp dụng vào awp-product-hub.
- Khi DevOps xác nhận org cho phép GitHub Actions (hoặc tạo được job Jenkins với token bot), thêm pipeline release gọi `npm run release`. Đây là việc sau, không thuộc phase này.
