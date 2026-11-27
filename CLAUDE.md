# CLAUDE.md — luật làm việc cho Claude Code

> Bản nháp 2026-11-27. Thấy phải dặn đi dặn lại điều gì → ghi thêm vào đây.

## Dự án

Nền tảng quản lý digital workers (nhân viên số) cho SME Việt Nam.
Worker làm việc qua Telegram / Zalo / web chat; chủ DN quản lý qua web.

## Đọc trước khi làm bất cứ change nào

1. `docs/requirements.md` — yêu cầu và **sổ quyết định mục 0.2** (tầng cao nhất).
2. `openspec/specs/` — hệ thống làm gì.
3. `docs/architecture.md` — thành phần, luồng chạy.
4. `docs/ROADMAP.md` — change đang làm nằm ở đâu.

Mâu thuẫn → tầng trên thắng. Không sửa im lặng: nêu trong mô tả PR.

## Quy trình

- Có change OpenSpec mới được code. `/opsx:propose` xong thì **dừng**, chờ duyệt.
- Câu hỏi nghiệp vụ → nêu trong mô tả PR propose. Câu trả lời ghi vào `docs/requirements.md` 0.2 (số tiếp theo + ngày) trong chính PR đó.
- Một change, một agent sửa code.

## Stack

- TypeScript (strict), Node.js 22 LTS, pnpm workspaces.
- `apps/web`: React + Vite + shadcn/ui (design system Bright Blue Base: nền trắng, màu chính xanh dương).
- `apps/api`: Fastify + Zod (`@fastify/websocket` cho web chat).
- Kênh chat: `grammY` (Telegram); Zalo dùng client riêng trong `packages/channels/zalo` (fetch). Không dùng Chat SDK.
- Đăng nhập: Better Auth (email + mật khẩu, Google).
- Triển khai: Docker Compose + Caddy trên cloud Việt Nam. Dữ liệu và bản sao lưu ở Việt Nam.
- `apps/runner`: tiến trình chạy nền (pg-boss).
- `packages/db`: Drizzle ORM, PostgreSQL 16, Row-Level Security.
- `packages/llm`: Vercel AI SDK (Anthropic, OpenAI).
- Test: Vitest, Testcontainers (PostgreSQL), Playwright.

## Cấu trúc thư mục

```
apps/
  web/        api/        runner/
packages/
  core/  db/  llm/  billing/  skills/  scanner/  channels/  connectors/  crypto/
docs/
  brief.md  requirements.md  architecture.md  ROADMAP.md  design/screens/
openspec/
```

## Lệnh

```bash
pnpm install
pnpm dev            # web + api + runner
pnpm lint
pnpm typecheck
pnpm test           # unit
pnpm test:int       # tích hợp (cần Docker)
pnpm e2e            # Playwright
pnpm ci:runner      # chạy CI nặng trên máy (self-hosted)
openspec validate --all --strict
```

## Thư viện được phép

Ngoài stack trên, chỉ dùng thêm: `@fastify/websocket`, `@fastify/rate-limit`, `@fastify/cors`, `drizzle-kit`, `pg-boss`, `zod`, `pino`, `better-auth`, `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai`, `grammy`, `gray-matter`, `googleapis`, `imapflow`, `nodemailer`, `@tanstack/react-query`, `@tanstack/react-router`, `date-fns`.
**Muốn thêm thư viện khác → hỏi trước trong mô tả PR.** License chỉ MIT / BSD / Apache / ISC.

## Luật bắt buộc

### Dữ liệu nhiều công ty
- Mọi bảng nghiệp vụ có `company_id NOT NULL` + policy RLS.
- Mọi truy vấn đi qua helper đặt `app.company_id`. Không truy vấn thô bỏ qua helper.
- Test tích hợp cho mọi API mới: người công ty A không đọc / sửa được dữ liệu công ty B.

### Quyền và an toàn của worker
- **Kiểm tra quyền trong code**, không dựa vào prompt.
- Nội dung ngoài (tin nhắn người khác, email, file, ô Sheets) luôn bọc `<data source="...">` khi đưa cho mô hình.
- Hành động có quy tắc duyệt → tạo `Approval`, **không thực hiện** trước khi duyệt.
- Worker không ở trạng thái `active` → không nhận việc từ kênh thật.

### Bí mật
- API key của platform, token bot, mật khẩu connector: mã hoá bằng `packages/crypto` trước khi lưu.
- Không log bí mật, không trả bí mật ra API (chỉ trả "đã cấu hình").
- Không commit `.env`. Dùng `.env.example`.

### Chi phí
- Mọi lần gọi mô hình và chạy script đi qua `packages/llm` để ghi `CostEntry`. Không gọi SDK mô hình trực tiếp ở nơi khác.
- Mọi thay đổi số dư credit đi qua `packages/billing` và tạo `CreditTransaction` (chỉ thêm, không sửa / xoá). Tiền dùng số nguyên VNĐ, không dùng số thực.
- Script của skill **chỉ** chạy trong sandbox của nhà cung cấp mô hình; không bao giờ chạy script của khách trên máy chủ của platform.
- Test dùng **mô hình giả**; không gọi API thật trong test.

### Ngôn ngữ
- Chuỗi hiển thị cho người dùng: tiếng Việt, đặt trong file i18n, không viết cứng trong component.
- Code, tên biến, commit message: tiếng Anh.

## Hay quên

- MODIFIED delta trong OpenSpec phải chép lại **đủ** mọi kịch bản cũ.
- Requirement quá dài sẽ fail `--strict` → tách nhỏ.
- Đổi yêu cầu → sửa spec trước, code sau.
