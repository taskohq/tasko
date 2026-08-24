# Quy tắc đồng bộ thành viên Chat

## Nguồn dữ liệu và vòng đời

Danh sách thành viên workspace là nguồn dữ liệu chuẩn cho Chat. Trong Tasko, thao tác **xóa khỏi workspace** được thực hiện qua thủ tục `workspaceMembers.remove` dưới dạng **xóa mềm** bằng trạng thái membership `suspended`. Cách này giữ nguyên lịch sử, quyền kiểm toán và tham chiếu công việc, đồng thời tránh xóa dây chuyền dữ liệu hội thoại.

| Trạng thái thành viên hệ thống | Có trong danh sách mời/tìm kiếm Chat | Có thể được @mention hoặc hiện diện | Hiển thị trong lịch sử |
|---|---:|---:|---|
| `active` | Có | Có | `Tên user` |
| `suspended` (đã xóa mềm) | Không | Không | `Tên user (inactive account)` |
| Không tồn tại trong workspace | Không | Không | Chỉ giữ định danh lịch sử nếu có snapshot dữ liệu hợp lệ |

Các channel chỉ lấy ứng viên mời từ danh sách `active` của workspace. Tài khoản đã xóa mềm không xuất hiện trong invite picker, autocomplete `@mention`, hay trạng thái online/typing; nhưng mọi tin nhắn và thread cũ vẫn định danh được người viết là tài khoản không hoạt động.
