# departments Specification

## Purpose
Cho công ty chia người dùng (và sau này nhân viên số) theo phòng ban, mỗi phòng có tối đa một trưởng phòng, để quyền "phòng mình" của Trưởng phòng có ý nghĩa.

## Requirements

### Requirement: Tạo phòng ban
Owner và Admin SHALL tạo được phòng ban với tên (bắt buộc), mô tả và trưởng phòng (không bắt buộc). Tên MUST không trùng (không phân biệt hoa thường) với phòng ban chưa lưu trữ của cùng công ty. Mỗi lần tạo có `AuditEvent`.

#### Scenario: Admin tạo phòng ban
- **WHEN** Admin tạo phòng ban "Kho vận" với mô tả "Nhập hàng, xuất kho"
- **THEN** phòng ban được tạo trong công ty của Admin và có `AuditEvent` tạo phòng ban

#### Scenario: Tên trùng
- **WHEN** Owner tạo phòng ban "kinh doanh" khi công ty đã có phòng "Kinh doanh" chưa lưu trữ
- **THEN** hệ thống từ chối và báo tên phòng ban đã có

#### Scenario: Trưởng phòng và Nhân viên không tạo được
- **WHEN** Trưởng phòng hoặc Nhân viên gửi trực tiếp yêu cầu tạo phòng ban
- **THEN** API trả 403, không có phòng ban mới và có `AuditEvent` truy cập bị từ chối

### Requirement: Sửa phòng ban
Owner và Admin SHALL đổi được tên và mô tả của phòng ban chưa lưu trữ, theo cùng luật tên không trùng. Mỗi lần sửa có `AuditEvent` ghi tên trường đã đổi.

#### Scenario: Đổi tên phòng ban
- **WHEN** Admin đổi tên phòng "CSKH" thành "Chăm sóc khách hàng"
- **THEN** tên mới được lưu và có `AuditEvent` sửa phòng ban với trường tên

#### Scenario: Sửa phòng ban công ty khác
- **WHEN** Admin công ty A gửi yêu cầu sửa phòng ban bằng id một phòng ban của công ty B
- **THEN** API trả 404, phòng ban của công ty B giữ nguyên và công ty A có `AuditEvent` truy cập không tìm thấy

### Requirement: Một trưởng phòng mỗi phòng
Mỗi phòng ban SHALL có tối đa một trưởng phòng, là thành viên vai trò Trưởng phòng thuộc phòng đó. Chỉ thành viên đang hoạt động có vai trò Trưởng phòng hoặc Nhân viên MUST được chọn làm trưởng phòng.

#### Scenario: Chọn trưởng phòng là Owner
- **WHEN** Admin chọn một Owner làm trưởng phòng
- **THEN** hệ thống từ chối và phòng ban giữ nguyên

#### Scenario: Bỏ trưởng phòng
- **WHEN** Admin bỏ trưởng phòng của phòng "Kế toán"
- **THEN** phòng không còn trưởng phòng và người đó trở thành Nhân viên của phòng "Kế toán"

### Requirement: Chọn Nhân viên làm trưởng phòng
Khi Owner hoặc Admin chọn một Nhân viên làm trưởng phòng, hệ thống SHALL đổi vai trò người đó sang Trưởng phòng và chuyển người đó vào phòng này trong cùng một thao tác. Trưởng phòng cũ (nếu có) MUST trở thành Nhân viên của phòng. Giao diện MUST báo trước khi lưu.

#### Scenario: Nhân viên phòng khác thành trưởng phòng
- **WHEN** Admin chọn Nhân viên "Võ Thành Tâm" của phòng "Kinh doanh" làm trưởng phòng "Kho vận"
- **THEN** Tâm có vai trò Trưởng phòng, thuộc phòng "Kho vận", và có `AuditEvent` đổi vai trò và chuyển phòng

#### Scenario: Thay trưởng phòng
- **WHEN** Owner chọn Nhân viên "Bùi Ngọc" làm trưởng phòng "Kinh doanh" đang do "Nguyễn Thị Lan" làm trưởng phòng
- **THEN** Ngọc là Trưởng phòng "Kinh doanh" và Lan trở thành Nhân viên của phòng "Kinh doanh"

#### Scenario: Giao diện báo trước
- **WHEN** Admin chọn một Nhân viên trong ô trưởng phòng trên form phòng ban
- **THEN** form hiện thông báo người đó sẽ đổi vai trò sang Trưởng phòng và chuyển vào phòng này, trước khi bấm lưu

### Requirement: Lưu trữ thay cho xoá
Phòng ban SHALL không bị xoá mà được lưu trữ: ẩn khỏi danh sách và ô chọn phòng, giữ nguyên lịch sử. Chỉ lưu trữ được phòng không còn thành viên nào (kể cả người đã khoá), không còn lời mời đang chờ vào phòng đó và không còn worker nào chưa nghỉ việc. Mỗi lần lưu trữ có `AuditEvent`.

#### Scenario: Lưu trữ phòng trống
- **WHEN** Admin lưu trữ phòng "Kho vận" không còn ai
- **THEN** phòng không còn trong danh sách phòng ban, dữ liệu vẫn còn và có `AuditEvent` lưu trữ phòng ban

#### Scenario: Phòng còn người
- **WHEN** Owner lưu trữ phòng "Kinh doanh" còn 8 người
- **THEN** hệ thống từ chối, báo số người còn trong phòng và phòng giữ nguyên

#### Scenario: Tạo lại tên đã lưu trữ
- **WHEN** Admin tạo phòng "Kho vận" sau khi phòng cùng tên đã được lưu trữ
- **THEN** phòng mới được tạo

#### Scenario: Phòng còn worker
- **WHEN** Admin lưu trữ phòng "Kho vận" không còn người nhưng còn một worker Tạm nghỉ
- **THEN** hệ thống từ chối, báo số worker chưa nghỉ việc còn trong phòng và phòng giữ nguyên

#### Scenario: Phòng chỉ còn worker đã nghỉ việc
- **WHEN** Admin lưu trữ phòng "Kho vận" không còn người và chỉ có worker đã nghỉ việc
- **THEN** phòng được lưu trữ và worker đã nghỉ việc vẫn tra cứu được với tên phòng cũ

### Requirement: Xem danh sách phòng ban
Mọi thành viên đang hoạt động SHALL xem được danh sách phòng ban chưa lưu trữ của công ty mình, gồm tên, mô tả, trưởng phòng và số người. Danh sách MUST chỉ có phòng ban của công ty người xem.

#### Scenario: Nhân viên xem phòng ban
- **WHEN** Nhân viên mở danh sách phòng ban
- **THEN** người đó thấy các phòng ban của công ty mình nhưng không có nút thêm, sửa hay lưu trữ

#### Scenario: Không thấy phòng ban công ty khác
- **WHEN** Owner công ty A xem danh sách phòng ban
- **THEN** danh sách không có phòng ban nào của công ty B

#### Scenario: Số người chưa có phòng
- **WHEN** Owner xem trang Phòng ban khi có 2 người chưa thuộc phòng nào
- **THEN** trang hiện "2 người chưa có phòng ban" kèm link tới trang Người dùng đã lọc sẵn

### Requirement: Gợi ý phòng ban cho công ty mới
Khi công ty chưa có phòng ban nào, trang Phòng ban SHALL gợi ý 4 phòng ban phổ biến (Kinh doanh, Kế toán, Chăm sóc khách hàng, Hành chính – Nhân sự); Owner hoặc Admin bấm một gợi ý là tạo phòng đó.

#### Scenario: Bấm gợi ý
- **WHEN** Owner của công ty mới bấm gợi ý "Kế toán"
- **THEN** phòng "Kế toán" được tạo và hiện trong danh sách
