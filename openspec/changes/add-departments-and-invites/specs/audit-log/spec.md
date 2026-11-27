## MODIFIED Requirements

### Requirement: Ghi nhật ký hành động
Hệ thống SHALL ghi một `AuditEvent` cho mỗi: tạo công ty, đổi thông tin công ty, đăng nhập thành công, truy cập bị từ chối (403), truy cập id không tìm thấy (404), tạo / sửa / lưu trữ phòng ban, tạo / gửi lại / huỷ / nhận lời mời, đổi vai trò, chuyển phòng ban, khoá / mở khoá tài khoản và đặt lại mật khẩu. Mỗi sự kiện MUST có công ty, người thực hiện, loại hành động, đối tượng và thời điểm.

#### Scenario: Ghi khi đổi tên công ty
- **WHEN** Admin đổi tên công ty
- **THEN** có một `AuditEvent` với công ty, người thực hiện là Admin đó, loại đổi thông tin công ty, và thời điểm

#### Scenario: Nhật ký thuộc công ty
- **WHEN** người dùng công ty A làm một hành động được ghi nhật ký
- **THEN** sự kiện thuộc công ty A và người công ty B không đọc được sự kiện đó

#### Scenario: Ghi khi khoá tài khoản
- **WHEN** Owner khoá một thành viên
- **THEN** có một `AuditEvent` với công ty, người thực hiện là Owner đó, loại khoá tài khoản, đối tượng là thành viên bị khoá, và thời điểm

#### Scenario: Lời mời không ghi email
- **WHEN** Admin gửi một lời mời
- **THEN** `AuditEvent` tạo lời mời có id lời mời nhưng không chứa địa chỉ email hay token của lời mời
