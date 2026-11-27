# Spec Delta: tenant-isolation

## Purpose

Bảo đảm mỗi dữ liệu nghiệp vụ thuộc đúng một công ty và người dùng chỉ đọc, sửa được dữ liệu của công ty mình, kể cả khi đoán hoặc sửa id trong yêu cầu.

## ADDED Requirements

### Requirement: Dữ liệu nghiệp vụ thuộc một công ty
Mỗi bản ghi nghiệp vụ SHALL thuộc đúng một công ty. Công ty của bản ghi MUST được lấy từ phiên của người đang đăng nhập, không bao giờ lấy từ dữ liệu người dùng gửi lên.

#### Scenario: Tạo dữ liệu gắn công ty theo phiên
- **WHEN** người dùng công ty A gửi yêu cầu tạo dữ liệu kèm trường công ty là công ty B
- **THEN** bản ghi được gắn với công ty A, hoặc yêu cầu bị từ chối vì trường không hợp lệ

#### Scenario: Thiếu công ty
- **WHEN** một truy vấn nghiệp vụ chạy mà không xác định được công ty
- **THEN** truy vấn không trả về và không ghi bản ghi nào

### Requirement: Không đọc được dữ liệu công ty khác
Khi người dùng yêu cầu một bản ghi bằng id thuộc công ty khác, hệ thống SHALL trả "không tìm thấy" (HTTP 404) giống hệt khi id không tồn tại, và MUST ghi một `AuditEvent` của công ty người yêu cầu.

#### Scenario: Đoán id của công ty khác
- **WHEN** người dùng công ty A gọi `GET /api/members/{id}` với id một thành viên của công ty B
- **THEN** API trả 404 với cùng nội dung như id không tồn tại, và công ty A có một `AuditEvent` loại truy cập không tìm thấy kèm id đã yêu cầu

#### Scenario: Đọc dữ liệu công ty mình
- **WHEN** người dùng công ty A gọi `GET /api/members/{id}` với id một thành viên công ty A
- **THEN** API trả 200 với dữ liệu của thành viên đó

### Requirement: Không sửa được dữ liệu công ty khác
Yêu cầu sửa hoặc xoá bản ghi của công ty khác SHALL bị xử lý như bản ghi không tồn tại và MUST NOT làm thay đổi dữ liệu nào.

#### Scenario: Sửa thông tin công ty khác
- **WHEN** người dùng công ty A gửi yêu cầu đổi tên công ty bằng cách chèn id công ty B vào yêu cầu
- **THEN** chỉ công ty A có thể bị đổi tên, công ty B giữ nguyên

### Requirement: Lớp chặn trong cơ sở dữ liệu
Ngoài kiểm tra trong API, cơ sở dữ liệu SHALL tự chặn truy cập chéo công ty: kết nối của ứng dụng chỉ thấy các dòng của công ty đã đặt cho phiên làm việc, kể cả khi truy vấn không có điều kiện lọc công ty.

#### Scenario: Truy vấn thô không lọc công ty
- **WHEN** ứng dụng chạy `SELECT` trên bảng thành viên không kèm điều kiện công ty, trong phiên đã đặt công ty A
- **THEN** kết quả chỉ có thành viên công ty A

#### Scenario: Ghi chéo công ty trong cơ sở dữ liệu
- **WHEN** ứng dụng cố chèn một dòng có công ty B trong phiên đã đặt công ty A
- **THEN** cơ sở dữ liệu từ chối lệnh chèn

#### Scenario: Phiên chưa đặt công ty
- **WHEN** ứng dụng truy vấn bảng nghiệp vụ mà chưa đặt công ty cho phiên làm việc
- **THEN** kết quả rỗng
