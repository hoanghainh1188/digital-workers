# Spec Delta

## Purpose

Một giao diện kênh chat chung (web chat, Telegram, Zalo) để worker runtime nhận tin đã chuẩn hoá và gửi trả lời mà không cần biết kênh cụ thể; thêm kênh mới không phải sửa runtime.

## ADDED Requirements

### Requirement: Tin vào chuẩn hoá
Mọi kênh SHALL đổi tin nhận được thành một dạng chung gồm: kênh, công ty, worker, loại cuộc chat (1:1 hay nhóm), người gửi (đã ghép tài khoản hay chưa), nội dung, tin có gửi cho worker không (1:1, được gọi tên hoặc trả lời tin của worker). Công ty và worker MUST lấy từ cấu hình kênh hoặc phiên đăng nhập, không từ nội dung tin.

#### Scenario: Tin web chat
- **WHEN** Nhân viên đã đăng nhập gửi tin cho worker qua web chat
- **THEN** tin chuẩn hoá có kênh web, loại 1:1, người gửi là thành viên đó và được đánh dấu là gửi cho worker

#### Scenario: Tin tự khai công ty khác
- **WHEN** nội dung tin hoặc dữ liệu gửi lên ghi id của công ty B
- **THEN** tin chuẩn hoá vẫn mang công ty lấy từ phiên của người gửi, không phải công ty B

### Requirement: Gửi tin tự chia theo độ dài
Mỗi kênh SHALL khai báo độ dài tối đa một tin và tự chia câu trả lời dài thành nhiều tin không vượt giới hạn đó, ưu tiên chia ở đoạn, rồi dòng, rồi câu, rồi khoảng trắng. Việc chia MUST NOT làm mất, đổi thứ tự hay cắt đôi ký tự nào.

#### Scenario: Câu trả lời dài trên kênh 2000 ký tự
- **WHEN** worker trả lời 4.500 ký tự gồm nhiều đoạn trên kênh có giới hạn 2.000 ký tự
- **THEN** người nhận nhận 3 tin, mỗi tin ≤ 2.000 ký tự, ghép lại đúng nguyên văn, không tin nào bắt đầu giữa một từ

#### Scenario: Ký tự tiếng Việt và emoji ở chỗ cắt
- **WHEN** điểm chia rơi vào giữa một emoji hoặc chữ có dấu viết bằng ký tự tổ hợp
- **THEN** ký tự đó nằm trọn trong một tin

### Requirement: Báo đang làm
Mỗi kênh SHALL có cách báo "đang làm…" cho người nhắn. Runtime MUST báo trong vòng 3 giây sau khi bắt đầu chạy một `Task` (NFR-06).

#### Scenario: Bắt đầu làm việc
- **WHEN** runner bắt đầu chạy một `Task` của web chat
- **THEN** trong vòng 3 giây người nhắn thấy worker "đang làm…"

### Requirement: Khai báo khả năng của kênh
Mỗi kênh SHALL khai báo nó có hỗ trợ nhóm, nút bấm và file hay không. Runtime MUST dựa vào khai báo này, không dựa vào tên kênh, để quyết định cách gửi.

#### Scenario: Kênh web không có nút
- **WHEN** runtime hỏi khả năng của kênh web ở change này
- **THEN** kênh web khai báo không có nhóm, không có nút, không có file

### Requirement: Kênh giả cho test
SHALL có một kênh giả cài đúng giao diện chung, ghi lại mọi tin gửi đi và mọi lần báo đang làm, để test runtime không cần kênh thật.

#### Scenario: Test runtime với kênh giả
- **WHEN** test chạy một `Task` qua kênh giả
- **THEN** test đọc được các tin worker gửi và lần báo đang làm theo đúng thứ tự
