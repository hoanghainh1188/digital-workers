## Purpose

Định dạng gói kỹ năng theo chuẩn Agent Skills (`SKILL.md` + file đi kèm), luật kiểm tra hợp lệ, và nhập / xuất gói qua file `.zip`, để kỹ năng mang ra mang vào được mà không đưa nội dung nguy hiểm vào hệ thống.

## ADDED Requirements

### Requirement: Frontmatter của SKILL.md
Mỗi gói SHALL có đúng một `SKILL.md` ở thư mục gốc, mở đầu bằng frontmatter YAML. `name` MUST có 1–64 ký tự chỉ gồm `a-z`, `0-9`, `-`, không bắt đầu / kết thúc bằng `-`, không có `--`. `description` MUST có 1–1024 ký tự. Lỗi MUST nêu trường sai và cách sửa bằng tiếng Việt.

#### Scenario: Thiếu description
- **WHEN** người dùng lưu `SKILL.md` không có `description`
- **THEN** bị từ chối với lý do "Thiếu description trong frontmatter" và gợi ý thêm một dòng mô tả kỹ năng làm gì, khi nào dùng

#### Scenario: name có chữ hoa hoặc dấu
- **WHEN** `name` là `Lập-Báo-Giá`
- **THEN** bị từ chối với lý do name chỉ được dùng chữ thường không dấu, số và dấu gạch ngang, kèm gợi ý `lap-bao-gia`

### Requirement: Trường tuỳ chọn của frontmatter
Frontmatter SHALL nhận các trường tuỳ chọn của chuẩn: `license`, `compatibility` (1–500 ký tự), `metadata` (bảng chuỗi → chuỗi), `allowed-tools` (chuỗi). Trường ngoài chuẩn MUST được giữ nguyên và báo là cảnh báo, không chặn. Frontmatter MUST chỉ được đọc như dữ liệu YAML; mọi dạng frontmatter chạy mã MUST bị từ chối.

#### Scenario: Trường ngoài chuẩn
- **WHEN** frontmatter có thêm trường `author`
- **THEN** gói hợp lệ, trường được giữ khi xuất, danh sách kiểm tra có cảnh báo "trường không có trong chuẩn"

#### Scenario: Frontmatter dạng mã
- **WHEN** `SKILL.md` mở đầu bằng `---js` hoặc frontmatter không phải YAML
- **THEN** bị từ chối với lý do frontmatter phải là YAML, và không đoạn mã nào được chạy

### Requirement: Loại file đi kèm
File đi kèm SHALL chỉ thuộc các loại: văn bản (`.md`, `.txt`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, `.xml`), `.xlsx`, `.docx`, `.pdf`, ảnh (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`). File văn bản MUST là UTF-8; file nhị phân MUST có nội dung khớp đuôi. File khác MUST bị từ chối kèm đường dẫn và lý do.

#### Scenario: File chạy được
- **WHEN** gói có `tools/setup.exe`
- **THEN** bị từ chối với lý do loại file không được nhận, nêu đường dẫn `tools/setup.exe`

#### Scenario: Đổi đuôi giả
- **WHEN** gói có `assets/logo.png` nhưng nội dung không phải ảnh PNG
- **THEN** bị từ chối với lý do nội dung không khớp loại file

### Requirement: Thư mục scripts
Script SHALL chỉ được nằm trong thư mục `scripts/` ở gốc và chỉ là file `.py` UTF-8. File `.py` ngoài `scripts/` hoặc file khác trong `scripts/` MUST bị từ chối. Gói có ít nhất một script MUST được đánh dấu "Có script" và rủi ro cao; script được lưu nhưng không chạy được cho tới khi có change chạy script.

#### Scenario: Gói có script Python
- **WHEN** gói có `scripts/doi_chieu.py`
- **THEN** gói được nhận, danh sách kiểm tra cảnh báo kỹ năng sẽ ở mức rủi ro cao, chưa chạy được script và chỉ giao cho worker chính thức sau kiểm duyệt

#### Scenario: Script không phải Python
- **WHEN** gói có `scripts/run.sh`
- **THEN** bị từ chối với lý do script chỉ nhận `.py`

### Requirement: Đường dẫn an toàn trong gói
Mọi đường dẫn trong gói SHALL là đường dẫn tương đối nằm trong gốc gói. Đường dẫn tuyệt đối, có `..`, có ký tự điều khiển, liên kết tượng trưng, file mã hoá hoặc hai file trùng đường dẫn (không phân biệt hoa thường) MUST làm gói bị từ chối. File hệ thống rác (`__MACOSX/`, `.DS_Store`) MUST được bỏ qua.

#### Scenario: Thoát khỏi thư mục gói
- **WHEN** zip có mục `../../etc/passwd`
- **THEN** cả gói bị từ chối với lý do đường dẫn không hợp lệ và không file nào được ghi

#### Scenario: Zip tạo trên macOS
- **WHEN** zip có `__MACOSX/` và `.DS_Store` cùng các file hợp lệ
- **THEN** gói được nhận, các file rác không xuất hiện trong kỹ năng

### Requirement: Giới hạn kích thước gói
File `.zip` SHALL tối đa 25 MB. Gói sau giải nén MUST tối đa 50 MB, tối đa 200 file, đường dẫn tối đa 200 ký tự và sâu tối đa 5 cấp; `SKILL.md` tối đa 200 KB. Giới hạn MUST được kiểm tra trong lúc giải nén, không tin kích thước khai trong zip, và vượt là dừng ngay.

#### Scenario: File quá 25 MB
- **WHEN** người dùng tải lên `.zip` 30 MB
- **THEN** API trả 413 với lý do gói tối đa 25 MB và không đọc nội dung

#### Scenario: Zip bomb
- **WHEN** một zip 1 MB giải nén ra hơn 50 MB
- **THEN** việc giải nén dừng khi vượt giới hạn và gói bị từ chối với lý do quá dung lượng sau giải nén

### Requirement: Nhập kỹ năng từ zip
Mọi vai trò SHALL nhập được kỹ năng từ `.zip` có `SKILL.md` ở gốc; kỹ năng mới ở trạng thái Nháp với v1 là bản nháp. API MUST trả danh sách kiểm tra (đạt, cảnh báo, lỗi) và MUST từ chối cả gói nếu có một lỗi, không tạo dữ liệu nào. Tên trùng kỹ năng chưa lưu trữ của công ty là lỗi.

#### Scenario: SKILL.md nằm trong thư mục con
- **WHEN** zip chỉ có `bao-gia/SKILL.md`
- **THEN** bị từ chối với lý do không tìm thấy `SKILL.md` ở gốc, gợi ý nén lại từ bên trong thư mục `bao-gia`

#### Scenario: Nhập thành công
- **WHEN** Nhân viên nhập zip hợp lệ gồm `SKILL.md` và `references/bang-gia.md`
- **THEN** công ty của Nhân viên có kỹ năng Nháp mới với đúng hai file đó và có `AuditEvent` nhập kỹ năng

#### Scenario: Nhập không lẫn công ty
- **WHEN** người dùng công ty A nhập zip có `name` trùng kỹ năng của công ty B
- **THEN** kỹ năng được tạo ở công ty A, công ty B không đổi

### Requirement: Xuất kỹ năng ra zip
Mọi thành viên SHALL xuất được một version của kỹ năng công ty mình ra `.zip` với `SKILL.md` ở gốc và đủ file đi kèm; mặc định là version đang dùng. File xuất MUST nhập lại được và cho cùng nội dung. Id của công ty khác MUST trả 404.

#### Scenario: Xuất rồi nhập lại
- **WHEN** người dùng xuất v2 rồi lưu trữ kỹ năng gốc và nhập lại file vừa xuất
- **THEN** kỹ năng mới có cùng `SKILL.md` và cùng các file như v2

#### Scenario: Xuất kỹ năng công ty khác
- **WHEN** người dùng công ty A gọi xuất với id kỹ năng của công ty B
- **THEN** API trả 404 và không có file nào được trả

### Requirement: Nội dung kỹ năng là dữ liệu
Nội dung `SKILL.md` và file đi kèm SHALL chỉ được hiển thị như văn bản (Markdown hiển thị không có HTML thô, không chạy script, không tải tài nguyên ngoài). File tải về MUST có tên an toàn và kiểu nội dung đúng, không mở trực tiếp được như trang web của platform.

#### Scenario: HTML trong SKILL.md
- **WHEN** `SKILL.md` chứa `<script>alert(1)</script>` hoặc `<img src="https://la.example/x">`
- **THEN** xem trước hiện đúng chữ đó, không chạy script và không gọi tới địa chỉ ngoài
