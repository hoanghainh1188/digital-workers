# Spec Delta

## Purpose

Quy định `Task` — một việc worker nhận từ một kênh chat (sau này cả lịch chạy): các trạng thái, cách xếp hàng, không chạy trùng, chạy đúng thứ tự trong một cuộc trò chuyện, gom tin nhắn ngắn liên tiếp và xử lý việc bị treo.

## ADDED Requirements

### Requirement: Task thuộc một công ty và một worker
Mỗi `Task` SHALL thuộc đúng một công ty, một worker, một cuộc trò chuyện và một người giao việc. Người công ty A MUST NOT đọc, tạo hay đổi `Task` của công ty B; id `Task` của công ty khác được xử lý như không tồn tại.

#### Scenario: Tạo Task từ tin nhắn
- **WHEN** Nhân viên được giao thử nhắn "Tóm tắt đơn hàng tuần này" cho worker Thử việc qua web chat
- **THEN** có một `Task` mới thuộc công ty, worker và cuộc trò chuyện đó, người giao việc là Nhân viên này

#### Scenario: Công ty khác không thấy Task
- **WHEN** runner hoặc API đọc `Task` của công ty A trong ngữ cảnh công ty B
- **THEN** không có dòng nào được trả về và không có gì thay đổi

### Requirement: Trạng thái của Task
`Task` SHALL đi qua các trạng thái Đang gom → Chờ chạy → Đang chạy → một trạng thái kết thúc: Xong, Lỗi, Đã dừng (vượt giới hạn hoặc hết credit) hoặc Đã huỷ (worker không còn nhận việc lúc bắt đầu). Trạng thái kết thúc MUST NOT đổi nữa.

#### Scenario: Việc chạy xong
- **WHEN** worker trả lời xong một `Task` mà không vượt giới hạn
- **THEN** `Task` ở Xong, có thời điểm bắt đầu, kết thúc, số bước và số credit đã dùng

#### Scenario: Bị huỷ vì worker tạm nghỉ trong lúc chờ
- **WHEN** worker bị cho tạm nghỉ khi `Task` của nó còn đang gom
- **THEN** `Task` sang Đã huỷ, không có lần gọi mô hình nào và người nhắn nhận câu "đang tạm nghỉ"

#### Scenario: Không đổi trạng thái kết thúc
- **WHEN** một `Task` đã Xong nhận lệnh chuyển sang Đang chạy
- **THEN** trạng thái vẫn là Xong

### Requirement: Task không chứa nội dung
`Task` SHALL chỉ lưu số liệu (trạng thái, lý do dừng, số bước, credit, thời điểm). Nội dung tin nhắn MUST nằm riêng để xoá được sau 90 ngày mà vẫn giữ log việc 1 năm (#019).

#### Scenario: Xoá nội dung giữ log việc
- **WHEN** nội dung tin nhắn của một `Task` cũ bị xoá theo hạn lưu
- **THEN** `Task` vẫn còn với trạng thái, số bước và credit đã dùng

### Requirement: Không chạy trùng một Task
Một `Task` SHALL được chạy nhiều nhất một lần, kể cả khi hàng đợi giao cùng một việc hai lần hoặc hai tiến trình runner cùng nhận.

#### Scenario: Hai runner cùng nhận một việc
- **WHEN** hai tiến trình runner cùng nhận việc chạy một `Task` đang Chờ chạy
- **THEN** chỉ một tiến trình chạy nó, chỉ có một chuỗi lần gọi mô hình và một câu trả lời

### Requirement: Chạy theo thứ tự trong một cuộc trò chuyện
Trong một cuộc trò chuyện, `Task` SHALL chạy lần lượt theo thứ tự tạo; `Task` sau chỉ bắt đầu khi `Task` trước đã kết thúc. Các cuộc trò chuyện khác nhau chạy song song được.

#### Scenario: Hai việc nối tiếp
- **WHEN** người dùng gửi việc thứ hai khi việc thứ nhất của cùng cuộc trò chuyện đang chạy
- **THEN** việc thứ hai chờ, bắt đầu sau khi việc thứ nhất kết thúc, và câu trả lời hiện theo đúng thứ tự

#### Scenario: Hai người cùng lúc
- **WHEN** hai người trò chuyện với cùng một worker cùng lúc
- **THEN** hai `Task` chạy song song, mỗi câu trả lời chỉ về đúng cuộc trò chuyện của người đó

### Requirement: Gom tin nhắn ngắn liên tiếp
Tin của cùng một người trong cùng cuộc trò chuyện tới trong 5 giây sau tin trước SHALL vào cùng một `Task` khi `Task` đó còn đang gom. Cửa sổ gom MUST đóng sau 30 giây kể từ tin đầu hoặc khi đủ 20 tin (FR-04-07).

#### Scenario: Ba tin liền nhau
- **WHEN** người dùng gửi "Báo giá cho anh Tâm", 2 giây sau "10 thùng nước mắm", 3 giây sau "giao thứ 6"
- **THEN** chỉ có một `Task`, mô hình nhận ba tin theo đúng thứ tự trong một lượt

#### Scenario: Tin cách xa
- **WHEN** người dùng gửi một tin, 8 giây sau gửi tin thứ hai
- **THEN** có hai `Task` riêng, chạy lần lượt

#### Scenario: Gõ liên tục
- **WHEN** người dùng gửi mỗi 3 giây một tin liên tục trong 40 giây
- **THEN** `Task` đầu đóng cửa sổ gom ở giây thứ 30 và các tin sau vào `Task` mới

#### Scenario: Tin tới khi việc đang chạy
- **WHEN** người dùng gửi tin khi `Task` của cuộc trò chuyện đã Đang chạy
- **THEN** tin đó vào `Task` mới, không chen vào `Task` đang chạy

### Requirement: Việc bị gián đoạn
`Task` Đang chạy mà runner ngừng báo còn sống quá 60 giây SHALL chuyển sang Lỗi với lý do gián đoạn và người nhắn được báo gửi lại. `Task` đó MUST NOT tự chạy lại, để không trừ credit hai lần.

#### Scenario: Runner chết giữa chừng
- **WHEN** tiến trình runner bị tắt đột ngột khi đang chạy một `Task`
- **THEN** sau tối đa 2 phút `Task` ở Lỗi, người nhắn nhận "Việc bị gián đoạn, vui lòng gửi lại." và không có lần gọi mô hình mới cho `Task` đó

#### Scenario: Việc chờ phía sau được chạy tiếp
- **WHEN** một `Task` bị đánh dấu gián đoạn trong khi cùng cuộc trò chuyện còn một `Task` Chờ chạy
- **THEN** `Task` Chờ chạy được bắt đầu

### Requirement: Việc chờ bị mất trong hàng đợi
`Task` Đang gom đã quá hạn gom, hoặc Chờ chạy mà không có `Task` Đang chạy đứng trước trong cuộc trò chuyện, SHALL được đưa lại vào hàng đợi khi quá 2 phút không đổi trạng thái. Đưa lại MUST NOT làm `Task` chạy hai lần.

#### Scenario: Runner chết trước khi bắt đầu
- **WHEN** runner lấy việc chạy một `Task` Chờ chạy rồi chết trước khi `Task` sang Đang chạy
- **THEN** sau tối đa 3 phút `Task` được chạy bởi runner khác, đúng một lần

### Requirement: Deploy không làm hỏng việc đang chạy
Khi runner được yêu cầu tắt, runner SHALL ngừng nhận việc mới và chờ các `Task` Đang chạy kết thúc (mỗi `Task` tự dừng trong giới hạn thời gian) trước khi thoát.

#### Scenario: Deploy khi worker đang làm việc
- **WHEN** runner nhận lệnh tắt lúc một `Task` đã chạy được 20 giây
- **THEN** `Task` đó vẫn kết thúc bình thường với câu trả lời, không chuyển sang Lỗi, và runner không bắt đầu `Task` mới trong lúc chờ

### Requirement: Hàng đợi không chứa nội dung
Việc trong hàng đợi SHALL chỉ mang id công ty và id `Task`; nội dung tin và dữ liệu nghiệp vụ MUST được đọc lại theo công ty khi chạy.

#### Scenario: Xem hàng đợi
- **WHEN** xem dữ liệu của một việc trong hàng đợi
- **THEN** chỉ có id công ty và id `Task`, không có nội dung tin nhắn
