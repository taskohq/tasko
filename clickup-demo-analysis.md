# ClickUp demo reference — Kanban task creation

Nguồn tham chiếu là tệp người dùng cung cấp tại `/home/ubuntu/projects/tasko-ecbef739/tasko---clickup-clone.zip`, đặc biệt là `components/BoardView.tsx` và `components/TaskDetail.tsx`.

Demo sử dụng điểm tạo task ở header cột và cuối cột. Ngữ cảnh cột được giữ khi tạo, sau đó task được mở ngay trong detail panel để người dùng hoàn thiện metadata bằng controls ngắn gọn như priority, assignee, due date và description. Các hành vi bàn phím quan trọng gồm focus rõ ràng, `Escape` để đóng/hủy, và trạng thái thao tác rõ ràng.

Tasko áp dụng cùng nguyên tắc nhưng không tạo work item rỗng: composer trong cột yêu cầu title, cho phép bổ sung description, priority, assignee tenant-scoped, due date và estimate trước khi tạo. Khi server tạo thành công, Tasko dùng move server-authoritative để đưa item vào cột đích, làm mới board và mở inspector của item mới. Toàn bộ persistence vẫn đi qua contract Work hiện có, authorization tập trung, history/audit và transactional outbox.
