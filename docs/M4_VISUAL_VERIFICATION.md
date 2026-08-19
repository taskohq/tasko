# M4 Unified Workspace — Visual Verification

## Scope inspected

Các màn hình `/platform`, `/inbox`, `/docs`, `/forms`, `/automations` và `/calendar` được kiểm tra ở desktop `1440×1100`. Các luồng tạo Docs, xây Forms và quản lý Automations được kiểm tra thêm ở mobile `390×844`.

| Khu vực | Kết quả desktop | Kết quả mobile |
| --- | --- | --- |
| Operations Overview | KPI strip, entry search, Inbox context và activity panel sử dụng cùng shell white/indigo; empty state giải thích nguồn dữ liệu thật. | Không có lỗi layout quan sát được trong shell responsive. |
| Inbox | Danh sách attention dùng liên kết entity và action archive; empty state không tạo dữ liệu giả. | Layout một cột giữ được khả năng đọc. |
| Docs | Composer và danh sách documents có hierarchy rõ ràng, action tạo document dễ tìm. | Composer và list xếp chồng, controls không tràn viewport. |
| Forms | Builder hiển thị target Work/CRM, project selector và empty state minh bạch. | Form controls giữ đủ chiều rộng thao tác, không có overflow. |
| Automations | Rule builder tách khỏi rule list và execution log để phân biệt cấu hình/kết quả. | Cards xếp một cột, execution log còn đọc được. |
| Calendar | Hiển thị projection công việc theo due date và empty state rõ nguồn dữ liệu. | Dùng cùng responsive shell. |

## Lưu ý xác minh dữ liệu

Screenshot ban đầu không có phiên đăng nhập nên tRPC trả `401` và các canvas hiển thị **empty states**. Sau đó `/platform` được mở lại qua My Browser; chrome hiển thị identity của preview nhưng request log vẫn xác nhận `workspace.overview`, `workspace.inbox` và `work.projects` nhận `401` từ server. Vì vậy browser hiện tại chưa có server-side authenticated session và giao diện vẫn chỉ có thể truthfully hiển thị empty states thay vì tạo dữ liệu giả.

Thử gọi `platform.seedDemo` qua POST từ preview browser bị external preview proxy chặn với HTTP `403`. Do đó screenshot populated authenticated chưa thể tạo trên proxy hiện tại. Đây là blocker môi trường được giữ như hạng mục verification mở; các luồng dữ liệu được kiểm chứng tách biệt qua acceptance memory và PostgreSQL Docker:

- Forms tạo Work item, Inbox item và xử lý retry idempotent.
- Automation ghi execution log một lần cho cùng durable outbox event.
- Document context links, Inbox state, audit/outbox được lưu qua PostgreSQL adapter.
- `workspace.overview` tạo KPI, cross-module Work/CRM/Docs activity, linked-object context và work graph từ dữ liệu tenant-scoped thật; acceptance cũng xác nhận tenant khác không thấy graph nodes.

Không ghi nhận lỗi TypeScript hoặc layout overflow trong các viewport đã kiểm tra.
