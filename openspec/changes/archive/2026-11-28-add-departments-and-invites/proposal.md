# Proposal: add-departments-and-invites

## Why

Sau change 1a, mỗi công ty chỉ có đúng một người: Owner đã đăng ký. Chủ DN chưa thêm được đồng nghiệp, chưa chia phòng ban, chưa gán trưởng phòng — mà change 2 (`add-worker-profile`) cần phòng ban và trưởng phòng để biết worker thuộc phòng nào, ai quản lý. Change này là nửa sau của change 1 cũ (FR-01-02, 0.2 #033–#040). Nó cũng đóng lỗ hổng "chiếm email chưa xác minh" mà 1a để lại, bằng luồng quên / đặt lại mật khẩu, trước khi mở cho khách thật.

## What Changes

- **Phòng ban**: Owner / Admin thêm, đổi tên, sửa mô tả, chọn trưởng phòng, lưu trữ (không xoá) phòng ban. Mỗi phòng tối đa một trưởng phòng; chọn một Nhân viên làm trưởng phòng thì tự đổi vai trò (#036). Chỉ lưu trữ được phòng không còn người (#037). Mọi thành viên xem được danh sách phòng ban. Công ty mới có gợi ý nhanh 4 phòng ban phổ biến.
- **Mời người dùng qua email**: Owner / Admin mời một hoặc nhiều email cùng vai trò và phòng ban; lời mời hết hạn sau 7 ngày, gửi lại và huỷ được (#034). Người mời chưa xác minh email thì không mời được (#033). Chỉ Owner mời được Owner / Admin (#039). Trưởng phòng / Nhân viên bắt buộc chọn phòng (#036).
- **Nhận lời mời**: người được mời mở link, đặt họ tên + mật khẩu (hoặc tiếp tục với Google cùng email); email đã cố định theo lời mời và được coi là đã xác minh (#033). Lời mời hết hạn / đã huỷ / đã dùng → báo rõ.
- **Đổi vai trò, chuyển phòng ban**: theo luật #036 và #039 — chỉ Owner gán Owner / Admin; Admin không sửa Owner; công ty luôn còn ít nhất một Owner đang hoạt động.
- **Khoá / mở khoá tài khoản** (#040): khoá thì huỷ mọi phiên đang có, chặn đăng nhập (email lẫn Google), giữ tên trong lịch sử; mở khoá được. Không khoá được chính mình hay Owner đang hoạt động cuối cùng.
- **Quên / đặt lại mật khẩu**: gửi link đặt lại qua email (phản hồi giống nhau dù email có tồn tại hay không), link dùng một lần, có hạn; mật khẩu mới theo #032; đặt lại xong huỷ mọi phiên cũ và đánh dấu email đã xác minh.
- **Ma trận quyền**: thêm hàng "Xem danh sách người dùng" (Trưởng phòng: phòng mình) để khớp #038.
- **Nhật ký**: ghi `AuditEvent` cho mọi thao tác phòng ban, lời mời, vai trò, chuyển phòng, khoá / mở khoá, đặt lại mật khẩu.
- **API mới**: `/api/departments*`, `/api/members` (danh sách + `PATCH` + khoá / mở khoá), `/api/invitations*` (kể cả hai endpoint công khai xem trước / nhận lời mời).
- **Web**: trang Phòng ban (`docs/design/screens/departments.html`), trang Người dùng (`users.html`, bộ lọc trên URL), trang nhận lời mời (`signup.html`, luồng "Nhận lời mời"), trang Quên mật khẩu và Đặt lại mật khẩu; thanh bên có mục Phòng ban, Người dùng.

## Capabilities

### New Capabilities
- `departments`: phòng ban của công ty — tạo, sửa, trưởng phòng, lưu trữ, xem danh sách.
- `invitations`: mời người vào công ty qua email, gửi lại, huỷ, hết hạn và nhận lời mời.
- `member-management`: xem danh sách người dùng, đổi vai trò, chuyển phòng ban, khoá / mở khoá, cùng các luật bảo vệ Owner.

### Modified Capabilities
- `authentication`: thêm quên / đặt lại mật khẩu và chặn đăng nhập với tài khoản bị khoá (requirement mới, không đổi requirement cũ).
- `audit-log`: requirement "Ghi nhật ký hành động" mở rộng danh sách hành động được ghi.

## Impact

- **DB** (migration mới): bảng `departments`, `invitations` (đều có `company_id` + RLS); `members` thêm `department_id`, `locked_at`; ràng buộc "Trưởng phòng / Nhân viên phải có phòng", "mỗi phòng tối đa một trưởng phòng"; hàm `SECURITY DEFINER` tra lời mời theo token (xem design.md D4).
- **Code**: `packages/core` (luật vai trò, schema Zod, ma trận quyền), `packages/db` (schema, migration), `packages/mail` (mẫu email lời mời, đặt lại mật khẩu), `apps/api` (route mới, hook Better Auth chặn tài khoản khoá, đặt lại mật khẩu), `apps/web` (5 trang mới, khung app).
- **Tài liệu**: docs/requirements.md mục 1 thêm hàng ma trận; 0.2 ghi câu trả lời cho các câu hỏi trong PR.
- **Thư viện**: không thêm thư viện mới.
- **Phụ thuộc**: change 2 (`add-worker-profile`) dùng phòng ban, trưởng phòng và trạng thái khoá từ change này.
