# Project TODO

- [x] Khảo sát kiến trúc, dữ liệu và giao diện chat hiện tại của Tasko.
- [x] Nghiên cứu tài liệu Slack về kênh, luồng thảo luận, phản ứng, nhắc tên, tìm kiếm và thao tác soạn tin.
- [x] Xác định các mô hình Slack phù hợp để áp dụng mà không sao chép thương hiệu hoặc nội dung độc quyền.
- [x] Thiết kế lại bố cục chat với thanh điều hướng không gian làm việc, danh sách kênh và vùng hội thoại giàu ngữ cảnh.
- [x] Tránh điều hướng Chat lồng nhau trong TaskoShell để sidebar hội thoại mới là ngữ cảnh duy nhất ở màn hình Chat.
- [x] Triển khai trải nghiệm luồng thảo luận, phản ứng emoji, nhắc tên, trả lời, ghim và tìm kiếm trong phạm vi chat hiện có.
- [x] Hoàn thiện trình soạn tin hỗ trợ phím tắt, đính kèm, định dạng nhẹ và phản hồi trạng thái.
- [x] Triển khai tính năng ghim tin nhắn hoặc channel đúng nghĩa, tách biệt với Saved/Later, gồm ghim, bỏ ghim và điểm hiển thị nội dung đã ghim.
- [x] Áp dụng migration PostgreSQL `0019_chat_pins.sql` khi dịch vụ `TASKO_POSTGRES_URL` khả dụng (sandbox hiện từ chối kết nối cục bộ).
- [x] Cấp PostgreSQL 16 cục bộ bằng Docker, dùng cổng và thông tin kết nối mà Tasko đang cấu hình.
- [x] Chạy toàn bộ migration PostgreSQL của Tasko, bao gồm `0019_chat_pins.sql`, trên container mới.
- [x] Xác minh kết nối PostgreSQL, kiểm thử ghim và bộ test toàn project sau khi container sẵn sàng.
- [x] Tạo các trạng thái trống, tải, lỗi và tương tác truy cập được bằng bàn phím.
- [x] Viết hoặc cập nhật kiểm thử Vitest cho logic chat được thay đổi.
- [x] Kiểm tra giao diện desktop và mobile, rà soát log; luồng có xác thực và Postgres sẽ xác minh lại sau khi dữ liệu khả dụng.
- [x] Bổ sung error states hiển thị cho truy vấn chat chính, gồm nút thử lại khi dữ liệu không tải được.
