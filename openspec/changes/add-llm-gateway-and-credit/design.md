# Design: add-llm-gateway-and-credit

## Context

Lý do: xem proposal.md. Hiện trạng code (sau change 0, 1a):

- `packages/db`: Drizzle + PostgreSQL 16, hai vai trò `dw_owner` (chủ schema, chạy migration) và `dw_app` (NOBYPASSRLS). Bảng nghiệp vụ có RLS `ENABLE + FORCE` so với `app.current_company_id()`; chỉ truy vấn qua `withCompany(db, companyId, fn)`. Lối đi qua RLS duy nhất hiện có là `app.member_for_user()` (`SECURITY DEFINER`). `audit_events` chỉ thêm (REVOKE UPDATE/DELETE/TRUNCATE). `docker/postgres/roles.sql` đã dặn: bảng chỉ thêm phải REVOKE trong migration riêng, kèm test.
- `apps/api`: Fastify + Zod; Better Auth 1.7.28 (email + mật khẩu, Google) ở `apps/api/src/auth/` — module duy nhất được chạm bảng `auth.*` (có test chặn import); guard `requireAuth → requireCompany → requirePermission(action)`; `notFound()` trả 404 + `access.not_found`.
- `packages/core/src/access/permissions.ts` đã có `credit.view` (Owner, Admin) và `credit.topup` (Owner) khớp ma trận mục 1.
- `packages/mail`: nodemailer + mẫu tiếng Việt.
- Chưa có bảng `workers` (change 2, phụ thuộc 1b đang apply song song) và chưa có `Task` (change 5). Change này **không phụ thuộc** vào chúng: `worker_id`, `task_id` trong `cost_entries` là uuid không khoá ngoại; khoá ngoại thêm ở change đầu tiên có cả hai bảng (change 5).

## Goals / Non-Goals

**Goals:**
- Một cửa gọi mô hình mà change 5 chỉ việc gọi, đã có tính tiền, trừ credit, chặn hết credit.
- Sổ credit đúng tới từng đồng, chịu được gọi đồng thời, không sửa được.
- Platform admin vận hành được dùng thử (cộng credit tay, đặt giá, thay key) trước khi có nạp tiền VietQR.

**Non-Goals:**
- Streaming, vòng lặp tool, bọc `<data>`, giới hạn mỗi `Task` (change 5). Gateway chỉ có `generate` một lần (có truyền tool qua được), chưa có `stream`.
- Chạy script trong sandbox nhà cung cấp, `SkillRun` (change 15) — bảng giá chừa chỗ cho đơn vị tính khác nhưng chưa dùng.
- Cảnh báo 80% ngân sách worker, bảng lương (change 13); nạp tiền, sao kê, hoá đơn (change 16).
- Xoay khoá chính (`ENCRYPTION_KEY`) — định dạng bản mã có số phiên bản để làm sau.
- Thông báo qua app chat (chưa có kênh) — change này chỉ gửi email.

## Decisions

### D1. Ba package, hướng phụ thuộc một chiều

```
packages/crypto   ← không phụ thuộc gì (node:crypto)
packages/billing  ← packages/db                 (tiền, sổ, giá, ngân sách)
packages/llm      ← packages/billing, crypto, db, ai, @ai-sdk/*
apps/api          ← cả ba (route credit + platform)
apps/runner       ← packages/llm (từ change 5)
```

`packages/billing` chứa cả phép tính giá (`pricing.ts`, hàm thuần, không I/O) để test đơn vị không cần DB. `packages/llm` là nơi duy nhất import `ai` / `@ai-sdk/*` — có test chặn import giống `auth-import-boundary.test.ts` (spec llm-gateway).

*Đã cân nhắc:* gộp billing vào llm — không chọn vì change 16 (nạp tiền) dùng billing mà không cần mô hình.

### D2. Mã hoá bí mật (`packages/crypto`)

- AES-256-GCM qua `node:crypto`, IV 12 byte ngẫu nhiên mỗi lần, tag 16 byte.
- Khoá chính: `ENCRYPTION_KEY` = 32 byte mã base64; Zod kiểm tra độ dài khi khởi động (spec runtime-config đã có: báo gom lỗi, không in giá trị).
- AAD (dữ liệu gắn kèm) = ngữ cảnh dùng, vd. `provider_key:anthropic`. Chép bản mã sang dòng khác → giải mã lỗi (spec secret-encryption).
- Định dạng lưu: một chuỗi `v1.<iv base64url>.<ciphertext+tag base64url>`. `v1` để sau thêm khoá thứ hai khi xoay khoá.
- API: `createSecretBox(key) → { seal(plaintext, aad): string; open(sealed, aad): string }`. Lỗi giải mã ném `SecretOpenError` không kèm dữ liệu.

*Đã cân nhắc:* `pgcrypto` trong PostgreSQL — khoá sẽ đi qua câu SQL và có thể vào log của DB; không chọn.

### D3. Lưu tiền: số nguyên, đơn vị nhỏ, phép tính bằng BigInt

| Giá trị | Kiểu cột | Đơn vị | Ví dụ |
|---|---|---|---|
| Giá mô hình | `bigint` | micro-USD cho 1 triệu token | $3,00 → `3000000`; $0,125 → `125000` |
| Tỉ giá | `integer` | VNĐ cho 1 USD | `25400` |
| Hệ số giá | `integer` | phần nghìn | 1,30 → `1300`; 1,15 → `1150` |
| Chi phí thật, số tiền bán của 1 lần gọi | `bigint` | micro-VNĐ (10⁻⁶ đồng) | 346,71đ → `346710000` |
| Số dư, số tiền giao dịch | `bigint` | VNĐ | `1284500` |
| Phần lẻ cộng dồn của công ty | `bigint` | micro-VNĐ, `0 ≤ x < 1.000.000` | `710000` |

Công thức (spec model-pricing), toàn bộ bằng `BigInt`, không số thực:

```
T        = Σ (token_loại_i × giá_loại_i)          // loại: vào, ra, cache đọc, cache ghi
real_µđ  = round_half_up( T × tỉ_giá / 10⁶ )
sale_µđ  = round_half_up( T × tỉ_giá × hệ_số / 10⁹ )
```

Kiểm tra đơn vị: token × (µUSD / 10⁶ token) = T/10⁶ µUSD; × tỉ giá = T × tỉ_giá / 10⁶ µđ; × hệ_số/1000 → chia 10⁹. Ví dụ spec: 1.000 × 3.000.000 + 500 × 15.000.000 = 1,05×10¹⁰; × 25.400 × 1.300 / 10⁹ = 346.710.000 µđ = 346,71đ. Số lớn nhất hợp lý (1 triệu token × $75 × 30.000 × 3.000) ≈ 6,75×10²¹ — vượt `Number` nhưng `BigInt` chịu được; kết quả micro-VNĐ của một lần gọi vẫn nằm gọn trong `bigint` của PostgreSQL. `sale_µđ` được tính thẳng từ `T` (không nhân `real_µđ` đã làm tròn) để chỉ làm tròn một lần.

**Trừ credit — cộng dồn phần lẻ (floor + carry):**

```
tổng      = phần_lẻ_công_ty + sale_µđ
trừ_đồng  = floor(tổng / 10⁶)
phần_lẻ'  = tổng mod 10⁶
```

Bất biến: `Σ trừ_đồng = floor(Σ sale_µđ)` của công ty, nên khách không bao giờ trả thừa quá dưới 1 đồng tổng cộng, và platform không mất tiền. Mỗi `CostEntry` có đúng một `CreditTransaction` loại `usage` (#072), kể cả khi `trừ_đồng = 0` (hiếm: lần gọi dưới 1 đồng).

*Đã cân nhắc:*
- Làm tròn lên từng lần — đơn giản nhưng khách trả thừa tới 1đ mỗi lần (≈ 1.900đ/tháng với công ty trong bản thiết kế) và tổng không khớp `CostEntry × hệ số` như test bắt buộc. Không chọn.
- Lưu số dư bằng micro-VNĐ — số dư hiển thị và giao dịch phải là đồng nguyên (#025, CLAUDE.md). Không chọn.
- `numeric` của PostgreSQL — đúng nhưng mọi phép tính vẫn phải ra JS; giữ một nơi tính (BigInt trong `pricing.ts`) dễ test hơn.

### D4. Bảng dữ liệu

Tất cả trong schema `public`, tạo bằng một migration (số thứ tự lấy lúc apply, sau migration của 1b — tránh trùng số).

**Bảng nghiệp vụ (có `company_id`, RLS ENABLE + FORCE, policy `company_id = app.current_company_id()`):**

- `credit_accounts` — `company_id` PK/FK, `balance_vnd bigint`, `carry_microvnd bigint` (CHECK 0..999999), `multiplier_permille integer NULL` (hệ số riêng, CHECK ≥ 1000), `last_credit_vnd bigint` (số tiền lần cộng gần nhất, cho ngưỡng #071), `low_notified boolean`, `zero_notified boolean`, `trial_granted_at timestamptz NULL`, `updated_at`. `dw_app`: SELECT, INSERT, UPDATE (không DELETE).
- `credit_transactions` — `id`, `company_id`, `kind` (`usage` | `trial` | `adjustment`), `amount_vnd bigint` (dương = cộng, âm = trừ), `balance_after_vnd bigint`, `cost_entry_id uuid NULL UNIQUE` (FK), `reason` (`bank_transfer` | `trial` | `system_fix` | `other`, NULL với `usage`), `note text NULL`, `actor_admin_id uuid NULL` (platform admin), `idempotency_key text NULL`, `created_at`. UNIQUE `(company_id, idempotency_key)`; UNIQUE partial `(company_id) WHERE kind = 'trial'` — chặn dùng thử lần hai ở tầng DB. **Chỉ thêm:** REVOKE UPDATE, DELETE, TRUNCATE FROM dw_app. Index `(company_id, created_at)`.
- `cost_entries` — `id`, `company_id`, `worker_id uuid NULL`, `task_id uuid NULL` (chưa FK, xem Context), `provider`, `model`, `price_id` (FK `model_prices`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (integer), `vnd_per_usd`, `multiplier_permille`, `real_cost_microvnd`, `charge_microvnd` (bigint), `created_at`. Chỉ thêm. Index `(company_id, created_at)`, `(company_id, worker_id, created_at)`.

**Bảng cấp platform (không `company_id`, không RLS — không phải dữ liệu nghiệp vụ, không chứa dữ liệu của công ty nào):**

- `model_prices` — `id`, `provider`, `model`, `input/output/cache_read/cache_write_usd_micros_per_mtok bigint` (cache_write NULL được = nhà cung cấp không tính riêng), `effective_from timestamptz`, `created_by`, `created_at`. UNIQUE `(provider, model, effective_from)`. Chỉ thêm (REVOKE UPDATE/DELETE).
- `fx_rates` — `id`, `vnd_per_usd integer CHECK > 0`, `effective_from timestamptz`, `created_by`. Chỉ thêm; giá trị đang dùng = dòng có `effective_from` mới nhất ≤ now().
- `price_multipliers` — như `fx_rates`, `permille integer CHECK ≥ 1000`. Hệ số mặc định.
- `provider_keys` — `provider` PK (`anthropic` | `openai`), `sealed text`, `updated_by`, `updated_at`, `last_ok_at timestamptz NULL`. `dw_app` SELECT/INSERT/UPDATE (thay key = UPDATE dòng; key cũ bị ghi đè, đúng màn "Key cũ bị xoá khỏi hệ thống").
- `platform_audit_events` — `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `company_id NULL`, `fields text[]`, `created_at`. Chỉ thêm.

Migration seed: tỉ giá và hệ số mặc định 1,30 (#025) với giá trị ban đầu 25.400đ / USD và 1,30 (0.2 #102); **không seed giá mô hình** — giá trên màn thiết kế là dữ liệu mẫu, platform admin nhập giá thật.

*Đã cân nhắc:* một bảng `platform_settings` key/value cho tỉ giá + hệ số — mất lịch sử và CHECK theo kiểu; không chọn. Dùng `numeric` cho hệ số — xem D3.

### D5. Ghi một lần gọi: một transaction, khoá dòng tài khoản

`billing.recordUsage(companyId, usage)` chạy trong `withCompany`:

1. `SELECT … FROM credit_accounts WHERE company_id = $1 FOR UPDATE` — các lần trừ cùng công ty xếp hàng ở đây (spec "Trừ đồng thời không sai số dư").
2. Tính `trừ_đồng`, `phần_lẻ'` (D3) từ `carry_microvnd` vừa đọc.
3. INSERT `cost_entries`, INSERT `credit_transactions` (`balance_after = balance − trừ_đồng`), UPDATE `credit_accounts`.
4. Tính sự kiện báo: `low` nếu số dư mới < `last_credit_vnd × 20 / 100` (làm tròn xuống), số dư mới > 0 và `low_notified = false`; `zero` nếu số dư cũ > 0 ≥ số dư mới và `zero_notified = false`. Đặt cờ trong cùng UPDATE.
5. COMMIT, rồi trả sự kiện cho nơi gọi; nơi gọi gửi email qua `Notifier` (D9). Gửi sau commit nên email lỗi không làm mất giao dịch.

Mọi lần **cộng** (dùng thử, điều chỉnh) cũng khoá dòng như vậy, đặt `last_credit_vnd = số tiền cộng`, và hạ cờ `low_notified` / `zero_notified` khi số dư mới lần lượt ≥ ngưỡng mới / > 0.

Số dư được phép âm sau một lần gọi đã xong (spec credit-ledger; 0.2 #095); hết credit thì việc đang chạy dừng ở lần gọi tiếp theo (#096). Kiểm tra trước khi gọi (D6) không khoá, nên N lần gọi đồng thời có thể cùng qua khi số dư còn ít: mức âm tối đa ≈ N × chi phí một lần gọi — chấp nhận cho MVP.

*Đã cân nhắc:* giữ chỗ (reserve) số tiền ước tính trước khi gọi rồi quyết toán — chính xác hơn nhưng cần bảng giữ chỗ và dọn giữ chỗ treo khi tiến trình chết; để sau nếu thấy âm nhiều. `SERIALIZABLE` thay cho `FOR UPDATE` — phải thử lại khi xung đột, phức tạp hơn mà không lợi gì.

### D6. Cổng gọi mô hình (`packages/llm`)

```ts
const gateway = createGateway({ database, billing, keys, models, clock, logger });
const result = await gateway.generate({
  companyId, workerId?, taskId?,           // companyId từ ngữ cảnh việc, không từ input người dùng
  model: { provider: 'anthropic', id: 'claude-sonnet-5-5' },
  messages, system?, tools?, maxOutputTokens,
});
```

Thứ tự trong `generate`:
1. Tìm giá đang hiệu lực (`effective_from ≤ now()` mới nhất). Không có → `ModelNotPricedError`, không gọi.
2. Đọc số dư (không khoá). ≤ 0 → `CreditExhaustedError` ("công ty đã hết credit"), không gọi.
3. Lấy key: `keys.get(provider)` đọc `provider_keys`, mở bằng secret box, nhớ trong bộ nhớ 60 giây (thay key có hiệu lực trong ≤ 60 giây; lưu key mới thì xoá bộ nhớ ngay trong cùng tiến trình). Không có → `ProviderNotConfiguredError`.
4. Gọi `generateText` của AI SDK với `models.resolve(provider, id, key)`. Lỗi → ném `ProviderCallError` (chỉ mã lỗi + trạng thái HTTP, không kèm request/headers), **không ghi CostEntry**.
5. Đọc usage: `inputTokens`, `outputTokens`, `cachedInputTokens` (cache đọc); cache ghi lấy từ `providerMetadata.anthropic.cacheCreationInputTokens`. Token vào tính tiền = `inputTokens − cache đọc − cache ghi` (AI SDK gộp cả ba vào `inputTokens`; kiểm lại với phiên bản cài khi apply và chốt bằng test).
6. `billing.recordUsage(...)` (D5), gửi sự kiện báo, trả `{ text, toolCalls, usage, chargeVnd }`.

`models` là `ModelResolver`: bản thật tạo `createAnthropic({ apiKey })` / `createOpenAI({ apiKey })`; bản test trả mô hình giả `MockLanguageModelV3` (hoặc tên tương ứng trong bản `ai` cài được) từ `ai/test` với nội dung và usage định sẵn — không thêm thư viện, không có mạng (spec "Mô hình giả cho test"). Đổi nhà cung cấp = thêm một nhánh trong resolver + giá trong DB (NFR-09).

*Đã cân nhắc:* LiteLLM proxy (architecture A8) — thêm một dịch vụ Python; không chọn. Middleware của AI SDK (`wrapLanguageModel`) để tính tiền — gọn, nhưng kiểm tra số dư và lỗi "chưa có giá" phải chạy trước khi có model; giữ hàm `generate` rõ ràng hơn.

### D7. Ngân sách tháng của worker

`billing.workerMonthSpend(tx, workerId, now)` = `floor(Σ charge_microvnd / 10⁶)` của `cost_entries` có `worker_id` trong tháng `[đầu tháng, đầu tháng sau)` tính theo `Asia/Ho_Chi_Minh` (đổi ra mốc UTC trong JS, so bằng index `(company_id, worker_id, created_at)`). `checkWorkerBudget(spend, budgetVnd)` → `{ ok: true, remainingVnd } | { ok: false }`. Ngân sách do nơi gọi truyền vào (đọc từ hồ sơ worker ở change 2/5). Gateway **không** tự chặn theo ngân sách: #018 nói việc đang chạy làm nốt, nên runtime (change 5) gọi kiểm tra này khi nhận việc mới.

*Đã cân nhắc:* lưu tổng đã dùng theo worker-tháng trong một bảng riêng — nhanh hơn nhưng thêm một chỗ có thể lệch với `cost_entries`; tính trực tiếp đủ nhanh với index ở quy mô MVP (bảng lương change 13 có thể thêm bảng tổng hợp).

### D8. Credit dùng thử (#073)

`billing.grantTrial(companyId)`: khoá tài khoản, bỏ qua nếu `trial_granted_at` đã có, INSERT giao dịch `kind = 'trial'` +200.000đ, đặt `trial_granted_at`. UNIQUE partial index là lớp chặn thứ hai khi hai yêu cầu chạy cùng lúc (bắt lỗi trùng → coi như đã cấp). Gọi từ hai chỗ:

1. **Email chuyển sang đã xác minh** — Better Auth `databaseHooks.user.update.after` khi `emailVerified` thành `true` (bắt cả link xác minh lẫn đặt lại mật khẩu của 1b, vì 1b cũng đánh dấu đã xác minh, #067). Hook tra `memberForUser`; chỉ cấp khi người đó là Owner.
2. **Tạo công ty** — `createCompany` (apps/api/src/tenancy) tạo `credit_accounts` trong cùng transaction; nếu người tạo đã xác minh (Google), gọi `grantTrial` sau khi commit.

Lỗi cấp dùng thử chỉ ghi log, không làm hỏng việc xác minh email; cấp lại được bằng tay ở màn quản trị (lý do "Credit dùng thử").

Công ty có từ trước change này (chỉ dữ liệu dev): migration tạo `credit_accounts` số dư 0 cho mọi công ty; công ty cũ đã có Owner xác minh email được cấp dùng thử (0.2 #104).

### D9. Báo sắp hết / hết credit

Port `Notifier` trong `packages/billing`: `lowBalance(companyId, balance, threshold)`, `exhausted(companyId)`. Bản email (`apps/api`, dùng lại `packages/mail`) đọc người nhận qua `member_profiles` trong `withCompany` (Owner cho `low`; Owner + Admin + Trưởng phòng cho `zero`, chỉ người `active`). Mẫu email mới trong `packages/mail/src/templates/vi.ts`. Runner (change 5) dùng cùng bản này khi gateway chạy ở đó. Gửi không chờ (`void … .catch(log)`), log không chứa địa chỉ email (như 1a).

### D10. Platform admin (#076, #077)

**Danh tính.** `PLATFORM_ADMIN_EMAILS` (danh sách phân tách bằng dấu phẩy, so sánh chữ thường) trong config của API. `requirePlatformAdmin` (preHandler cho `/api/platform/*`):
1. Có phiên, email trong danh sách, `emailVerified`, **không** có member (`memberForUser` trả null). Sai bất kỳ điều nào → 404 (`NOT_FOUND_BODY`), và nếu có member thì `access.not_found` vào công ty đó với `targetType = 'platform'`.
2. `twoFactorEnabled = false` → 403 `TWO_FACTOR_REQUIRED` (chỉ với người đã qua bước 1, nên không lộ màn quản trị cho người ngoài).
3. `session.createdAt` cũ hơn 12 giờ → 401 `REAUTH_REQUIRED`.

Tạo công ty (`POST /api/companies`, onboarding Google) bằng email platform admin → 409 `PLATFORM_ADMIN` (spec platform-admin).

**TOTP.** Bật plugin `twoFactor` của Better Auth (có sẵn trong `better-auth`, không thêm thư viện): cần bảng `auth.two_factors` và cột `auth.users.two_factor_enabled` (sinh bằng schema của plugin, migration trong schema `auth`). Plugin tự chặn tạo phiên sau mật khẩu đúng khi đã bật TOTP, cho tới khi gọi `/two-factor/verify-totp`. Thêm vào `hooks.before` sẵn có:
- `/two-factor/enable`: chỉ cho email trong `PLATFORM_ADMIN_EMAILS` (người khác 404) — MVP không mở 2FA cho khách.
- `/two-factor/verify-totp`, `/two-factor/verify-backup-code`: bỏ `trustDevice` (luôn false) — không "ghi nhớ thiết bị".
- Giới hạn: thêm `customRules` cho `/two-factor/*` (5 lần / phút / IP), và dùng `FailedLoginLimiter` theo email cho mã sai.
Bật TOTP trên web: hiện khoá bí mật dạng chữ + link `otpauth://` để nhập tay vào app xác thực; có mã dự phòng của plugin. Không vẽ mã QR (cần thư viện ngoài danh sách — 0.2 #099).

**Đọc chéo công ty.** Platform admin không có `company_id`, nên RLS chặn mọi bảng nghiệp vụ. Hai cách đi qua, cả hai hẹp:
- Danh sách công ty: hàm `app.platform_company_summaries()` (`SECURITY DEFINER`, owner `dw_owner`, `search_path` cố định, chỉ `dw_app` EXECUTE) trả **chỉ** các cột tổng của spec: id, tên, email Owner đầu tiên, số dư, đã trừ 30 ngày, chi phí thật 30 ngày (chỉ để tính tổng platform), hệ số riêng, lần dùng gần nhất. Số worker thêm vào hàm này ở change 2 (bảng `workers` chưa có). Policy SELECT `TO dw_owner` cho các bảng nó đọc, như `members_owner_lookup` của 1a.
- Ghi cho một công ty (điều chỉnh, hệ số riêng): `withCompany(db, companyIdTừĐườngDẫn, …)` — được vì quyền đã kiểm ở guard; id công ty sai → 404.
- Test chặn import: chỉ `apps/api/src/platform/` gọi `platform_company_summaries` và route `/api/platform/*`.

**Nhật ký.** `recordPlatformAudit(db, {...})` ghi `platform_audit_events` cho: `credit.adjusted`, `price.added`, `fx.changed`, `multiplier.changed`, `company_multiplier.set|cleared`, `provider_key.replaced`. Ghi tên trường, không giá trị key. Điều chỉnh credit **không** ghi thêm `AuditEvent` vào công ty — Owner đã thấy giao dịch (kèm lý do, ghi chú) trong lịch sử credit.

**Điều chỉnh credit.** `POST /api/platform/companies/:id/credit-adjustments` body `{ direction: 'credit'|'debit', amountVnd: int 1..100.000.000, reason, note: 1..200 ký tự }`, header `Idempotency-Key` bắt buộc (UUID do web sinh mỗi lần mở hộp thoại). Ghi chú có ≥ 9 chữ số liền nhau → 400 (NFR-03, màn "Không ghi số tài khoản đầy đủ"). Trừ: khoá dòng, `amount > balance` → 422 `INSUFFICIENT_BALANCE`. Trùng khoá → trả lại giao dịch cũ (200).

**Kiểm tra key.** Trước khi lưu, `packages/llm` gọi endpoint liệt kê mô hình của nhà cung cấp (`GET /v1/models`) bằng `fetch` — không tốn token, nên không cần `CostEntry`. 401/403 → `INVALID_KEY`, không lưu. Đây là yêu cầu duy nhất ra ngoài không qua AI SDK, và vẫn nằm trong `packages/llm`.

*Đã cân nhắc:* platform admin là cờ trên `auth.users` — đổi được bằng SQL mà không ai thấy; danh sách trong env đổi phải deploy lại, rõ hơn cho MVP (#076). Một vai trò thứ 5 trong `member_role` — sai với #076 (không thuộc công ty nào).

### D11. API cho công ty

| Route | Guard | Trả |
|---|---|---|
| `GET /api/credit` | `credit.view` | số dư, trạng thái (`normal`/`low`/`exhausted`), ngưỡng (`last_credit_vnd × 20%`), đã dùng tháng này (đồng + số lần), ước tính số ngày (số dư / trung bình 7 ngày, null khi chưa dùng), dùng thử: đã nhận / chờ Owner xác minh |
| `GET /api/credit/transactions?month=YYYY-MM&type=all\|credit\|usage` | `credit.view` | dòng cộng / điều chỉnh, và dòng `usage` **gộp theo (worker_id, ngày giờ VN)**: tổng tiền, số lần, số dư sau của lần cuối |
| `GET /api/credit/usage?date=YYYY-MM-DD&workerId=` | `credit.view` | từng lần: giờ, tổng token, số tiền (đồng nguyên đã trừ). Không trả chi phí thật / hệ số (#074) |
| `GET /api/me` | phiên | thêm `credit: { exhausted: boolean }` khi vai trò là Owner / Admin / Trưởng phòng; không có trường này với Nhân viên |

Tên worker chưa có ở change 4: API trả `workerId`, web hiện "Nhân viên số" chung; change 2/5 nối tên. Mô tả việc ("Báo giá cho Đại lý Hồng Phát") đến từ `Task` — change 5.

### D12. Web

- `/credit` theo `credit.html`: thẻ số dư (5 trạng thái của màn thiết kế), "Đã dùng tháng" (tổng; danh sách theo worker hiện khi có worker — change 2/5), lịch sử gộp + mở chi tiết, nút "Nạp credit" và "Tải sao kê" ở trạng thái **Sắp có**. Admin xem, không có nút nạp.
- Banner đỏ "Công ty đã hết credit" trong `app-shell` khi `me.credit.exhausted`.
- `/platform/companies`, `/platform/pricing`, `/platform/keys` theo `platform-admin.html`, cùng hộp thoại điều chỉnh credit, thêm giá, thay key. `/two-factor` (nhập mã) và `/platform/setup-2fa` (bật TOTP).
- Chuỗi hiển thị trong `i18n/vi.ts`; định dạng tiền `1.284.500đ` bằng `Intl.NumberFormat('vi-VN')`; hệ số hiển thị `× 1,30`.

## Risks / Trade-offs

- [Số dư âm khi nhiều lần gọi cùng lúc lúc gần hết credit] → Âm tối đa ≈ số lần gọi đồng thời × chi phí một lần; giới hạn chi tiêu tháng ở trang nhà cung cấp là lớp chặn cuối (architecture mục 6). Có thể thêm giữ chỗ sau MVP.
- [Cách AI SDK báo token cache khác giữa các phiên bản / nhà cung cấp] → Một chỗ đọc usage (`readUsage`), test bằng mô hình giả cho từng nhà cung cấp; kiểm lại với phiên bản cài khi apply.
- [Gửi email báo sau commit có thể mất khi tiến trình chết đúng lúc] → Chấp nhận cho MVP; trang Credit và banner vẫn hiện đúng trạng thái. Hàng đợi pg-boss có ở change 5 nếu cần chắc hơn.
- [`platform_company_summaries` là lối đi qua RLS thứ hai] → `SECURITY DEFINER` hẹp, chỉ trả cột tổng, test chặn import, test kiểm tra hàm không trả cột nào ngoài danh sách.
- [Khoá chính mất = mất mọi key đã lưu] → Key nhà cung cấp lấy lại được từ trang nhà cung cấp; ghi vào hướng dẫn vận hành ở change `deploy-staging`: sao lưu `ENCRYPTION_KEY` riêng với bản sao lưu DB.
- [Change lớn: 3 package + 2 màn hình] → Task chia nhóm để dừng được sau nhóm API (đã chốt giữ một change).
- [Migration đụng số thứ tự với 1b] → Đặt số khi apply sau khi rebase lên main.

## Migration Plan

1. Migration mới: bảng D4, cột/bảng `twoFactor` trong `auth`, hàm `platform_company_summaries`, REVOKE cho bảng chỉ thêm, seed tỉ giá + hệ số mặc định, tạo `credit_accounts` cho công ty đã có.
2. `.env.example` thêm `ENCRYPTION_KEY` (kèm lệnh sinh: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) và `PLATFORM_ADMIN_EMAILS`.
3. Rollback: chưa có dữ liệu tiền thật trước change 16; rollback = revert code + migration xuống (drop các bảng mới). Không rollback sau khi đã có khách nạp tiền.

## Open Questions

Không còn. Câu hỏi nghiệp vụ của PR propose đã chốt ở `docs/requirements.md` 0.2 #095–#104.
