# Tasks: add-tenancy-and-auth

## 1. Lược đồ và RLS (`packages/db`)

- [ ] 1.1 Thêm schema Drizzle cho `auth.*` (bảng Better Auth trong `pgSchema('auth')`) và migration tạo schema `auth` + quyền cho `dw_app`; kiểm tra `pnpm db:migrate` chạy hai lần không lỗi
- [ ] 1.2 Thêm bảng `companies`, `members` (enum `role`, `status`, `user_id UNIQUE`), `audit_events`, RLS `ENABLE` + `FORCE` + policy theo `app.company_id`, `REVOKE UPDATE, DELETE` trên `audit_events`; test tích hợp: SQL thô dưới `dw_app` không đặt công ty → rỗng, đặt công ty A → chỉ thấy A, chèn dòng công ty B → bị từ chối, `UPDATE`/`DELETE` nhật ký → bị từ chối
- [ ] 1.3 Viết helper `withCompany(db, companyId, fn)` (transaction + `set_config(..., true)`); test tích hợp: biến không rò sang transaction kế tiếp trên cùng kết nối pool
- [ ] 1.4 Thêm hàm `app.member_for_user(user_id)` (`SECURITY DEFINER`, `search_path` cố định, chỉ `dw_app` được `EXECUTE`) và view `member_profiles` (`security_invoker`); test tích hợp: hàm chỉ trả thành viên của đúng `user_id`, view dưới công ty A không lộ email người công ty B

## 2. Nền tảng dùng chung (`packages/core`, `packages/mail`)

- [ ] 2.1 Viết ma trận quyền (`ACTIONS`, `ROLES`, `can()`) đủ mọi hàng ở docs/requirements.md mục 1; test dạng bảng: mỗi ô của ma trận đúng với từng vai trò
- [ ] 2.2 Viết `isCommonPassword()` (danh sách trong repo, gồm mẫu tiếng Việt) và schema Zod `signupInput`, `companyInput` dùng chung api / web; unit test: 9 ký tự bị từ chối, `1234567890` bị từ chối, cụm từ dài không ký tự đặc biệt được chấp nhận, tên công ty rỗng bị từ chối
- [ ] 2.3 Tạo `packages/mail` (`createMailer`, transport bộ nhớ cho test, mẫu email xác minh tiếng Việt); thêm Mailpit vào `compose.yaml`; kiểm tra unit test mẫu email và gửi thử tới Mailpit hiện trên `localhost:8025`

## 3. Xác thực (`apps/api/src/auth`)

- [ ] 3.1 Cấu hình Better Auth (drizzle adapter, email + mật khẩu, Google có điều kiện, phiên 30 ngày, cookie an toàn, `trustedOrigins`, hook chặn mật khẩu phổ biến, gửi email xác minh) và route `GET|POST /api/auth/*`; thêm biến env vào schema (Google đủ cặp hoặc không có); test: thiếu `BETTER_AUTH_SECRET` → tiến trình dừng, chỉ có `GOOGLE_CLIENT_ID` → lỗi cấu hình
- [ ] 3.2 Viết plugin `request-context` và guard `requireAuth`, `requireCompany`, `requirePermission`, `requireVerifiedEmail`, helper `notFound`; unit test từng guard với `app.inject` (401, 409 `NO_COMPANY`, 403 + `AuditEvent`, 403 `EMAIL_NOT_VERIFIED`, 404 + `AuditEvent`)
- [ ] 3.3 Thêm giới hạn thử sai theo email trên `/api/auth/sign-in/email` (`@fastify/rate-limit`, chỉ đếm lần sai) và bật `trustProxy`; test tích hợp: 10 lần sai trong 15 phút → lần 11 nhận 429 dù mật khẩu đúng; lần đúng xoá bộ đếm
- [ ] 3.4 Test tích hợp các kịch bản spec `authentication`: đăng nhập đúng / sai (sai email và sai mật khẩu cùng phản hồi), cookie httpOnly + SameSite=Lax, đăng xuất rồi dùng cookie cũ → 401, gọi API không phiên → 401, link xác minh dùng một lần, gửi lại link, mật khẩu không xuất hiện trong log

## 4. Công ty và thành viên (API)

- [ ] 4.1 Viết `POST /api/signup` (Zod, `signUpEmail`, tạo công ty + Owner + `AuditEvent` trong `withCompany`) và `POST /api/companies` (tạo công ty sau Google; đã có công ty → từ chối); test tích hợp mọi kịch bản spec `company-signup` về đăng ký, kể cả email trùng và lỗi giữa chừng → người dùng chưa có công ty nhận 409 `NO_COMPANY`
- [ ] 4.2 Viết `GET /api/me`, `GET /api/config/public`, `GET|PATCH /api/company` (`requirePermission('company.update')`, nhật ký chỉ ghi tên trường); test tích hợp: Owner / Admin đổi được, Nhân viên → 403 + nhật ký, chèn id công ty B vào body không đổi được công ty B, nhật ký không chứa số điện thoại
- [ ] 4.3 Viết `GET /api/members/:id` (đọc qua `member_profiles`, không tìm thấy → `notFound`); test tích hợp: đọc thành viên công ty mình → 200, id công ty B → 404 giống id không tồn tại + `AuditEvent access.not_found` ở công ty A
- [ ] 4.4 Test chặn import: không file nào ngoài `apps/api/src/auth/` import bảng `auth.*`; kiểm tra test fail khi thêm một import thử

## 5. Web

- [ ] 5.1 Thêm `@tanstack/react-router`, `@tanstack/react-query`, `better-auth/react`; dựng các route `/signup`, `/login`, `/onboarding`, `/verify-email`, `/` và điều hướng theo `me` (chưa đăng nhập → `/login`, chưa có công ty → `/onboarding`); kiểm tra `pnpm --filter @dw/web build` và typecheck qua
- [ ] 5.2 Thêm `@fontsource/be-vietnam-pro` (4 độ đậm, subset vietnamese + latin) và chuyển component dùng chung từ `docs/design/screens/_shared.css` (Button, Field, Callout, Badge, khung sidebar) và làm trang đăng ký, đăng nhập theo `signup.html` (lỗi theo trường từ schema Zod, nút Google theo `googleEnabled`, chuỗi trong `vi.ts`); unit test hàm ánh xạ lỗi Zod → thông báo tiếng Việt
- [ ] 5.3 Làm trang `/onboarding` (tạo công ty), `/verify-email`, banner "Xác minh email" + "Gửi lại" trong khung app, đăng xuất; kiểm tra bằng tay trên `pnpm dev` với Mailpit: đăng ký → nhận email → bấm link → banner biến mất
- [ ] 5.4 Dựng `globalSetup` Playwright (Testcontainers + api + `vite preview`) và e2e: đăng ký → vào app → đăng xuất → đăng nhập lại; mật khẩu yếu báo lỗi đúng trường; không tràn ngang ở 320 và 1440 px; kiểm tra `pnpm e2e` qua

## 6. Tài liệu và lộ trình

- [ ] 6.1 Cập nhật `.env.example`, `.env.prod.example`, `compose.prod.yaml` (biến mới) và README (Mailpit, cách đăng ký thử); kiểm tra stack prod trên máy: `/api/auth` chạy qua Caddy, cookie có cờ Secure
- [ ] 6.2 Cập nhật docs/architecture.md mục 7 (schema `auth`, hàm `member_for_user`, `withCompany`); kiểm tra `openspec validate --all --strict` qua

## Workflow follow-up

- Sau khi code merge: `/opsx:archive add-tenancy-and-auth`, đánh dấu ✅ change 1a trong `docs/ROADMAP.md`, đóng issue #2.
- Change tiếp: 1b `add-departments-and-invites` (phòng ban, lời mời, đổi vai trò, khoá, quên mật khẩu).
