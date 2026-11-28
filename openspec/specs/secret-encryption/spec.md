# secret-encryption Specification

## Purpose
Giữ bí mật của platform (API key của nhà cung cấp mô hình; sau này là token bot, mật khẩu connector) an toàn khi lưu: chỉ lưu bản đã mã hoá, không bao giờ trả ra API, không bao giờ ghi vào log.

## Requirements

### Requirement: Bí mật lưu đã mã hoá
Mọi bí mật SHALL được mã hoá bằng AES-256-GCM trước khi ghi vào cơ sở dữ liệu. Khoá chính MUST lấy từ biến môi trường, không nằm trong cơ sở dữ liệu. Bản mã MUST gắn với đúng chỗ dùng của nó, nên chép bản mã sang chỗ khác thì không giải mã được.

#### Scenario: Lưu API key
- **WHEN** platform admin lưu một API key Anthropic
- **THEN** cột lưu key trong cơ sở dữ liệu không chứa chuỗi key gốc, và giải mã bằng khoá chính cho lại đúng key

#### Scenario: Bản mã bị chép sang chỗ khác
- **WHEN** bản mã của key Anthropic bị chép vào dòng của key OpenAI
- **THEN** giải mã thất bại và hệ thống báo "key chưa cấu hình được", không dùng giá trị đó để gọi mô hình

#### Scenario: Bản mã bị sửa
- **WHEN** một byte của bản mã bị đổi
- **THEN** giải mã thất bại thay vì trả về giá trị sai

### Requirement: Khoá chính bắt buộc khi khởi động
Tiến trình cần đọc hoặc ghi bí mật SHALL từ chối khởi động khi thiếu khoá chính hoặc khoá không đúng 32 byte, và MUST NOT in giá trị khoá ra log.

#### Scenario: Thiếu khoá chính
- **WHEN** API khởi động mà không có `ENCRYPTION_KEY`
- **THEN** tiến trình dừng với thông báo thiếu biến `ENCRYPTION_KEY`

#### Scenario: Khoá sai độ dài
- **WHEN** `ENCRYPTION_KEY` giải ra 16 byte
- **THEN** tiến trình dừng, thông báo khoá không hợp lệ và không in giá trị khoá

### Requirement: Không trả và không ghi log bí mật
API SHALL chỉ trả trạng thái "đã cấu hình" / "chưa cấu hình" của một bí mật, MUST NOT trả giá trị hay bản mã. Log và nhật ký MUST NOT chứa giá trị bí mật, kể cả khi gọi nhà cung cấp bị lỗi.

#### Scenario: Xem trang API key
- **WHEN** platform admin gọi `GET /api/platform/provider-keys`
- **THEN** phản hồi chỉ có nhà cung cấp, trạng thái đã cấu hình, ngày thay và người thay; không có key hay bản mã

#### Scenario: Gọi mô hình bị lỗi xác thực
- **WHEN** nhà cung cấp trả lỗi 401 cho một lần gọi
- **THEN** log ghi lỗi xác thực của nhà cung cấp, và toàn bộ log không chứa chuỗi key
