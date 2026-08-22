# Nghiên cứu UX chat tham chiếu từ Slack

## Phạm vi tham chiếu

Nghiên cứu này dùng tài liệu trợ giúp công khai của Slack để xác định các mô hình tương tác đáng áp dụng cho Tasko. Mục tiêu là nâng chất lượng cộng tác, không sao chép nhận diện, tài sản thương hiệu, hay nội dung giao diện của Slack.

| Mô hình Slack | Lý do có giá trị | Quyết định áp dụng cho Tasko |
|---|---|---|
| Channel sidebar có các khu vực ưu tiên | Giảm tải nhận thức và giúp định vị hội thoại nhanh | Tổ chức kênh theo **Ưu tiên**, **Kênh**, và **Tin nhắn trực tiếp**, với huy hiệu chưa đọc và nhắc tên. |
| Thread theo từng tin | Giữ luồng chính gọn, cung cấp ngữ cảnh khi trả lời | Duy trì panel thread bên phải; bổ sung điểm vào rõ ràng, số phản hồi và nút chia sẻ phản hồi trở lại kênh. |
| Emoji reactions | Cho phép xác nhận hay biểu đạt nhanh thay vì tạo thêm tin rời | Hiển thị reaction dưới dạng chip có đếm số lượng và trạng thái đã chọn; thêm menu phản ứng nhanh. |
| Mention trong composer | Chuyển thông tin cần hành động đến đúng người | Bổ sung bộ chọn thành viên sau ký tự `@`, đồng thời giữ `@channel` và `@here` theo kiểm soát quyền hiện có. |
| Search lấy hội thoại làm trung tâm | Giúp truy hồi quyết định trong lịch sử trao đổi | Mở thanh tìm kiếm trực quan, nêu cú pháp gợi ý và đưa người dùng tới đúng channel/thread từ kết quả. |
| Lưu tin để xử lý sau | Biến hội thoại thành hàng đợi công việc cá nhân | Kích hoạt chức năng lưu sẵn có qua menu tin, đồng thời cung cấp một lối vào **Đã lưu** trong điều hướng Chat. |
| Soạn tin giàu hành động | Đính kèm, emoji, định dạng nhẹ và phím tắt làm giảm ma sát gửi tin | Tái tạo composer dạng bề mặt có toolbar; hỗ trợ Enter để gửi, Shift+Enter xuống dòng, phím Escape đóng lớp nổi. |

## Nguyên tắc triển khai

Tasko đã có backend cho channel, thread, phản ứng, nhắc tên, tìm kiếm, saved messages, hiện diện, trạng thái gõ và tệp đính kèm. Đợt cải tổ ưu tiên đưa các khả năng này lên giao diện trước, đồng thời mở rộng API một cách tối thiểu khi cần dự báo phản ứng hoặc hỗ trợ hành động của từng tin.

Các thao tác nguy cơ cao như xóa, lưu trữ và quản lý thành viên sẽ tiếp tục yêu cầu xác nhận và chịu kiểm soát quyền ở máy chủ. Những phần không có backend đầy đủ sẽ thể hiện bằng thông báo rõ ràng thay vì mô phỏng dữ liệu hoặc tạo nội dung người dùng giả.

## Xác minh triển khai

Địa chỉ xem trước đã hiển thị thành công sau khi luồng log worker được điều chỉnh để không làm sai nhận diện cổng ứng dụng. Kiểm tra trực quan đã xác nhận trạng thái Chat chưa đăng nhập, cấu trúc vỏ ứng dụng và màn hình truy cập mới. Do phiên xem trước không có phiên chat đã xác thực, các luồng channel, thread, composer, phản ứng và hàng đợi được xác minh thêm bằng kiểm tra kiểu TypeScript và kiểm thử tích hợp có dữ liệu trong bộ nhớ, thay vì tạo nội dung cộng tác giả.

PostgreSQL 16 đã được cấp bằng Docker theo `TASKO_POSTGRES_URL`, và toàn bộ migration của Tasko — gồm `0019_chat_pins.sql` — đã áp dụng thành công. Bảng `pinned_messages` cùng năm cột dự kiến đã được kiểm tra trực tiếp trong container.

Kiểm tra TypeScript hoàn tất không lỗi. Toàn bộ Vitest đạt **113 kiểm thử** và **11 kiểm thử được bỏ qua**; kiểm thử chuyên biệt cho chat gồm **11 kiểm thử** đều đạt, bao gồm projection phản ứng emoji, tác giả tin nhắn và ghim/bỏ ghim channel. Kiểm tra trực quan desktop và mobile cũng xác nhận giao diện Chat hiển thị ổn định với sidebar hội thoại duy nhất.

## Tài liệu tham khảo

[1] [Slack, *Use threads to organize discussions*](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions)

[2] [Slack, *Use emoji and reactions*](https://slack.com/help/articles/202931348-Use-emoji-and-reactions)

[3] [Slack, *Search in Slack*](https://slack.com/help/articles/202528808-Search-in-Slack)

[4] [Slack, *Slack keyboard shortcuts*](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)

[5] [Slack, *Use mentions in Slack*](https://slack.com/help/articles/205240127-Use-mentions-in-Slack)

[6] [Slack, *Save messages and files for later*](https://slack.com/help/articles/360042650274-Save-messages-and-files-for-later)

[7] [Slack, *Send and read messages*](https://slack.com/help/articles/201457107-Send-and-read-messages)

[8] [Slack, *Organize your sidebar with custom sections*](https://slack.com/help/articles/360043207674-Organize-your-sidebar-with-custom-sections)
