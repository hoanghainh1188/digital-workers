# worker-lifecycle Specification

## Purpose
Vòng đời của digital worker: Nháp → Thử việc → Chính thức ⇄ Tạm nghỉ, và Nghỉ việc từ mọi trạng thái, không quay lại; ai được chuyển trạng thái nào, cách đề nghị và duyệt chính thức, thời hạn thử việc và lịch sử trạng thái.

## Requirements

### Requirement: Đường chuyển trạng thái hợp lệ
Worker SHALL chỉ chuyển theo các đường: Nháp → Thử việc; Thử việc → Chính thức; Chính thức → Tạm nghỉ; Tạm nghỉ → Chính thức; Nháp / Thử việc / Chính thức / Tạm nghỉ → Nghỉ việc. Mọi đường khác MUST bị từ chối với 409 và trạng thái giữ nguyên. Kiểm tra nằm trong API.

#### Scenario: Cho thử việc
- **WHEN** Trưởng phòng bấm "Cho thử việc" với worker Nháp phòng mình có mô tả công việc
- **THEN** worker sang Thử việc và có `AuditEvent` chuyển trạng thái

#### Scenario: Nháp lên thẳng Chính thức
- **WHEN** Owner gọi API chuyển worker Nháp sang Chính thức
- **THEN** API trả 409 với lỗi đường chuyển không hợp lệ và worker vẫn ở Nháp

#### Scenario: Tạm nghỉ từ Thử việc
- **WHEN** Admin gọi API chuyển worker Thử việc sang Tạm nghỉ
- **THEN** API trả 409 và worker vẫn ở Thử việc

#### Scenario: Chính thức về Thử việc
- **WHEN** Admin gọi API chuyển worker Chính thức về Thử việc
- **THEN** API trả 409 và worker vẫn Chính thức

#### Scenario: Đi làm lại
- **WHEN** Trưởng phòng bấm "Đi làm lại" với worker Tạm nghỉ phòng mình
- **THEN** worker về Chính thức và có `AuditEvent` chuyển trạng thái

### Requirement: Ai được chuyển trạng thái
Owner / Admin SHALL chuyển được mọi đường hợp lệ với mọi worker. Trưởng phòng chuyển được với worker phòng mình mọi đường trừ Thử việc → Chính thức (chỉ đề nghị). Nhân viên, kể cả khi là người quản lý worker, MUST NOT chuyển trạng thái.

#### Scenario: Trưởng phòng tự cho chính thức
- **WHEN** Trưởng phòng gọi API chuyển worker Thử việc phòng mình sang Chính thức
- **THEN** API trả 403 và worker vẫn ở Thử việc

#### Scenario: Trưởng phòng thao tác worker phòng khác
- **WHEN** Trưởng phòng Kinh doanh gọi API cho tạm nghỉ, cho nghỉ việc hoặc cho thử việc một worker phòng Kế toán
- **THEN** API trả 403, trạng thái giữ nguyên và có `AuditEvent` truy cập bị từ chối

#### Scenario: Nhân viên là người quản lý
- **WHEN** Nhân viên đang là người quản lý của worker Chính thức gọi API cho worker tạm nghỉ
- **THEN** API trả 403 và worker vẫn Chính thức

#### Scenario: Owner cho chính thức không cần đề nghị
- **WHEN** Owner bấm "Duyệt chính thức" với worker Thử việc chưa có đề nghị nào
- **THEN** worker sang Chính thức và lịch sử ghi Owner là người duyệt

#### Scenario: Worker công ty khác
- **WHEN** Admin công ty A gọi API chuyển trạng thái worker công ty B
- **THEN** API trả 404 và worker công ty B giữ nguyên

### Requirement: Cho thử việc cần mô tả công việc
Worker Nháp SHALL chỉ chuyển sang Thử việc khi mô tả công việc không trống. Bắt đầu thử việc ghi ngày bắt đầu và ngày hết hạn sau 14 ngày theo giờ Việt Nam.

#### Scenario: Mô tả trống
- **WHEN** Admin bấm "Cho thử việc" với worker Nháp có mô tả công việc trống
- **THEN** API trả 400 với lỗi thiếu mô tả công việc và worker vẫn ở Nháp

#### Scenario: Đếm ngày thử việc
- **WHEN** worker bắt đầu thử việc ngày 23/11 và hôm nay là 26/11 giờ Việt Nam
- **THEN** hồ sơ và thẻ trên sơ đồ hiện "Thử việc · ngày 4/14"

### Requirement: Đề nghị chính thức
Trưởng phòng SHALL đề nghị được cho worker Thử việc phòng mình lên Chính thức, kèm ghi chú tuỳ chọn tối đa 500 ký tự. Mỗi worker có tối đa một đề nghị đang chờ. Worker vẫn ở Thử việc cho tới khi Owner / Admin duyệt.

#### Scenario: Trưởng phòng đề nghị
- **WHEN** Trưởng phòng bấm "Đề nghị chính thức" cho worker Thử việc phòng mình
- **THEN** có một đề nghị đang chờ, worker vẫn ở Thử việc, Owner / Admin thấy đề nghị trên hồ sơ và có `AuditEvent` đề nghị chính thức

#### Scenario: Đề nghị lần hai khi đang chờ
- **WHEN** Trưởng phòng gửi đề nghị chính thức cho worker đã có đề nghị đang chờ
- **THEN** API trả 409 và vẫn chỉ có một đề nghị đang chờ

#### Scenario: Nhân viên đề nghị
- **WHEN** Nhân viên gọi API đề nghị chính thức
- **THEN** API trả 403 và không có đề nghị nào được tạo

### Requirement: Duyệt hoặc trả lại đề nghị
Owner / Admin SHALL duyệt đề nghị (worker sang Chính thức) hoặc trả lại kèm lý do bắt buộc (worker ở lại Thử việc). Lịch sử MUST ghi người đề nghị, người quyết và lý do trả lại. Worker rời Thử việc bằng đường khác thì đề nghị đang chờ bị đóng.

#### Scenario: Duyệt đề nghị
- **WHEN** Owner bấm "Duyệt chính thức" với worker có đề nghị của Nguyễn Thị Lan
- **THEN** worker sang Chính thức, đề nghị được đóng là đã duyệt và lịch sử ghi "Owner duyệt đề nghị của Nguyễn Thị Lan"

#### Scenario: Trả lại không có lý do
- **WHEN** Admin bấm "Trả lại" một đề nghị mà để trống lý do
- **THEN** API trả 400 và đề nghị vẫn đang chờ

#### Scenario: Trả lại có lý do
- **WHEN** Admin trả lại đề nghị với lý do "Còn sai giá ở 2 báo giá"
- **THEN** worker vẫn ở Thử việc, đề nghị được đóng là trả lại, người đề nghị thấy lý do trên hồ sơ và Trưởng phòng đề nghị lại được

#### Scenario: Trưởng phòng duyệt
- **WHEN** Trưởng phòng gọi API duyệt hoặc trả lại một đề nghị
- **THEN** API trả 403 và đề nghị vẫn đang chờ

### Requirement: Lên chính thức nâng ngân sách mặc định
Khi worker lên Chính thức mà ngân sách tháng vẫn là mặc định thử việc 300.000đ, ngân sách SHALL tự thành 800.000đ. Ngân sách đã được đặt khác 300.000đ thì giữ nguyên.

#### Scenario: Ngân sách mặc định
- **WHEN** worker có ngân sách 300.000đ được duyệt lên Chính thức
- **THEN** ngân sách tháng thành 800.000đ

#### Scenario: Ngân sách đã chỉnh
- **WHEN** worker có ngân sách 500.000đ được duyệt lên Chính thức
- **THEN** ngân sách tháng vẫn là 500.000đ

### Requirement: Thời hạn thử việc
Thử việc SHALL kéo dài 14 ngày kể từ ngày bắt đầu. Người đổi được trạng thái worker gia hạn được thêm 7 hoặc 14 ngày, mỗi lần có `AuditEvent`. Hết hạn mà chưa ai quyết, worker MUST vẫn ở Thử việc và hồ sơ, sơ đồ báo "đã hết hạn thử việc" kèm việc cần làm.

#### Scenario: Hết hạn thử việc
- **WHEN** worker đã thử việc quá 14 ngày và chưa được duyệt
- **THEN** worker vẫn ở Thử việc, hồ sơ và thẻ trên sơ đồ hiện "Hết hạn thử việc" với nút đề nghị chính thức hoặc gia hạn cho người có quyền

#### Scenario: Gia hạn
- **WHEN** Trưởng phòng gia hạn thêm 7 ngày cho worker Thử việc phòng mình
- **THEN** ngày hết hạn lùi 7 ngày và có `AuditEvent` gia hạn thử việc

#### Scenario: Gia hạn số ngày khác
- **WHEN** Admin gọi API gia hạn 10 ngày
- **THEN** API trả 400 và ngày hết hạn giữ nguyên

### Requirement: Tạm nghỉ
Worker Chính thức SHALL chuyển được sang Tạm nghỉ, lý do tuỳ chọn tối đa 500 ký tự. Worker Tạm nghỉ MUST NOT nhận việc mới; trạng thái này được cung cấp cho phần chạy worker, kênh chat và lịch chạy.

#### Scenario: Tạm nghỉ không lý do
- **WHEN** Trưởng phòng cho worker Chính thức phòng mình tạm nghỉ mà không ghi lý do
- **THEN** worker sang Tạm nghỉ, lịch sử ghi người và thời điểm

#### Scenario: Trạng thái cho phần chạy worker
- **WHEN** phần chạy worker hỏi trạng thái của một worker Tạm nghỉ
- **THEN** câu trả lời là không nhận việc mới, kèm trạng thái Tạm nghỉ

### Requirement: Nghỉ việc không quay lại
Worker ở Nháp, Thử việc, Chính thức hoặc Tạm nghỉ SHALL chuyển được sang Nghỉ việc với lý do bắt buộc và gõ lại đúng tên worker để xác nhận. Nghỉ việc là trạng thái cuối: mọi chuyển trạng thái, sửa hồ sơ và đổi phòng sau đó MUST bị từ chối. Hồ sơ và lịch sử giữ để tra cứu.

#### Scenario: Cho nghỉ việc
- **WHEN** Owner cho worker Tạm nghỉ nghỉ việc với lý do "Đổi sang dùng Zalo OA" và gõ đúng tên
- **THEN** worker sang Nghỉ việc, lịch sử ghi Owner, thời điểm, lý do, và có `AuditEvent` chuyển trạng thái

#### Scenario: Thiếu lý do hoặc sai tên
- **WHEN** Trưởng phòng cho nghỉ việc mà để trống lý do hoặc gõ sai tên worker
- **THEN** API trả 400 và trạng thái giữ nguyên

#### Scenario: Quay lại từ Nghỉ việc
- **WHEN** Owner gọi API chuyển worker Nghỉ việc sang Chính thức, Tạm nghỉ, Thử việc hay Nháp
- **THEN** API trả 409 với lỗi worker đã nghỉ việc và worker vẫn Nghỉ việc

#### Scenario: Bỏ bản nháp
- **WHEN** Trưởng phòng cho worker Nháp nghỉ việc với lý do "Tạo nhầm"
- **THEN** worker sang Nghỉ việc, tên được giải phóng và worker hiện trong nhóm "Đã nghỉ việc" của sơ đồ

### Requirement: Chuyển trạng thái đồng thời
Mỗi yêu cầu chuyển trạng thái SHALL gửi kèm trạng thái hiện tại mà người dùng đang thấy. Trạng thái trong hệ thống đã khác thì yêu cầu MUST bị từ chối với 409 và không có gì thay đổi.

#### Scenario: Hai người bấm cùng lúc
- **WHEN** Trưởng phòng cho worker Chính thức tạm nghỉ đúng lúc Owner cho worker đó nghỉ việc, và yêu cầu của Owner tới trước
- **THEN** worker ở Nghỉ việc, yêu cầu của Trưởng phòng nhận 409 và lịch sử chỉ có một lần chuyển

### Requirement: Lịch sử trạng thái
Mỗi lần chuyển trạng thái, đề nghị, trả lại đề nghị và gia hạn thử việc SHALL được ghi vào lịch sử của worker (chỉ thêm, không sửa / xoá) với người làm, thời điểm, trạng thái trước / sau và lý do nếu có. Người xem được hồ sơ thì xem được lịch sử.

#### Scenario: Xem lịch sử
- **WHEN** Nhân viên phòng Kinh doanh mở hồ sơ worker phòng mình đã qua thử việc và chính thức
- **THEN** thấy lịch sử mới nhất trước: "Lên chính thức · người duyệt", "Bắt đầu thử việc · người làm", "Tạo bản nháp từ mẫu"

#### Scenario: Lịch sử thuộc công ty
- **WHEN** người công ty B gọi API lịch sử với id worker công ty A
- **THEN** API trả 404
