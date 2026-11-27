# Design: add-tenancy-and-auth

## Context

- Khung từ change 0 (`openspec/specs/runtime-config`, `service-health`): Fastify `buildApp`, `loadConfig`, logger có che, `createDatabase`, vai trò DB `dw_owner` (migration) / `dw_app` (NOBYPASSRLS, không phải owner), Testcontainers `startTestPostgres`.
- Chưa có bảng nghiệp vụ, chưa có đăng nhập, web chỉ có trang giữ chỗ.
- Quyết định liên quan: 0.2 #012 (Better Auth, email + Google), #032–#035, #039 (nhiều Owner), #041; ma trận quyền ở docs/requirements.md mục 1.
- Màn hình: `docs/design/screens/signup.html` (luồng Owner đăng ký). Luồng nhận lời mời, phòng ban, người dùng thuộc change 1b.
- Lý do và phạm vi: xem proposal.md. Hành vi: 5 spec trong `specs/`.

## Goals / Non-Goals

**Goals:**
- Một lớp tách công ty dùng lại được cho mọi change sau: helper `withCompany` + RLS + mẫu test "công ty A không đọc / sửa được công ty B".
- Đăng ký, đăng nhập, xác minh email chạy thật end-to-end trên máy (Mailpit).
- Ma trận quyền đủ cho cả MVP (kể cả hành động chưa có API), để change sau chỉ gọi `requirePermission`.

**Non-Goals:**
- Phòng ban, lời mời, đổi vai trò, khoá tài khoản, trang Người dùng (change 1b).
- Quên mật khẩu / đặt lại mật khẩu (đề xuất làm trong 1b, cùng luồng email).
- Chặn hành động khi chưa xác minh email: làm cùng hành động đó (mời người ở 1b, nạp credit ở change 16). Change này chỉ cung cấp cờ `emailVerified` và guard dùng chung.
- Đăng nhập Zalo, 2FA.

## Decisions

### D1. Mô hình dữ liệu

```
auth.users          (Better Auth) id, name, email UNIQUE, email_verified, image, timestamps
auth.sessions       (Better Auth) id, token UNIQUE, user_id, expires_at, ip_address, user_agent
auth.accounts       (Better Auth) provider_id, account_id, user_id, password (băm)
auth.verifications  (Better Auth) identifier, value, expires_at

public.companies    id uuid PK, name, contact_phone NULL, created_at, updated_at        RLS: id = app.company_id
public.members      id uuid PK, company_id FK, user_id UNIQUE → auth.users, role, status,
                    created_at                                                         RLS: company_id = app.company_id
public.audit_events id uuid PK, company_id FK, actor_member_id NULL, action, target_type,
                    target_id NULL, fields text[] NULL, created_at                     RLS + chỉ INSERT/SELECT
view public.member_profiles (security_invoker) = members JOIN auth.users (name, email, email_verified)
```

- `members.user_id UNIQUE` toàn hệ thống thực thi "mỗi email một công ty" (#035) ngay trong DB, kể cả khi RLS che các công ty khác.
- `role`: enum `owner | admin | manager | member`. `status`: enum `active | locked` (1b dùng `locked`; change này chỉ tạo `active`).
- `department_id` **chưa thêm**; 1b thêm bằng migration riêng.
- `audit_events.fields` chỉ chứa **tên trường** đã đổi (spec audit-log), không có giá trị.

### D2. Bảng của Better Auth: schema `auth`, không RLS

- Đây là **danh tính toàn cục** (một email trước khi biết công ty), không phải dữ liệu nghiệp vụ: Better Auth phải tìm người dùng theo email lúc đăng nhập, khi chưa có công ty. Vì vậy không gắn `company_id`. Đây là ngoại lệ có chủ đích với luật "mọi bảng nghiệp vụ có company_id".
- **Chặn rò rỉ**: chỉ module `apps/api/src/auth/` được import bảng `auth.*`. Mọi chỗ khác đọc tên / email qua view `member_profiles` (`security_invoker = true`), nên RLS của `members` vẫn lọc. Một test kiểm tra không file nào ngoài `src/auth/` import `auth` schema.
- **Đã cân nhắc**: gắn `company_id` vào bảng người dùng của Better Auth. Không chọn: phải sửa sâu adapter, và đăng nhập Google lần đầu chưa có công ty.

### D3. RLS và helper `withCompany`

- Mỗi bảng nghiệp vụ: `ENABLE` + `FORCE ROW LEVEL SECURITY`, một policy `USING (company_id = current_setting('app.company_id', true)::uuid) WITH CHECK (cùng điều kiện)`. Chưa đặt biến thì `current_setting(..., true)` trả NULL → không thấy dòng nào (spec tenant-isolation, "Phiên chưa đặt công ty").
- `withCompany(db, companyId, fn)` trong `packages/db`: mở transaction, `SELECT set_config('app.company_id', $1, true)` (chỉ trong transaction), chạy `fn(tx)`. Đây là **cách duy nhất** để truy vấn bảng nghiệp vụ; code ngoài helper không nhận được đối tượng DB nghiệp vụ.
- **Tìm thành viên từ phiên**: khi đăng nhập mới chỉ biết `user_id`, chưa biết công ty, mà RLS lại chặn đọc `members`. Giải bằng một hàm `SECURITY DEFINER` duy nhất `app.member_for_user(user_id) → (member_id, company_id, role, status)`, owner là `dw_owner`, `search_path` cố định, chỉ `dw_app` được `EXECUTE`. Đây là lối đi qua RLS duy nhất, có test riêng.
- **Tạo công ty**: trong `withCompany(newId, …)` với `newId` sinh ở ứng dụng, chèn `companies` rồi `members` (Owner) rồi `audit_events` trong cùng transaction.
- `audit_events`: `REVOKE UPDATE, DELETE` khỏi `dw_app` (theo ghi chú trong `docker/postgres/roles.sql`), có test.

### D4. Better Auth trong Fastify

- Cấu hình ở `apps/api/src/auth/auth.ts`: `drizzleAdapter(db, { provider: 'pg', schema })` với bảng trong `pgSchema('auth')`; `emailAndPassword` (`minPasswordLength: 10`, `requireEmailVerification: false` theo #033), `emailVerification.sendVerificationEmail` (gửi không chờ, theo khuyến cáo chống timing), `socialProviders.google` **chỉ khi** có `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `session.expiresIn = 30 ngày` + `updateAge = 1 ngày`, `advanced.useSecureCookies` khi `NODE_ENV=production`, `trustedOrigins = [WEB_ORIGIN]`.
- Gắn route `GET|POST /api/auth/*` theo mẫu Fastify chính thức (better-auth 1.7 docs, `fromNodeHeaders`).
- **Mật khẩu phổ biến** (#032): `hooks.before` của Better Auth chặn ở mọi đường đặt mật khẩu (`/sign-up/email`, sau này `/reset-password`), dùng `isCommonPassword()` trong `packages/core` (danh sách ~1.000 mật khẩu phổ biến nhất, kèm mẫu tiếng Việt như `matkhau123`, đặt trong repo, không thêm thư viện).
- **Đăng ký công ty bằng email**: route riêng `POST /api/signup` {companyName, name, email, password, phone?}. Route kiểm tra bằng Zod (schema dùng chung với web, ở `packages/core`), gọi `auth.api.signUpEmail`, rồi tạo công ty. Nếu tạo công ty lỗi sau khi đã có tài khoản thì người dùng rơi vào bước "Tạo công ty", **giống hệt luồng Google**. Nhờ vậy chỉ có một đường "đã đăng nhập nhưng chưa có công ty", không cần giao dịch xuyên Better Auth.
- **Đã cân nhắc**: dùng plugin `organization` của Better Auth. Không chọn: nó cho một người thuộc nhiều tổ chức (trái #035), có mô hình vai trò riêng, và không đi qua RLS của mình.

### D5. Ngữ cảnh request: phiên → thành viên → công ty

- Plugin `request-context`: đọc phiên (`auth.api.getSession`), gọi `member_for_user`, rồi gắn `request.ctx = { userId, memberId, companyId, role, emailVerified }`.
- Các guard:
  - `requireAuth`: chưa đăng nhập → 401.
  - `requireCompany`: chưa có công ty → 409 `NO_COMPANY`.
  - `requirePermission(action)`: không đủ quyền → 403 + `AuditEvent access.denied`.
  - `requireVerifiedEmail`: chưa xác minh → 403 `EMAIL_NOT_VERIFIED`. Change này chưa có route nào dùng guard này; nó có test riêng để 1b và change 16 dùng lại.
- `notFound(request, targetType, id)`: trả 404 chung và ghi `AuditEvent access.not_found`. Mọi route đọc / sửa theo id dùng helper này (spec tenant-isolation). Không phân biệt "không tồn tại" với "của công ty khác", vì làm vậy phải đi vòng qua RLS.
- Fastify bật `trustProxy` khi chạy sau Caddy để lấy đúng IP cho giới hạn thử sai.

### D6. Giới hạn thử đăng nhập sai

- **Theo IP**: `rateLimit` có sẵn của Better Auth cho `/sign-in/email` và `/sign-up/email`.
- **Theo email** (spec: 10 lần sai / 15 phút → 429): đặt `@fastify/rate-limit` trên route `/api/auth/sign-in/email`, khoá theo email đã chuẩn hoá (lowercase, trim). Chỉ lần sai mới bị đếm: lần đúng thì xoá bộ đếm.
- Bộ đếm để trong bộ nhớ: chỉ có một tiến trình api (NFR-10). Khởi động lại thì bộ đếm về 0, chấp nhận được với MVP.

### D7. Ma trận quyền ở `packages/core`

- `ACTIONS` liệt kê đủ các hàng của ma trận mục 1 (kể cả hành động của change sau, ví dụ `worker.create`, `credit.topup`). `can(role, action)` trả `'all' | 'own-department' | false`.
- Test dạng bảng: mỗi ô của ma trận trong docs/requirements.md mục 1 là một ca (spec access-control). Đổi ma trận thì sửa tài liệu trước, test sau, code sau cùng.
- Web dùng cùng `can()` để ẩn / hiện nút; API vẫn tự kiểm tra.

### D8. Gửi email: `packages/mail`

- `createMailer({ smtpUrl, from })` bọc nodemailer. Test dùng transport ghi vào bộ nhớ.
- Mẫu email đặt trong `packages/mail/src/templates/vi.ts` (tiếng Việt, cả bản text lẫn HTML đơn giản), không viết chuỗi cứng trong code gửi.
- Dev: thêm `mailpit` (`axllent/mailpit`) vào `compose.yaml`, SMTP cổng 1025, giao diện 8025. Prod: nhà cung cấp SMTP chờ chốt (xem Open Questions).

### D9. Web

- **Router**: `@tanstack/react-router` với các route:
  - `/signup`, `/login`
  - `/onboarding` (tạo công ty)
  - `/verify-email` (nhận token từ link)
  - `/` (khung app, chỉ khi đăng nhập và đã có công ty)
- **Gọi API**: `@tanstack/react-query`. Truy vấn `me` quyết định điều hướng: chưa đăng nhập → `/login`; chưa có công ty → `/onboarding`.
- **Client auth**: `better-auth/react` (`createAuthClient`), dùng cho đăng nhập email, Google và đăng xuất. Đăng ký công ty gọi `POST /api/signup`.
- **Form**: tự viết. React Hook Form không có trong danh sách được phép, mà form ở đây chỉ có 3–5 trường. Kiểm tra bằng chính schema Zod ở `packages/core`, nên lỗi hiển thị khớp lỗi API.
- **Giao diện**: chuyển phần dùng được của `_shared.css` vào component (Button, Field, Callout, Badge, khung sidebar). Mọi chuỗi đặt trong `src/i18n/vi.ts`.
- **Banner xác minh email**: hiện trong khung app khi `emailVerified = false`, có nút "Gửi lại".
- **Dev**: proxy của Vite chuyển `/api` sang api, nên cookie cùng origin; prod cùng origin qua Caddy.

### D10. Cấu hình

Thêm vào schema env của api:
- `BETTER_AUTH_SECRET`: chuỗi ≥ 32 ký tự, bắt buộc.
- `BETTER_AUTH_URL`: URL, bắt buộc.
- `WEB_ORIGIN`: URL, mặc định `http://localhost:5173`.
- `SMTP_URL`: bắt buộc. Dev trỏ tới Mailpit.
- `MAIL_FROM`: bắt buộc.
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`: không bắt buộc, nhưng phải **có đủ cả hai hoặc không có cái nào**. Thiếu một trong hai thì báo lỗi cấu hình.

`GET /api/config/public` trả `{ googleEnabled }` để web biết có hiện nút Google hay không.

### D11. Kiểm thử

- **Tích hợp** (Testcontainers):
  - Dựng 2 công ty, mỗi công ty một Owner và một Nhân viên.
  - Mỗi kịch bản trong spec là một test, đặc biệt cặp "A đọc B" và "A sửa B" cho mọi route mới.
  - RLS kiểm trực tiếp bằng SQL thô dưới vai trò `dw_app`.
  - Email dùng transport bộ nhớ: lấy link xác minh từ email đã "gửi".
- **Unit**:
  - Ma trận quyền, `isCommonPassword`, schema đăng ký.
  - Các guard của Fastify, chạy với `app.inject` và ngữ cảnh giả.
- **E2E** (Playwright):
  - `globalSetup` dựng Postgres bằng Testcontainers, chạy migration, khởi động api với mailer bộ nhớ, rồi chạy web qua `vite preview` có proxy.
  - Luồng kiểm: đăng ký → vào app → đăng xuất → đăng nhập lại; mật khẩu yếu bị báo lỗi.
  - Google OAuth không có e2e, vì cần tài khoản Google thật. Chỉ kiểm việc ẩn/hiện nút Google và luồng `/onboarding`, giả lập bằng một người dùng chưa có công ty.

## Risks / Trade-offs

- [Bảng `auth.*` không có RLS] → chỉ `src/auth/` được import; view `member_profiles` dùng `security_invoker`; có test chặn import. Rủi ro còn lại là code review bỏ sót một truy vấn thô vào `auth.users`.
- [Hàm `SECURITY DEFINER` là lối đi qua RLS] → chỉ trả về thành viên của **chính** `user_id` được truyền vào; `search_path` cố định; test xác nhận không liệt kê được thành viên của người khác. API chỉ gọi hàm này với `user_id` lấy từ phiên.
- [Đăng ký 2 bước (tài khoản rồi mới tạo công ty) có thể dừng giữa chừng] → người dùng vào bước "Tạo công ty", không mất dữ liệu.
- [Bộ đếm thử sai trong bộ nhớ] → mất khi khởi động lại. Chấp nhận với 1 tiến trình; khi chạy nhiều tiến trình thì chuyển sang lưu trong DB.
- [Better Auth đổi API giữa các bản 1.x] → ghim phiên bản chính xác trong lockfile; test tích hợp bao phủ các luồng đang dùng.
- [Gửi email thất bại] → đăng ký vẫn thành công (#033: dùng ngay); có nút "Gửi lại"; lỗi gửi được log (không kèm địa chỉ email đầy đủ).

## Migration Plan

- Hai migration:
  1. Schema `auth` + bảng Better Auth.
  2. `companies`, `members`, `audit_events`, RLS, hàm `member_for_user`, view.
- Hệ thống chưa có dữ liệu thật nên không cần chuyển dữ liệu. Rollback = revert PR + xoá DB dev.

## Open Questions

- Nhà cung cấp SMTP cho prod (dữ liệu email đi qua đâu). Không đổi code: chỉ là `SMTP_URL`. Cần chốt trước `deploy-staging`.
