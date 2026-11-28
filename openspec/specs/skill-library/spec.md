# skill-library Specification

## Purpose
Thư viện kỹ năng nội bộ của mỗi công ty: tạo, sửa, version, duyệt, mức rủi ro, quay lại version cũ, lưu trữ và dùng mẫu, để worker chỉ làm theo quy trình đã được Owner / Admin duyệt.

## Requirements

### Requirement: Xem thư viện kỹ năng
Mọi thành viên đang hoạt động SHALL xem được danh sách kỹ năng của công ty mình, gồm tên hiển thị, `name`, mô tả, trạng thái (Nháp, Chờ duyệt, Đang dùng, Lưu trữ), version đang dùng, version chờ duyệt, mức rủi ro, có script hay không và số worker đang dùng. Danh sách MUST tìm được theo tên và lọc được theo trạng thái và mức rủi ro; mặc định ẩn kỹ năng đã lưu trữ.

#### Scenario: Nhân viên xem thư viện
- **WHEN** Nhân viên mở trang Thư viện kỹ năng
- **THEN** thấy mọi kỹ năng chưa lưu trữ của công ty mình kèm trạng thái, version và mức rủi ro

#### Scenario: Lọc theo rủi ro
- **WHEN** người dùng lọc mức rủi ro "Cao"
- **THEN** chỉ còn kỹ năng có mức rủi ro cao, và bộ lọc nằm trên URL để mở lại được

#### Scenario: Không thấy kỹ năng công ty khác
- **WHEN** người dùng công ty A gọi `GET /api/skills`
- **THEN** kết quả không có kỹ năng nào của công ty B

### Requirement: Xem chi tiết kỹ năng
Mọi thành viên SHALL xem được chi tiết một kỹ năng của công ty mình: cây file và nội dung từng file của một version, lịch sử version (người tạo, người duyệt, ngày, ghi chú thay đổi) và danh sách worker đang dùng kèm version. Id kỹ năng hoặc version của công ty khác MUST trả 404 như id không tồn tại.

#### Scenario: Xem version chờ duyệt
- **WHEN** người dùng mở kỹ năng có v2 đang dùng và v3 chờ duyệt
- **THEN** trang hiện nội dung v3, ghi chú "so với v2", và nói rõ worker nào vẫn dùng v2

#### Scenario: Đoán id kỹ năng công ty khác
- **WHEN** người dùng công ty A gọi `GET /api/skills/{id}` với id kỹ năng của công ty B
- **THEN** API trả 404 với cùng nội dung như id không tồn tại, và công ty A có `AuditEvent` loại truy cập không tìm thấy

### Requirement: Tạo kỹ năng
Mọi vai trò SHALL tạo được kỹ năng mới ở trạng thái Nháp với version 1 là bản nháp. Gói kỹ năng MUST hợp lệ theo capability `skill-package`. `name` MUST duy nhất trong các kỹ năng chưa lưu trữ của công ty và không đổi sau khi tạo. Công ty của kỹ năng lấy từ phiên, không lấy từ dữ liệu gửi lên.

#### Scenario: Nhân viên tạo kỹ năng
- **WHEN** Nhân viên tạo kỹ năng với `SKILL.md` hợp lệ
- **THEN** kỹ năng ở trạng thái Nháp, có v1 là bản nháp, người tạo là Nhân viên đó

#### Scenario: Trùng name
- **WHEN** người dùng tạo kỹ năng có `name` trùng một kỹ năng chưa lưu trữ của công ty
- **THEN** API trả 409 với lý do "tên đã có trong thư viện" và không tạo gì

#### Scenario: Trùng name với công ty khác
- **WHEN** công ty B đã có kỹ năng `lap-bao-gia` và người dùng công ty A tạo kỹ năng cùng `name`
- **THEN** kỹ năng được tạo ở công ty A, không báo trùng và không lộ gì về công ty B

### Requirement: Sửa kỹ năng tạo version mới
Sửa một kỹ năng SHALL ghi vào bản nháp đang mở của nó; nếu chưa có bản nháp thì tạo version mới (số kế tiếp) từ version mới nhất. Mỗi kỹ năng MUST có tối đa một bản nháp. Version đã gửi duyệt, đã duyệt hoặc bị từ chối MUST NOT bị sửa. Lưu bản nháp dựa trên bản đã cũ hơn bản đang có MUST bị từ chối.

#### Scenario: Sửa kỹ năng đang dùng
- **WHEN** Trưởng phòng sửa kỹ năng có v2 đang dùng và chưa có bản nháp
- **THEN** có v3 là bản nháp chứa thay đổi, v2 vẫn là version đang dùng

#### Scenario: Hai người cùng sửa
- **WHEN** hai người mở cùng bản nháp và người thứ hai lưu sau người thứ nhất
- **THEN** lần lưu thứ hai bị từ chối với lý do bản nháp đã thay đổi, nội dung của người thứ nhất được giữ

#### Scenario: Sửa kỹ năng công ty khác
- **WHEN** người dùng công ty A gửi bản sửa cho id kỹ năng của công ty B
- **THEN** API trả 404 và kỹ năng của công ty B không đổi

### Requirement: Gửi duyệt version
Người dùng SHALL gửi bản nháp đi duyệt kèm ghi chú thay đổi; bản nháp chuyển sang Chờ duyệt và không sửa được nữa. Nếu kỹ năng đã có một version Chờ duyệt khác, version đó MUST chuyển sang "Đã thay" và không duyệt được nữa.

#### Scenario: Gửi duyệt khi đã có bản chờ duyệt
- **WHEN** kỹ năng có v3 chờ duyệt và người dùng gửi duyệt v4
- **THEN** v4 chờ duyệt, v3 thành "Đã thay", version đang dùng không đổi

### Requirement: Duyệt version
Chỉ Owner / Admin SHALL duyệt được version Chờ duyệt; khi duyệt MUST chốt mức rủi ro. Version được duyệt trở thành version đang dùng của kỹ năng và mọi worker đang dùng kỹ năng chuyển sang version đó. Trưởng phòng / Nhân viên duyệt MUST bị từ chối với 403.

#### Scenario: Admin duyệt
- **WHEN** Admin duyệt v3 của kỹ năng có 2 worker đang dùng v2, chọn rủi ro trung bình
- **THEN** v3 là version đang dùng với rủi ro trung bình, cả 2 worker dùng v3, ghi người duyệt và thời điểm

#### Scenario: Trưởng phòng gọi API duyệt
- **WHEN** Trưởng phòng gửi thẳng yêu cầu duyệt một version (không qua giao diện)
- **THEN** API trả 403, version vẫn Chờ duyệt và có `AuditEvent` truy cập bị từ chối

#### Scenario: Duyệt version công ty khác
- **WHEN** Admin công ty A duyệt id version của công ty B
- **THEN** API trả 404 và version của công ty B không đổi

### Requirement: Từ chối version
Chỉ Owner / Admin SHALL từ chối được version Chờ duyệt, kèm lý do bắt buộc. Version bị từ chối không duyệt lại được; người dùng sửa tiếp thì tạo bản nháp mới. Version đang dùng không đổi.

#### Scenario: Từ chối có lý do
- **WHEN** Owner từ chối v3 với lý do "chiết khấu sai"
- **THEN** v3 ở trạng thái Từ chối kèm lý do, worker vẫn dùng v2

#### Scenario: Từ chối không lý do
- **WHEN** Owner từ chối v3 mà không nhập lý do
- **THEN** API trả 400 và v3 vẫn Chờ duyệt

### Requirement: Worker giữ version cũ tới khi duyệt
Version mới của một kỹ năng MUST NOT được worker dùng trước khi được duyệt. Điều này áp dụng cho mọi version, kể cả version mới của kỹ năng có script.

#### Scenario: Ba worker giữ version cũ
- **WHEN** kỹ năng đang được 3 worker dùng ở v2 có v3 được gửi duyệt
- **THEN** cả 3 worker vẫn dùng v2 cho tới khi v3 được duyệt

#### Scenario: Version mới của kỹ năng có script
- **WHEN** kỹ năng có script được sửa và gửi duyệt
- **THEN** version mới chưa được dùng ở worker nào cho tới khi Owner / Admin duyệt

### Requirement: Mức rủi ro của kỹ năng
Mỗi version SHALL có mức rủi ro thấp / trung bình / cao: hệ thống gợi ý, người tạo chọn khi gửi duyệt, Owner / Admin chốt khi duyệt. Version có thư mục `scripts/` MUST luôn ở mức cao và không hạ được. Mức rủi ro của kỹ năng là mức của version đang dùng, hoặc của version mới nhất nếu chưa có version đang dùng.

#### Scenario: Gợi ý theo nội dung
- **WHEN** người dùng gửi duyệt một kỹ năng chỉ soạn văn bản, không đọc dữ liệu
- **THEN** mức gợi ý là thấp và người dùng đổi được trước khi gửi

#### Scenario: Không hạ rủi ro kỹ năng có script
- **WHEN** Admin duyệt version có `scripts/` với mức rủi ro trung bình
- **THEN** API trả 400 với lý do kỹ năng có script luôn rủi ro cao, version vẫn Chờ duyệt

### Requirement: Quay lại version cũ
Chỉ Owner / Admin SHALL quay lại được một version đã từng được duyệt của kỹ năng bằng một thao tác; version đó trở thành version đang dùng ngay và mọi worker đang dùng kỹ năng chuyển sang. Version chưa từng được duyệt MUST NOT là đích quay lại.

#### Scenario: Quay lại v1
- **WHEN** Owner bấm "Quay lại v1" trên kỹ năng đang dùng v2
- **THEN** v1 là version đang dùng, mọi worker đang dùng kỹ năng dùng v1, lịch sử ghi người quay lại

#### Scenario: Nhân viên quay lại
- **WHEN** Nhân viên gửi thẳng yêu cầu quay lại version
- **THEN** API trả 403 và version đang dùng không đổi

### Requirement: Lưu trữ kỹ năng
Chỉ Owner / Admin SHALL lưu trữ được kỹ năng, và chỉ khi không còn worker nào (trừ worker đã Nghỉ việc) được giao, đang chờ duyệt giao hoặc bị tạm khoá kỹ năng đó. Còn worker thì MUST trả 409 kèm số worker. Kỹ năng đã lưu trữ ẩn khỏi danh sách mặc định, không sửa và không giao được, lịch sử giữ nguyên.

#### Scenario: Còn worker dùng
- **WHEN** Admin lưu trữ kỹ năng đang được 2 worker dùng
- **THEN** API trả 409 với số worker là 2, kỹ năng không đổi, giao diện dẫn tới danh sách worker đó

#### Scenario: Không còn worker dùng
- **WHEN** Admin lưu trữ kỹ năng không còn worker nào dùng
- **THEN** kỹ năng ở trạng thái Lưu trữ và `name` của nó dùng lại được cho kỹ năng mới

### Requirement: Kỹ năng mẫu có sẵn
Hệ thống SHALL có 10 kỹ năng mẫu tiếng Việt, giống nhau cho mọi công ty và chỉ đọc. Mọi vai trò xem được mẫu; "Dùng mẫu" MUST tạo một kỹ năng Nháp của công ty với nội dung của mẫu, theo luật tạo kỹ năng.

#### Scenario: Dùng mẫu
- **WHEN** Trưởng phòng bấm "Dùng mẫu" ở mẫu "Lập báo giá"
- **THEN** công ty có kỹ năng Nháp mới với nội dung của mẫu, sửa được như kỹ năng khác, mẫu gốc không đổi

#### Scenario: Mẫu của một công ty không ảnh hưởng công ty khác
- **WHEN** công ty A dùng và sửa kỹ năng tạo từ mẫu "Tóm tắt email"
- **THEN** công ty B vẫn thấy mẫu gốc và không thấy kỹ năng của công ty A

### Requirement: Nhật ký thao tác kỹ năng
Hệ thống SHALL ghi một `AuditEvent` cho mỗi: tạo kỹ năng (kể cả từ mẫu, từ `.zip`), tạo version, gửi duyệt, duyệt, từ chối, quay lại version, lưu trữ và xuất `.zip`. Sự kiện MUST chỉ chứa id, loại hành động và tên trường; MUST NOT chứa nội dung `SKILL.md`, nội dung file hay lý do từ chối.

#### Scenario: Ghi khi duyệt
- **WHEN** Admin duyệt một version
- **THEN** công ty có `AuditEvent` duyệt version với người thực hiện, id kỹ năng, id version và thời điểm, không có nội dung kỹ năng
