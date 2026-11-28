# authentication Specification

## Purpose
Xác định người đang dùng web quản lý: đăng nhập bằng email + mật khẩu hoặc Google, giữ phiên an toàn, chống dò mật khẩu, và xác minh email người dùng.

## Requirements

### Requirement: Đăng nhập bằng email và mật khẩu
Người dùng SHALL đăng nhập được bằng email và mật khẩu đúng. Sai email hoặc sai mật khẩu MUST trả cùng một thông báo, không cho biết email có tồn tại hay không.

#### Scenario: Đăng nhập đúng
- **WHEN** người dùng gửi email và mật khẩu đúng
- **THEN** phiên được tạo bằng cookie và `GET /api/me` trả người dùng, công ty, vai trò

#### Scenario: Sai mật khẩu và email không tồn tại cùng phản hồi
- **WHEN** người dùng đăng nhập với mật khẩu sai, rồi với một email không tồn tại
- **THEN** hai lần nhận cùng mã lỗi và cùng thông báo

### Requirement: Phiên đăng nhập an toàn
Phiên SHALL lưu phía máy chủ và gửi cho trình duyệt bằng cookie httpOnly, SameSite=Lax, Secure khi chạy HTTPS. Đăng xuất MUST huỷ phiên ở máy chủ.

#### Scenario: Cookie phiên không đọc được bằng JavaScript
- **WHEN** đăng nhập thành công
- **THEN** cookie phiên có cờ httpOnly và SameSite=Lax

#### Scenario: Đăng xuất
- **WHEN** người dùng đăng xuất rồi dùng lại cookie phiên cũ
- **THEN** `GET /api/me` trả 401

#### Scenario: Chưa đăng nhập
- **WHEN** gọi API nghiệp vụ không có phiên
- **THEN** API trả 401

### Requirement: Quy tắc mật khẩu
Mật khẩu SHALL có ít nhất 10 ký tự, không bắt buộc ký tự đặc biệt. Mật khẩu nằm trong danh sách mật khẩu quá phổ biến MUST bị từ chối. Mật khẩu MUST chỉ lưu dạng băm, không ghi vào log.

#### Scenario: Mật khẩu ngắn
- **WHEN** người dùng đăng ký với mật khẩu 9 ký tự
- **THEN** hệ thống từ chối và báo cần ít nhất 10 ký tự

#### Scenario: Mật khẩu quá phổ biến
- **WHEN** người dùng đăng ký với mật khẩu "1234567890"
- **THEN** hệ thống từ chối và báo mật khẩu quá dễ đoán

#### Scenario: Cụm từ dài không có ký tự đặc biệt
- **WHEN** người dùng đăng ký với mật khẩu "gom an phu bat trang"
- **THEN** mật khẩu được chấp nhận

### Requirement: Giới hạn thử đăng nhập sai
Hệ thống SHALL giới hạn số lần đăng nhập thất bại theo email và theo địa chỉ IP; vượt giới hạn MUST trả HTTP 429 cho tới khi hết thời gian chờ.

#### Scenario: Dò mật khẩu
- **WHEN** cùng một email đăng nhập sai 10 lần trong 15 phút
- **THEN** lần thử tiếp theo nhận 429, kể cả khi mật khẩu đúng

### Requirement: Xác minh email
Sau khi đăng ký bằng email, hệ thống SHALL gửi link xác minh và cho dùng ứng dụng ngay. Người dùng MUST gửi lại được link; link chỉ dùng một lần. Đăng nhập bằng Google coi như đã xác minh.

#### Scenario: Gửi link sau đăng ký
- **WHEN** người dùng đăng ký bằng email
- **THEN** một email chứa link xác minh được gửi tới địa chỉ đó và `GET /api/me` báo chưa xác minh

#### Scenario: Bấm link xác minh
- **WHEN** người dùng mở link xác minh còn hạn
- **THEN** email được đánh dấu đã xác minh

#### Scenario: Dùng lại link
- **WHEN** người dùng mở lại link đã dùng
- **THEN** hệ thống báo link không còn hiệu lực và không đổi trạng thái

#### Scenario: Gửi lại link
- **WHEN** người dùng chưa xác minh yêu cầu gửi lại link
- **THEN** một link mới được gửi

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
