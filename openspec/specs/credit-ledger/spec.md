# credit-ledger Specification

## Purpose
Sổ credit của mỗi công ty (1 credit = 1 đồng): số dư chỉ đổi qua giao dịch chỉ thêm, trừ theo từng lần gọi mô hình, cộng credit dùng thử và điều chỉnh tay, báo khi sắp hết hoặc hết, và cho Owner / Admin xem số dư cùng lịch sử.

## Requirements

### Requirement: Mỗi công ty một tài khoản credit
Mỗi công ty SHALL có đúng một tài khoản credit, tạo cùng lúc với công ty, số dư ban đầu 0đ. Số dư và mọi số tiền MUST là số nguyên VNĐ.

#### Scenario: Tạo công ty
- **WHEN** người dùng đăng ký một công ty mới bằng email chưa xác minh
- **THEN** công ty có tài khoản credit với số dư 0đ

### Requirement: Giao dịch credit chỉ thêm
Mọi thay đổi số dư SHALL đi qua một `CreditTransaction` mới ghi số tiền, loại, và số dư sau giao dịch. Kết nối của ứng dụng MUST NOT sửa hay xoá được giao dịch đã ghi, và MUST NOT đổi số dư mà không có giao dịch.

#### Scenario: Ứng dụng cố sửa giao dịch
- **WHEN** ứng dụng chạy `UPDATE` hoặc `DELETE` trên bảng giao dịch credit
- **THEN** cơ sở dữ liệu từ chối lệnh

#### Scenario: Số dư khớp sổ
- **WHEN** công ty có một chuỗi giao dịch cộng và trừ bất kỳ
- **THEN** số dư hiện tại bằng tổng số tiền của mọi giao dịch, và bằng "số dư sau" của giao dịch mới nhất

### Requirement: Trừ đồng thời không sai số dư
Các lần trừ credit của cùng một công ty SHALL được xử lý lần lượt, mỗi lần đọc số dư mới nhất. Hai lần trừ chạy cùng lúc MUST NOT làm mất một lần trừ.

#### Scenario: Hai lần trừ cùng lúc
- **WHEN** công ty có số dư 10.000đ và hai lần gọi mô hình, mỗi lần trừ 1.000đ, được ghi cùng lúc
- **THEN** số dư còn 8.000đ và hai giao dịch có số dư sau là 9.000đ và 8.000đ

### Requirement: Trừ đủ chi phí lần gọi đã xong
Chi phí của một lần gọi đã có kết quả SHALL được trừ đủ, kể cả khi làm số dư xuống dưới 0. Khi số dư bằng 0 hoặc âm, mọi lần gọi mới MUST bị từ chối cho tới khi được cộng credit.

#### Scenario: Lần gọi cuối vượt số dư
- **WHEN** công ty có số dư 200đ và một lần gọi đã xong có số trừ 350đ
- **THEN** số dư là −150đ và lần gọi tiếp theo bị từ chối vì hết credit

#### Scenario: Cộng credit khi đang âm
- **WHEN** công ty có số dư −150đ và được cộng 100.000đ
- **THEN** số dư là 99.850đ và các lần gọi mới được thực hiện lại

### Requirement: Credit dùng thử
Công ty SHALL nhận một lần 200.000đ credit dùng thử, cộng tự động khi lần đầu công ty có một Owner đã xác minh email (xác minh sau khi đăng ký, hoặc tạo công ty bằng tài khoản đã xác minh như Google). Một công ty MUST NOT nhận credit dùng thử tự động lần thứ hai.

#### Scenario: Owner xác minh email
- **WHEN** Owner của công ty mới mở link xác minh email
- **THEN** công ty có giao dịch "Credit dùng thử" +200.000đ và số dư 200.000đ

#### Scenario: Tạo công ty bằng Google
- **WHEN** người dùng đăng nhập Google rồi tạo công ty
- **THEN** công ty nhận ngay 200.000đ credit dùng thử

#### Scenario: Xác minh lặp lại
- **WHEN** công ty đã nhận credit dùng thử, và một Owner khác của công ty xác minh email
- **THEN** không có giao dịch credit dùng thử thứ hai

#### Scenario: Thành viên không phải Owner xác minh
- **WHEN** công ty chưa có Owner nào xác minh email, và một Admin của công ty xác minh email
- **THEN** công ty chưa nhận credit dùng thử

### Requirement: Báo credit sắp hết
Khi một lần trừ làm số dư xuống dưới 20% số tiền của lần cộng credit gần nhất, hệ thống SHALL gửi email cho các Owner đang hoạt động một lần. Lần báo tiếp theo MUST chỉ xảy ra sau một lần cộng credit mới rồi lại xuống dưới ngưỡng.

#### Scenario: Xuống dưới ngưỡng
- **WHEN** lần cộng gần nhất là 1.000.000đ, số dư 201.000đ, và một lần trừ 2.000đ
- **THEN** mỗi Owner đang hoạt động nhận một email "credit sắp hết"

#### Scenario: Tiếp tục trừ dưới ngưỡng
- **WHEN** công ty đã được báo sắp hết và có thêm lần trừ, số dư vẫn trên 0
- **THEN** không có email báo sắp hết mới

#### Scenario: Cộng credit rồi lại xuống ngưỡng
- **WHEN** công ty đã được báo, được cộng 500.000đ, rồi số dư xuống dưới 100.000đ
- **THEN** Owner nhận một email báo sắp hết mới

### Requirement: Báo hết credit
Khi một lần trừ làm số dư từ trên 0 xuống 0 hoặc âm, hệ thống SHALL gửi email "công ty đã hết credit" một lần cho mọi Owner, Admin và Trưởng phòng đang hoạt động của công ty. Lần báo tiếp theo MUST chỉ xảy ra sau khi số dư lại lên trên 0.

#### Scenario: Hết credit
- **WHEN** công ty có số dư 300đ và một lần trừ 350đ
- **THEN** mọi Owner, Admin và Trưởng phòng đang hoạt động nhận một email báo hết credit, Nhân viên không nhận

#### Scenario: Báo hết credit không lộ công ty khác
- **WHEN** công ty A hết credit
- **THEN** không ai của công ty B nhận email đó

### Requirement: Xem số dư credit
Owner và Admin SHALL xem được số dư, trạng thái (bình thường / sắp hết / hết credit), ngưỡng báo, tổng đã dùng trong tháng và số ngày ước tính còn đủ dùng theo mức dùng 7 ngày qua. Trưởng phòng và Nhân viên gọi API này MUST nhận 403. Số tiền hiển thị MUST là số đã nhân hệ số; không trả chi phí thật hay hệ số.

#### Scenario: Owner xem số dư
- **WHEN** Owner gọi `GET /api/credit`
- **THEN** API trả số dư, trạng thái, ngưỡng báo và tổng đã dùng tháng này, không có trường chi phí thật hay hệ số giá

#### Scenario: Trưởng phòng gọi API
- **WHEN** Trưởng phòng gọi `GET /api/credit`
- **THEN** API trả 403 và có `AuditEvent` truy cập bị từ chối

#### Scenario: Số dư theo công ty
- **WHEN** Owner công ty A gọi `GET /api/credit`
- **THEN** số liệu chỉ tính từ giao dịch của công ty A

### Requirement: Lịch sử credit
Owner và Admin SHALL xem lịch sử credit theo tháng, lọc được cộng / trừ. Các lần trừ theo việc MUST gộp mỗi worker mỗi ngày thành một dòng, mở ra thấy từng lần (giờ, số token, số tiền). Dòng cộng tay MUST hiện lý do và ghi chú.

#### Scenario: Gộp theo ngày
- **WHEN** một worker có 14 lần gọi trong ngày 28/11
- **THEN** lịch sử tháng 11 có một dòng của worker đó ngày 28/11 với tổng 14 lần, và xem chi tiết thì có 14 dòng

#### Scenario: Dòng điều chỉnh tay
- **WHEN** platform admin cộng 1.000.000đ với lý do "Đã nhận chuyển khoản" và ghi chú
- **THEN** lịch sử của công ty có dòng cộng 1.000.000đ kèm lý do, ghi chú và số dư sau

#### Scenario: Lịch sử công ty khác
- **WHEN** Owner công ty A xem chi tiết một nhóm bằng id worker của công ty B
- **THEN** API trả danh sách rỗng hoặc 404, không có dòng nào của công ty B

### Requirement: Báo hết credit trên mọi trang
`GET /api/me` SHALL cho Owner, Admin và Trưởng phòng biết công ty đang hết credit, để giao diện hiện banner ở đầu mọi trang. Nhân viên MUST NOT nhận trạng thái credit.

#### Scenario: Trưởng phòng khi hết credit
- **WHEN** công ty có số dư 0đ và Trưởng phòng gọi `GET /api/me`
- **THEN** phản hồi báo công ty đã hết credit, không có số dư

#### Scenario: Nhân viên
- **WHEN** công ty có số dư 0đ và Nhân viên gọi `GET /api/me`
- **THEN** phản hồi không có trạng thái credit
