## ADDED Requirements

### Requirement: Hạn mức người nhận lời mời mỗi ngày
Mỗi công ty SHALL gửi lời mời (tạo mới hoặc gửi lại) tới tối đa một số người nhận trong 24 giờ gần nhất: **20** với công ty tạo chưa đủ 7 ngày, **200** với công ty khác (0.2 #082). Yêu cầu làm vượt hạn mức MUST bị từ chối cả yêu cầu với HTTP 429 và mã lỗi "vượt hạn mức lời mời", không tạo lời mời và không gửi email nào; giao diện báo bằng tiếng Việt khi nào gửi tiếp được. Hạn mức tính theo công ty, không theo người mời.

#### Scenario: Công ty mới mời vượt hạn mức
- **WHEN** Owner của công ty tạo 2 ngày trước đã gửi lời mời tới 15 người trong 24 giờ qua và mời thêm 6 email
- **THEN** API trả 429 với mã lỗi "vượt hạn mức lời mời", không có lời mời mới và không email nào được gửi

#### Scenario: Còn trong hạn mức
- **WHEN** Admin của công ty tạo 30 ngày trước đã gửi tới 150 người trong 24 giờ qua và mời thêm 50 email
- **THEN** 50 lời mời được tạo và gửi như bình thường

#### Scenario: Hai Admin mời cùng lúc
- **WHEN** hai Admin cùng công ty mới gửi yêu cầu mời 15 email cùng lúc khi công ty chưa gửi lời mời nào trong ngày
- **THEN** đúng một yêu cầu thành công, yêu cầu còn lại nhận 429

#### Scenario: Hạn mức không tính lẫn công ty
- **WHEN** công ty A đã dùng hết hạn mức trong ngày và Owner công ty B mời 5 email
- **THEN** lời mời của công ty B được tạo và gửi bình thường

### Requirement: Giới hạn gửi lại một lời mời
Một lời mời SHALL được gửi lại tối đa 3 lần, và hai lần gửi (kể cả lần đầu) MUST cách nhau ít nhất 10 phút. Gửi lại vượt giới hạn MUST bị từ chối với HTTP 429 và mã lỗi "gửi lại quá nhiều", link hiện tại vẫn dùng được và không có email mới. Mỗi lần gửi lại vẫn tính vào hạn mức người nhận mỗi ngày của công ty.

#### Scenario: Gửi lại quá sớm
- **WHEN** Owner gửi lại một lời mời 3 phút sau lần gửi trước
- **THEN** API trả 429 với mã lỗi "gửi lại quá nhiều", link cũ vẫn dùng được và không có email mới

#### Scenario: Gửi lại lần thứ tư
- **WHEN** Admin gửi lại lần thứ tư một lời mời đã gửi lại 3 lần
- **THEN** API trả 429 với mã lỗi "gửi lại quá nhiều"; Admin vẫn huỷ được lời mời rồi mời lại (tính vào hạn mức ngày)

#### Scenario: Gửi lại lời mời công ty khác
- **WHEN** Admin công ty A gửi lại một lời mời bằng id lời mời của công ty B
- **THEN** API trả 404, lần gửi không được tính vào hạn mức của công ty nào và lời mời của công ty B giữ nguyên

### Requirement: Ghi nhận lần gửi lời mời
Mỗi email lời mời được gửi (lần đầu hoặc gửi lại) SHALL tạo một bản ghi lần gửi gồm công ty, lời mời và thời điểm; bản ghi chỉ thêm, không sửa / xoá, và MUST NOT chứa địa chỉ email hay token. Bản ghi lần gửi của công ty này MUST NOT đọc được từ công ty khác.

#### Scenario: Không đọc lần gửi của công ty khác
- **WHEN** truy vấn bản ghi lần gửi trong `withCompany(A)`
- **THEN** chỉ thấy bản ghi của công ty A, không thấy bản ghi nào của công ty B
