# Tasko Project-Management Functional Audit

_Cập nhật lần đầu: 2026-08-19. Phạm vi audit này đối chiếu canvas React, tRPC router, service/domain store, authorization, audit/outbox và coverage đang có. Trạng thái **Real** nghĩa là có đường đi end-to-end có thể kiểm thử; **Partial** nghĩa là chỉ một phần thao tác thực có mặt trong UI hoặc vận hành; **UI-only** nghĩa là không được xem là capability hoàn chỉnh nếu chưa có đường backend tương ứng._

## Tiêu chí đánh giá

| Mức | Điều kiện tối thiểu |
|---|---|
| **Real** | UI gọi read/write path thật; server resolve tenant/membership; authorization domain áp dụng; mutation durable có audit/outbox; hành vi có test hoặc verification phù hợp. |
| **Partial** | Domain/API có thật nhưng UI chưa mở được workflow thiết yếu, hoặc UI gọi được một phần nhưng thiếu recovery/coverage quan trọng. |
| **UI-only** | Canvas/control chưa gọi capability backend tương ứng hoặc dùng dữ liệu minh họa. Không được tính là feature hoàn chỉnh. |

## Ma trận capability hiện tại

| Nhóm | Capability | Evidence | Trạng thái | Khoảng trống / hành động |
|---|---|---|---|---|
| Work | Spaces, projects, Kanban/List, drag-drop & reorder | `work.spaces/projects/board`, `moveItem`; Work service/store, version check, audit/outbox, integration tests | **Real** | Tiếp tục kiểm tra planning UI trong remediation. |
| Work | Create/edit item, assignee, due date, estimate, comments | `createItem`, `updateItem`, `createComment`, directory assignee tenant-safe; inspector/composer/bulk UI | **Real** | Có optimistic create, partial-failure recovery và regression. |
| Work | Filters, groups, bulk status move | UI Work gọi `moveItem` tenant-safe, orchestration có unit tests | **Real** | Mutations tuần tự để giữ audit/outbox từng item. |
| Work | Dependencies | `addDependency`/`removeDependency`/`itemDetails.dependencies`; Work inspector tạo, xem và gỡ liên kết; cycle guard, authorization, audit/outbox và Work regression | **Real** | Gỡ liên kết phản hồi optimistic và rollback cache nếu mutation lỗi; server vẫn là nguồn dữ liệu cuối. |
| Work | Sprints | `createSprint`, `addItemsToSprint`, `completeSprint(nextSprintId)`; planner Sprint trên canvas Work, disposition backlog/carry-over, Work integration và PostgreSQL Docker test | **Real** | Carry-over di chuyển sprint item và `work_items.sprint_id` cùng transaction, sau đó audit/outbox. |
| Work | Custom fields, saved views, calendar/timeline | Router/service có custom-field và saved-view write paths; calendar/timeline renderer đã có | **Partial** | Cần audit một workflow cấu hình/áp dụng custom field và saved view từ UI trước khi coi toàn bộ nhóm là Real. |
| Chat | Channel, message, attachment, thread, reaction, saved item, presence/typing | Chat service/store, router mutations/queries, canvas Chat, read-state guard và PostgreSQL read cursor regression | **Real** | `chat.markRead` JSONB UUID coercion đã được sửa; full regression và Docker tests đã pass. |
| Chat | Search và link Message–Work | `chat.search`, `chat.linkWorkItem`, `workspace.search(kind=work)`; inspector UI, audit/outbox test | **Real** | Các link được refresh theo server-authoritative state. |
| CRM | Pipeline board, create lead, move deal | `crm.overview/pipelines/board/createLead/moveDeal`; CRM UI và service/store | **Real** cho workflow cơ bản | Cần audit detail, company/contact, conversion, handoff, follow-up và entity link. |
| CRM | Sales-to-delivery handoff | `requestDealHandoff`, `createFollowUp`, `linkEntity`, conversion paths có trong router/service | **Partial** | UI cần chứng minh được full flow và trạng thái worker/outbox. |
| Workspace | Search, inbox, documents | Workspace router/service + Workspace canvas mutations/queries | **Real** cho thao tác hiển thị | Cần kiểm tra edit document, entity links và permission filtering trên từng surface. |
| Workspace | Forms & automations | API create/activate/submit form và create rule/executions có thật; canvas tạo/activate cơ bản | **Partial** | Thiếu đường cấu hình đầy đủ, public/run experience và observability UI cần audit. |
| Imports | Create, preview, stage, map, queue, execute batch | Ecosystem import service/router, Imports canvas | **Real** cho workflow staged | Cần kiểm tra upload/source ingestion có thật, thay vì chỉ input record thủ công. |
| Ecosystem | Token, webhook, connection registry | API token/webhook/connect/list có thật; Ecosystem canvas gọi mutations | **Partial** | `connect` hiện là registration boundary; cần không trình bày như OAuth sync provider nếu chưa có thực thi provider. |
| AI | Read/draft/proposal/confirm/execute | Permission-aware AI service, tool registry, proposal confirmation paths và UI | **Real** | Cần duy trì citations/audit/mutation authorization ở regression. |
| Administration | Tenant lifecycle, plan, export/backup probes | SaaS procedures/service; Admin/Settings mutations | **Partial** | Product-management không phụ thuộc trực tiếp; audit role boundary/external billing separately. |
| Auth | Email/password | Rate limited scrypt credential flow, tenant provisioning/session HTTP-only, tests | **Real** | Không phải PM feature nhưng là precondition. |
| Auth | Google OAuth end-to-end | Callback hardening và tests có; browser journey đã được người dùng yêu cầu hoãn | **Deferred** | Không tính là đã verified cho đến khi user cho phép browser login. |

## Phát hiện ưu tiên

| Ưu tiên | Phát hiện | Remediation |
|---|---|---|
| **P0 — Closed** | `chat.markRead` trả HTTP 500 trên PostgreSQL do UUID truyền vào toán tử JSONB cần text coercion. | Đã sửa store PostgreSQL, thêm Docker read cursor regression/audit-outbox coverage, và guard UI chỉ thử một lần trên một channel/sequence. |
| **P1 — Partially closed** | Work planning API (sprint, custom field, saved view, dependency) hiện không được chứng minh đầy đủ qua workflow UI. | Sprint và dependencies đã có workflow UI thật, domain regression và persistence proof; custom field/saved view vẫn là phần audit tiếp theo. |
| **P1** | CRM delivery handoff, Workspace forms/automation và Ecosystem connection cần phân biệt rõ execution thật với registration/UI. | Audit từng full flow và hoàn thiện/giới hạn phần chưa vận hành trước khi coi là production-ready. |

## Nguyên tắc remediation

1. Không thêm control chỉ để đầy UI. Mỗi control cần mapped tới procedure/service/store cụ thể.
2. Mọi mutation durable giữ centralized authorization, tenant resolution server-side, audit và transactional outbox.
3. Mỗi gap được đóng bằng regression ở domain layer; các lỗi UI flow quan trọng thêm test helper/component-level phù hợp.
4. Cập nhật ma trận này sau từng vòng remediation để trạng thái có thể truy vết.

## Bằng chứng verification vòng remediation

| Kiểm tra | Kết quả |
|---|---|
| Full regression | `pnpm test`: 18 test files pass, 80 tests pass; 5 PostgreSQL/storage suites được opt-in và skip theo cấu hình mặc định. |
| Production build | `pnpm build`: Vite client bundle và Express server bundle hoàn tất thành công. Cảnh báo chunk JavaScript lớn hơn 500 kB được giữ lại như một workstream hiệu năng riêng, không phải lỗi build. |
| PostgreSQL Docker | `TASKO_RUN_POSTGRES_INTEGRATION_TESTS=1 pnpm vitest run modules/work/work.postgres.integration.test.ts modules/chat/chat.postgres.integration.test.ts`: 2 files, 3 tests pass. |
| Work canvas desktop | Canvas tải ổn định theo app shell; inspector dependency đã nằm trên read/write path tRPC và được production build kiểm tra type/bundle. |
