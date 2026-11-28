# Spec Delta

## Purpose

Cho người vận hành platform (không thuộc công ty nào) quản lý credit, giá mô hình và API key của platform qua một màn quản trị được bảo vệ bằng xác thực 2 bước, chỉ thấy số liệu tổng theo công ty, và mọi thay đổi đều được ghi nhật ký.

## ADDED Requirements

### Requirement: Danh tính platform admin
Platform admin SHALL là tài khoản có email nằm trong danh sách `PLATFORM_ADMIN_EMAILS`, đã xác minh email và không là thành viên của công ty nào. Platform admin không phải một vai trò trong công ty; danh sách trống MUST nghĩa là không ai vào được màn quản trị.

#### Scenario: Email trong danh sách
- **WHEN** người dùng có email nằm trong `PLATFORM_ADMIN_EMAILS`, đã bật xác thực 2 bước, gọi `GET /api/platform/companies`
- **THEN** API trả 200

#### Scenario: Email trong danh sách nhưng thuộc một công ty
- **WHEN** email trong danh sách là Owner của một công ty và gọi `GET /api/platform/companies`
- **THEN** API trả 404 như người không phải platform admin

#### Scenario: Platform admin tạo công ty
- **WHEN** platform admin gọi API tạo công ty
- **THEN** API từ chối và không tạo công ty nào

### Requirement: Bắt buộc xác thực 2 bước
Màn quản trị SHALL chỉ mở cho phiên đã qua bước nhập mã TOTP. Platform admin chưa bật TOTP MUST chỉ được làm bước bật TOTP. Không có "ghi nhớ thiết bị"; quyền quản trị của một phiên MUST hết sau 12 giờ kể từ lúc đăng nhập.

#### Scenario: Chưa bật TOTP
- **WHEN** platform admin chưa bật xác thực 2 bước gọi `GET /api/platform/companies`
- **THEN** API trả 403 với mã cần bật xác thực 2 bước, không có số liệu

#### Scenario: Đăng nhập cần mã
- **WHEN** platform admin đã bật TOTP đăng nhập bằng email và mật khẩu đúng
- **THEN** chưa có phiên cho tới khi nhập đúng mã TOTP

#### Scenario: Mã sai
- **WHEN** platform admin nhập sai mã TOTP
- **THEN** không có phiên và lần thử sai được tính vào giới hạn thử

#### Scenario: Phiên quá 12 giờ
- **WHEN** phiên của platform admin đã đăng nhập 13 giờ trước gọi API quản trị
- **THEN** API trả 401 và yêu cầu đăng nhập lại

### Requirement: Người khác không thấy màn quản trị
Mọi API `/api/platform/*` SHALL trả 404 cho người không phải platform admin, giống hệt đường dẫn không tồn tại. Thành viên công ty gọi vào MUST tạo `AuditEvent` truy cập không tìm thấy trong công ty của họ.

#### Scenario: Owner gọi API quản trị
- **WHEN** Owner công ty A gọi `POST /api/platform/companies/{id}/credit-adjustments`
- **THEN** API trả 404, không có giao dịch credit nào mới, và công ty A có một `AuditEvent` truy cập không tìm thấy

#### Scenario: Chưa đăng nhập
- **WHEN** người chưa đăng nhập gọi `GET /api/platform/companies`
- **THEN** API trả 404

### Requirement: Chỉ xem tổng theo công ty
Danh sách công ty SHALL chỉ có: tên công ty, email Owner, số dư, tổng đã trừ 30 ngày, trạng thái credit, hệ số riêng (nếu có) và thời điểm dùng gần nhất, cùng tổng toàn platform. API MUST NOT trả tên worker, nội dung việc, danh sách thành viên hay dữ liệu nghiệp vụ khác.

#### Scenario: Xem danh sách công ty
- **WHEN** platform admin gọi `GET /api/platform/companies`
- **THEN** mỗi công ty chỉ có các trường tổng ở trên, không có trường nào chứa tên worker hay nội dung việc

#### Scenario: Lọc công ty hết credit
- **WHEN** platform admin lọc trạng thái "hết credit"
- **THEN** danh sách chỉ có các công ty có số dư bằng 0 hoặc âm

### Requirement: Điều chỉnh credit tay
Platform admin SHALL cộng hoặc trừ credit của một công ty bằng một giao dịch mới, bắt buộc chọn lý do (đã nhận chuyển khoản, credit dùng thử, bù lỗi hệ thống, khác) và ghi chú. Trừ quá số dư hiện có MUST bị chặn; gửi lại cùng một yêu cầu MUST NOT tạo giao dịch thứ hai.

#### Scenario: Cộng credit đã nhận chuyển khoản
- **WHEN** platform admin cộng 2.000.000đ cho công ty có số dư 0đ, lý do "Đã nhận chuyển khoản", có ghi chú
- **THEN** công ty có giao dịch +2.000.000đ, số dư 2.000.000đ, và lần gọi mô hình tiếp theo của công ty được thực hiện

#### Scenario: Thiếu ghi chú
- **WHEN** platform admin gửi điều chỉnh không có ghi chú
- **THEN** API trả 400 và không có giao dịch mới

#### Scenario: Trừ quá số dư
- **WHEN** platform admin trừ 100.000đ của công ty có số dư 86.200đ
- **THEN** API từ chối và số dư giữ 86.200đ

#### Scenario: Gửi lại yêu cầu
- **WHEN** cùng một yêu cầu cộng credit (cùng khoá chống lặp) được gửi hai lần
- **THEN** chỉ có một giao dịch và lần gửi thứ hai trả lại kết quả của lần đầu

#### Scenario: Ghi chú chứa số tài khoản
- **WHEN** ghi chú có một dãy từ 9 chữ số liền nhau trở lên
- **THEN** API trả 400 với lỗi không ghi số tài khoản đầy đủ

### Requirement: Quản lý giá, tỉ giá và hệ số
Platform admin SHALL thêm giá mô hình mới, đổi tỉ giá USD → VNĐ, đổi hệ số giá mặc định, đặt hoặc bỏ hệ số riêng của một công ty. Hệ số MUST lớn hơn hoặc bằng 1; tỉ giá MUST là số nguyên dương.

#### Scenario: Đổi hệ số mặc định
- **WHEN** platform admin đổi hệ số mặc định từ 1,30 sang 1,25
- **THEN** các lần gọi sau của công ty không có hệ số riêng dùng 1,25

#### Scenario: Hệ số dưới 1
- **WHEN** platform admin đặt hệ số riêng 0,9 cho một công ty
- **THEN** API trả 400 và hệ số không đổi

### Requirement: Thay API key nhà cung cấp
Platform admin SHALL thêm hoặc thay API key của từng nhà cung cấp. Key mới MUST được kiểm tra bằng một yêu cầu tới nhà cung cấp trước khi lưu; key không hợp lệ không được lưu và key cũ giữ nguyên. Key đã lưu MUST NOT xem lại được.

#### Scenario: Key hợp lệ
- **WHEN** platform admin thay key Anthropic bằng một key nhà cung cấp chấp nhận
- **THEN** key mới được lưu đã mã hoá, các lần gọi sau dùng key mới, và phản hồi chỉ báo "đã cấu hình"

#### Scenario: Key bị nhà cung cấp từ chối
- **WHEN** platform admin thay key Anthropic bằng một key nhà cung cấp trả 401
- **THEN** API trả lỗi key không hợp lệ và key cũ vẫn được dùng

### Requirement: Nhật ký cấp platform
Mọi thay đổi trên màn quản trị (điều chỉnh credit, thêm giá, đổi tỉ giá, đổi hệ số, thay key) SHALL ghi một sự kiện nhật ký cấp platform: người làm, hành động, đối tượng, công ty liên quan nếu có, thời điểm. Nhật ký MUST chỉ thêm và MUST NOT chứa giá trị key.

#### Scenario: Thay key
- **WHEN** platform admin thay key OpenAI
- **THEN** có một sự kiện nhật ký thay key OpenAI với người làm và thời điểm, không chứa key

#### Scenario: Ứng dụng cố xoá nhật ký
- **WHEN** ứng dụng chạy `DELETE` trên bảng nhật ký cấp platform
- **THEN** cơ sở dữ liệu từ chối lệnh
