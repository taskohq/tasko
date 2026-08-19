# M6 — Import and Ecosystem Architecture

## Quyết định pipeline

M6 áp dụng pipeline import staging dùng chung: **connect/upload → parse neutral records → validate → map → preview → batch execute → report warnings/errors → persist source mapping**. Các batch phải resume được và idempotent; mọi tạo/cập nhật entity đích đều đi qua service domain tương ứng để giữ authorization, audit và transactional outbox.

## Quyết định event-driven integrations

Các integration Jira, ClickUp, Slack, GitHub và GitLab đều có cơ chế webhook/event callback công khai nên M6 dùng inbound webhook receiver có validation signature, replay protection và idempotency, thay vì polling.

| Provider | Kết luận kỹ thuật xác minh | Hệ quả Tasko |
|---|---|---|
| Jira Cloud | Webhook HTTPS có event filter; có retry và `X-Atlassian-Webhook-Identifier` ổn định giữa retries. | Lưu provider delivery ID làm idempotency key, chỉ đăng ký scope dự án cần thiết. |
| ClickUp | Webhook gắn theo token người tạo, ký bằng shared secret; tài liệu đề xuất `webhook_id:history_item_id` làm idempotency key. | Lưu secret dạng tham chiếu bảo mật và enforce idempotency per history item. |
| Slack | Events API giao về HTTP hoặc Socket Mode, chịu chi phối OAuth scopes và chỉ phản ánh resource scope app được thấy. | M6 dùng HTTP callback, acknowledge nhanh, xử lý async qua outbox; không cố import private data ngoài scope OAuth. |
| GitHub | Repository/organization/App webhook có event subscription và cung cấp delivery theo thời điểm event. | GitHub connection chỉ mở repo được cấp quyền, push/PR/issue đi qua durable inbound event. |
| GitLab | Project/group webhook hỗ trợ HMAC-SHA256 signing token, delivery identifier/timestamp và khuyến nghị timestamp freshness chống replay. | Ưu tiên standard webhook signature, constant-time verify và giới hạn skew timestamp. |

## Public platform boundary

Public API M6 theo `/api/v1`, không trả trực tiếp database rows, dùng token scopes tối thiểu, cursor pagination và `Idempotency-Key` cho mutation retriable. Webhook subscription của Tasko gửi signed event envelope; delivery có retry, dead-letter, failure count và auto-disable endpoint khi liên tiếp thất bại.

## Bằng chứng kiểm chứng M6

Migration `0009_import_ecosystem.sql` đã được áp dụng qua migration ledger vào PostgreSQL Docker. Bộ kiểm chứng cuối M6 đã chạy `tsc --noEmit`, toàn bộ regression gồm PostgreSQL adapters và build production: **13 test files pass, 52 tests pass, 2 integration storage bị skip có chủ đích**. Capture route Import và Developer Ecosystem xác nhận route được đăng ký; capture sandbox không có session OAuth dừng tại trạng thái xác thực/loading an toàn. Việc debug OAuth callback và ảnh authenticated populated được giữ là deferred follow-up theo quyết định sản phẩm đã ghi nhận, không làm lỏng server-side authorization của các canvas M6.

## Nguồn xác minh

- [Jira Cloud Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [ClickUp Webhooks](https://developer.clickup.com/docs/webhooks)
- [Slack Events API](https://api.slack.com/apis/connections/events-api)
- [GitHub Webhooks](https://docs.github.com/en/webhooks/about-webhooks)
- [GitLab Webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)
