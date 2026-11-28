## ADDED Requirements

### Requirement: Máy chủ đặt ở Việt Nam
Máy ảo, ổ đĩa cơ sở dữ liệu và object storage chứa bản sao lưu SHALL thuộc vùng (region) đặt ở Việt Nam của nhà cung cấp cloud đã chốt (0.2 #011). Runbook MUST ghi tên nhà cung cấp và vùng của từng tài nguyên.

#### Scenario: Kiểm tra vùng của tài nguyên
- **WHEN** người vận hành đối chiếu runbook với bảng điều khiển của nhà cung cấp
- **THEN** máy ảo, ổ đĩa và bucket sao lưu đều ở vùng Việt Nam ghi trong runbook

### Requirement: HTTPS với chứng chỉ hợp lệ
Staging SHALL chỉ phục vụ người dùng qua HTTPS trên tên miền đã cấu hình, với chứng chỉ do tổ chức cấp chứng chỉ công khai ký và Caddy tự gia hạn. Yêu cầu HTTP MUST được chuyển sang HTTPS.

#### Scenario: Gọi kiểm tra còn sống từ ngoài
- **WHEN** một máy ngoài internet gọi `https://<staging>/health` và kiểm tra chứng chỉ
- **THEN** nhận HTTP 200 `{"status":"ok"}` và chứng chỉ hợp lệ cho đúng tên miền, chưa hết hạn

#### Scenario: Gọi bằng HTTP
- **WHEN** một máy ngoài gọi `http://<staging>/`
- **THEN** nhận chuyển hướng sang `https://<staging>/`

### Requirement: Kiểm tra sẵn sàng sau mỗi lần đưa bản mới
Sau mỗi lần đưa bản mới lên, quy trình deploy SHALL gọi `GET /health/ready` của api từ mạng nội bộ của máy chủ và chỉ báo thành công khi nhận HTTP 200. `/health/ready` MUST vẫn không gọi được từ ngoài internet (trả 404 qua Caddy, 0.2 #144).

#### Scenario: Deploy thành công
- **WHEN** chạy deploy một tag mới và cơ sở dữ liệu sẵn sàng
- **THEN** script deploy nhận HTTP 200 `{"status":"ready"}` từ api trong mạng nội bộ và báo thành công kèm tag đang chạy

#### Scenario: Gọi sẵn sàng từ ngoài
- **WHEN** một máy ngoài internet gọi `https://<staging>/health/ready`
- **THEN** nhận HTTP 404

### Requirement: Chỉ mở cổng cần thiết
Máy chủ SHALL chỉ nhận kết nối từ internet ở cổng 80 và 443 (TCP, và UDP 443 cho HTTP/3). SSH MUST chỉ nhận từ các địa chỉ IP ghi trong runbook và chỉ bằng khoá; không đăng nhập bằng mật khẩu, không đăng nhập thẳng `root`.

#### Scenario: Cổng PostgreSQL từ ngoài
- **WHEN** một máy ngoài internet thử kết nối TCP tới cổng 5432 của máy chủ
- **THEN** kết nối không thành công

#### Scenario: SSH từ IP lạ
- **WHEN** một địa chỉ IP không có trong danh sách cho phép thử kết nối cổng 22
- **THEN** kết nối bị chặn ở tường lửa

#### Scenario: SSH bằng mật khẩu
- **WHEN** một IP được phép thử đăng nhập SSH bằng mật khẩu
- **THEN** máy chủ từ chối, chỉ chấp nhận khoá

### Requirement: Đưa bản mới lên theo tag
Mỗi bản chạy trên máy chủ SHALL ứng với một ảnh build từ một commit trên `main`, gắn tag là git sha. Deploy MUST chạy migration xong rồi mới khởi động `api` và `runner`; migration lỗi MUST giữ nguyên bản đang chạy.

#### Scenario: Migration lỗi
- **WHEN** deploy một tag có migration chạy lỗi
- **THEN** `api` và `runner` của bản cũ vẫn chạy, script deploy báo lỗi và tag đang chạy không đổi

#### Scenario: Biết bản đang chạy
- **WHEN** người vận hành hỏi bản đang chạy trên staging
- **THEN** script deploy cho biết git sha đang chạy và git sha của lần deploy trước

### Requirement: Quay lại bản trước
Người vận hành SHALL quay lại được bản deploy trước bằng một lệnh. Vì migration chỉ thêm (không xoá / đổi tên cột đang dùng trong cùng một bản), bản trước MUST chạy được trên schema mới mà không cần khôi phục cơ sở dữ liệu.

#### Scenario: Quay lại sau một bản lỗi
- **WHEN** bản mới chạy nhưng có lỗi và người vận hành chạy lệnh quay lại
- **THEN** `api`, `runner`, `caddy` chạy lại ảnh của tag trước, `/health/ready` trả 200 và dữ liệu tạo ra trong lúc chạy bản mới vẫn còn

### Requirement: Bí mật trên máy chủ
Bí mật của staging SHALL nằm trong một file môi trường trên máy chủ, quyền 600, chủ là user chạy deploy; file MUST NOT có trong git, trong ảnh Docker hay trong bản sao lưu cơ sở dữ liệu. `ENCRYPTION_KEY` và khoá giải mã bản sao lưu MUST có bản sao giữ ngoài máy chủ, ở chỗ khác với bản sao lưu.

#### Scenario: Quyền file bí mật
- **WHEN** kiểm tra file môi trường trên máy chủ
- **THEN** quyền là 600, chủ là user deploy và user khác trên máy không đọc được

#### Scenario: Ảnh Docker không chứa bí mật
- **WHEN** liệt kê file và biến môi trường mặc định trong ảnh `api`, `runner`, `caddy`
- **THEN** không có `.env`, `.env.prod` hay giá trị của bất kỳ bí mật nào

#### Scenario: Mất máy chủ
- **WHEN** máy chủ bị xoá và dựng lại máy mới từ runbook
- **THEN** người vận hành có lại `ENCRYPTION_KEY` từ chỗ giữ ngoài máy chủ, khôi phục bản sao lưu và các API key đã lưu vẫn giải mã được
