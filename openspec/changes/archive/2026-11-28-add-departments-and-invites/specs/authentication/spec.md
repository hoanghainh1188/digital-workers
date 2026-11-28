## ADDED Requirements

### Requirement: Quên mật khẩu
Người dùng SHALL yêu cầu được link đặt lại mật khẩu bằng email. Phản hồi MUST giống hệt nhau dù email có tài khoản hay không. Chỉ email có tài khoản mật khẩu mới nhận link; link có hạn 1 giờ. Yêu cầu MUST bị giới hạn theo IP và theo email.

#### Scenario: Email có tài khoản
- **WHEN** người dùng nhập email đã có tài khoản vào trang Quên mật khẩu
- **THEN** một email chứa link đặt lại mật khẩu được gửi tới địa chỉ đó và trang báo "nếu email có tài khoản, link đã được gửi"

#### Scenario: Email không có tài khoản
- **WHEN** người dùng nhập email chưa có tài khoản
- **THEN** trang hiện đúng thông báo như email có tài khoản và không có email nào được gửi

#### Scenario: Yêu cầu liên tục
- **WHEN** cùng một email yêu cầu link đặt lại quá giới hạn trong 15 phút
- **THEN** các yêu cầu tiếp theo nhận 429

### Requirement: Đặt lại mật khẩu
Người có link còn hạn SHALL đặt được mật khẩu mới theo quy tắc mật khẩu. Đặt lại thành công MUST huỷ mọi phiên cũ của tài khoản, đánh dấu email đã xác minh, làm link hết hiệu lực và ghi `AuditEvent` nếu tài khoản thuộc một công ty.

#### Scenario: Đặt lại thành công
- **WHEN** người dùng mở link còn hạn và đặt mật khẩu mới hợp lệ
- **THEN** đăng nhập bằng mật khẩu mới thành công, mật khẩu cũ không dùng được và phiên cũ trên máy khác nhận 401

#### Scenario: Mật khẩu mới quá phổ biến
- **WHEN** người dùng đặt lại với mật khẩu "1234567890"
- **THEN** hệ thống từ chối, báo mật khẩu quá dễ đoán và link vẫn dùng được

#### Scenario: Dùng lại link
- **WHEN** người dùng mở lại link đặt lại đã dùng hoặc đã quá 1 giờ
- **THEN** trang báo link không còn hiệu lực và có nút gửi link mới

#### Scenario: Lấy lại email bị đăng ký trước
- **WHEN** chủ thật của một email chưa xác minh (do người khác đăng ký) đặt lại mật khẩu qua link gửi về email đó
- **THEN** mọi phiên của người đăng ký trước bị huỷ và email được đánh dấu đã xác minh

### Requirement: Tài khoản bị khoá không đăng nhập được
Thành viên bị khoá SHALL không tạo được phiên mới bằng email + mật khẩu hay Google. Thông báo MUST cho biết tài khoản đã bị khoá và cần liên hệ quản trị công ty. Phiên có sẵn MUST bị từ chối với 401.

#### Scenario: Đăng nhập khi bị khoá
- **WHEN** thành viên bị khoá đăng nhập bằng đúng email và mật khẩu
- **THEN** không có phiên nào được tạo và trang đăng nhập báo tài khoản đã bị khoá

#### Scenario: Google khi bị khoá
- **WHEN** thành viên bị khoá đăng nhập bằng Google cùng email
- **THEN** không có phiên nào được tạo và trang đăng nhập báo tài khoản đã bị khoá
