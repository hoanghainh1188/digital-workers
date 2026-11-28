# Tasks: add-llm-gateway-and-credit

> Nhóm 1–8 là phần nền + API (đã chốt giữ một change; nhóm vẫn dừng được giữa chừng). Nhóm 9–10 là web.
> Rebase lên main trước khi bắt đầu; nếu 1b đã merge thì đánh số migration sau migration của 1b.

## 1. `packages/crypto`

- [ ] 1.1 Tạo package `@dw/crypto` với `createSecretBox(key)` → `seal(plaintext, aad)` / `open(sealed, aad)` theo D2 (AES-256-GCM, IV 12 byte, định dạng `v1.<iv>.<ct+tag>`); verify: unit test seal → open ra đúng giá trị, hai lần seal cùng giá trị cho bản mã khác nhau
- [ ] 1.2 Test lỗi: AAD khác, bản mã bị sửa 1 byte, sai phiên bản, khoá khác → `SecretOpenError` không chứa plaintext; verify: `pnpm test` cho package xanh
- [ ] 1.3 Thêm trường `envFields.encryptionKey` (base64, đúng 32 byte) vào `packages/core/src/config`; verify: test config thiếu / sai độ dài báo lỗi gom một lần và không in giá trị (spec runtime-config, secret-encryption)

## 2. Cơ sở dữ liệu

- [ ] 2.1 Schema Drizzle + migration cho `credit_accounts`, `credit_transactions`, `cost_entries` (RLS ENABLE + FORCE, policy công ty, index, CHECK) theo D4; verify: `pnpm --filter @dw/db generate` không còn khác biệt, migration chạy trên DB trống
- [ ] 2.2 Bảng platform `model_prices`, `fx_rates`, `price_multipliers`, `provider_keys`, `platform_audit_events`; seed tỉ giá + hệ số mặc định 25.400đ / USD và 1,30 (#102); tạo `credit_accounts` cho công ty đã có (và dùng thử cho công ty đã có Owner xác minh, #104); verify: migration chạy trên DB có dữ liệu 1a
- [ ] 2.3 REVOKE UPDATE, DELETE, TRUNCATE FROM dw_app cho `credit_transactions`, `cost_entries`, `model_prices`, `fx_rates`, `price_multipliers`, `platform_audit_events`; UNIQUE partial dùng thử, UNIQUE `(company_id, idempotency_key)`; verify: test tích hợp `UPDATE`/`DELETE` bị từ chối trên từng bảng
- [ ] 2.4 Bảng `auth.two_factors` + cột `auth.users.two_factor_enabled` theo schema của plugin `twoFactor` (better-auth 1.7.28); verify: schema Drizzle trong `@dw/db/auth-schema` khớp migration
- [ ] 2.5 Hàm `app.platform_company_summaries()` (`SECURITY DEFINER`, owner `dw_owner`, `search_path` cố định, chỉ `dw_app` EXECUTE) và policy SELECT `TO dw_owner` cần cho nó; verify: test tích hợp hàm chỉ trả đúng danh sách cột của D10, `dw_app` đọc thẳng bảng vẫn bị RLS chặn
- [ ] 2.6 Test tách công ty: với `withCompany(A)` không thấy `credit_accounts` / `credit_transactions` / `cost_entries` của B, không chèn được dòng mang `company_id` của B; verify: `pnpm test:int` xanh

## 3. `packages/billing` — tính giá

- [ ] 3.1 `pricing.ts` (hàm thuần, BigInt): `computeCost(usage, price, vndPerUsd, multiplierPermille)` → `{ realMicroVnd, chargeMicroVnd }` làm tròn half-up một lần; verify: unit test đúng hai ví dụ của spec model-pricing (346,71đ; 99,06đ) và ca token rất lớn không mất chính xác
- [ ] 3.2 `applyCarry(carryMicroVnd, chargeMicroVnd)` → `{ debitVnd, carry }`; verify: test hai lần 346,71đ → 346đ rồi 347đ, ca 0,40đ → trừ 0đ, và test thuộc tính: với 1.000 lần ngẫu nhiên, Σ trừ = floor(Σ charge)
- [ ] 3.3 Chọn giá / tỉ giá / hệ số đang hiệu lực (`effective_from` mới nhất ≤ thời điểm gọi; hệ số riêng công ty thắng hệ số mặc định); verify: unit + tích hợp cho ca giá mới bắt đầu, chưa có giá, bỏ hệ số riêng

## 4. `packages/billing` — sổ credit

- [ ] 4.1 `recordUsage` theo D5 (khoá `FOR UPDATE`, INSERT cost entry + transaction, UPDATE tài khoản, trả sự kiện low / zero); verify: test tích hợp số dư = Σ giao dịch = "số dư sau" mới nhất, và cho phép âm sau lần gọi cuối (spec credit-ledger)
- [ ] 4.2 Test đồng thời: 20 lần `recordUsage` chạy song song trên cùng công ty → số dư đúng, "số dư sau" là dãy liên tục không trùng; verify: `pnpm test:int` xanh nhiều lần liên tiếp
- [ ] 4.3 `credit(companyId, { kind, amountVnd, reason, note, actorAdminId, idempotencyKey })` và `debitAdjustment` (chặn trừ quá số dư), đặt `last_credit_vnd`, hạ cờ báo; verify: test cộng khi đang âm, trừ quá số dư bị từ chối, cùng khoá chống lặp chỉ một giao dịch
- [ ] 4.4 `grantTrial` theo D8 (một lần, chịu được gọi đồng thời nhờ UNIQUE partial); verify: test gọi 2 lần song song → một giao dịch +200.000đ
- [ ] 4.5 Quyết định báo low / zero và port `Notifier`; verify: test ngưỡng 20% của lần cộng gần nhất, chỉ báo một lần, báo lại sau khi cộng và xuống ngưỡng lần nữa; zero chỉ khi đi từ > 0 xuống ≤ 0
- [ ] 4.6 `workerMonthSpend` + `checkWorkerBudget` theo D7 (tháng giờ Việt Nam); verify: test ca 23:30 ngày 30/11 và 00:10 ngày 01/12 giờ VN, ca bằng ngân sách = hết, ca công ty khác = 0đ (spec worker-budget)
- [ ] 4.7 Truy vấn đọc cho trang Credit: tổng quan (trạng thái, ngưỡng, đã dùng tháng, ước tính số ngày), lịch sử gộp theo (worker, ngày VN), chi tiết từng lần; verify: test gộp 14 lần thành 1 dòng, lọc cộng / trừ, không trả chi phí thật hay hệ số

## 5. `packages/llm` — cổng gọi mô hình

- [ ] 5.1 Thêm `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` vào `packages/llm` (chỉ package này); test chặn import như `auth-import-boundary.test.ts`; verify: test fail khi một package khác import `ai`
- [ ] 5.2 `ProviderKeyStore`: đọc `provider_keys`, mở bằng secret box (AAD `provider_key:<provider>`), nhớ 60 giây, xoá khi thay key; verify: unit test bản mã dòng khác không mở được → `ProviderNotConfiguredError`
- [ ] 5.3 `ModelResolver` thật (Anthropic, OpenAI) và mô hình giả từ `ai/test` với nội dung + usage định sẵn; verify: test chạy không có mạng (chặn `fetch` toàn cục trong test)
- [ ] 5.4 `createGateway().generate` theo D6 (giá → số dư → key → gọi → `readUsage` → `recordUsage` → gửi sự kiện báo); verify: test với mô hình giả: `CostEntry` và giao dịch đúng số token × giá × tỉ giá × hệ số; số dư 0 → `CreditExhaustedError`, mô hình giả không được gọi; chưa có giá → lỗi, không gọi; mô hình giả ném lỗi → không có `CostEntry`
- [ ] 5.5 `readUsage` cho Anthropic (cache đọc + cache ghi từ `providerMetadata`) và OpenAI (cache đọc); verify: test mô hình giả cho từng nhà cung cấp, kiểm tra cách AI SDK bản đã cài gộp token cache vào `inputTokens`
- [ ] 5.6 `verifyProviderKey(provider, key)` gọi `GET /v1/models` bằng `fetch`; verify: test với `fetch` giả trả 200 / 401 / lỗi mạng
- [ ] 5.7 Không lộ key: log của gateway (pino redact) và lỗi `ProviderCallError` không chứa key; verify: test dùng `log-capture` với key giả `sk-test-…`, gọi lỗi 401 và 500, khẳng định chuỗi key không có trong log và trong lỗi ném ra

## 6. API — cấu hình, xác thực 2 bước, guard platform

- [ ] 6.1 `apps/api/src/config.ts` thêm `ENCRYPTION_KEY` (bắt buộc) và `PLATFORM_ADMIN_EMAILS` (danh sách, không bắt buộc); `.env.example` thêm hai biến kèm lệnh sinh khoá; verify: test config thiếu `ENCRYPTION_KEY` → dừng, `PLATFORM_ADMIN_EMAILS` trống → danh sách rỗng
- [ ] 6.2 Bật plugin `twoFactor` trong `createAuth`; hook before: `/two-factor/enable` chỉ cho email platform admin, bỏ `trustDevice`; `customRules` cho `/two-factor/*`; mã sai tính vào `FailedLoginLimiter`; verify: test tích hợp đăng nhập platform admin đã bật TOTP → chưa có phiên tới khi nhập mã đúng; mã sai → không có phiên; người thường gọi `/two-factor/enable` → 404
- [ ] 6.3 `requirePlatformAdmin` theo D10 (404 cho người ngoài + `access.not_found` khi có member; 403 `TWO_FACTOR_REQUIRED`; 401 khi phiên > 12 giờ); verify: test tích hợp từng ca của spec platform-admin "Danh tính", "Bắt buộc xác thực 2 bước", "Người khác không thấy màn quản trị"
- [ ] 6.4 Chặn tạo công ty bằng email platform admin (409 `PLATFORM_ADMIN`) ở đăng ký email và onboarding Google; verify: test tích hợp không có công ty nào được tạo

## 7. API — credit của công ty

- [ ] 7.1 Tạo `credit_accounts` trong transaction `createCompany`; cấp dùng thử khi người tạo đã xác minh; hook `databaseHooks.user.update.after` cấp dùng thử khi Owner chuyển sang đã xác minh (D8); verify: test tích hợp đăng ký email → 0đ, mở link xác minh → +200.000đ; Google → +200.000đ ngay; Owner thứ hai xác minh → không cấp lần hai; Admin xác minh khi Owner chưa xác minh → không cấp
- [ ] 7.2 `Notifier` bản email + mẫu "credit sắp hết", "công ty đã hết credit" trong `packages/mail`; verify: test (Mailpit hoặc mailer giả) người nhận đúng vai trò, chỉ người `active`, chỉ công ty của mình, log không chứa email
- [ ] 7.3 `GET /api/credit`, `GET /api/credit/transactions`, `GET /api/credit/usage` với `requirePermission('credit.view')` (D11); verify: test tích hợp Owner / Admin 200, Trưởng phòng / Nhân viên 403 + `AuditEvent`, phản hồi không có chi phí thật / hệ số, Owner A không thấy dữ liệu B (kể cả truyền `workerId` của B)
- [ ] 7.4 `GET /api/me` thêm `credit.exhausted` cho Owner / Admin / Trưởng phòng; verify: test tích hợp Trưởng phòng thấy cờ khi số dư 0, Nhân viên không có trường `credit`

## 8. API — quản trị platform

- [ ] 8.1 `GET /api/platform/companies` (lọc trạng thái, tìm theo tên) + tổng platform qua `app.platform_company_summaries()`; test chặn import (chỉ `apps/api/src/platform/`); verify: test tích hợp phản hồi chỉ có các trường của spec "Chỉ xem tổng theo công ty", lọc "hết credit" đúng
- [ ] 8.2 `POST /api/platform/companies/:id/credit-adjustments` (D10: lý do, ghi chú bắt buộc, chặn ≥ 9 chữ số liền nhau, trần 100.000.000đ mỗi lần (#103), `Idempotency-Key`); verify: test tích hợp từng kịch bản của spec "Điều chỉnh credit tay", công ty hết credit được cộng → gateway gọi được lại (mô hình giả)
- [ ] 8.3 Giá, tỉ giá, hệ số: `GET/POST /api/platform/model-prices`, `POST /api/platform/fx-rates`, `POST /api/platform/multipliers`, `PUT/DELETE /api/platform/companies/:id/multiplier`; verify: test ngày hiệu lực quá khứ → 400, trùng thời điểm → 409, hệ số < 1 → 400, đổi tỉ giá không đổi `CostEntry` cũ
- [ ] 8.4 `GET /api/platform/provider-keys`, `PUT /api/platform/provider-keys/:provider` (kiểm tra key trước khi lưu, lưu bản mã, xoá bộ nhớ key); verify: test phản hồi chỉ có trạng thái, key bị từ chối → key cũ giữ nguyên, cột DB không chứa key gốc, log không chứa key
- [ ] 8.5 `platform_audit_events` cho mọi thay đổi ở 8.2–8.4; verify: test mỗi route ghi đúng một sự kiện, không chứa giá trị key

## 9. Web — trang Credit

- [ ] 9.1 Route `/credit` (Owner, Admin; mục menu ẩn với Trưởng phòng / Nhân viên) theo `docs/design/screens/credit.html`: thẻ số dư 5 trạng thái, đã dùng tháng, lịch sử gộp + mở chi tiết, nút Nạp credit / Tải sao kê "Sắp có"; chuỗi trong `i18n/vi.ts`; verify: Playwright cho Owner thấy số dư và lịch sử, Admin không có nút nạp, Trưởng phòng mở `/credit` bị chuyển về trang chủ
- [ ] 9.2 Banner "Công ty đã hết credit" trong `app-shell` theo `me.credit.exhausted`, câu chữ theo `credit.html` (đã sửa theo #096); verify: Playwright banner hiện ở mọi trang khi số dư 0, ẩn sau khi được cộng
- [ ] 9.3 Ảnh chụp ở 320, 768, 1024, 1440 cho trang Credit (trạng thái bình thường, sắp hết, hết credit); verify: không tràn ngang

## 10. Web — quản trị platform và TOTP

- [ ] 10.1 Bước nhập mã TOTP sau mật khẩu (`/two-factor`) và trang bật TOTP (`/platform/setup-2fa`: khoá dạng chữ + link `otpauth://`, mã dự phòng; không có mã QR, #099); verify: Playwright bật TOTP bằng mã sinh trong test, đăng xuất, đăng nhập lại phải nhập mã
- [ ] 10.2 `/platform/companies`, `/platform/pricing`, `/platform/keys` + hộp thoại điều chỉnh credit, thêm giá, thay key theo `platform-admin.html`; verify: Playwright platform admin cộng credit cho công ty hết credit → banner của công ty đó biến mất; Owner mở `/platform/companies` thấy trang không tìm thấy
- [ ] 10.3 Ảnh chụp ở 1024 và 1440 cho ba trang quản trị và hộp thoại điều chỉnh; verify: không tràn ngang

## 11. Kiểm tra tổng và tài liệu

- [ ] 11.1 `docs/architecture.md` mục 6–7: cách tính số nguyên + cộng dồn phần lẻ, số dư được âm (#095), dừng ở lần gọi tiếp theo khi hết credit (#096), lối đi `platform_company_summaries`, platform admin + TOTP; verify: đọc lại khớp design.md
- [ ] 11.2 `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm e2e` và `npx @fission-ai/openspec@1.17.0 validate --all --strict`; verify: tất cả xanh, ghi kết quả vào mô tả PR apply

## Workflow follow-up

- Sau khi merge apply: archive change, đồng bộ 6 spec mới vào `openspec/specs/`.
- Change 2 thêm số worker vào `app.platform_company_summaries()`; change 5 thêm khoá ngoại `cost_entries.worker_id` / `task_id` và gọi `checkWorkerBudget` khi nhận việc mới.
