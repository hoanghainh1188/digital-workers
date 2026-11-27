# Spec Delta: audit-log

## Purpose

Ghi lại ai đã làm gì, khi nào, với hành động quản trị và truy cập bị từ chối, để chủ doanh nghiệp và platform truy vết được mà không lưu nội dung nhạy cảm.

## ADDED Requirements

### Requirement: Ghi nhật ký hành động
Hệ thống SHALL ghi một `AuditEvent` cho mỗi: tạo công ty, đổi thông tin công ty, đăng nhập thành công, truy cập bị từ chối (403) và truy cập id không tìm thấy (404). Mỗi sự kiện MUST có công ty, người thực hiện, loại hành động, đối tượng và thời điểm.

#### Scenario: Ghi khi đổi tên công ty
- **WHEN** Admin đổi tên công ty
- **THEN** có một `AuditEvent` với công ty, người thực hiện là Admin đó, loại đổi thông tin công ty, và thời điểm

#### Scenario: Nhật ký thuộc công ty
- **WHEN** người dùng công ty A làm một hành động được ghi nhật ký
- **THEN** sự kiện thuộc công ty A và người công ty B không đọc được sự kiện đó

### Requirement: Nhật ký chỉ thêm
`AuditEvent` SHALL chỉ được thêm mới. Kết nối của ứng dụng MUST NOT sửa hoặc xoá được sự kiện đã ghi.

#### Scenario: Ứng dụng cố sửa nhật ký
- **WHEN** ứng dụng chạy lệnh `UPDATE` hoặc `DELETE` trên bảng nhật ký
- **THEN** cơ sở dữ liệu từ chối lệnh

### Requirement: Không ghi nội dung nhạy cảm
`AuditEvent` MUST NOT chứa mật khẩu, token, cookie, nội dung tin nhắn hay giá trị bí mật. Chỉ ghi định danh và tên trường đã đổi.

#### Scenario: Đổi thông tin công ty
- **WHEN** Owner đổi số điện thoại liên hệ của công ty
- **THEN** sự kiện ghi tên trường đã đổi, không ghi số điện thoại cũ hay mới

#### Scenario: Đăng nhập
- **WHEN** người dùng đăng nhập thành công
- **THEN** sự kiện không chứa mật khẩu, token phiên hay cookie
