# Spec Delta

## MODIFIED Requirements

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
