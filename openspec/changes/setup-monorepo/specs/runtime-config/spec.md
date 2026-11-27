# Spec Delta: runtime-config

## Purpose

Quy định cách các tiến trình của platform (api, runner) nhận cấu hình từ biến môi trường và kiểm tra nó lúc khởi động, để lỗi cấu hình lộ ra ngay thay vì giữa lúc chạy, và bí mật không bao giờ bị in ra.

## ADDED Requirements

### Requirement: Kiểm tra cấu hình khi khởi động
Mỗi tiến trình SHALL đọc và kiểm tra toàn bộ biến môi trường nó cần trước khi nhận yêu cầu hay việc nào. Thiếu biến bắt buộc hoặc giá trị sai định dạng → tiến trình MUST dừng với mã thoát khác 0.

#### Scenario: Thiếu biến bắt buộc
- **KHI** khởi động `api` mà không có `DATABASE_URL`
- **THÌ** tiến trình dừng với mã thoát khác 0 trước khi mở cổng lắng nghe

#### Scenario: Giá trị sai định dạng
- **KHI** khởi động `api` với `PORT=abc`
- **THÌ** tiến trình dừng với mã thoát khác 0 và báo `PORT` không hợp lệ

#### Scenario: Cấu hình đủ và đúng
- **KHI** khởi động `api` hoặc `runner` với đủ biến bắt buộc, đúng định dạng
- **THÌ** tiến trình chạy bình thường và ghi log một dòng "đã khởi động"

### Requirement: Báo lỗi cấu hình gom một lần
Khi cấu hình sai, tiến trình SHALL báo trong một lần **tất cả** biến bị thiếu hoặc sai, mỗi biến kèm lý do ngắn, để người vận hành sửa một lượt.

#### Scenario: Nhiều biến sai cùng lúc
- **KHI** khởi động thiếu `DATABASE_URL` và có `PORT=abc`
- **THÌ** thông báo lỗi liệt kê cả `DATABASE_URL` (thiếu) và `PORT` (không hợp lệ)

### Requirement: Không in giá trị bí mật
Thông báo lỗi cấu hình và log khởi động MUST NOT chứa giá trị của biến nào; chỉ được nêu tên biến và lý do.

#### Scenario: Bí mật sai định dạng
- **KHI** `DATABASE_URL` có giá trị không phải URL PostgreSQL hợp lệ nhưng chứa mật khẩu
- **THÌ** thông báo lỗi nêu `DATABASE_URL` không hợp lệ và không chứa bất kỳ phần nào của giá trị đó

#### Scenario: Log khởi động
- **KHI** tiến trình khởi động thành công
- **THÌ** log không chứa giá trị của `DATABASE_URL` hay biến bí mật nào khác

### Requirement: Mỗi tiến trình chỉ đòi biến mình dùng
Mỗi tiến trình SHALL chỉ bắt buộc những biến nó thực sự dùng; biến của tính năng chưa có (vd. khoá mô hình, token bot) MUST NOT là điều kiện để khởi động.

#### Scenario: Chưa cấu hình khoá mô hình
- **KHI** khởi động `api` với `DATABASE_URL` hợp lệ và không có `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- **THÌ** tiến trình khởi động bình thường
