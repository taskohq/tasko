# Workspace Invitation Email Delivery

Tasko gửi email lời mời từ worker outbox, sau khi transaction tạo hoặc gửi lại lời mời đã commit. Provider hiện tại là Resend. Worker dùng `POST https://api.resend.com/emails`, xác thực Bearer server-side, và đặt `Idempotency-Key` bằng event ID của outbox để tránh gửi trùng khi retry. Nội dung email sử dụng cả HTML và text, với liên kết redeem một lần dưới `/settings?workspaceInvite=<token>`.

Token chỉ tồn tại trong payload outbox trong thời gian xử lý; audit log và realtime payload không chứa token. Nếu provider trả lỗi, worker retry theo chính sách outbox và email không được xác nhận là đã gửi giả tạo.

## Sources

- [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) — body `from`, `to`, `subject`, HTML/text và header idempotency.
- [Resend Node.js guide](https://resend.com/docs/send-with-nodejs) — yêu cầu API key và verified domain cho transactional email.
