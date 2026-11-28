## ADDED Requirements

### Requirement: Sao lưu hằng ngày
Máy chủ SHALL sao lưu toàn bộ cơ sở dữ liệu PostgreSQL mỗi ngày một lần, lúc 02:00 giờ Việt Nam, ra object storage cùng nhà cung cấp, đặt ở Việt Nam (0.2 #011). Bản sao lưu lỗi MUST được ghi log và không xoá bản cũ nào.

#### Scenario: Sao lưu thành công
- **WHEN** tới 02:00 giờ Việt Nam và cơ sở dữ liệu đang chạy
- **THEN** một bản sao lưu mới có tên chứa ngày giờ xuất hiện trong bucket ở Việt Nam

#### Scenario: Sao lưu lỗi
- **WHEN** tải bản sao lưu lên object storage thất bại
- **THEN** log máy chủ ghi lỗi (không chứa bí mật) và 14 bản cũ vẫn còn nguyên

### Requirement: Mã hoá bản sao lưu
Bản sao lưu SHALL được mã hoá trên máy chủ trước khi tải lên. Máy chủ MUST chỉ giữ khoá công khai để mã hoá; khoá giải mã giữ ngoài máy chủ, nên ai có quyền vào máy chủ hay bucket cũng không đọc được bản sao lưu đã có.

#### Scenario: Đọc bản sao lưu không có khoá
- **WHEN** tải một bản sao lưu từ bucket và mở mà không có khoá giải mã
- **THEN** không đọc được nội dung, không thấy tên bảng hay dữ liệu công ty nào

### Requirement: Giữ 14 bản
Sau mỗi lần sao lưu thành công, bucket SHALL còn đúng 14 bản mới nhất; bản cũ hơn MUST bị xoá. Chỉ xoá bản cũ khi bản mới đã tải lên đủ.

#### Scenario: Bản thứ 15
- **WHEN** bucket đang có 14 bản và lần sao lưu mới thành công
- **THEN** bucket còn 14 bản, bản cũ nhất đã bị xoá

### Requirement: Khôi phục vào cơ sở dữ liệu trống
Runbook SHALL có lệnh khôi phục bản sao lưu mới nhất (hoặc một bản chọn theo ngày) vào một PostgreSQL 16 trống. Sau khi khôi phục, cơ sở dữ liệu MUST có đủ migration, vai trò `dw_app` / `dw_owner` dùng được và RLS vẫn bật trên các bảng nghiệp vụ.

#### Scenario: Khôi phục bản mới nhất
- **WHEN** người vận hành có khoá giải mã chạy lệnh khôi phục bản mới nhất vào PostgreSQL trống
- **THEN** lệnh chạy xong không lỗi, số migration bằng trên staging, và `api` trỏ vào DB đó trả `/health/ready` 200

#### Scenario: Tách công ty sau khi khôi phục
- **WHEN** khôi phục xong một bản có dữ liệu của công ty A và công ty B và kết nối bằng `dw_app` với `app.company_id` của A
- **THEN** truy vấn bảng nghiệp vụ chỉ thấy dữ liệu của công ty A

### Requirement: Thử khôi phục định kỳ
Người vận hành SHALL chạy thử khôi phục ít nhất một lần trước khi mở staging cho khách thật và sau đó mỗi tháng một lần; mỗi lần thử ghi ngày, bản đã dùng và kết quả vào runbook.

#### Scenario: Thử khôi phục hằng tháng
- **WHEN** tới lần thử khôi phục của tháng
- **THEN** runbook có dòng mới ghi ngày thử, tên bản sao lưu và kết quả
