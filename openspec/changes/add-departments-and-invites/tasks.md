# Tasks: add-departments-and-invites

## 1. Tài liệu và luật dùng chung (`packages/core`)

- [ ] 1.1 Thêm hàng "Xem danh sách người dùng" (Owner ✓, Admin ✓, Trưởng phòng ✓ phòng mình, Nhân viên —) vào ma trận docs/requirements.md mục 1, rồi action `member.list` trong `permissions.ts`; test ma trận đọc tài liệu vẫn xanh (`pnpm test`).
- [ ] 1.2 `access/member-rules.ts`: `canManageMember`, `canAssignRole`, `validateMembership`, mã lỗi (design D2); unit test dạng bảng actor × target × hành động.
- [ ] 1.3 Schema Zod dùng chung: phòng ban (tạo / sửa), lời mời (danh sách email ≤ 50, tách theo dấu phẩy / xuống dòng, báo lỗi từng email), sửa thành viên, preview / accept, quên / đặt lại mật khẩu; unit test.

## 2. Cơ sở dữ liệu (`packages/db`)

- [ ] 2.1 Schema Drizzle + migration `0003_departments_invites`: `departments`, `invitations`, cột mới của `members`, FK ghép, CHECK, index unique một phần, RLS, tạo lại view `member_profiles` (design D1); `pnpm --filter @dw/db migrate` chạy được trên DB trống và DB của 1a.
- [ ] 2.2 Hàm `app.invitation_by_token_hash` + policy `invitations_owner_lookup` (design D4); test tích hợp: trả đúng một dòng theo hash, không liệt kê được, `dw_app` không đọc được lời mời ngoài `withCompany`.
- [ ] 2.3 Test RLS / ràng buộc bằng SQL thô dưới `dw_app`: phòng ban / lời mời công ty khác không thấy; `members.department_id` trỏ phòng công ty khác bị từ chối; hai trưởng phòng một phòng bị từ chối; Nhân viên không phòng bị từ chối.

## 3. Phòng ban (`apps/api`)

- [ ] 3.1 `GET|POST /api/departments`, `PATCH /api/departments/:id` với đổi trưởng phòng trong một transaction (design D5) và `AuditEvent`; test tích hợp mọi kịch bản spec `departments`.
- [ ] 3.2 `POST /api/departments/:id/archive` (`409 DEPARTMENT_NOT_EMPTY` kèm số người); test lưu trữ phòng trống / còn người / tạo lại tên cũ.
- [ ] 3.3 Test tách công ty + quyền cho mọi route phòng ban: A đọc / sửa / lưu trữ phòng B → 404 + `access.not_found`, dữ liệu B không đổi; Trưởng phòng / Nhân viên tạo / sửa → 403 + `access.denied`.

## 4. Thành viên (`apps/api`)

- [ ] 4.1 `GET /api/members` với bộ lọc và phạm vi Trưởng phòng; cập nhật `last_seen_at` trong request-context (design D6); test: Trưởng phòng chỉ thấy phòng mình, Nhân viên 403, không thấy công ty B.
- [ ] 4.2 `PATCH /api/members/:id` (đổi vai trò, chuyển phòng) theo D2 + khoá Owner `FOR UPDATE` (D3); test mọi kịch bản spec `member-management` về vai trò / chuyển phòng, kể cả hai yêu cầu hạ Owner chạy song song.
- [ ] 4.3 `POST /api/members/:id/lock|unlock`, `revokeUserSessions` trong `src/auth/`, hook `session.create.before` chặn tài khoản khoá (D6); test: phiên cũ 401, đăng nhập email bị chặn với `ACCOUNT_LOCKED`, tạo phiên trực tiếp (giả lập Google) bị chặn, mở khoá đăng nhập lại được.
- [ ] 4.4 Test tách công ty + quyền cho mọi route thành viên: A sửa / khoá / mở khoá thành viên B → 404; Admin gán Owner / Admin, Admin sửa / khoá Owner → 403; tự khoá → 409.

## 5. Lời mời (`apps/api`, `packages/mail`)

- [ ] 5.1 Mẫu email `inviteTemplate`, `resetPasswordTemplate` trong `templates/vi.ts`; unit test escape HTML và có link.
- [ ] 5.2 `GET|POST /api/invitations`, `POST /api/invitations/:id/resend|cancel` (token ngẫu nhiên, lưu hash, `requireVerifiedEmail`, luật D2, báo theo từng email); test mọi kịch bản "Gửi lời mời", "Luật vai trò khi mời", "Hạn, gửi lại và huỷ".
- [ ] 5.3 `POST /api/invitations/preview|accept` công khai, giới hạn IP, hai chế độ nhận lời mời (D4); test: nhận bằng mật khẩu (email đã xác minh, vai trò + phòng đúng), mật khẩu phổ biến, hết hạn / huỷ / đã dùng / token sai, email đã thuộc công ty khác, phiên cùng email / khác email, 429.
- [ ] 5.4 Test tách công ty + quyền cho mọi route lời mời: A xem / gửi lại / huỷ lời mời B → 404; Trưởng phòng / Nhân viên mời → 403; người chưa xác minh email mời → 403 `EMAIL_NOT_VERIFIED`; `AuditEvent` không chứa email hay token.

## 6. Quên / đặt lại mật khẩu (`apps/api`)

- [ ] 6.1 Bật `sendResetPassword`, hạn 1 giờ, `revokeSessionsOnPasswordReset`, `onPasswordReset` (đánh dấu xác minh + `AuditEvent`), giới hạn IP + theo email (D7); test mọi kịch bản "Quên mật khẩu", "Đặt lại mật khẩu" trong spec `authentication`.

## 7. Web — khung, Phòng ban

- [ ] 7.1 Thanh bên thêm "Phòng ban", "Người dùng" (ẩn theo `can(role, 'member.list')`); chuỗi trong `i18n/vi.ts`; typecheck + lint xanh.
- [ ] 7.2 Trang `/departments` theo `departments.html`: thẻ phòng, dialog thêm / sửa với báo trước khi chọn Nhân viên làm trưởng phòng, dialog chưa lưu trữ được, trạng thái trống + 4 gợi ý, chế độ chỉ xem cho Trưởng phòng / Nhân viên; kiểm bằng Playwright screenshot 375 / 1440.

## 8. Web — Người dùng, lời mời, mật khẩu

- [ ] 8.1 Trang `/users` theo `users.html`: bảng thành viên + lời mời, bộ lọc trên URL, menu đổi vai trò / chuyển phòng / khoá / mở khoá / gửi lại / huỷ theo `canManageMember`, dialog mời nhiều email, dialog Owner cuối, nút mời khoá khi chưa xác minh; screenshot 375 / 1440, không tràn ngang.
- [ ] 8.2 Trang `/invite` (đọc token từ hash, nhận bằng mật khẩu hoặc Google, màn hết hạn / không hợp lệ) theo `signup.html` luồng "Nhận lời mời".
- [ ] 8.3 Trang `/forgot-password`, `/reset-password`, link "Quên mật khẩu?" ở trang đăng nhập, thông báo "tài khoản đã bị khoá" ở trang đăng nhập.

## 9. Kiểm tra cuối

- [ ] 9.1 E2E Playwright: Owner xác minh email → tạo phòng → mời → người được mời nhận lời mời → Owner khoá người đó → người đó bị đăng xuất; quên mật khẩu → đặt lại → đăng nhập bằng mật khẩu mới.
- [ ] 9.2 `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm e2e` và `openspec validate --all --strict` xanh; `pnpm ci:runner` chạy trên máy trước khi merge.

## Workflow follow-up

- Sau khi merge apply: `/opsx:archive add-departments-and-invites`, đồng bộ specs, đóng issue #26.
