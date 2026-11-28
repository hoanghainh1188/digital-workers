## Purpose
Cho Owner và Admin quản lý người thật trong công ty: xem, đổi vai trò, chuyển phòng ban, khoá và mở khoá tài khoản, với các luật bảo vệ Owner để công ty không bao giờ mất người quản trị.

## ADDED Requirements

### Requirement: Xem danh sách người dùng
Owner và Admin SHALL xem được mọi thành viên của công ty; Trưởng phòng MUST chỉ xem được (không sửa) thành viên phòng mình (0.2 #038); Nhân viên MUST NOT xem được danh sách. Mỗi dòng có họ tên, email, vai trò, phòng ban, trạng thái và lần hoạt động gần nhất.

#### Scenario: Trưởng phòng xem phòng mình
- **WHEN** Trưởng phòng "Kinh doanh" mở danh sách người dùng
- **THEN** danh sách chỉ có thành viên phòng "Kinh doanh", không có nút đổi vai trò, chuyển phòng, khoá hay mời

#### Scenario: Nhân viên không xem được
- **WHEN** Nhân viên gọi API danh sách người dùng
- **THEN** API trả 403 và có `AuditEvent` truy cập bị từ chối

#### Scenario: Không thấy người công ty khác
- **WHEN** Owner công ty A xem danh sách người dùng
- **THEN** danh sách không có thành viên hay lời mời nào của công ty B

### Requirement: Lọc danh sách người dùng
Danh sách người dùng SHALL lọc được theo từ khoá (tên hoặc email), vai trò, phòng ban (kể cả "chưa có phòng ban") và trạng thái (đang hoạt động, đã mời, đã khoá). Bộ lọc MUST nằm trên URL để gửi link được.

#### Scenario: Lọc theo phòng và vai trò
- **WHEN** Admin mở trang Người dùng với bộ lọc phòng "Kế toán" và vai trò Nhân viên
- **THEN** chỉ hiện Nhân viên phòng "Kế toán" và URL chứa hai bộ lọc đó

#### Scenario: Không có kết quả
- **WHEN** Owner tìm "kế toán trưởng" không khớp ai
- **THEN** trang báo không có ai khớp và có nút xoá bộ lọc

### Requirement: Chỉ Owner quản lý Owner và Admin
Chỉ Owner SHALL gán vai trò Owner hoặc Admin, và chỉ Owner MUST đổi vai trò, chuyển phòng, khoá hoặc mở khoá một Owner hay Admin (0.2 #039). Admin vi phạm luật này MUST nhận 403 và có `AuditEvent` truy cập bị từ chối.

#### Scenario: Owner gán Admin
- **WHEN** Owner đổi vai trò một Nhân viên thành Admin
- **THEN** người đó có vai trò Admin và có `AuditEvent` đổi vai trò

#### Scenario: Admin gán Admin
- **WHEN** Admin đổi vai trò một Nhân viên thành Admin
- **THEN** API trả 403 và vai trò giữ nguyên

#### Scenario: Admin khoá Owner
- **WHEN** Admin gửi yêu cầu khoá một Owner
- **THEN** API trả 403 và Owner vẫn đang hoạt động

### Requirement: Luôn còn một Owner đang hoạt động
Công ty SHALL luôn có ít nhất một Owner đang hoạt động. Đổi vai trò hoặc khoá Owner đang hoạt động cuối cùng MUST bị từ chối, kể cả khi hai yêu cầu chạy cùng lúc.

#### Scenario: Hạ vai trò Owner cuối cùng
- **WHEN** Owner đang hoạt động duy nhất đổi vai trò của chính mình thành Admin
- **THEN** hệ thống từ chối, báo công ty cần ít nhất một Owner và vai trò giữ nguyên

#### Scenario: Hai Owner hạ vai trò nhau cùng lúc
- **WHEN** công ty có đúng hai Owner và mỗi người gửi cùng lúc yêu cầu đổi vai trò người kia thành Admin
- **THEN** nhiều nhất một yêu cầu thành công và công ty vẫn còn một Owner đang hoạt động

#### Scenario: Có Owner khác thì được hạ
- **WHEN** công ty có hai Owner đang hoạt động và một Owner tự đổi vai trò thành Admin
- **THEN** đổi vai trò thành công

### Requirement: Đổi vai trò
Owner và Admin SHALL đổi được vai trò của thành viên theo luật trên. Vai trò Trưởng phòng hoặc Nhân viên MUST có phòng ban. Đổi sang Trưởng phòng MUST bị từ chối khi phòng của người đó đã có trưởng phòng khác. Mỗi lần đổi có `AuditEvent`.

#### Scenario: Nhân viên lên Trưởng phòng
- **WHEN** Admin đổi vai trò Nhân viên phòng "Kế toán" (chưa có trưởng phòng) thành Trưởng phòng
- **THEN** người đó là trưởng phòng "Kế toán" và có `AuditEvent` đổi vai trò

#### Scenario: Admin xuống Nhân viên thiếu phòng
- **WHEN** Owner đổi một Admin chưa có phòng ban thành Nhân viên mà không chọn phòng
- **THEN** hệ thống từ chối và yêu cầu chọn phòng ban

#### Scenario: Đổi vai trò thành viên công ty khác
- **WHEN** Owner công ty A đổi vai trò bằng id một thành viên công ty B
- **THEN** API trả 404, thành viên công ty B giữ nguyên và công ty A có `AuditEvent` truy cập không tìm thấy

### Requirement: Chuyển phòng ban
Owner và Admin SHALL chuyển được thành viên sang một phòng ban chưa lưu trữ khác của công ty. Owner và Admin MUST bỏ phòng được; Trưởng phòng và Nhân viên MUST NOT để trống phòng. Chuyển Trưởng phòng sang phòng khác MUST biến người đó thành Nhân viên của phòng mới, phòng cũ không còn trưởng phòng. Mỗi lần chuyển có `AuditEvent`.

#### Scenario: Chuyển Nhân viên
- **WHEN** Admin chuyển một Nhân viên từ "Kinh doanh" sang "Kế toán"
- **THEN** người đó thuộc phòng "Kế toán" và có `AuditEvent` chuyển phòng

#### Scenario: Chuyển Trưởng phòng
- **WHEN** Owner chuyển Trưởng phòng "Kinh doanh" sang phòng "Kế toán"
- **THEN** người đó là Nhân viên phòng "Kế toán" và phòng "Kinh doanh" không còn trưởng phòng

#### Scenario: Chuyển sang phòng công ty khác
- **WHEN** Admin công ty A chuyển thành viên sang một phòng ban có id thuộc công ty B
- **THEN** hệ thống từ chối như phòng ban không tồn tại và thành viên giữ nguyên phòng

### Requirement: Khoá tài khoản
Owner và Admin SHALL khoá được thành viên theo luật trên, trừ chính mình. Khoá MUST huỷ ngay mọi phiên đăng nhập của người đó, chặn đăng nhập về sau, giữ vai trò, phòng ban và tên trong lịch sử. Mỗi lần khoá có `AuditEvent`.

#### Scenario: Khoá người nghỉ việc
- **WHEN** Admin khoá Nhân viên "Phan Quang" đang đăng nhập
- **THEN** yêu cầu tiếp theo của Quang bằng phiên cũ nhận 401, trạng thái là "Đã khoá" kèm ngày khoá và có `AuditEvent` khoá tài khoản

#### Scenario: Tự khoá mình
- **WHEN** Owner gửi yêu cầu khoá chính mình
- **THEN** hệ thống từ chối và trạng thái giữ nguyên

#### Scenario: Khoá thành viên công ty khác
- **WHEN** Admin công ty A khoá bằng id một thành viên công ty B
- **THEN** API trả 404, thành viên công ty B vẫn đăng nhập được và công ty A có `AuditEvent` truy cập không tìm thấy

### Requirement: Mở khoá tài khoản
Owner và Admin SHALL mở khoá được thành viên đã khoá theo luật trên. Mở khoá xong người đó đăng nhập lại được với vai trò và phòng ban cũ. Mỗi lần mở khoá có `AuditEvent`.

#### Scenario: Mở khoá
- **WHEN** Owner mở khoá "Phan Quang"
- **THEN** Quang đăng nhập được bằng mật khẩu cũ với vai trò và phòng ban như trước khi khoá

#### Scenario: Trưởng phòng không mở khoá được
- **WHEN** Trưởng phòng gửi yêu cầu mở khoá một người trong phòng mình
- **THEN** API trả 403 và người đó vẫn bị khoá
