# M5 SaaS Readiness Architecture

## Mục tiêu và ranh giới

M5 bổ sung các năng lực vận hành nhiều workspace trong **một codebase, một domain model và một lịch sử migration**. Core Work, Chat, CRM và Unified Workspace tiếp tục chỉ phụ thuộc `PlatformActor` tenant-scoped; provisioning, entitlement, quota, billing boundary và platform operations tồn tại trong module SaaS tách biệt. Điều này giữ profile `single_tenant` không bị phủ bởi điều kiện SaaS rải rác trong domain logic.

| Concern | Quyết định M5 | Ràng buộc an toàn |
| --- | --- | --- |
| Provisioning | Request idempotent tạo tenant, owner membership, worker service account và entitlement mặc định trong một transaction. | Tenant slug được server-normalize; browser không truyền tenant ID có thẩm quyền. |
| Lifecycle | `active` và `suspended` được kiểm tra khi resolve membership; reactivation chỉ có actor platform. | Mutation audit + outbox trong cùng transaction. |
| Plans & entitlements | Plan catalog, entitlement record và usage ledger tenant-aware; `SaaSService` là cổng check duy nhất. | Domain chỉ gọi policy guard tại feature boundary, không có `if (saas)` phân tán. |
| Quotas & abuse | Usage idempotent theo metric/key được enforce tại boundary Forms và Automation; provisioning, lifecycle, backup, billing, export và recovery probe dùng Redis rate control. Quota không thay thế security rate limit. | Không dùng counter browser; mọi decision gắn actor/tenant server-resolved và quota được đánh giá trước durable action đích. |
| Billing | Provider-neutral adapter trả checkout/customer-portal intent; một provider thật chỉ được wiring sau khi integration và secret được phê duyệt. | Không lưu secret, payment method, hoặc raw webhook payload trong audit/log. |
| Backup & restore | Portable manifest metadata, checksum và restore drill record; export manifest platform-admin được ghi S3/Wasabi qua storage adapter. M5 không giả định backup scheduler. | Restore drill kiểm tra tenant ownership, schema version và manifest checksum trước status `verified`; export chỉ nhận target tenant từ API platform-admin và không dùng actor tenant do browser gửi. |
| Platform admin | Actor platform được xác thực từ server owner subject hoặc danh sách platform-admin persisted. | Không suy ra từ role workspace; mọi cross-tenant read/write có audit riêng. |
| Observability | Snapshot metric từ source-of-truth store/outbox; recovery probe platform-admin đo pending outbox và search-index backlog trước/sau một worker pass giới hạn, đồng thời trả worker health. | Không log credentials, session cookie hoặc raw authorization header; probe không đọc payload nghiệp vụ qua UI và không cho workspace role xem aggregate. |

## Processing model

Provisioning, lifecycle, entitlement changes, backup requests và restore drill requests là **durable mutations**. Chúng ghi audit/outbox trong cùng transaction. M5 không thêm polling hay cron: backup schedule dành cho hosted operations sau này; hiện tại operator tạo backup manifest hoặc restore drill rõ ràng qua service/API.

> Quota là chính sách sản phẩm; rate limiting là biện pháp chống abuse. Cả hai đều cần thiết và phải được đánh giá phía server sau khi tenant/membership được resolve.

## Billing integration posture

Adapter exposes typed intent records (`checkout`, `customer_portal`, `webhook_event`) but returns an explicit `provider_not_configured` result when no provider has been enabled. Điều này cho phép plan/entitlement/usage lifecycle được kiểm chứng mà không tạo checkout giả, không hard-code Stripe và không cần lưu secrets trong repository. Khi bật provider thật, inbound webhook phải được verify signature trước khi event được chuyển thành entitlement mutation durable.

## Acceptance gates

M5 cần chứng minh provisioning không duplicate, suspension chặn tenant access, plan/quota được enforce server-side, platform actor không suy từ workspace role, backup manifest/restore drill verify được, và operational snapshot/outbox recovery không phá tenant isolation. OAuth callback debugging và populated authenticated preview đã được tách thành deferred follow-up theo yêu cầu người dùng, không phải một phần của M5 data model.

Acceptance bổ sung xác nhận quota Forms/Automation chặn target durable action, rate-control chặn provisioning flood trước tenant insert, export/recovery bị từ chối trước storage hoặc aggregate access khi caller không phải platform admin, và recovery pass giảm search-index backlog có thể quan sát được.

## Visual verification note

Initial unauthenticated preview of `/settings` and `/admin` preserved the existing Tasko shell and displayed a non-blocking loading state while the deployment-profile query resolved. After hydration in the configured `single_tenant` profile, `/settings` showed the explicit single-workspace explanation and `/admin` showed that platform administration was unavailable; neither rendered commercial controls, metrics, tenant records, nor lifecycle actions. SaaS metrics and platform controls are not synthesized for screenshots: they remain dependent on server-resolved membership and the independent platform-admin gate.
