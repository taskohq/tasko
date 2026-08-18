# Tasko Design Reference Notes

## Nền tảng trực quan

Tasko dùng **white-first workspace shell** với nền xám-lavender rất nhẹ, đường viền mảnh, shadow tối thiểu và accent indigo/violet để định vị tương tác đang chọn. Typography thiên về sans-serif hiện đại, title đậm vừa phải và metadata nhỏ, màu slate. Mọi khối dữ liệu ưu tiên bề mặt trắng, radius nhỏ đến vừa và nhịp spacing chặt để duy trì mật độ vận hành cao.

## App shell hai lớp

Thanh global header cao khoảng 60px gồm wordmark, command search trung tâm, workspace switcher, CTA Create indigo, notification/help và user identity. Bên dưới là shell ba lớp: **primary icon rail** rất hẹp cho Home/Inbox/Work/Chat/CRM/Docs/Automations/Admin; **module navigation rail** ngữ cảnh; content canvas; và một **right-side inspector** mở theo selection. Primary rail dùng icon line, badge đỏ cho unread và vùng active phủ lavender nhạt.

## Chat reference

Chat đặt channel title, breadcrumb account/deal, people avatars và actions ở page header. Ngay dưới đó là dải context cards nhỏ cho Account, Deal và Project, kế tiếp là tabs Messages/Files/Tasks/Deal/Project. Timeline tách message rõ bằng avatar, author, time, body, reaction chips và thread count. Task được tạo từ hội thoại hiện như card có viền violet, priority/due date/assignee và cross-module chips; composer bám đáy canvas. Right inspector là Thread, gồm replies, attachment, linked items và quick actions để tạo/link task.

## Work reference

Work dùng project title, health badge, description, collaborators và compact secondary navigation Overview/Board/Backlog/Timeline/Files. Board có control strip cho sprint/date, Filters, Group, Sort và CTA Create task. Mỗi status column hiển thị count, add action, card density cao và header category rõ. Work cards cần title, priority chip, assignee avatar, due date, company/channel relationship và comment count. Inspector task phải thể hiện status/priority, assignee/due date/project/sprint, linked Deal/Channel, subtask progress và activity timeline.

## CRM reference

CRM giữ primary rail nhưng module rail chuyển sang Leads, Companies, Contacts, Deals, Activities, Pipelines và saved views. Header Deal có total pipeline và weighted forecast, CTA Create deal. Filter shelf gồm pipeline, owner, close date và search. Pipeline board dùng mỗi stage như một column có stage dot, deal count và total currency; card cực gọn gồm account, solution/subtitle, amount, close date và owner. Deal inspector phải thể hiện stage, amount, probability bar, close date, account, contacts, next step, activity và Related Project/Channel/Tasks bằng link có icon loại thực thể.

## Operations Overview reference

Overview mở rộng module rail thành Today, My Tasks, Projects, Workload, Calendar, Performance, Team, Customers, Automation Health và custom views. Canvas bắt đầu bằng dashboard title/subtitle rồi dải five KPI cards có icon, primary metric, secondary note và sparkline. Vùng nội dung chia thành activity timeline, Today tabs (due work/meetings/follow-ups), cross-functional work graph và linked-object flow. Inspector entity phải dùng tabs Overview/Details/Timeline/Files, sau đó đưa account/deal details, relationship list và activity gần đây vào một luồng cuộn thống nhất.

## Quy ước implementation

Các module Tasko sẽ tái sử dụng bề mặt, rail, header, tab và inspector thống nhất thay vì render các shell riêng. Dữ liệu liên kết chỉ hiển thị khi lấy từ API tenant-scoped thật; không hardcode reviews, ratings hoặc testimonials. Mọi placeholder cho module chưa hoàn thành phải báo rõ trạng thái chưa hỗ trợ thay vì giả lập capability.
