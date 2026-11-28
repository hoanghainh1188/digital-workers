# Spec Delta

## Purpose

Tính số credit một worker đã dùng trong tháng từ `CostEntry` và cho biết worker còn ngân sách tháng hay không, để runtime ngừng giao việc mới cho worker hết ngân sách (#018) và giao diện hiện mức dùng so với ngân sách.

## ADDED Requirements

### Requirement: Chi phí tháng của worker
Chi phí tháng của một worker SHALL là tổng số tiền bán (đã nhân hệ số) của các `CostEntry` gắn với worker đó trong tháng dương lịch theo giờ Việt Nam (UTC+7), làm tròn xuống tới đồng. Chi phí MUST chỉ tính trong công ty của worker.

#### Scenario: Tính theo tháng giờ Việt Nam
- **WHEN** một lần gọi của worker diễn ra lúc 23:30 ngày 30/11 giờ Việt Nam (16:30 UTC)
- **THEN** chi phí đó tính vào tháng 11

#### Scenario: Lần gọi đầu tháng
- **WHEN** một lần gọi diễn ra lúc 00:10 ngày 01/12 giờ Việt Nam (17:10 UTC ngày 30/11)
- **THEN** chi phí đó tính vào tháng 12, không tính vào tháng 11

#### Scenario: Công ty khác không cộng vào
- **WHEN** truy vấn chi phí tháng của worker công ty A bằng ngữ cảnh công ty B
- **THEN** kết quả là 0đ

### Requirement: Kiểm tra ngân sách tháng
Hệ thống SHALL cho biết worker còn ngân sách hay đã hết, so chi phí tháng với ngân sách tháng được truyền vào. Chi phí tháng bằng hoặc vượt ngân sách MUST trả "hết ngân sách". Kiểm tra này chỉ dùng khi nhận việc mới; việc đang chạy không bị dừng vì hết ngân sách (#018).

#### Scenario: Còn ngân sách
- **WHEN** worker có ngân sách 300.000đ và chi phí tháng 268.900đ
- **THEN** kiểm tra trả còn ngân sách 31.100đ

#### Scenario: Hết ngân sách
- **WHEN** worker có ngân sách 300.000đ và chi phí tháng 300.000đ
- **THEN** kiểm tra trả hết ngân sách

#### Scenario: Sang tháng mới
- **WHEN** worker đã hết ngân sách tháng 11 và kiểm tra chạy ngày 01/12
- **THEN** kiểm tra trả còn ngân sách
