# Spec Delta

## Purpose

Quy định cách tính tiền mỗi lần gọi mô hình: giá theo mô hình có ngày hiệu lực, tỉ giá USD → VNĐ chung, hệ số giá mặc định hoặc riêng từng công ty, và cách quy ra số nguyên VNĐ mà không mất hay thừa tiền.

## ADDED Requirements

### Requirement: Bảng giá có ngày hiệu lực
Giá mô hình SHALL lưu trong cơ sở dữ liệu theo nhà cung cấp + mã mô hình, gồm giá vào, ra, cache đọc, cache ghi (USD cho 1 triệu token) và thời điểm hiệu lực. Mỗi lần gọi MUST dùng giá có thời điểm hiệu lực gần nhất không muộn hơn lúc gọi. Giá đã lưu MUST NOT sửa được; muốn đổi thì thêm giá mới.

#### Scenario: Giá mới bắt đầu hiệu lực
- **WHEN** `gpt-5.5-mini` có giá $0,50 từ 01/10 và giá $0,40 từ 01/12, và một lần gọi diễn ra ngày 02/12
- **THEN** `CostEntry` của lần gọi dùng giá $0,40

#### Scenario: Thêm giá cho ngày đã qua
- **WHEN** platform admin thêm giá với ngày hiệu lực hôm qua
- **THEN** API từ chối với lỗi ngày hiệu lực không được ở quá khứ

#### Scenario: Thêm giá trùng thời điểm
- **WHEN** platform admin thêm giá thứ hai cho cùng mô hình với cùng ngày hiệu lực
- **THEN** API từ chối và giá đã có giữ nguyên

### Requirement: Tỉ giá và hệ số giá
Tỉ giá USD → VNĐ SHALL là một giá trị chung cho mọi công ty. Hệ số giá SHALL là hệ số riêng của công ty nếu platform admin đã đặt, nếu không thì là hệ số mặc định. Mỗi `CostEntry` MUST lưu giá, tỉ giá và hệ số đã dùng.

#### Scenario: Công ty có hệ số riêng
- **WHEN** hệ số mặc định là 1,30, công ty A có hệ số riêng 1,15, và công ty A gọi mô hình
- **THEN** `CostEntry` của công ty A ghi hệ số 1,15

#### Scenario: Bỏ hệ số riêng
- **WHEN** platform admin bỏ hệ số riêng của công ty A
- **THEN** các lần gọi sau của công ty A dùng hệ số mặc định

### Requirement: Không tính lại giao dịch cũ
Đổi giá, tỉ giá hay hệ số SHALL chỉ áp dụng cho các lần gọi sau thời điểm đổi. `CostEntry` và giao dịch credit đã ghi MUST giữ nguyên.

#### Scenario: Đổi tỉ giá
- **WHEN** tỉ giá đổi từ 25.400đ sang 26.000đ
- **THEN** các `CostEntry` trước đó vẫn ghi tỉ giá 25.400đ và số tiền cũ, số dư không bị điều chỉnh

### Requirement: Tính tiền bằng số nguyên
Chi phí thật và số tiền bán (= chi phí thật × hệ số) SHALL được tính bằng phép tính số nguyên chính xác từ số token, giá, tỉ giá và hệ số, rồi làm tròn tới một phần triệu đồng. Phép tính MUST NOT dùng số thực.

#### Scenario: Một lần gọi
- **WHEN** gọi `claude-sonnet-5-5` (vào $3, ra $15 cho 1 triệu token) với 1.000 token vào và 500 token ra, tỉ giá 25.400đ, hệ số 1,30
- **THEN** `CostEntry` ghi chi phí thật 266,7đ và số tiền bán 346,71đ

#### Scenario: Token cache
- **WHEN** một lần gọi có 10.000 token cache đọc với giá cache đọc $0,30 cho 1 triệu token, tỉ giá 25.400đ, hệ số 1,30, không có token nào khác
- **THEN** `CostEntry` ghi chi phí thật 76,2đ và số tiền bán 99,06đ

### Requirement: Cộng dồn phần lẻ dưới một đồng
Số trừ vào credit mỗi lần SHALL là số nguyên đồng: lấy số tiền bán cộng phần lẻ còn lại của công ty, trừ phần nguyên, giữ phần lẻ (dưới 1 đồng) cho lần sau. Tổng đã trừ của công ty MUST luôn bằng phần nguyên của tổng số tiền bán.

#### Scenario: Hai lần gọi giống nhau
- **WHEN** công ty A chưa có phần lẻ và gọi hai lần, mỗi lần số tiền bán 346,71đ
- **THEN** lần đầu trừ 346đ (còn lẻ 0,71đ), lần hai trừ 347đ (còn lẻ 0,42đ), tổng đã trừ 693đ

#### Scenario: Lần gọi rất nhỏ
- **WHEN** công ty A chưa có phần lẻ và một lần gọi có số tiền bán 0,40đ
- **THEN** lần đó trừ 0đ, có giao dịch ghi 0đ gắn với `CostEntry`, và phần lẻ của công ty là 0,40đ
