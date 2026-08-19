# M7 AI/MCP Architecture

## Mục tiêu và ranh giới

M7 đưa AI vào Tasko như một lớp hỗ trợ vận hành **tuân theo cùng model tenant, membership và authorization** như mọi module khác. AI không có đường truy cập dữ liệu riêng, không nhận tenant từ browser, và không thể biến một lời nhắc thành durable write mà không có proposal cùng xác nhận rõ ràng.

| Thành phần | Trách nhiệm | Ràng buộc an toàn |
|---|---|---|
| `AIStore` | Lưu run, citation và tool proposal | Mọi mutation PostgreSQL ghi audit/outbox trong cùng transaction; RLS theo `tenant_id` |
| Context Resolver | Chuyển entity refs thành ngữ cảnh được phép đọc | Exact authorization cho từng entity và link liên quan; redaction giá trị/khóa nhạy cảm |
| Tool Registry | Định nghĩa allowlist và mức rủi ro | Không có raw SQL hoặc generic HTTP; mỗi tool có capability, idempotency và confirmation policy |
| AI service | Gọi LLM server-side, tạo citation và điều phối proposal | Prompt/context loại bỏ credentials; read/draft không tạo durable domain mutation |
| MCP beta | Bề mặt JSON-RPC cho token developer có scope | Xác thực `mcp:connect`, kiểm capability, rate-limit tenant/member và chỉ expose tool allowlist |

## Luồng thực thi

Read và draft bắt đầu bằng capability tương ứng (`ai.context.read` hoặc `ai.draft.create`). Service tạo `ai_run`, resolve context bằng quyền đọc hiện hữu, lưu context references làm backlinks rồi mới gọi model server-side. Run hoàn tất ghi model, usage và kết quả; lỗi được ghi thành failed run mà không để lộ secret vào output hoặc audit metadata.

Write tool không được gọi trực tiếp qua AI UI hay MCP. `proposeAction` tạo một run và `ai_tool_proposal` với preview, idempotency key, thời hạn 15 phút và trạng thái `proposed`. Người xác nhận cần capability `ai.action.confirm`; chỉ proposal còn hiệu lực ở trạng thái `confirmed` mới được Tool Registry chuyển tới service Work hoặc Chat chính thức. Domain service tiếp tục chịu trách nhiệm authorization, idempotency, audit và transactional outbox của bản thân mutation.

> **Nguyên tắc thực thi:** xác nhận và thực thi là hai thao tác độc lập. Tạo proposal hoặc xác nhận proposal không tự động gửi message hay tạo work item.

## AI Tool allowlist

| Tool | Risk | Hành vi | Capability |
|---|---|---|---|
| `context.read` | Read | Tự chạy sau authorization | `ai.context.read` |
| `work_item.draft` | Draft | Tự chạy; không tạo WorkItem | `ai.draft.create` |
| `document.draft` | Draft | Tự chạy; không persist document | `ai.draft.create` |
| `work_item.create` | Write | Chỉ tạo proposal rồi chờ xác nhận | `ai.action.propose` và `ai.action.confirm` |
| `chat.message.send` | Write | Chỉ tạo proposal rồi chờ xác nhận | `ai.action.propose` và `ai.action.confirm` |

## MCP beta

Endpoint `POST /api/mcp` chấp nhận JSON-RPC cho `initialize`, `tools/list` và `tools/call`. Nó xác thực token developer qua scope `mcp:connect`, resolve actor tenant-side, sau đó kiểm `mcp.connect`. Mỗi identity bị giới hạn 60 request/phút theo tenant/member qua Redis. Call vào write tool trả lại proposal; endpoint tuyệt đối không thực thi raw SQL, không gọi URL tùy ý, và không đưa secret vào tool context.

## Kiểm chứng M7

Regression `modules/ai/ai.integration.test.ts` xác minh proposal idempotency không tạo execution, redaction input nhạy cảm, negative authorization của guest ở confirmation, tenant isolation của proposal và token MCP scope. Toàn bộ suite dự án hiện chạy với `pnpm test`; PostgreSQL integration opt-in vẫn dùng `TASKO_RUN_POSTGRES_INTEGRATION_TESTS=1`.
