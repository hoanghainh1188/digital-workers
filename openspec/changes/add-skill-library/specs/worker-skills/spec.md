## Purpose

Giao kỹ năng đã duyệt cho worker, duyệt yêu cầu giao, gỡ kỹ năng, và cho biết mỗi worker đang dùng version nào, với luật quyền kiểm tra trong API theo trạng thái worker và vai trò người giao.

## ADDED Requirements

### Requirement: Chỉ giao kỹ năng đã duyệt
Chỉ kỹ năng chưa lưu trữ và có version đang dùng SHALL giao được cho worker. Worker đã Nghỉ việc MUST NOT được giao kỹ năng. Một worker MUST NOT được giao cùng một kỹ năng hai lần. Mọi lần giao từ màn kỹ năng hay từ hồ sơ worker MUST đi qua cùng một luật.

#### Scenario: Kỹ năng chưa từng được duyệt
- **WHEN** Admin giao một kỹ năng chỉ có bản nháp cho worker
- **THEN** API trả 409 với lý do kỹ năng chưa có version được duyệt

#### Scenario: Worker đã nghỉ việc
- **WHEN** Admin giao kỹ năng cho worker đã Nghỉ việc
- **THEN** API trả 409 và không có gì được giao

#### Scenario: Cùng luật ở hai nơi
- **WHEN** Trưởng phòng giao cùng một kỹ năng cho cùng một worker Chính thức, một lần từ màn kỹ năng, một lần từ tab Kỹ năng của hồ sơ worker
- **THEN** cả hai lần đều cho cùng kết quả (chờ Owner / Admin duyệt) và chỉ có một yêu cầu giao

### Requirement: Ai được giao kỹ năng
Owner / Admin SHALL giao được kỹ năng cho mọi worker của công ty; Trưởng phòng chỉ cho worker thuộc phòng mình; Nhân viên không giao được. Không đủ quyền MUST trả 403 kèm `AuditEvent`; worker của công ty khác MUST trả 404.

#### Scenario: Nhân viên giao kỹ năng
- **WHEN** Nhân viên gửi thẳng yêu cầu giao kỹ năng cho một worker
- **THEN** API trả 403, worker không có kỹ năng mới và có `AuditEvent` truy cập bị từ chối

#### Scenario: Trưởng phòng giao cho phòng khác
- **WHEN** Trưởng phòng Kinh doanh giao kỹ năng cho worker của phòng Kế toán
- **THEN** API trả 403 và không có gì được giao

#### Scenario: Giao cho worker công ty khác
- **WHEN** Admin công ty A giao kỹ năng cho id worker của công ty B
- **THEN** API trả 404 và worker của công ty B không đổi

### Requirement: Giao kỹ năng cho worker Nháp hoặc Thử việc
Giao kỹ năng không có script cho worker ở trạng thái Nháp hoặc Thử việc SHALL có hiệu lực ngay, với bất kỳ người có quyền giao nào, không cần duyệt.

#### Scenario: Trưởng phòng giao cho worker thử việc
- **WHEN** Trưởng phòng giao kỹ năng "Tóm tắt email" (không script) cho worker Thử việc của phòng mình
- **THEN** worker dùng ngay version đang dùng của kỹ năng

### Requirement: Giao kỹ năng cho worker Chính thức hoặc Tạm nghỉ
Với worker Chính thức hoặc Tạm nghỉ, Owner / Admin giao SHALL có hiệu lực ngay; Trưởng phòng giao MUST tạo yêu cầu "Chờ duyệt" và worker chưa dùng kỹ năng cho tới khi Owner / Admin duyệt.

#### Scenario: Trưởng phòng giao cho worker chính thức
- **WHEN** Trưởng phòng giao kỹ năng cho worker Chính thức của phòng mình
- **THEN** có yêu cầu giao Chờ duyệt, worker chưa dùng kỹ năng, Owner / Admin thấy yêu cầu trên màn kỹ năng và hồ sơ worker

#### Scenario: Admin giao cho worker chính thức
- **WHEN** Admin giao kỹ năng không có script cho worker Chính thức
- **THEN** worker dùng ngay version đang dùng của kỹ năng

### Requirement: Giao kỹ năng có script
Giao kỹ năng có script SHALL luôn tạo yêu cầu Chờ duyệt, kể cả khi Owner / Admin giao. Cho tới khi có kiểm duyệt (change `add-review-and-scanner`), kỹ năng có script MUST NOT giao được cho worker Chính thức hoặc Tạm nghỉ, và yêu cầu giao như vậy MUST bị từ chối với 409 kèm lý do cần kiểm duyệt.

#### Scenario: Kỹ năng có script cho worker chính thức
- **WHEN** Owner giao kỹ năng có script cho worker Chính thức
- **THEN** API trả 409 với lý do kỹ năng có script cần qua kiểm duyệt trước khi giao cho worker chính thức, và không có yêu cầu nào được tạo

#### Scenario: Kỹ năng có script cho worker thử việc
- **WHEN** Admin giao kỹ năng có script cho worker Thử việc
- **THEN** có yêu cầu giao Chờ duyệt; worker chỉ dùng kỹ năng sau khi Owner / Admin duyệt yêu cầu

#### Scenario: Worker được chính thức hoá khi đang có kỹ năng script
- **WHEN** worker Thử việc đang được giao kỹ năng có script được chuyển sang Chính thức
- **THEN** kỹ năng có script của worker đó ngừng có hiệu lực (Tạm khoá) cho tới khi có kiểm duyệt, các kỹ năng khác không đổi

#### Scenario: Version mới thêm script cho kỹ năng worker chính thức đang dùng
- **WHEN** Owner duyệt version có `scripts/` của một kỹ năng đang được worker Chính thức dùng
- **THEN** phần giao kỹ năng đó của worker Chính thức chuyển Tạm khoá trong cùng thao tác, worker Thử việc vẫn dùng version mới

### Requirement: Duyệt yêu cầu giao kỹ năng
Chỉ Owner / Admin SHALL duyệt hoặc từ chối yêu cầu giao Chờ duyệt. Duyệt làm worker dùng version đang dùng của kỹ năng; từ chối xoá yêu cầu và ghi người từ chối. Trưởng phòng / Nhân viên duyệt MUST bị 403.

#### Scenario: Owner duyệt yêu cầu
- **WHEN** Owner duyệt yêu cầu giao do Trưởng phòng tạo
- **THEN** worker dùng version đang dùng của kỹ năng, lịch sử ghi người giao và người duyệt

#### Scenario: Trưởng phòng tự duyệt
- **WHEN** Trưởng phòng gửi thẳng yêu cầu duyệt yêu cầu giao của chính mình
- **THEN** API trả 403 và yêu cầu vẫn Chờ duyệt

#### Scenario: Duyệt yêu cầu công ty khác
- **WHEN** Admin công ty A duyệt id yêu cầu giao của công ty B
- **THEN** API trả 404 và yêu cầu của công ty B không đổi

### Requirement: Gỡ kỹ năng khỏi worker
Người có quyền giao kỹ năng cho một worker SHALL gỡ được kỹ năng (kể cả huỷ yêu cầu Chờ duyệt) khỏi worker đó, không cần duyệt. Gỡ có hiệu lực cho việc mới; việc đang chạy làm nốt.

#### Scenario: Trưởng phòng gỡ kỹ năng
- **WHEN** Trưởng phòng gỡ một kỹ năng khỏi worker của phòng mình
- **THEN** worker không còn kỹ năng đó cho việc mới và có `AuditEvent` gỡ kỹ năng

#### Scenario: Nhân viên gỡ kỹ năng
- **WHEN** Nhân viên gửi thẳng yêu cầu gỡ kỹ năng khỏi worker
- **THEN** API trả 403 và worker giữ kỹ năng

### Requirement: Xem kỹ năng của worker
Người xem được hồ sơ worker SHALL thấy tab Kỹ năng: mỗi kỹ năng được giao kèm version đang dùng, mức rủi ro, có script hay không, trạng thái giao (Đang dùng, Chờ duyệt, Tạm khoá) và có version mới chờ duyệt hay không. Màn kỹ năng MUST hiện cùng dữ liệu theo chiều ngược lại.

#### Scenario: Worker có kỹ năng chờ duyệt
- **WHEN** Owner mở tab Kỹ năng của worker có một kỹ năng đang dùng v2 và một yêu cầu giao Chờ duyệt
- **THEN** tab hiện cả hai, kỹ năng thứ nhất ghi v2, kỹ năng thứ hai có nút Duyệt / Từ chối

#### Scenario: Không lộ worker công ty khác
- **WHEN** người dùng công ty A mở chi tiết một kỹ năng của công ty A
- **THEN** danh sách worker đang dùng chỉ có worker của công ty A

### Requirement: Version worker được dùng
Hệ thống SHALL cho biết, với mỗi worker, danh sách kỹ năng có hiệu lực và version đang dùng của từng kỹ năng. Chỉ phần giao đã có hiệu lực của kỹ năng chưa lưu trữ MUST được tính; yêu cầu Chờ duyệt, phần giao Tạm khoá và version chưa duyệt MUST NOT được tính.

#### Scenario: Danh sách cho lúc chạy
- **WHEN** worker có một kỹ năng đang dùng v2 (v3 chờ duyệt) và một yêu cầu giao Chờ duyệt
- **THEN** danh sách có hiệu lực chỉ gồm kỹ năng thứ nhất ở v2

### Requirement: Nhật ký giao kỹ năng
Hệ thống SHALL ghi `AuditEvent` cho mỗi lần giao, tạo yêu cầu giao, duyệt, từ chối, tạm khoá và gỡ kỹ năng khỏi worker, chỉ với id worker, id kỹ năng và loại hành động.

#### Scenario: Ghi khi duyệt yêu cầu giao
- **WHEN** Admin duyệt một yêu cầu giao
- **THEN** công ty có `AuditEvent` duyệt giao kỹ năng với người thực hiện, id worker, id kỹ năng và thời điểm
