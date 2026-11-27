# Proposal: add-tenancy-and-auth

## Why

Mọi tính năng sau (worker, kỹ năng, credit) đều cần biết **ai** đang thao tác và thuộc **công ty nào**, và dữ liệu của công ty này không được lọt sang công ty khác (NFR-01, FR-01-03). Change này dựng phần nền đó: công ty, tài khoản, vai trò, đăng ký / đăng nhập và lớp tách dữ liệu bằng RLS. Đây là nửa đầu của change 1 cũ (`add-tenancy-and-users`); phòng ban, lời mời, đổi vai trò, khoá tài khoản sang change 1b `add-departments-and-invites`.

## What Changes

- **Công ty và thành viên**: bảng công ty và bảng thành viên (người dùng thuộc công ty với một vai trò). Mỗi email thuộc đúng một công ty (0.2 #035).
- **Đăng ký công ty** (FR-01-01): người đăng ký bằng email + mật khẩu hoặc Google tạo công ty và thành Owner đầu tiên. Đăng ký Google xong mà chưa có công ty → bước "Tạo công ty".
- **Đăng nhập / đăng xuất** bằng Better Auth (0.2 #012): phiên lưu trong PostgreSQL, cookie httpOnly; giới hạn số lần thử sai.
- **Mật khẩu** tối thiểu 10 ký tự, chặn mật khẩu quá phổ biến (0.2 #032).
- **Xác minh email** (0.2 #033): gửi link xác minh, gửi lại được; dùng được ngay khi chưa xác minh. Chặn các hành động cần xác minh (mời người, nạp credit) làm ở change của các hành động đó.
- **Tách dữ liệu công ty**: helper đặt `app.company_id` cho mỗi request; RLS trên mọi bảng nghiệp vụ; truy cập id của công ty khác → "không tìm thấy" + `AuditEvent`.
- **Vai trò và quyền**: 4 vai trò (Owner, Admin, Trưởng phòng, Nhân viên) và ma trận quyền ở `packages/core`, kiểm tra trong API, không dựa vào giao diện.
- **Nhật ký (`AuditEvent`)**: ghi hành động quản trị và truy cập bị từ chối; chỉ thêm, không sửa / xoá, không chứa nội dung nhạy cảm (NFR-08).
- **API**: `/api/auth/*` (Better Auth), `GET /api/me`, `POST /api/companies` (tạo công ty sau đăng ký Google), `GET|PATCH /api/company`, `GET /api/members/:id`.
- **Web**: trang đăng ký và đăng nhập theo `docs/design/screens/signup.html`, bước "Tạo công ty", trang xác minh email, khung ứng dụng (thanh bên) với trang chủ giữ chỗ. Thêm TanStack Router + React Query.
- **Gửi email**: package `packages/mail` (nodemailer); dev dùng Mailpit trong `compose.yaml`.
- **Tách change 1**: ROADMAP và issue: #2 thành 1a `add-tenancy-and-auth`, issue mới cho 1b `add-departments-and-invites`.

## Capabilities

### New Capabilities
- `tenant-isolation`: mọi dữ liệu nghiệp vụ thuộc đúng một công ty; người dùng chỉ đọc / sửa được dữ liệu công ty mình, kể cả khi đoán id.
- `company-signup`: đăng ký công ty và Owner đầu tiên (email hoặc Google), xem và đổi tên công ty.
- `authentication`: đăng nhập, đăng xuất, phiên, quy tắc mật khẩu, giới hạn thử sai, xác minh email.
- `access-control`: vai trò của người dùng trong công ty và ma trận quyền được kiểm tra ở API.
- `audit-log`: nhật ký hành động quản trị và truy cập bị từ chối, chỉ thêm, không lộ nội dung nhạy cảm.

### Modified Capabilities
- (không có)

## Impact

- **DB**: bảng `companies`, `members`, `audit_events` (có `company_id` + RLS); bảng của Better Auth (`users`, `sessions`, `accounts`, `verifications`) trong schema `auth`, không có RLS vì là danh tính toàn cục (xem design.md D2).
- **Code**: `packages/db` (schema, migration, helper `withCompany`), `packages/core` (vai trò, ma trận quyền, chính sách mật khẩu), `packages/mail` (mới), `apps/api` (auth, plugin phiên + công ty, route), `apps/web` (router, trang auth, khung app).
- **Biến môi trường mới**: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (bắt buộc với api); `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (không có thì ẩn nút Google); `SMTP_URL`, `MAIL_FROM`.
- **Thư viện**: `better-auth`, `nodemailer`, `@tanstack/react-router`, `@tanstack/react-query` (đều trong danh sách được phép). Không thêm thư viện ngoài danh sách.
- **Phụ thuộc của change sau**: change 2 (`add-worker-profile`) cần phòng ban nên phụ thuộc 1b; change 3, 4 chỉ cần 1a.
