# OAuth Runtime Incident: `ENOTFOUND base`

## Tóm tắt

Lỗi `getaddrinfo ENOTFOUND base` được người dùng quan sát sau khi đăng nhập không phát sinh từ exchange code OAuth hay endpoint `OAUTH_SERVER_URL`. Call stack đã lưu trong runtime logs cho thấy lỗi phát sinh khi tRPC gọi `saas.plans`, đi qua `PostgresSaaSStore.listPlans()` rồi tới `pg-pool`.

| Hạng mục | Kết luận |
|---|---|
| Điểm lỗi | PostgreSQL client của SaaS store, không phải OAuth SDK |
| Nguyên nhân | `TASKO_POSTGRES_URL` runtime chứa giá trị placeholder `1` thay vì connection string PostgreSQL |
| Hệ quả | pg client parse endpoint sai và cố DNS lookup hostname `base`; UI sau login có thể hiện thông báo callback lỗi do query canvas tiếp theo thất bại |
| Khắc phục | Cập nhật `TASKO_POSTGRES_URL` sang cùng PostgreSQL Docker development, rồi restart server |

## Bảo vệ bổ sung

OAuth callback hiện được tách thành handler dependency-injected để có thể kiểm thử mà không yêu cầu login thật. Validation giữ nonce cookie, state và redirect URI callback allowlist. Khi provider trả lỗi mạng như `ENOTFOUND`, handler ghi diagnostics phía server nhưng trả `502 OAuth provider unavailable` chung, không lộ hostname hay thông tin hạ tầng cho browser.

Test `server/oauth.callback.test.ts` bao phủ callback mock success (session cookie và 302), invalid state/redirect, và DNS failure mock sau state hợp lệ. Test `server/postgres.connection.test.ts` chạy `select 1` với `TASKO_POSTGRES_URL` để xác nhận endpoint PostgreSQL Docker được cấu hình có thể kết nối.

## Xác minh

Sau restart, endpoint `saas.plans` trả HTTP 200 thay vì lỗi DNS và full regression chạy thành công. Login Google end-to-end vẫn được giữ là bước kiểm chứng thủ công deferred theo yêu cầu người dùng, vì nó cần một phiên OAuth thật.
