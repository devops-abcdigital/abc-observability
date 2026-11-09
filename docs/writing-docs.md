# Hướng dẫn viết docs cho Backstage

## Cấu trúc

```text
catalog-info.yaml
mkdocs.yml
docs/
  index.md
  writing-docs.md
  assets/images/
```

Annotation trong `catalog-info.yaml` trỏ TechDocs đến gốc repository:

```yaml
metadata:
  annotations:
    backstage.io/techdocs-ref: dir:.
```

`mkdocs.yml` khai báo menu và plugin `techdocs-core`. Viết nội dung bằng Markdown trong `docs/`.

## Thêm nội dung và trang

Sửa `docs/index.md`, thay các mục TODO bằng thông tin thực tế.
Dùng `#` cho tiêu đề trang, `##` cho mục lớn và ba dấu backtick cho khối mã.

Để thêm trang triển khai, tạo `docs/deployment.md`, rồi thêm vào `nav` trong `mkdocs.yml`:

```yaml
nav:
  - Tổng quan: index.md
  - Hướng dẫn viết docs: writing-docs.md
  - Triển khai: deployment.md
```

Đường dẫn trong `nav` tính từ thư mục `docs/`, không thêm tiền tố `docs/`.

## Liên kết và hình ảnh

Liên kết giữa các trang dùng đường dẫn tương đối:

```markdown
[Tổng quan](index.md)
```

Đặt ảnh vào `docs/assets/images/`, rồi chèn từ trang ở gốc `docs/`:

```markdown
![Sơ đồ kiến trúc](assets/images/architecture.png)
```

Thay tên ảnh trong ví dụ bằng file có thật trước khi sử dụng.

## Xem trên Backstage

1. Commit và push tài liệu lên nhánh chứa `catalog-info.yaml` đã đăng ký.
2. Mở Component của project trong Catalog, chọn tab **Docs**.
3. TechDocs build và hiển thị tài liệu. Khi thay đổi cấu hình catalog, refresh entity nếu cần.

Nếu không hiển thị, kiểm tra annotation, `mkdocs.yml`, plugin `techdocs-core` và đường dẫn trong `nav`.
Với cấu hình hiện tại (`builder: local`, generator chạy trong Docker), máy chạy backend Backstage
cần Docker hoạt động và quyền đọc repository. Xem log TechDocs để xác định lỗi build.
