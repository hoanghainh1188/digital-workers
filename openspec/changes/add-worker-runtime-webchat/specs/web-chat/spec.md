# Spec Delta

## Purpose

Kênh web chat trong web quản lý: người có quyền giao việc trò chuyện với worker, gửi việc và nhận câu trả lời gần như tức thời. Đây là kênh duy nhất của worker Thử việc (FR-02-03).

## ADDED Requirements

### Requirement: Ai được trò chuyện với worker Thử việc
Worker Thử việc SHALL chỉ nhận tin web chat từ người có tên trong danh sách người được giao thử của worker, kể cả Owner và Admin. Người khác MUST bị từ chối với 403 và không có `Task`.

#### Scenario: Người được giao thử nhắn
- **WHEN** Hoàng Văn Việt có tên trong danh sách người được giao thử nhắn worker Thử việc
- **THEN** tin được nhận và có `Task` mới

#### Scenario: Thiếu quyền trò chuyện với worker Thử việc
- **WHEN** Nhân viên cùng phòng không có tên trong danh sách gửi tin cho worker Thử việc
- **THEN** API trả 403, không có `Task` và có `AuditEvent` truy cập bị từ chối

#### Scenario: Owner không có tên trong danh sách
- **WHEN** Owner chưa có tên trong danh sách người được giao thử gửi tin cho worker Thử việc
- **THEN** API trả 403 và màn hình gợi ý thêm mình vào danh sách người được giao thử

### Requirement: Ai được trò chuyện với worker Chính thức
Worker Chính thức SHALL nhận tin web chat từ Owner, Admin, Trưởng phòng của phòng worker và Nhân viên có tên trong danh sách người được giao việc của worker. Người khác MUST bị từ chối với 403.

#### Scenario: Trưởng phòng phòng mình
- **WHEN** Trưởng phòng Kinh doanh nhắn worker Chính thức của phòng Kinh doanh
- **THEN** tin được nhận và có `Task` mới

#### Scenario: Trưởng phòng phòng khác
- **WHEN** Trưởng phòng Kinh doanh gửi tin cho worker Chính thức của phòng Kế toán
- **THEN** API trả 403 và không có `Task`

#### Scenario: Nhân viên không được gán
- **WHEN** Nhân viên phòng Kinh doanh không có tên trong danh sách gửi tin cho worker Chính thức của phòng
- **THEN** API trả 403 và không có `Task`

#### Scenario: Worker công ty khác
- **WHEN** Owner công ty A mở web chat với id một worker của công ty B
- **THEN** API trả 404 như worker không tồn tại và có `AuditEvent` truy cập ở công ty A

### Requirement: Không trò chuyện với worker Nháp
Worker Nháp SHALL không có web chat; mở hoặc gửi tin MUST trả 403 kèm lỗi "worker chưa bắt đầu thử việc".

#### Scenario: Gửi tin cho worker Nháp
- **WHEN** Trưởng phòng gửi tin cho worker Nháp của phòng mình
- **THEN** API trả 403 với lỗi worker chưa bắt đầu thử việc và không có `Task`

### Requirement: Cuộc trò chuyện riêng của mỗi người
Mỗi người SHALL có một cuộc trò chuyện đang mở với mỗi worker; nội dung chỉ người đó đọc được. Người khác trong công ty, kể cả Owner, MUST nhận 404 khi mở cuộc trò chuyện của người khác.

#### Scenario: Mở lại web chat
- **WHEN** Nhân viên mở lại web chat với worker đã trò chuyện hôm qua
- **THEN** thấy các tin cũ của cuộc trò chuyện đang mở theo thứ tự thời gian

#### Scenario: Đọc cuộc trò chuyện của người khác
- **WHEN** Owner gọi API đọc tin của cuộc trò chuyện giữa một Nhân viên và worker
- **THEN** API trả 404 và có `AuditEvent` truy cập

#### Scenario: Cuộc trò chuyện của công ty khác
- **WHEN** người dùng công ty A gọi API với id một cuộc trò chuyện của công ty B
- **THEN** API trả 404 như không tồn tại

### Requirement: Bắt đầu cuộc trò chuyện mới
Người dùng SHALL bắt đầu được cuộc trò chuyện mới với worker; cuộc cũ đóng lại và worker không còn thấy lịch sử cũ khi làm việc mới. Mỗi `Task` MUST chỉ đưa cho mô hình tối đa 30 tin gần nhất của cuộc trò chuyện đang mở.

#### Scenario: Cuộc trò chuyện mới
- **WHEN** người dùng bấm "Cuộc trò chuyện mới" rồi gửi một tin
- **THEN** `Task` mới không mang tin nào của cuộc trò chuyện cũ tới mô hình

#### Scenario: Cuộc trò chuyện dài
- **WHEN** cuộc trò chuyện đang mở có 80 tin và người dùng gửi tin mới
- **THEN** mô hình nhận 30 tin gần nhất cùng tin mới, không nhận tin cũ hơn

### Requirement: Gửi tin
Người được trò chuyện SHALL gửi được tin văn bản 1–4.000 ký tự. Tin rỗng hoặc dài hơn MUST trả 400. Mỗi người MUST bị giới hạn 20 tin mỗi phút; quá thì trả 429 và tin không được lưu.

#### Scenario: Tin quá dài
- **WHEN** người dùng gửi tin 4.001 ký tự
- **THEN** API trả 400 và không có tin hay `Task` mới

#### Scenario: Gửi quá nhanh
- **WHEN** một người gửi tin thứ 21 trong cùng một phút
- **THEN** API trả 429 và tin đó không được lưu

### Requirement: Nhận câu trả lời gần như tức thời
Trang web chat SHALL nhận tin của worker, trạng thái "đang làm…" và câu báo của hệ thống mà không cần tải lại trang. Mất kết nối rồi nối lại MUST tải bù đủ các tin đã có trong lúc mất.

#### Scenario: Câu trả lời hiện ra
- **WHEN** worker làm xong `Task` trong lúc người dùng đang mở web chat
- **THEN** câu trả lời hiện trong cuộc trò chuyện mà người dùng không phải tải lại trang

#### Scenario: Mất mạng giữa chừng
- **WHEN** người dùng mất mạng 1 phút, trong lúc đó worker trả lời, rồi có mạng lại
- **THEN** câu trả lời hiện ra đúng một lần, đúng thứ tự

#### Scenario: Kết nối của người không có quyền
- **WHEN** một người mở kết nối thời gian thực rồi đăng ký theo dõi cuộc trò chuyện không phải của mình
- **THEN** đăng ký bị từ chối và người đó không nhận được tin nào của cuộc trò chuyện đó

#### Scenario: Bị khoá khi đang mở web chat
- **WHEN** người dùng bị khoá trong lúc đang mở web chat
- **THEN** trong vòng 60 giây kết nối thời gian thực bị đóng và người đó không nhận thêm tin nào

### Requirement: Câu trả lời cố định khi worker không nhận việc
Khi worker không nhận việc (tạm nghỉ, nghỉ việc, hết credit, hết ngân sách), web chat SHALL lưu tin của người dùng và hiện ngay câu báo cố định của hệ thống, phân biệt rõ với câu trả lời của worker. Câu báo MUST NOT tốn credit.

#### Scenario: Nhắn worker Tạm nghỉ
- **WHEN** người được giao việc nhắn worker Tạm nghỉ trên web chat
- **THEN** tin được lưu, ngay sau đó hiện câu báo "… đang tạm nghỉ, chưa nhận việc mới." kiểu thông báo hệ thống, không có `CostEntry` mới

### Requirement: Báo việc bị dừng hoặc lỗi
Khi `Task` Đã dừng hoặc Lỗi, web chat SHALL hiện câu báo nói rõ lý do (vượt số bước, hết thời gian, vượt chi phí, hết credit, gián đoạn, lỗi chung) bằng tiếng Việt, không lộ chi tiết kỹ thuật.

#### Scenario: Việc vượt giới hạn
- **WHEN** một `Task` dừng vì vượt số bước
- **THEN** web chat hiện "Việc này cần nhiều bước hơn giới hạn nên đã dừng. Hãy chia nhỏ yêu cầu."

### Requirement: Mở web chat từ hồ sơ worker
Hồ sơ worker SHALL có nút "Trò chuyện" khi người xem được trò chuyện với worker đó; trang web chat liệt kê các worker người dùng được trò chuyện. Chuỗi hiển thị MUST là tiếng Việt từ file i18n.

#### Scenario: Nút trò chuyện
- **WHEN** người được giao thử mở hồ sơ worker Thử việc
- **THEN** hồ sơ có nút "Trò chuyện" mở web chat với worker đó

#### Scenario: Không có quyền thì không có nút
- **WHEN** Nhân viên cùng phòng không có tên trong danh sách mở hồ sơ worker Thử việc
- **THEN** hồ sơ không có nút "Trò chuyện"
