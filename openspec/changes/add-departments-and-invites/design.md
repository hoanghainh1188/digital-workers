# Design: add-departments-and-invites

## Context

- Nền từ change 1a (`openspec/changes/archive/2026-11-27-add-tenancy-and-auth/design.md`): `withCompany` + RLS (`app.current_company_id()`), hàm `SECURITY DEFINER` `app.member_for_user`, view `member_profiles`, guard `requireAuth` / `requireCompany` / `requirePermission` / `requireVerifiedEmail` / `notFound`, `recordAudit`, `packages/mail` (mẫu tiếng Việt), Better Auth 1.7 trong `apps/api/src/auth/` (module duy nhất chạm bảng `auth.*`), web dùng TanStack Router + React Query, chuỗi trong `src/i18n/vi.ts`.
- `members` đã có `role` (`owner|admin|manager|member`) và `status` (`active|locked`); `requireCompany` đã trả `403 ACCOUNT_LOCKED` cho thành viên khoá. Chưa có `department_id`.
- Ma trận quyền (`packages/core/src/access/permissions.ts`) đã có `org.manage` = Owner / Admin. Test ma trận đọc thẳng bảng ở docs/requirements.md mục 1.
- Lý do và phạm vi: proposal.md. Hành vi: 5 file trong `specs/`. Màn hình: `docs/design/screens/departments.html`, `users.html`, `signup.html` (luồng "Nhận lời mời").

## Goals / Non-Goals

**Goals:**
- Bất biến về vai trò / phòng ban / Owner nằm ở **cả** code (`packages/core`, thông báo lỗi rõ) **và** DB (ràng buộc, khoá dòng), để hai yêu cầu đồng thời không phá được.
- Luồng lời mời và đặt lại mật khẩu chạy end-to-end trên máy (Mailpit), có e2e.

**Non-Goals:**
- Lịch sử thay đổi xem được trên giao diện (chỉ ghi `AuditEvent`; trang nhật ký để sau).
- Khôi phục phòng ban đã lưu trữ; đổi email của thành viên; chuyển người sang công ty khác.
- Worker và người quản lý worker (change 2): khoá một Trưởng phòng chưa ảnh hưởng worker nào ở change này.
- Trang danh sách lời mời riêng: lời mời hiện chung bảng trên trang Người dùng.

## Decisions

### D1. Mô hình dữ liệu (migration `0003_departments_invites`)

```
public.departments  id uuid PK, company_id FK, name, description NULL, archived_at NULL,
                    created_at, updated_at
                    UNIQUE (company_id, id)                                   -- đích của FK ghép
                    UNIQUE (company_id, lower(name)) WHERE archived_at IS NULL
                    RLS: company_id = app.current_company_id()

public.members      + department_id uuid NULL, + locked_at timestamptz NULL, + last_seen_at timestamptz NULL
                    FK (company_id, department_id) → departments (company_id, id)
                    CHECK (role IN ('owner','admin') OR department_id IS NOT NULL)
                    CHECK ((status = 'locked') = (locked_at IS NOT NULL))
                    UNIQUE (department_id) WHERE role = 'manager'             -- 1 trưởng phòng / phòng

public.invitations  id uuid PK, company_id FK, email (lowercase), role, department_id NULL,
                    invited_by_member_id FK, token_hash bytea UNIQUE, expires_at,
                    status enum('pending','accepted','cancelled'), accepted_member_id NULL,
                    created_at, updated_at
                    FK (company_id, department_id) → departments (company_id, id)
                    CHECK (role IN ('owner','admin') OR department_id IS NOT NULL)
                    UNIQUE (company_id, email) WHERE status = 'pending'
                    UNIQUE (department_id) WHERE status = 'pending' AND role = 'manager'
                    RLS: company_id = app.current_company_id()
```

- **Trưởng phòng là suy ra, không lưu riêng**: trưởng phòng của phòng X = thành viên `role = 'manager'` có `department_id = X`. Không có cột `head_member_id`, nên không có hai nguồn sự thật phải giữ khớp; index unique một phần thực thi "tối đa một trưởng phòng" (#036) ngay trong DB.
  - *Đã cân nhắc*: cột `departments.head_member_id`. Cho phép Owner / Admin làm trưởng phòng, nhưng vai trò Trưởng phòng và "là trưởng phòng" có thể lệch nhau, cần thêm trigger. Không chọn (xem câu hỏi Q2 trong PR).
- **FK ghép `(company_id, department_id)`**: một thành viên / lời mời không thể trỏ tới phòng ban của công ty khác, kể cả khi code sai — RLS chặn đọc, FK ghép chặn ghi.
- **Trạng thái "hết hạn" của lời mời là suy ra** từ `expires_at < now()` khi `status = 'pending'`; không có job đổi trạng thái. Danh sách trả `state: 'pending' | 'expired'`.
- `invitations.email` chỉ là dữ liệu nghiệp vụ trong RLS; `AuditEvent` chỉ ghi id lời mời (spec audit-log).
- Lưu trữ: `archived_at`. Index tên unique chỉ tính phòng chưa lưu trữ, nên tạo lại được tên cũ.

### D2. Luật vai trò ở `packages/core/src/access/member-rules.ts`

Hàm thuần, test dạng bảng, API và web dùng chung (web ẩn / khoá lựa chọn, API vẫn tự kiểm):

- `canManageMember(actor, target)`: `false` khi target là Owner/Admin mà actor không phải Owner (#039). Áp cho đổi vai trò, chuyển phòng, khoá, mở khoá, gửi lại / huỷ lời mời Owner/Admin.
- `canAssignRole(actorRole, newRole)`: Owner / Admin chỉ do Owner gán (cả khi mời).
- `validateMembership(role, departmentId)`: Trưởng phòng / Nhân viên phải có phòng (#036).
- Không khoá chính mình. Tự đổi vai trò được (Owner tự hạ khi còn Owner khác).
- Kết quả là mã lỗi (`ROLE_REQUIRES_OWNER`, `DEPARTMENT_REQUIRED`, `LAST_OWNER`, `CANNOT_LOCK_SELF`, `DEPARTMENT_HAS_HEAD`…); web map mã sang chuỗi trong `vi.ts`.
- Vi phạm `canManageMember` / `canAssignRole` → **403 + `access.denied`** (đây là thiếu quyền); vi phạm bất biến dữ liệu (thiếu phòng, Owner cuối, phòng đã có trưởng) → **409/400** có mã riêng, không ghi `access.denied`.

### D3. Bất biến "ít nhất một Owner đang hoạt động" chống chạy đồng thời

Mọi thao tác có thể làm giảm số Owner đang hoạt động (đổi vai trò một Owner, khoá Owner) chạy trong `withCompany` và mở đầu bằng:

```sql
SELECT id FROM members WHERE role = 'owner' AND status = 'active' ORDER BY id FOR UPDATE
```

Khoá theo thứ tự id nên hai yêu cầu đồng thời xếp hàng thay vì deadlock; yêu cầu sau đếm lại và nhận `409 LAST_OWNER`. Test tích hợp chạy hai yêu cầu song song (spec member-management).
*Đã cân nhắc*: trigger `AFTER UPDATE` kiểm số Owner. Không chọn: lỗi trigger khó map ra thông báo rõ, và vẫn cần khoá để tránh write skew ở mức READ COMMITTED.

### D4. Lời mời: token, tra cứu công khai, nhận lời mời

- **Token**: 32 byte ngẫu nhiên (`crypto.randomBytes`), base64url trong link `${WEB_ORIGIN}/invite#token=…` — đặt sau `#` để token không vào log truy cập của Caddy / Fastify. DB chỉ lưu `sha256(token)`. Gửi lại = token mới + `expires_at = now() + 7 ngày`, link cũ chết ngay (#034).
- **Tra cứu không có công ty**: người mở link chưa đăng nhập nên chưa có `app.company_id`. Thêm hàm `SECURITY DEFINER app.invitation_by_token_hash(bytea)` (cùng mẫu với `member_for_user`: owner `dw_owner`, `search_path` cố định, chỉ `dw_app` EXECUTE, policy `invitations_owner_lookup FOR SELECT TO dw_owner`) trả **một** dòng: id, company_id, tên công ty, tên người mời, email, role, tên phòng, status, expires_at. Không có hàm nào liệt kê lời mời.
- **Endpoint công khai** (POST để token nằm trong body, không trong URL / log):
  - `POST /api/invitations/preview {token}` → thông tin hiển thị, hoặc `410 INVITATION_INVALID` chung cho sai / huỷ / đã nhận, `410 INVITATION_EXPIRED` cho hết hạn (để trang hiện đúng màn "hết hạn" — chỉ lộ "token này từng hợp lệ", chấp nhận được vì token 256 bit).
  - `POST /api/invitations/accept {token, name?, password?}`. Giới hạn 20 lần / phút / IP cho cả hai (`perIpLimit` có sẵn).
- **Nhận lời mời — hai chế độ**:
  1. *Không có phiên*: cần `name` + `password`. Module `src/auth/` tạo tài khoản bằng `auth.api.signUpEmail` (bọc như `signUpWithEmail` của 1a), tắt gửi email xác minh cho lần này, rồi đặt `email_verified = true` qua `internalAdapter.updateUser` (#033). Email đã có tài khoản → `409 EMAIL_TAKEN` ("đăng nhập bằng tài khoản đó rồi mở lại link" nếu tài khoản chưa có công ty; xem chế độ 2).
  2. *Có phiên*: phiên phải **chưa có công ty** và `email` của phiên trùng email lời mời (so sánh đã chuẩn hoá) → không cần mật khẩu. Khác email → `403 INVITATION_EMAIL_MISMATCH`. Đã có công ty → `409 ALREADY_IN_COMPANY` (#035). Phủ cả Google (Better Auth tạo user khi đăng nhập Google lần đầu, web cất token vào `sessionStorage` trước khi chuyển sang Google, `callbackURL` là `/invite`, quay về thì đọc lại token rồi xoá) lẫn tài khoản dở dang từ 1a.
  - Bước ghi: `withCompany(invitation.companyId)` (company id lấy từ hàm tra cứu — đáng tin vì token đã khớp hash): `SELECT … FOR UPDATE` lời mời, kiểm lại `pending` + còn hạn + phòng chưa lưu trữ, chèn `members`, đặt `accepted`, ghi `AuditEvent invitation.accepted` (actor = thành viên mới). Vi phạm unique (phòng đã có trưởng phòng, `user_id` đã là thành viên) → `409` có mã riêng, lời mời giữ `pending`.
  - Nếu tạo tài khoản xong mà bước ghi lỗi: người dùng đã đăng nhập, chưa có công ty → web gọi lại `accept` ở chế độ 2 (cùng ý tưởng "một đường dở dang" của 1a D4).
- **Gửi email**: `inviteTemplate` trong `packages/mail/src/templates/vi.ts`, gửi không chờ; lỗi gửi ghi log không kèm địa chỉ. Mời nhiều email: tạo tất cả trong một transaction rồi mới gửi.
- **Email đã thuộc công ty khác**: lúc mời **không** kiểm (không có quyền nhìn công ty khác và không muốn lộ "email này đã dùng ở đâu đó"); người được mời nhận lỗi lúc nhận lời mời. Đã có thành viên / lời mời chờ trong **chính** công ty → báo theo từng email (spec).

### D5. Phòng ban và trưởng phòng

- `PATCH /api/departments/:id {name?, description?, headMemberId?: uuid | null}`. Đổi trưởng phòng trong một transaction:
  1. Trưởng phòng cũ (nếu có) → `role = 'member'`, giữ phòng.
  2. Người mới (phải `active`, vai trò `manager`/`member`) → `role = 'manager'`, `department_id = X`. Nếu người mới đang là Trưởng phòng của phòng Y thì phòng Y mất trưởng phòng.
  3. `AuditEvent` `department.updated` (fields `['head']`) + `member.role_changed` / `member.moved` cho từng người bị đổi.
  - Thứ tự 1 → 2 để index unique một phần không vướng giữa chừng.
- `POST /api/departments {name, description?, headMemberId?}` dùng cùng hàm đổi trưởng phòng.
- `POST /api/departments/:id/archive`: đếm `members` (mọi trạng thái) + lời mời `pending` chưa hết hạn của phòng; còn → `409 DEPARTMENT_NOT_EMPTY` kèm số lượng. Lời mời đã hết hạn của phòng bị đánh `cancelled` cùng lúc.
- `GET /api/departments`: mọi thành viên đang hoạt động (chỉ `requireCompany`, không thêm hàng ma trận). Trả thêm `head {id, name}`, `memberCount`, tối đa 4 người đầu để vẽ avatar, và ở cấp danh sách `unassignedCount` (chỉ Owner / Admin nhận số này).
- Không có trưởng phòng là Owner / Admin (D1).

### D6. Thành viên: danh sách, sửa, khoá

- **Quyền xem**: thêm action `member.list` vào ma trận: Owner / Admin `all`, Trưởng phòng `own-department`, Nhân viên `false` (#038). Sửa docs/requirements.md mục 1 (hàng "Xem danh sách người dùng") trước, test ma trận sau, code sau cùng.
- `GET /api/members?q=&role=&department=<id|none>&status=<active|locked>`: đọc `member_profiles` (view thêm `department_id`, `locked_at`, `last_seen_at`). Trưởng phòng: server ép `department = phòng mình`, bỏ qua tham số.
- **Cột "Hoạt động"**: `members.last_seen_at`, cập nhật trong plugin request-context tối đa mỗi giờ một lần (`UPDATE … WHERE last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour'`). *Đã cân nhắc*: lấy `max(auth.sessions.updated_at)` qua view — không chọn vì `dw_app` không có quyền trên `auth.sessions` (1a D2) và phiên bị xoá khi khoá / đăng xuất.
- `GET /api/invitations?state=` (Owner / Admin) — web ghép với danh sách thành viên khi lọc trạng thái "Đã mời" hoặc "mọi trạng thái".
- `PATCH /api/members/:id {role?, departmentId?: uuid | null}` — một endpoint cho cả "Đổi vai trò" và "Chuyển phòng ban" (hai hộp thoại của màn hình gửi một trong hai trường). Áp D2, D3; chuyển Trưởng phòng sang phòng khác → `role = 'member'` (spec member-management).
- `POST /api/members/:id/lock` và `/unlock`. Khoá: `status = 'locked'`, `locked_at = now()`, rồi gọi `revokeUserSessions(userId)` trong `src/auth/` (xoá mọi dòng `auth.sessions` của user — chạy sau commit; nếu bước này lỗi thì `requireCompany` vẫn chặn vì đọc trạng thái mỗi request).
- **Chặn đăng nhập** (spec authentication): `databaseHooks.session.create.before` của Better Auth gọi `memberForUser`; `status = 'locked'` → `throw new APIError('FORBIDDEN', { code: 'ACCOUNT_LOCKED' })`. Áp cho mọi đường tạo phiên (email, Google, sau đặt lại mật khẩu). Thứ tự với bộ đếm thử sai: mật khẩu sai vẫn trả 401 như cũ, nên không lộ thêm gì; chỉ khi mật khẩu **đúng** mới thấy "đã bị khoá".
- Better Auth không bật `cookieCache`, nên phiên bị xoá có hiệu lực ngay ở request sau.

### D7. Quên / đặt lại mật khẩu

- Bật `emailAndPassword.sendResetPassword` (link `${WEB_ORIGIN}/reset-password?token=…`, mẫu `resetPasswordTemplate`), `resetPasswordTokenExpiresIn = 3600`, `revokeSessionsOnPasswordReset = true`. Endpoint của Better Auth 1.7: `POST /api/auth/request-password-reset`, `POST /api/auth/reset-password`. Token lưu ở `auth.verifications` và Better Auth xoá sau khi dùng → link dùng một lần.
- Mật khẩu phổ biến: hook `before` của 1a đã có `/reset-password` trong `PASSWORD_FIELDS`.
- `onPasswordReset`: đặt `email_verified = true` và ghi `AuditEvent auth.password_reset` nếu user có công ty. Đây là đường lấy lại email bị đăng ký trước (rủi ro còn mở của 1a): chủ thật của hộp thư đặt lại mật khẩu → mọi phiên của người kia bị huỷ.
- Giới hạn: `customRules['/request-password-reset'] = 5 / phút / IP`; thêm bộ đếm theo email (dùng lại `createFailedLoginLimiter` với tham số 3 lần / 15 phút) trong hook `before`, trả 429.
- Phản hồi luôn `200` giống nhau (Better Auth đã vậy); không gửi email cho email không tồn tại.
- Thành viên bị khoá vẫn đặt lại được mật khẩu nhưng vẫn không đăng nhập được (D6).

### D8. Web

- **Route mới**: `/departments`, `/users` (search params `q`, `role`, `department`, `status` qua `validateSearch` bằng Zod), `/invite` (đọc token từ `location.hash`), `/forgot-password`, `/reset-password`. Thanh bên: "Phòng ban" (mọi người), "Người dùng" (ẩn với Nhân viên theo `can(role, 'member.list')`). Trang đăng nhập có link "Quên mật khẩu?".
- **Trang Phòng ban**: thẻ phòng (tên, mô tả, trưởng phòng, avatar thành viên, số người), dialog thêm / sửa với ô trưởng phòng chỉ liệt kê Nhân viên + Trưởng phòng đang hoạt động, dòng báo "sẽ được đổi vai trò…" khi chọn Nhân viên; dialog "Chưa xoá được phòng …" khi `409 DEPARTMENT_NOT_EMPTY`; trạng thái trống có 4 gợi ý. Trưởng phòng / Nhân viên thấy callout "Bạn đang xem…".
- **Trang Người dùng**: bảng thành viên + lời mời, bộ lọc trên URL, menu thao tác theo `canManageMember`, dialog mời nhiều email (tách theo dấu phẩy / xuống dòng, báo lỗi từng email), dialog "Không đổi được vai trò của bạn" cho Owner cuối. Nút mời bị khoá kèm hướng dẫn khi chưa xác minh email.
- **Nhận lời mời**: dùng `auth-layout` của 1a với panel "Tham gia công ty" (signup.html); nút Google hiện email lời mời; màn "Lời mời đã hết hạn".
- **Quên / đặt lại mật khẩu**: chưa có màn vẽ; dựng bằng `auth-layout` + `Field` + `Callout` sẵn có, cùng phong cách trang đăng nhập (xem câu hỏi trong PR).
- Mọi chuỗi trong `src/i18n/vi.ts`.

### D9. API tóm tắt

| Method | Đường dẫn | Guard |
|---|---|---|
| GET | `/api/departments` | `requireCompany` |
| POST | `/api/departments` | `org.manage` |
| PATCH | `/api/departments/:id` | `org.manage` |
| POST | `/api/departments/:id/archive` | `org.manage` |
| GET | `/api/members` | `member.list` |
| PATCH | `/api/members/:id` | `org.manage` + D2 |
| POST | `/api/members/:id/lock`, `/unlock` | `org.manage` + D2 |
| GET | `/api/invitations` | `org.manage` |
| POST | `/api/invitations` | `org.manage` + `requireVerifiedEmail` + D2 |
| POST | `/api/invitations/:id/resend`, `/cancel` | `org.manage` + `requireVerifiedEmail` (resend) + D2 |
| POST | `/api/invitations/preview`, `/accept` | công khai, giới hạn IP |

Mọi route theo id dùng `guards.notFound` (id sai định dạng cũng 404 + `access.not_found`). Mọi `POST|PATCH` đã qua kiểm `Origin` của 1a.

### D10. Kiểm thử

- **Unit**: `member-rules` (bảng đầy đủ actor × target × hành động), ma trận quyền (hàng mới), tách danh sách email, schema Zod, mẫu email (escape HTML).
- **Tích hợp** (Testcontainers, dựng 2 công ty như 1a, thêm phòng ban + Trưởng phòng + Nhân viên):
  - Mỗi kịch bản trong `specs/` là một test.
  - Với **mọi** route mới: A đọc B, A sửa B (404 + `access.not_found`, dữ liệu B không đổi); Trưởng phòng / Nhân viên tạo phòng ban, mời người → 403; Admin gán Owner/Admin, Admin hạ / khoá Owner → 403; hạ / khoá Owner cuối → 409.
  - RLS / FK ghép bằng SQL thô dưới `dw_app`: chèn `members.department_id` của công ty khác bị từ chối; `app.invitation_by_token_hash` không liệt kê được.
  - Hai yêu cầu hạ Owner chạy song song (D3).
  - Khoá → phiên cũ 401, đăng nhập email bị chặn; Google mô phỏng bằng gọi thẳng `internalAdapter.createSession` qua hook.
  - Lời mời: email từ transport bộ nhớ → token → preview → accept; hết hạn bằng cách sửa `expires_at`.
- **E2E** (Playwright, hạ tầng của 1a): Owner xác minh email → tạo phòng → mời → người được mời nhận lời mời → Owner khoá người đó → người đó bị đăng xuất; quên mật khẩu → đặt lại → đăng nhập.

## Risks / Trade-offs

- [Hàm `SECURITY DEFINER` thứ hai đi vòng RLS] → chỉ trả một dòng theo hash 256 bit; không có tham số tìm theo email / công ty; test xác nhận không liệt kê được.
- [Trưởng phòng suy ra từ vai trò] → Owner / Admin không làm trưởng phòng được. Nếu khách cần, thêm cột ở change sau (Q2).
- [Không kiểm "email đã thuộc công ty khác" lúc mời] → Owner có thể thấy lời mời treo; người được mời thấy lỗi rõ. Đổi lại không lộ email giữa các công ty.
- [`last_seen_at` cập nhật mỗi giờ] → cột "Hoạt động" sai lệch tối đa 1 giờ; đổi lại không ghi DB mỗi request.
- [Xoá phiên sau commit có thể lỗi] → `requireCompany` đọc `status` mỗi request nên phiên còn sót vẫn bị chặn (403 `ACCOUNT_LOCKED`).
- [Đặt lại mật khẩu đánh dấu đã xác minh] → đúng ý (chứng minh giữ hộp thư); người đăng ký trước mất phiên và mất tài khoản — đây chính là mục tiêu.
- [Token lời mời sau `#`] → không vào log server; nhưng vẫn nằm trong lịch sử trình duyệt của người nhận. Chấp nhận (link dùng một lần, có hạn).
- [Change khá lớn: 3 capability, ~11 route, 5 trang] → ước 1–2 buổi như 1a; nếu apply thấy quá, tách web Phòng ban / Người dùng sang buổi thứ hai theo nhóm task 6–8.

## Migration Plan

- Một migration `0003_departments_invites`: bảng, cột, ràng buộc, RLS, policy tra cứu, hàm `invitation_by_token_hash`, tạo lại view `member_profiles` (thêm cột).
- Dữ liệu hiện có: chỉ Owner (không cần phòng) → `CHECK` thoả ngay; `locked_at` NULL khớp `status = 'active'`.
- Rollback: revert PR + `DROP` theo thứ tự ngược trong DB dev (chưa có dữ liệu thật).
