# company-signup Specification

## Purpose
Cho chủ doanh nghiệp tự tạo công ty trên platform và trở thành Owner đầu tiên, bằng email + mật khẩu hoặc tài khoản Google, rồi xem và đổi thông tin cơ bản của công ty.

## Requirements

### Requirement: Đăng ký công ty bằng email
Người chưa có tài khoản SHALL tạo được công ty bằng tên công ty, họ tên, email, mật khẩu và số điện thoại không bắt buộc. Thành công thì người đó là Owner của công ty mới, đã đăng nhập, và có `AuditEvent` tạo công ty.

#### Scenario: Đăng ký thành công
- **WHEN** người dùng gửi tên công ty "Gốm An Phú", họ tên, một email chưa dùng và mật khẩu hợp lệ
- **THEN** hệ thống tạo công ty "Gốm An Phú", người đó là thành viên vai trò Owner, phiên đăng nhập được tạo, và có `AuditEvent` tạo công ty

#### Scenario: Không nhập số điện thoại
- **WHEN** người dùng đăng ký không có số điện thoại
- **THEN** đăng ký vẫn thành công

#### Scenario: Email đã có tài khoản
- **WHEN** người dùng đăng ký bằng email đã thuộc một công ty
- **THEN** hệ thống từ chối, báo email đã có tài khoản, không tạo công ty mới

#### Scenario: Thiếu tên công ty
- **WHEN** người dùng đăng ký với tên công ty để trống
- **THEN** hệ thống từ chối và chỉ rõ trường tên công ty

### Requirement: Đăng ký bằng Google
Người đăng nhập bằng Google lần đầu SHALL được chuyển tới bước "Tạo công ty" và chỉ dùng được ứng dụng sau khi tạo công ty. Khi chưa cấu hình Google, nút Google MUST NOT hiện.

#### Scenario: Google lần đầu
- **WHEN** người dùng đăng nhập Google bằng email chưa thuộc công ty nào
- **THEN** hệ thống mở bước "Tạo công ty"; mọi API nghiệp vụ trả lỗi "chưa có công ty" cho tới khi tạo xong

#### Scenario: Tạo công ty sau Google
- **WHEN** người dùng ở bước "Tạo công ty" gửi tên công ty hợp lệ
- **THEN** người đó thành Owner của công ty mới

#### Scenario: Đã có công ty thì không tạo thêm
- **WHEN** người dùng đã thuộc một công ty gọi tạo công ty
- **THEN** hệ thống từ chối (mỗi email một công ty)

#### Scenario: Chưa cấu hình Google
- **WHEN** platform chạy không có cấu hình Google
- **THEN** trang đăng ký và đăng nhập không hiện nút Google

### Requirement: Xem và đổi thông tin công ty
Mọi thành viên SHALL xem được tên công ty mình. Chỉ Owner và Admin MUST đổi được tên và số điện thoại liên hệ; mỗi lần đổi có `AuditEvent`.

#### Scenario: Owner đổi tên công ty
- **WHEN** Owner đổi tên công ty thành "Gốm An Phú Bát Tràng"
- **THEN** tên mới được lưu và có `AuditEvent` đổi thông tin công ty

#### Scenario: Nhân viên không đổi được
- **WHEN** thành viên vai trò Nhân viên gửi yêu cầu đổi tên công ty
- **THEN** API trả 403 và tên công ty giữ nguyên

#### Scenario: Chỉ đổi được công ty mình
- **WHEN** Owner công ty A gửi yêu cầu đổi tên kèm id công ty B
- **THEN** công ty B không bị đổi
