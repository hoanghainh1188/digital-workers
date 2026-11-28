# invitations Specification

## Purpose
Cho Owner và Admin đưa đồng nghiệp vào công ty bằng lời mời qua email, với vai trò và phòng ban chọn sẵn, và cho người được mời tham gia an toàn bằng mật khẩu hoặc Google cùng email.

## Requirements

### Requirement: Gửi lời mời
Owner và Admin SHALL mời được một hoặc nhiều email (tối đa 50 mỗi lần) với cùng vai trò và phòng ban. Mỗi email hợp lệ nhận một email chứa link tham gia. Mỗi lời mời có `AuditEvent`; nhật ký MUST NOT chứa địa chỉ email hay token.

#### Scenario: Mời hai người
- **WHEN** Admin đã xác minh email mời "ngoc.bui@gomanphu.vn" và "tam.vo@gomanphu.vn" làm Nhân viên phòng "Kinh doanh"
- **THEN** hai lời mời ở trạng thái "Đã mời" được tạo, mỗi địa chỉ nhận một email có link tham gia, và có `AuditEvent` cho từng lời mời

#### Scenario: Một email sai định dạng
- **WHEN** Owner mời "thu@gomanphu" cùng một email hợp lệ
- **THEN** hệ thống từ chối cả yêu cầu, chỉ rõ "thu@gomanphu" chưa đúng định dạng và không tạo lời mời nào

#### Scenario: Email đã là thành viên hoặc đang được mời
- **WHEN** Admin mời một email đã là thành viên công ty, hoặc đang có lời mời còn hạn
- **THEN** email đó được báo là đã có trong công ty hoặc đã được mời, không tạo lời mời trùng; các email khác vẫn được mời

#### Scenario: Trưởng phòng và Nhân viên không mời được
- **WHEN** Trưởng phòng hoặc Nhân viên gửi trực tiếp yêu cầu tạo lời mời
- **THEN** API trả 403, không có lời mời nào và có `AuditEvent` truy cập bị từ chối

### Requirement: Phải xác minh email trước khi mời
Người chưa xác minh email SHALL không tạo hoặc gửi lại được lời mời (0.2 #033). Giao diện MUST báo cần xác minh email trước khi mời.

#### Scenario: Owner chưa xác minh email
- **WHEN** Owner chưa xác minh email gửi yêu cầu mời người
- **THEN** API trả 403 với mã lỗi "chưa xác minh email" và không có lời mời nào

### Requirement: Luật vai trò khi mời
Chỉ Owner SHALL mời được người với vai trò Owner hoặc Admin. Lời mời vai trò Trưởng phòng hoặc Nhân viên MUST có phòng ban chưa lưu trữ của công ty. Lời mời Trưởng phòng MUST bị từ chối khi phòng đã có trưởng phòng hoặc đang có lời mời Trưởng phòng còn hạn.

#### Scenario: Admin mời Admin
- **WHEN** Admin gửi lời mời vai trò Admin
- **THEN** API trả 403 và không có lời mời nào

#### Scenario: Nhân viên không có phòng
- **WHEN** Owner mời một Nhân viên mà không chọn phòng ban
- **THEN** hệ thống từ chối và chỉ rõ trường phòng ban

#### Scenario: Phòng ban của công ty khác
- **WHEN** Admin công ty A mời người vào một phòng ban có id thuộc công ty B
- **THEN** hệ thống từ chối như phòng ban không tồn tại và không có lời mời nào

#### Scenario: Phòng đã có trưởng phòng
- **WHEN** Admin mời một Trưởng phòng vào phòng "Kinh doanh" đã có trưởng phòng
- **THEN** hệ thống từ chối và báo phòng đã có trưởng phòng

### Requirement: Hạn, gửi lại và huỷ lời mời
Lời mời SHALL hết hạn sau 7 ngày kể từ lần gửi gần nhất (0.2 #034). Owner và Admin MUST gửi lại được lời mời chưa nhận (link cũ hết hiệu lực, hạn tính lại 7 ngày) và huỷ được lời mời chưa nhận. Admin MUST NOT gửi lại hay huỷ lời mời vai trò Owner hoặc Admin. Mỗi lần gửi lại / huỷ có `AuditEvent`.

#### Scenario: Gửi lại lời mời hết hạn
- **WHEN** Admin gửi lại một lời mời đã hết hạn
- **THEN** người được mời nhận email mới, link mới dùng được thêm 7 ngày và link cũ không còn dùng được

#### Scenario: Huỷ lời mời
- **WHEN** Owner huỷ một lời mời chưa nhận
- **THEN** link trong lời mời không còn dùng được và lời mời không còn trong danh sách đang chờ

#### Scenario: Huỷ lời mời công ty khác
- **WHEN** Admin công ty A huỷ một lời mời bằng id lời mời của công ty B
- **THEN** API trả 404, lời mời của công ty B giữ nguyên và công ty A có `AuditEvent` truy cập không tìm thấy

### Requirement: Xem lời mời
Owner và Admin SHALL thấy các lời mời chưa nhận của công ty mình trên trang Người dùng, với email, vai trò, phòng ban và thời gian còn lại hoặc "đã hết hạn". Trưởng phòng và Nhân viên MUST NOT xem được danh sách lời mời.

#### Scenario: Owner thấy lời mời đang chờ
- **WHEN** Owner mở trang Người dùng khi có một lời mời còn 5 ngày
- **THEN** dòng lời mời hiện trạng thái "Đã mời" và "Hết hạn sau 5 ngày"

#### Scenario: Không thấy lời mời công ty khác
- **WHEN** Owner công ty A xem danh sách lời mời
- **THEN** danh sách không có lời mời nào của công ty B

### Requirement: Mở link lời mời
Người mở link lời mời SHALL thấy tên công ty, người mời, vai trò, phòng ban và email đã cố định. Link hết hạn, đã huỷ, đã dùng hoặc sai MUST hiện trang "lời mời không còn hiệu lực" và không lộ thông tin công ty.

#### Scenario: Link còn hạn
- **WHEN** người được mời mở link lời mời còn hạn
- **THEN** trang hiện tên công ty, tên người mời, vai trò, phòng ban, và ô email không sửa được

#### Scenario: Link hết hạn
- **WHEN** người được mời mở link lời mời đã quá 7 ngày
- **THEN** trang báo lời mời đã hết hạn, nhờ người mời gửi lại, và có nút về trang đăng nhập

#### Scenario: Token sai
- **WHEN** ai đó mở link lời mời với token không tồn tại
- **THEN** trang báo lời mời không còn hiệu lực, không hiện tên công ty nào

### Requirement: Nhận lời mời bằng mật khẩu
Người được mời SHALL nhận lời mời bằng họ tên và mật khẩu theo quy tắc mật khẩu. Thành công thì người đó là thành viên công ty với vai trò và phòng ban trong lời mời, đã đăng nhập, email được coi là đã xác minh (0.2 #033), lời mời chuyển sang đã nhận và có `AuditEvent`. Email đã có tài khoản MUST bị từ chối theo luật mỗi email một công ty.

#### Scenario: Nhận lời mời thành công
- **WHEN** người được mời làm Trưởng phòng "Kinh doanh" nhập họ tên và mật khẩu hợp lệ
- **THEN** người đó vào công ty với vai trò Trưởng phòng phòng "Kinh doanh", đã đăng nhập, `GET /api/me` báo email đã xác minh và link không dùng lại được

#### Scenario: Mật khẩu quá phổ biến
- **WHEN** người được mời nhận lời mời với mật khẩu "1234567890"
- **THEN** hệ thống từ chối, báo mật khẩu quá dễ đoán và lời mời vẫn còn hiệu lực

#### Scenario: Email đã thuộc công ty khác
- **WHEN** người được mời có email đã là thành viên của một công ty khác
- **THEN** hệ thống báo email đã có tài khoản ở công ty khác, không tạo thành viên mới

### Requirement: Nhận lời mời bằng Google hoặc tài khoản sẵn có
Người đã đăng nhập (bằng Google hoặc tài khoản chưa có công ty) SHALL nhận được lời mời khi email của phiên trùng email trong lời mời, không cần đặt mật khẩu. Email khác MUST bị từ chối và lời mời giữ nguyên.

#### Scenario: Google cùng email
- **WHEN** người được mời bấm "Tiếp tục với Google" và đăng nhập Google bằng đúng email trong lời mời
- **THEN** người đó vào công ty với vai trò và phòng ban trong lời mời

#### Scenario: Google khác email
- **WHEN** người được mời đăng nhập Google bằng một email khác email trong lời mời
- **THEN** hệ thống báo lời mời dành cho email khác, không thêm thành viên và lời mời vẫn còn hiệu lực

### Requirement: Giới hạn thử link lời mời
Các endpoint công khai xem và nhận lời mời SHALL giới hạn số lần gọi theo địa chỉ IP; vượt giới hạn MUST trả HTTP 429.

#### Scenario: Dò token lời mời
- **WHEN** một địa chỉ IP gọi xem lời mời với nhiều token khác nhau vượt giới hạn trong một phút
- **THEN** các lần gọi tiếp theo nhận 429
