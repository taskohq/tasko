# Visual verification — Jira rollout

## 2026-08-19

Đã rà soát các canvas Work, Chat và CRM trên khung nhìn di động 375 × 812. App shell chuyển sang header gọn, giữ logo, notification và navigation trigger hiển thị được. Các vùng thao tác chính duy trì border nhỏ, nền neutral và CTA xanh có tương phản rõ.

| Canvas | Kết quả quan sát | Ghi chú responsive |
| --- | --- | --- |
| Work | Đạt | Toolbar tự xuống dòng; board giữ cột có thể cuộn ngang, phù hợp kiểu board nhiều cột. |
| Chat | Đạt | Header ngữ cảnh, tabs và composer giữ được thứ bậc nội dung, composer luôn ở cuối màn hình. |
| CRM | Đạt | KPI, tabs và CTA co về một cột; pipeline tiếp tục dùng cuộn ngang thay vì ép nhỏ card. |

Không phát hiện lỗi TypeScript hoặc lỗi render trong đợt rà soát này.

## 2026-08-20 — OAuth tự động

Lần kiểm tra tự động mở thành công trình khởi tạo OAuth từ `/login` và cổng `manus.im/app-auth` với callback URL của preview. Trong browser sandbox, cổng xác thực chuyển về `about:blank` trước khi phát sinh request `/api/oauth/callback`; do đó không có cơ sở để tuyên bố đã hoàn tất callback end-to-end hoặc tạo Overview screenshot từ cookie callback. Đây không phải lỗi cookie first-party của preview: probe HTTPS `SameSite=None; Secure` đọc được trong browser.

| Hạng mục | Bằng chứng | Kết luận |
|---|---|---|
| Khởi tạo OAuth | URL `app-auth` nhận đúng `appId`, callback preview HTTPS và `state` browser-bound | Đạt. |
| Callback server-side | `pnpm vitest run server/oauth.callback.test.ts`: 5/5 pass, gồm nonce/redirect validation, user upsert, audit, session cookie và redirect | Đạt ở mức regression contract. |
| Callback browser sandbox | Không có dòng `/api/oauth/callback` trong access logs; browser về `about:blank` | Chưa thể xác minh end-to-end trong runtime này, được ghi rõ thay vì suy diễn thành công. |
| Session UI | `auth.me` không có cookie callback trong browser sandbox, vì callback chưa chạm app | Chưa có screenshot authenticated bằng cookie OAuth; không yêu cầu người dùng thao tác lại theo chỉ đạo. |
