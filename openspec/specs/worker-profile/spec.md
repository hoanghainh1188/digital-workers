# worker-profile Specification

## Purpose
Hồ sơ của digital worker như hồ sơ một nhân viên: tên, mô tả công việc, phòng ban, người quản lý, ngân sách tháng, giọng văn và người được giao thử; ai xem và sửa được hồ sơ nào; sơ đồ nhân sự số của công ty.

## Requirements

### Requirement: Tuyển worker từ mẫu hoặc hồ sơ trống
Người có quyền tạo worker SHALL tạo được worker từ một trong 3 mẫu có sẵn (Trợ lý báo giá, Trợ lý CSKH nội bộ, Trợ lý tổng hợp báo cáo) hoặc từ hồ sơ trống. Worker mới MUST ở trạng thái Nháp và có `AuditEvent` tạo worker ghi mẫu đã dùng.

#### Scenario: Tạo từ mẫu
- **WHEN** Trưởng phòng Kinh doanh chọn mẫu "Trợ lý báo giá" và bấm "Tạo bản nháp"
- **THEN** worker mới ở trạng thái Nháp thuộc phòng Kinh doanh, mô tả công việc và giọng văn lấy từ mẫu, và có `AuditEvent` tạo worker kèm id mẫu

#### Scenario: Tạo từ hồ sơ trống
- **WHEN** Admin chọn "Hồ sơ trống", nhập tên "Bảo · Hoá đơn" và chọn phòng Kế toán
- **THEN** worker mới ở trạng thái Nháp với mô tả công việc trống

#### Scenario: Nhân viên không tuyển được
- **WHEN** Nhân viên gọi API tạo worker
- **THEN** API trả 403, không có worker nào được tạo và có `AuditEvent` truy cập bị từ chối

#### Scenario: Trưởng phòng tuyển cho phòng khác
- **WHEN** Trưởng phòng Kinh doanh gọi API tạo worker cho phòng Kế toán
- **THEN** API trả 403 và không có worker nào được tạo

#### Scenario: Phòng ban công ty khác
- **WHEN** Admin công ty A tạo worker với id phòng ban của công ty B
- **THEN** API trả 404 và không có worker nào được tạo

### Requirement: Trường hồ sơ worker
Hồ sơ worker SHALL gồm: tên hiển thị (1–60 ký tự), ảnh đại diện sinh từ chữ cái đầu và một màu trong bảng màu cố định, mô tả công việc (tối đa 4.000 ký tự), phòng ban (bắt buộc, phòng chưa lưu trữ), người quản lý, ngân sách tháng và giọng văn (một trong "Lịch sự, ngắn gọn", "Thân thiện", "Trang trọng", hoặc tự viết tối đa 500 ký tự). Dữ liệu sai MUST bị từ chối kèm lỗi theo từng trường.

#### Scenario: Lưu hồ sơ hợp lệ
- **WHEN** Trưởng phòng sửa mô tả công việc và chọn giọng văn "Thân thiện" rồi bấm "Lưu hồ sơ"
- **THEN** hồ sơ được lưu và có `AuditEvent` sửa hồ sơ ghi tên các trường đã đổi, không ghi nội dung

#### Scenario: Mô tả quá dài
- **WHEN** người dùng lưu mô tả công việc 4.001 ký tự
- **THEN** API trả 400 với lỗi ở trường mô tả công việc và hồ sơ giữ nguyên

#### Scenario: Phòng ban đã lưu trữ
- **WHEN** Admin tạo worker vào một phòng đã lưu trữ
- **THEN** API trả 400 và không có worker nào được tạo

### Requirement: Tên worker duy nhất trong công ty
Tên hiển thị của worker SHALL duy nhất trong các worker chưa nghỉ việc của cùng công ty, so sánh không phân biệt hoa thường và bỏ khoảng trắng đầu cuối. Worker đã nghỉ việc không giữ tên.

#### Scenario: Trùng tên worker đang làm
- **WHEN** Admin đặt tên "minh · báo giá" trong khi đã có worker Chính thức tên "Minh · Báo giá"
- **THEN** API trả 409 với lỗi trùng tên và hồ sơ không đổi

#### Scenario: Dùng lại tên của worker đã nghỉ việc
- **WHEN** Admin tạo worker tên "Quang · Tin nhắn Tết" sau khi worker cùng tên đã nghỉ việc
- **THEN** worker mới được tạo

#### Scenario: Trùng tên ở công ty khác
- **WHEN** công ty B đã có worker "Minh · Báo giá" và Admin công ty A tạo worker cùng tên
- **THEN** worker của công ty A được tạo

### Requirement: Ngân sách tháng của worker
Ngân sách tháng SHALL là số nguyên VNĐ từ 0 đến 100.000.000. Worker mới nhận mặc định 300.000đ. Trưởng phòng chỉ đặt được ngân sách tới 2.000.000đ và không sửa được ngân sách của worker đang lớn hơn 2.000.000đ; Owner / Admin đặt được tới mức tối đa.

#### Scenario: Mặc định khi tạo
- **WHEN** Trưởng phòng tạo worker từ mẫu
- **THEN** ngân sách tháng của worker là 300.000đ

#### Scenario: Trưởng phòng vượt trần
- **WHEN** Trưởng phòng đặt ngân sách 2.500.000đ cho worker phòng mình
- **THEN** API trả 403 với lỗi vượt trần ngân sách của Trưởng phòng và ngân sách giữ nguyên

#### Scenario: Owner đặt cao hơn trần
- **WHEN** Owner đặt ngân sách 3.000.000đ cho một worker
- **THEN** ngân sách được lưu là 3.000.000đ

#### Scenario: Trưởng phòng sửa worker có ngân sách cao
- **WHEN** worker có ngân sách 3.000.000đ do Owner đặt và Trưởng phòng gửi ngân sách 1.000.000đ
- **THEN** API trả 403 và ngân sách giữ nguyên; các trường khác Trưởng phòng vẫn sửa được

#### Scenario: Số tiền không phải số nguyên
- **WHEN** người dùng gửi ngân sách 150000.5
- **THEN** API trả 400 với lỗi ở trường ngân sách

### Requirement: Người quản lý worker
Người quản lý SHALL là một thành viên đang hoạt động thuộc phòng của worker, hoặc một Owner / Admin đang hoạt động. Khi tạo, người quản lý mặc định là trưởng phòng; phòng chưa có trưởng phòng thì là người tạo. Hồ sơ được phép không có người quản lý.

#### Scenario: Chọn nhân viên trong phòng
- **WHEN** Trưởng phòng Kinh doanh chọn Hoàng Văn Việt (Nhân viên phòng Kinh doanh) làm người quản lý
- **THEN** hồ sơ lưu người quản lý là Hoàng Văn Việt

#### Scenario: Chọn người phòng khác
- **WHEN** Admin chọn một Nhân viên phòng Kế toán làm người quản lý cho worker phòng Kinh doanh
- **THEN** API trả 400 và người quản lý giữ nguyên

#### Scenario: Chọn thành viên công ty khác
- **WHEN** Admin công ty A chọn id thành viên công ty B làm người quản lý
- **THEN** API trả 404 và người quản lý giữ nguyên

### Requirement: Người quản lý rời phòng
Khi người quản lý của worker bị khoá, hoặc (với Trưởng phòng / Nhân viên) chuyển sang phòng khác, mọi worker chưa nghỉ việc họ đang quản lý SHALL chuyển người quản lý sang trưởng phòng hiện tại của phòng worker, hoặc để trống nếu phòng chưa có trưởng phòng, trong cùng thao tác, kèm `AuditEvent` cho từng worker.

#### Scenario: Khoá người quản lý
- **WHEN** Owner khoá Hoàng Văn Việt đang quản lý worker "An · Chăm sóc đại lý" của phòng Kinh doanh có trưởng phòng Nguyễn Thị Lan
- **THEN** người quản lý của "An · Chăm sóc đại lý" thành Nguyễn Thị Lan

#### Scenario: Phòng không còn trưởng phòng
- **WHEN** Admin chuyển trưởng phòng Kế toán sang phòng khác trong khi họ quản lý worker "Thu · Công nợ"
- **THEN** "Thu · Công nợ" không còn người quản lý và sơ đồ hiện "Chưa có người quản lý"

### Requirement: Người được giao thử
Hồ sơ SHALL có danh sách tối đa 10 người được giao thử: thành viên đang hoạt động của phòng worker hoặc Owner / Admin. Khi tạo, danh sách gồm người quản lý. Người bị khoá hoặc chuyển khỏi phòng MUST bị bỏ khỏi danh sách. Người sửa được danh sách là người đổi được trạng thái worker.

#### Scenario: Thêm người được giao thử
- **WHEN** Trưởng phòng thêm Hoàng Văn Việt vào danh sách người được giao thử của worker phòng mình
- **THEN** danh sách lưu Hoàng Văn Việt và có `AuditEvent` sửa người được giao thử

#### Scenario: Quá 10 người
- **WHEN** Admin gửi danh sách 11 người được giao thử
- **THEN** API trả 400 và danh sách giữ nguyên

#### Scenario: Nhân viên sửa danh sách
- **WHEN** Nhân viên gọi API sửa người được giao thử
- **THEN** API trả 403 và danh sách giữ nguyên

### Requirement: Phạm vi xem worker
Owner / Admin SHALL xem mọi worker của công ty. Trưởng phòng và Nhân viên xem hồ sơ worker của phòng mình; với phòng khác chỉ thấy số lượng worker theo phòng. Nhân viên chỉ xem, không có thao tác. Id worker công ty khác MUST trả "không tìm thấy".

#### Scenario: Trưởng phòng mở hồ sơ phòng khác
- **WHEN** Trưởng phòng Kinh doanh mở hồ sơ một worker phòng Kế toán
- **THEN** API trả 403 và có `AuditEvent` truy cập bị từ chối

#### Scenario: Trưởng phòng xem sơ đồ
- **WHEN** Trưởng phòng Kinh doanh mở sơ đồ nhân sự số
- **THEN** thấy thẻ các worker phòng Kinh doanh và chỉ số lượng worker của từng phòng khác, không có tên hay mô tả công việc

#### Scenario: Nhân viên xem hồ sơ phòng mình
- **WHEN** Nhân viên phòng Kinh doanh mở hồ sơ worker phòng Kinh doanh
- **THEN** thấy hồ sơ ở chế độ chỉ xem và API từ chối mọi thao tác sửa hay chuyển trạng thái với 403

#### Scenario: Worker công ty khác
- **WHEN** Owner công ty A gọi API với id worker công ty B
- **THEN** API trả 404 và có `AuditEvent` truy cập id không tìm thấy

### Requirement: Sửa hồ sơ worker
Owner / Admin SHALL sửa được hồ sơ mọi worker; Trưởng phòng sửa được hồ sơ worker phòng mình; Nhân viên không sửa được. Worker đã nghỉ việc MUST chỉ xem, không sửa được.

#### Scenario: Trưởng phòng sửa worker phòng khác
- **WHEN** Trưởng phòng Kinh doanh gửi sửa hồ sơ worker phòng Kế toán
- **THEN** API trả 403 và hồ sơ giữ nguyên

#### Scenario: Sửa worker đã nghỉ việc
- **WHEN** Owner gửi sửa mô tả công việc của worker đã nghỉ việc
- **THEN** API trả 409 với lỗi worker đã nghỉ việc và hồ sơ giữ nguyên

#### Scenario: Hai người cùng sửa
- **WHEN** hai người mở cùng hồ sơ, người thứ nhất lưu trước rồi người thứ hai lưu bản cũ của mình
- **THEN** API trả 409 với lỗi hồ sơ đã thay đổi và thay đổi của người thứ nhất giữ nguyên

### Requirement: Đổi phòng ban của worker
Chỉ Owner / Admin SHALL đổi được phòng ban của worker chưa nghỉ việc. Đổi phòng giữ nguyên trạng thái, đặt lại người quản lý là người được chọn trong phòng mới (mặc định trưởng phòng mới), bỏ người được giao thử không thuộc phòng mới, và có `AuditEvent`.

#### Scenario: Admin chuyển worker đang chính thức
- **WHEN** Admin chuyển worker Chính thức "Vy · CSKH nội bộ" sang phòng Kinh doanh
- **THEN** worker vẫn Chính thức, thuộc phòng Kinh doanh, người quản lý là trưởng phòng Kinh doanh và có `AuditEvent` đổi phòng ban

#### Scenario: Trưởng phòng đổi phòng
- **WHEN** Trưởng phòng gửi đổi phòng ban của worker phòng mình
- **THEN** API trả 403 và phòng ban giữ nguyên

### Requirement: Sơ đồ nhân sự số
Trang sơ đồ SHALL nhóm worker theo phòng ban, mỗi thẻ có tên, mô tả công việc ngắn, trạng thái, người quản lý và ngân sách tháng; có bộ đếm và bộ lọc theo trạng thái lưu trên URL. Worker đã nghỉ việc gom ở cuối trang, thu gọn mặc định.

#### Scenario: Lọc theo trạng thái
- **WHEN** Owner bấm bộ lọc "Thử việc"
- **THEN** URL có bộ lọc trạng thái và chỉ thẻ worker Thử việc được hiện, tải lại trang vẫn giữ bộ lọc

#### Scenario: Công ty chưa có worker
- **WHEN** Owner mở sơ đồ khi công ty chưa có worker nào
- **THEN** trang hiện lời mời "Tuyển nhân viên số đầu tiên" với 3 mẫu và lựa chọn hồ sơ trống
