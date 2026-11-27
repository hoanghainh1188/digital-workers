# access-control Specification

## Purpose
Quy định mỗi người dùng có một vai trò trong công ty và mỗi hành động chỉ được phép theo ma trận quyền, kiểm tra trong API chứ không dựa vào giao diện hay prompt.

## Requirements

### Requirement: Mỗi thành viên có một vai trò
Mỗi thành viên của công ty SHALL có đúng một vai trò trong: Owner, Admin, Trưởng phòng, Nhân viên. `GET /api/me` MUST trả vai trò hiện tại.

#### Scenario: Vai trò trong phản hồi
- **WHEN** Owner gọi `GET /api/me`
- **THEN** phản hồi có vai trò Owner và công ty của người đó

#### Scenario: Vai trò theo công ty
- **WHEN** Owner công ty A gọi `GET /api/me`
- **THEN** phản hồi không chứa thông tin của công ty B

### Requirement: Quyền kiểm tra trong API
Mọi API nghiệp vụ SHALL kiểm tra quyền theo ma trận quyền (docs/requirements.md mục 1) trước khi đọc hoặc ghi dữ liệu. Không đủ quyền MUST trả HTTP 403 và ghi `AuditEvent`; việc ẩn nút trên giao diện không thay cho kiểm tra này.

#### Scenario: Gọi API thẳng khi không đủ quyền
- **WHEN** Nhân viên gửi trực tiếp yêu cầu `PATCH /api/company` (không qua giao diện)
- **THEN** API trả 403, dữ liệu không đổi và có `AuditEvent` truy cập bị từ chối

#### Scenario: Đủ quyền
- **WHEN** Admin gửi `PATCH /api/company` với tên hợp lệ
- **THEN** API trả 200

#### Scenario: Quyền không vượt công ty
- **WHEN** Admin công ty A gọi API với id dữ liệu công ty B
- **THEN** API trả 404, không trả 403 hay dữ liệu

### Requirement: Ma trận quyền là một nguồn duy nhất
Danh sách hành động và vai trò được phép SHALL được định nghĩa ở một nơi duy nhất, dùng chung cho API và giao diện, và MUST khớp ma trận quyền trong docs/requirements.md mục 1.

#### Scenario: Khớp ma trận tài liệu
- **WHEN** chạy bộ test ma trận quyền
- **THEN** mỗi ô của ma trận trong docs/requirements.md mục 1 cho đúng kết quả được phép / không được phép với từng vai trò
