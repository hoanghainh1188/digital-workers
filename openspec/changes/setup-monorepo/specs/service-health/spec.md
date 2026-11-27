# Spec Delta: service-health

## Purpose

Cho Docker, Caddy và công cụ giám sát biết API còn sống và đã sẵn sàng phục vụ hay chưa, mà không cần đăng nhập và không lộ thông tin nhạy cảm.

## ADDED Requirements

### Requirement: Kiểm tra còn sống
API SHALL có route `GET /health` không cần đăng nhập, trả HTTP 200 với thân JSON `{"status":"ok"}` khi tiến trình đang chạy, kể cả khi cơ sở dữ liệu không kết nối được.

#### Scenario: Tiến trình đang chạy
- **KHI** gọi `GET /health` không kèm thông tin đăng nhập
- **THÌ** API trả HTTP 200 và thân `{"status":"ok"}`

#### Scenario: Cơ sở dữ liệu ngừng
- **KHI** PostgreSQL không kết nối được và gọi `GET /health`
- **THÌ** API vẫn trả HTTP 200 (tiến trình không bị khởi động lại vì DB tạm ngừng)

### Requirement: Kiểm tra sẵn sàng
API SHALL có route `GET /health/ready` không cần đăng nhập, trả HTTP 200 `{"status":"ready"}` khi truy vấn thử tới PostgreSQL thành công trong 2 giây, ngược lại trả HTTP 503 `{"status":"unavailable"}`.

#### Scenario: Cơ sở dữ liệu sẵn sàng
- **KHI** PostgreSQL đang chạy và gọi `GET /health/ready`
- **THÌ** API trả HTTP 200 và thân `{"status":"ready"}`

#### Scenario: Cơ sở dữ liệu không trả lời
- **KHI** PostgreSQL không kết nối được hoặc không trả lời trong 2 giây và gọi `GET /health/ready`
- **THÌ** API trả HTTP 503 và thân `{"status":"unavailable"}`

### Requirement: Không lộ thông tin nhạy cảm
Phản hồi của các route sức khoẻ MUST chỉ chứa trường `status`; không chứa thông báo lỗi, chuỗi kết nối, phiên bản phần mềm, tên máy hay bất kỳ dữ liệu nào của công ty. Lỗi chi tiết chỉ ghi vào log phía máy chủ, đã che bí mật.

#### Scenario: Lỗi kết nối không đi ra ngoài
- **KHI** `GET /health/ready` thất bại vì sai mật khẩu cơ sở dữ liệu
- **THÌ** thân phản hồi chỉ có `{"status":"unavailable"}`, và log máy chủ ghi lỗi mà không chứa mật khẩu hay chuỗi kết nối đầy đủ

#### Scenario: Không có dữ liệu công ty
- **KHI** cơ sở dữ liệu có dữ liệu của công ty A và công ty B và gọi bất kỳ route sức khoẻ nào
- **THÌ** phản hồi không chứa dữ liệu nào của công ty A hay công ty B
