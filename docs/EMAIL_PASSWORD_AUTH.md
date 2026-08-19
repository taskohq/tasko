# Email and Password Authentication

## Phạm vi

Tasko hỗ trợ đăng ký và đăng nhập bằng **email/mật khẩu** song song với Google OAuth. Cả hai phương thức phát hành cùng loại session cookie HTTP-only, vì vậy middleware, tRPC context, authorization, tenant isolation và logout hiện hữu không cần đường bypass riêng.

| Thành phần | Hành vi |
|---|---|
| Credential store | `email_password_accounts` lưu email chuẩn hóa, display name, hash KDF và thời điểm sign-in gần nhất; không lưu plaintext password. |
| KDF | Node `scrypt` với salt ngẫu nhiên, tham số được mã hóa cùng hash và so sánh constant-time. |
| Rate control | Redis giới hạn signup và login theo hash của email chuẩn hóa, không lưu email vào key quan sát được. |
| Error surface | Tài khoản không tồn tại và password sai cùng trả `TASKO_INVALID_CREDENTIALS` để hạn chế account enumeration. |
| Durable events | Signup provision tenant/membership owner qua PlatformStore; login được ghi audit/outbox theo actor tenant đã resolve server-side. |

## Tenant và session

Signup tạo subject nội bộ có tiền tố `email:`, credential account và một workspace owner bằng workflow provision idempotent. Với profile `single_tenant`, OAuth principals hiện hữu vẫn được gắn vào workspace cấu hình; local email principal resolve workspace đầu tiên mà server đã provision cho chính subject đó. Browser không gửi tenant ID có quyền lực nào.

Sau khi signup hoặc login thành công, server tạo session bằng SDK hiện hữu với same-site, secure và HTTP-only cookie options đã dùng cho OAuth. Logout xoá cùng cookie; không có token credential được cấp cho browser.

## API và UI

Router `auth` cung cấp procedures public cho signup và login. Trang `/login` hiển thị Google OAuth trước, sau đó là form email/mật khẩu; link “Create a workspace” chuyển sang form đăng ký có display name và workspace name. Các lỗi policy, email/password không hợp lệ và rate limit có trạng thái rõ ràng mà không tiết lộ tài khoản tồn tại.

Regression `modules/auth/email-password.integration.test.ts` bao phủ KDF/no-plaintext, owner provisioning, session compatibility, failure generic và rate limit. Các test platform bảo toàn semantics tenant cho non-email principals.
