# Tasko Document Management Design

## Phạm vi

Document Management bổ sung một thư viện gọn nhẹ cho tài liệu vận hành. Một tài liệu có thể là **note nội bộ** đang có sẵn hoặc **tệp nhị phân** được tải lên từ máy người dùng. Tệp nhị phân bao gồm PDF, Microsoft Word, Excel, PowerPoint, hình ảnh và các định dạng thông dụng khác; bytes chỉ lưu ở S3-compatible storage (Wasabi khi dùng, MinIO ở phát triển), còn PostgreSQL chỉ giữ metadata và liên kết.

| Bối cảnh | Hành vi |
| --- | --- |
| Project documents | Mỗi project có thư viện tài liệu riêng; tài liệu được tạo tại đây luôn liên kết với project đó. |
| Workspace library | Docs hiển thị tất cả tài liệu mà người dùng hiện tại được phép đọc, từ mọi project và tài liệu không gắn project. |
| Office preview | PDF và ảnh hiển thị inline khi trình duyệt hỗ trợ. Word, Excel và PowerPoint mở URL tải có chữ ký trong tab mới để dùng preview native/phần mềm người dùng; không tự chuyển nội dung qua dịch vụ bên thứ ba. |
| Download | Mọi lần tải hoặc preview file nhị phân dùng URL S3 có thời hạn ngắn, được phát hành sau authorization ở server. |

## Mô hình dữ liệu

`workspace_documents` vẫn là thực thể tài liệu thống nhất. Migration additive bổ sung `document_kind`, `project_id`, `object_key`, `filename`, `content_type`, và `byte_size`. Note cũ giữ `document_kind = 'note'`; tệp upload có `document_kind = 'file'` và các trường object bắt buộc. Liên kết `workspace_document_links` tiếp tục được dùng cho các context bổ sung ngoài project chủ quản.

Project scope không được tin từ browser. Service tải project theo `tenant_id`, kiểm tra `work.project.read` trước list/download và `work.project.manage` trước upload/remove. Sau đó service kiểm tra capability document chung (`workspace.document.read` hoặc `workspace.document.manage`) và policy visibility. Mọi tạo/xóa metadata phát sinh audit record và outbox record trong cùng transaction.

## Luồng upload và truy cập

1. Client gửi bytes base64, filename và declared content type tới procedure typed, với giới hạn kích thước và allowlist định dạng.
2. Server resolve membership và project quyền hạn, ghi bytes vào key `tenants/{tenantId}/documents/{projectId-or-workspace}/...` trên S3-compatible storage.
3. Sau upload thành công, transaction tạo `workspace_documents` metadata, audit và outbox. Không tạo bản ghi nếu bytes upload thất bại.
4. Client list dữ liệu qua read model tenant-scoped. Search/filter xảy ra trên metadata đã được authorization, không bao giờ gửi `tenant_id` từ client.
5. Khi preview/download, service resolve document theo tenant, lặp lại authorization và phát hành signed URL cho object key. Xóa chỉ loại metadata và không cung cấp xóa hàng loạt.

## Giới hạn chủ ý của phiên bản này

Tasko không triển khai editor đồng thời kiểu Google Docs, version history, chuyển đổi Office sang HTML hoặc chia sẻ public URL. Các tệp office được lưu nguyên bản nên có thể tải về và mở bằng ứng dụng tương thích. Thiết kế này giữ scope nhẹ, bảo toàn tính riêng tư và tái sử dụng đường lưu trữ Wasabi/MinIO đã được kiểm chứng.
