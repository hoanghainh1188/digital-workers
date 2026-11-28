# Proposal: add-llm-gateway-and-credit

## Why

Worker runtime (change 5) cần một cửa duy nhất để gọi mô hình AI bằng API key của platform (#016), và mỗi lần gọi phải trừ đúng credit của công ty (#025) trước khi có khách thật. Tiền phải đúng tới từng đồng, không trừ hai lần và không lộ API key, nên phần này làm và test riêng trước khi có vòng lặp worker.

## What Changes

- **`packages/crypto`** (mới): mã hoá / giải mã bí mật bằng AES-256-GCM, khoá chính lấy từ biến môi trường `ENCRYPTION_KEY`. Dùng trước tiên cho `ProviderKey`; token bot và mật khẩu connector dùng lại ở change 6, 9, 10.
- **`packages/llm`** (mới): cổng gọi mô hình (Vercel AI SDK, Anthropic + OpenAI). Mỗi lần gọi: tìm giá đang hiệu lực, kiểm tra số dư, gọi mô hình bằng key của platform, ghi `CostEntry` và trừ credit. Không có giá → không gọi. Test chỉ dùng mô hình giả.
- **`packages/billing`** (mới): sổ credit `CreditAccount` + `CreditTransaction` (chỉ thêm), số tiền là số nguyên VNĐ; phép tính giá bằng số nguyên (không dùng số thực), phần lẻ dưới 1 đồng được cộng dồn; khoá dòng để hai lần trừ đồng thời không làm sai số dư; credit dùng thử 200.000đ khi Owner xác minh email (#073); báo "sắp hết" dưới 20% lần cộng gần nhất (#071) và báo "hết credit".
- **Bảng giá trong DB** (`packages/db`): giá theo mô hình có ngày hiệu lực, tỉ giá USD → VNĐ chung, hệ số giá mặc định và hệ số riêng từng công ty (#075). Đổi giá / tỉ giá / hệ số không tính lại giao dịch cũ.
- **Ngân sách tháng của worker**: hàm kiểm tra "worker còn ngân sách tháng này không" dựa trên `CostEntry`, để runtime (change 5) chặn việc mới theo #018. Bảng `workers` chưa có ở change này (change 2), nên ngân sách được truyền vào.
- **Platform admin** (#076, #077): email trong `PLATFORM_ADMIN_EMAILS`, bắt buộc TOTP (plugin `twoFactor` của Better Auth). API `/api/platform/*`: tổng theo công ty, điều chỉnh credit có lý do, giá mô hình, tỉ giá, hệ số, thay API key. Người khác gọi → 404. Mọi thay đổi ghi nhật ký cấp platform.
- **Web**: trang Credit cho Owner / Admin (`credit.html`), banner "hết credit" ở đầu mọi trang cho Owner / Admin / Trưởng phòng, màn quản trị platform (`platform-admin.html`) và bước nhập mã TOTP khi đăng nhập.
- Không có trong change này: nạp tiền VietQR, sao kê tháng, hoá đơn (change 16); bảng lương và cảnh báo 80% ngân sách (change 13); `Task` và vòng lặp worker (change 5).

## Capabilities

### New Capabilities

- `secret-encryption`: bí mật của platform được mã hoá khi lưu, không bao giờ trả ra API hay ghi vào log.
- `llm-gateway`: một cửa gọi mô hình, đổi được nhà cung cấp, ghi `CostEntry` cho mỗi lần gọi, từ chối khi hết credit hoặc mô hình chưa có giá.
- `model-pricing`: bảng giá mô hình có ngày hiệu lực, tỉ giá, hệ số giá, và cách quy đổi ra số nguyên VNĐ.
- `credit-ledger`: số dư credit của công ty, giao dịch chỉ thêm, trừ theo lần gọi, credit dùng thử, báo sắp hết / hết, trang Credit.
- `worker-budget`: ngân sách tháng của từng worker tính từ `CostEntry`.
- `platform-admin`: danh tính platform admin, xác thực 2 bước, màn quản trị (công ty, điều chỉnh credit, giá, key) và nhật ký cấp platform.

### Modified Capabilities

(không có — change 1b đang apply song song; change này không sửa requirement của spec nào đang có.)

## Impact

- Package mới: `packages/crypto`, `packages/llm`, `packages/billing`. Thư viện mới, đều có trong danh sách được phép: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`. Plugin `twoFactor` có sẵn trong `better-auth`. Không thêm thư viện ngoài danh sách (không vẽ mã QR, 0.2 #099).
- `packages/db`: migration mới cho `credit_accounts`, `credit_transactions`, `cost_entries`, `model_prices`, `fx_rates`, `price_multipliers`, `provider_keys`, `platform_audit_events`, bảng `auth.two_factors` + cột `auth.users.two_factor_enabled`, hàm `app.platform_company_summaries()`.
- `apps/api`: biến môi trường mới `ENCRYPTION_KEY` (bắt buộc), `PLATFORM_ADMIN_EMAILS` (không bắt buộc); route `/api/credit/*`, `/api/platform/*`; `GET /api/me` có thêm trạng thái credit; Better Auth bật `twoFactor`; tạo công ty thì tạo luôn `CreditAccount`.
- `apps/web`: trang `/credit`, `/platform/*`, `/two-factor`, banner hết credit trong khung app; chuỗi tiếng Việt trong `i18n/vi.ts`.
- `packages/mail`: mẫu email "credit sắp hết", "công ty đã hết credit".
- `apps/runner`: chưa đổi (gateway được runtime dùng từ change 5).
