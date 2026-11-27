# Design: setup-monorepo

## Context

- Repo mới chỉ có tài liệu (`docs/`, `openspec/`, `CLAUDE.md`). Chưa có `package.json`.
- Stack đã chốt trong CLAUDE.md và `docs/architecture.md` mục 3, 11 (A1–A11): TypeScript strict, pnpm workspaces, Fastify + Zod, React + Vite + shadcn/ui, Drizzle + PostgreSQL 16 + RLS, pg-boss, Vitest + Testcontainers + Playwright.
- Triển khai (architecture.md mục 8): 1 máy ảo ở cloud Việt Nam, Docker Compose, Caddy (HTTPS bắt buộc cho webhook), sao lưu ra object storage ở Việt Nam.
- Máy của Harry: Node 24.13, pnpm 9.15, Docker 29. Repo GitHub **private**.
- Lý do làm change này: xem proposal.md, mục Why. Hành vi: `specs/service-health`, `specs/runtime-config`.

## Goals / Non-Goals

**Goals:**
- Clone repo → `pnpm install` → `docker compose up -d` → `pnpm dev` là chạy được, không cần bước tay nào khác.
- Mỗi lệnh trong CLAUDE.md (mục Lệnh) chạy được và có ít nhất một test thật.
- Khung để change 1 viết bảng + RLS + test tách công ty ngay, không phải dựng lại hạ tầng test.
- `compose.prod.yaml` chạy được trên máy (localhost) giống hệt cách nó sẽ chạy trên cloud.

**Non-Goals:**
- Chưa tạo bảng nghiệp vụ, chưa đăng nhập, chưa có pg-boss trong runner.
- Chưa thuê máy, chưa triển khai thật, chưa cấu hình sao lưu. Việc này làm sau khi chốt nhà cung cấp (xem Câu hỏi mở).
- Chưa tạo các package `llm`, `billing`, `crypto`, `skills`, `scanner`, `channels`, `connectors`.

## Decisions

### D1. Node 24 LTS, chạy TypeScript trực tiếp bằng type stripping

- **Chọn**: Node **24 LTS** (`.nvmrc`, `engines: ">=24"`). API và runner chạy thẳng file `.ts` bằng type stripping có sẵn của Node: `node --watch src/main.ts` khi dev, `node src/main.ts` trong Docker. Không có bước build cho api / runner / packages.
- **Lý do**: Node 22 (đang ghi trong CLAUDE.md) hết hỗ trợ tháng 4/2027, tức khoảng 5 tháng sau khi bắt đầu MVP. Node 24 được hỗ trợ tới tháng 4/2028, và máy Harry đã dùng Node 24. Type stripping giúp bỏ `tsx` / `ts-node`, bỏ thư mục `dist`, và stack trace trỏ đúng dòng.
- **Ràng buộc kèm theo**: `tsconfig` bật `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` và `noEmit`. Import dùng đuôi `.ts`. Không dùng `enum`, `namespace` hay parameter property (dùng `as const` + union).
- **Đã cân nhắc**: (a) `tsc` build ra `dist`: thêm bước build, dễ chạy nhầm bản cũ. (b) `tsx`: ngoài danh sách thư viện, và không cần nữa từ Node 22.18. (c) Ở lại Node 22: được, nhưng phải nâng cấp ngay giữa MVP.
- **Đã duyệt** (0.2 #027): CLAUDE.md ghi Node.js 24 LTS.

### D2. Cấu trúc thư mục: chỉ tạo package khi có người dùng

```
apps/
  api/        Fastify: src/app.ts (buildApp), src/main.ts, src/routes/health.ts, src/plugins/
  runner/     src/main.ts (khởi động, tắt êm), src/config.ts
  web/        Vite + React + shadcn/ui: src/i18n/vi.ts, src/routes/, e2e/
packages/
  core/       src/config/ (đọc + kiểm tra env bằng Zod, dùng chung cho api và runner)
  db/         src/client.ts (pool pg + Drizzle), drizzle.config.ts, migrations/, test/ (Testcontainers)
tsconfig.base.json  biome.json  vitest.config.ts  pnpm-workspace.yaml
compose.yaml  compose.prod.yaml  Caddyfile  Dockerfile  docker/postgres/init.sql
scripts/ci-runner.sh   .github/workflows/ci.yml
```

- Package nội bộ đặt tên `@dw/core`, `@dw/db`, export thẳng `src/index.ts`, không build.
- **Đã cân nhắc**: tạo sẵn đủ 9 package rỗng như sơ đồ trong CLAUDE.md. Không chọn: package rỗng không có hành vi để test, và change sau sẽ phải sửa lại cho khớp thiết kế thật. Sơ đồ trong CLAUDE.md vẫn là đích đến; mỗi change tạo package của mình.

### D3. Cấu hình: Zod ở `packages/core`, nạp `.env` bằng Node

- `packages/core/src/config` có hàm `loadConfig(schema, env)`. Hàm trả về object đã kiểm tra (đóng băng), hoặc ném `ConfigError` chứa danh sách `{ name, reason }`. Danh sách này **không bao giờ** chứa giá trị (spec `runtime-config`).
- Mỗi app khai schema riêng, chỉ gồm biến nó dùng. Ví dụ api: `DATABASE_URL`, `PORT` (mặc định 3000), `HOST`, `LOG_LEVEL`, `NODE_ENV`. Các biến khác trong `.env.example` để `optional` cho tới change dùng tới.
- `main.ts` bắt `ConfigError`, in danh sách ra stderr rồi `process.exit(1)`.
- Nạp `.env`: dùng `node --env-file-if-exists=.env` (có sẵn trong Node), không dùng `dotenv`.

### D4. Fastify: app factory, Zod, log có che

- `buildApp({ config, db })` trả về instance chưa listen. Test dùng `app.inject()`, không mở cổng.
- **Validate bằng Zod**: tự viết `validatorCompiler` / `serializerCompiler` khoảng 30 dòng trong `apps/api/src/plugins/zod.ts`. **Đã cân nhắc** `fastify-type-provider-zod` (MIT): tiện hơn nhưng ngoài danh sách; nếu Harry duyệt thì thay sau, không ảnh hưởng route.
- **Lỗi**: một error handler trả envelope `{ error: { code, message } }`. Lỗi 5xx chỉ trả message chung; chi tiết ghi log.
- **Log**: dùng logger pino có sẵn của Fastify, `redact` các đường dẫn `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.apiKey`, `*.secret`, `DATABASE_URL`. `pino-pretty` không dùng (ngoài danh sách); dev đọc log JSON.
- **Route sức khoẻ**: `/health` không chạm DB. `/health/ready` chạy `SELECT 1` với `statement_timeout`, tổng thời gian chờ 2 giây (`AbortSignal.timeout`). Lỗi → log `warn` (đã che) + 503.
- **Tắt êm**: SIGTERM/SIGINT → `app.close()` → đóng pool DB → thoát. Áp dụng cả cho runner.

### D5. Cơ sở dữ liệu: hai vai trò từ ngày đầu

- `docker/postgres/init.sql` (dev và prod) tạo:
  - `dw_owner`: sở hữu schema, chạy migration (`MIGRATION_DATABASE_URL`).
  - `dw_app`: vai trò ứng dụng, **không** phải owner bảng, **không** có `BYPASSRLS` (`DATABASE_URL`).
- **Lý do**: PostgreSQL bỏ qua RLS với superuser và với chủ bảng (trừ khi `FORCE ROW LEVEL SECURITY`). Nếu ứng dụng kết nối bằng `postgres`, test RLS ở change 1 sẽ qua giả. Tách ngay để change 1 không phải đổi chuỗi kết nối ở mọi nơi.
- Driver: **`pg`** (node-postgres). Drizzle cần một driver, pg-boss (đã có trong danh sách) cũng dùng `pg`, nên dùng chung một driver.
- `drizzle-kit` sinh migration vào `packages/db/migrations`. Change này có **một migration rỗng** để kiểm tra luồng `pnpm db:migrate` chạy được.

### D6. Test

- **Unit** (`pnpm test`): Vitest, một `vitest.config.ts` ở gốc với `test.projects` trỏ từng package. File `*.test.ts`. Không cần Docker.
- **Tích hợp** (`pnpm test:int`): file `*.int.test.ts`. `packages/db/test/pg.ts` dùng Testcontainers dựng `postgres:16-alpine`, chạy `init.sql` + migration, trả về hai pool (`owner`, `app`). Test mẫu: `dw_app` không tạo được bảng trong schema `public`; `/health/ready` trả 200 khi DB chạy, 503 khi DB dừng.
- **E2E** (`pnpm e2e`): Playwright, chỉ Chromium ở change này, chạy `vite preview`. Test mẫu: trang chủ hiện tiêu đề tiếng Việt lấy từ `vi.ts`. Thêm Firefox / WebKit khi có màn hình thật (change 1).
- Mô hình giả, adapter giả: chưa cần ở change này.

### D7. Lint + format: Biome

- **Chọn** `@biomejs/biome` (MIT / Apache-2.0): một gói làm cả lint lẫn format, nhanh, không có cây plugin.
- **Đã cân nhắc**: ESLint + `typescript-eslint` + `eslint-plugin-react-hooks` + Prettier: 4+ gói và nhiều phụ thuộc con. Biome có sẵn luật cho React hooks và TypeScript đủ cho MVP.
- `pnpm lint` = `biome check .`. `pnpm typecheck` = `tsc --noEmit` cho từng package (`pnpm -r typecheck`).

### D8. CI (đã duyệt, 0.2 #030)

- **GitHub Actions** (`ci.yml`, `ubuntu-latest`) chạy cho mỗi PR: `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `test`, `openspec validate --all --strict`. Mất khoảng 2–3 phút, nằm trong hạn mức miễn phí của repo private.
- **`pnpm ci:runner`** (`scripts/ci-runner.sh`) chạy trên máy Harry, trước khi merge: các bước trên + `test:int` + `e2e` + `docker compose -f compose.prod.yaml build`. Script dừng ở lỗi đầu tiên.
- **Đã cân nhắc**: GitHub self-hosted runner gắn máy Harry. Để sau: máy tắt thì PR treo, và phải cài và giữ dịch vụ runner. Có thể bật khi test tích hợp nhiều lên.

### D9. Thư viện ngoài danh sách CLAUDE.md (đã duyệt, 0.2 #028)

| Gói | License | Dùng cho | Không có thì sao |
|---|---|---|---|
| `pg` (+ `@types/pg`) | MIT | Driver PostgreSQL cho Drizzle, dùng chung với pg-boss | Drizzle không chạy được; bản thay `postgres` (postgres.js) dùng license Unlicense, ngoài danh sách cho phép |
| `@biomejs/biome` | MIT / Apache-2.0 | Lint + format | Cần ESLint + Prettier (nhiều gói hơn) |
| `tailwindcss`, `@tailwindcss/vite` | MIT | Nền của shadcn/ui | shadcn/ui cần Tailwind |
| `radix-ui` / `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` | MIT / ISC | Phụ thuộc chuẩn của shadcn/ui | Như trên |
| `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@playwright/test`, `testcontainers`, `@testcontainers/postgresql`, `@types/node`, `drizzle-orm` | MIT / Apache-2.0 | Đã nằm trong stack | — |

CLAUDE.md, mục "Thư viện được phép", đã ghi các gói trên, kể cả phụ thuộc chuẩn của shadcn/ui.

### D10. Docker và triển khai

- **`compose.yaml` (dev)**: chỉ `postgres:16-alpine`, cổng 5432, volume tên, healthcheck `pg_isready`, mount `init.sql`. Api / runner / web chạy bằng `pnpm dev` trên máy để có watch nhanh.
- **`Dockerfile`**: một file nhiều stage, `node:24-alpine`, `pnpm deploy --prod` cho từng app (`--target api` / `--target runner`), chạy bằng user không phải root, `HEALTHCHECK` gọi `/health`.
- **`compose.prod.yaml`**: `postgres`, `api`, `runner`, `caddy`. Web được build (`vite build`) trong stage của Caddy và Caddy phục vụ file tĩnh. Caddy proxy `/api/*`, `/webhooks/*`, `/health*` sang `api:3000`. `api` khởi động khi `postgres` đã healthy. Migration chạy bằng service `migrate` một lần (`dw_owner`) trước `api`. Postgres không mở cổng ra ngoài.
- `Caddyfile` dùng biến `{$SITE_ADDRESS}`: `localhost` khi thử trên máy, tên miền thật trên cloud (Caddy tự lấy chứng chỉ).

### D11. Nhà cung cấp cloud Việt Nam (đề xuất VNG Cloud, chốt khi có báo giá — 0.2 #029)

Cần: 1 máy ảo 2–4 vCPU / 4–8 GB, ổ riêng cho PostgreSQL, **object storage tương thích S3 đặt ở Việt Nam** (sao lưu), hoá đơn VAT, trả bằng VNĐ.

| | VNG Cloud | Viettel Cloud (Viettel IDC) | FPT Smart Cloud |
|---|---|---|---|
| Máy 4 vCPU / 8 GB | ~23,6 USD/tháng, gói VPS 90 GB SSD (trang giá chính thức) | ~1,25 triệu đ/tháng (blog, chưa phải bảng giá chính thức) | ~1,5–2 triệu đ/tháng (bài so sánh bên thứ ba) |
| Ghi chú | Trung tâm dữ liệu đặt tại Viettel IDC (Tier 3); có VPS rẻ và vServer | Mạng trung tâm dữ liệu lớn nhất | Trang giá có gói Standard-02, không ghi rõ giá |

- **Đề xuất: VNG Cloud** cho giai đoạn đầu: có giá công khai, tự đăng ký và trả tiền online được, chi phí thấp nhất trong ba. Viettel là phương án dự phòng nếu cần cam kết SLA hoặc hợp đồng doanh nghiệp.
- **Chưa kiểm chứng**: giá object storage của cả ba, và giá chính thức của Viettel / FPT. Harry cần xem bảng giá hoặc xin báo giá trước khi chốt. Thiết kế không phụ thuộc nhà cung cấp: chỉ cần Docker và một bucket S3.
- Nguồn: [VNG Cloud VPS](https://vngcloud.com/en/vps), [FPT Cloud pricing](https://fptcloud.com/en/pricing/), [Cloud Viettel — giá thuê](https://cloudviettel.vn/2026/04/08/thue-cloud-server-viettel-gia-bao-nhieu/), [So sánh VPS FPT](https://www.tnd.vn/vps-fpt-co-dang-tien-so-voi-5-alt-re-hon-12949/).

### D12. Giao diện web và i18n

- Vite + React + Tailwind v4 + shadcn/ui. Token màu Bright Blue Base (nền trắng, màu chính xanh dương) đặt bằng biến CSS trong `src/styles/tokens.css`.
- **i18n tự viết**: `src/i18n/vi.ts` là object `as const`, hàm `t(key)` có kiểu chặt (key sai → lỗi typecheck). Không thêm `i18next`: MVP chỉ có tiếng Việt (#020). Đổi sang thư viện sau không phải sửa component.
- Router (`@tanstack/react-router`) và React Query **chưa** thêm; change 1 thêm khi có màn hình thật.

## Risks / Trade-offs

- [Type stripping chưa hỗ trợ cú pháp TS không xoá được (`enum`, decorator)] → `erasableSyntaxOnly` bắt lỗi lúc typecheck; thư viện được dùng ở dạng JS nên không ảnh hưởng.
- [Package nội bộ export `.ts` qua symlink của pnpm; Node không strip file nằm trong `node_modules`] → pnpm workspace link tới đường dẫn thật (`packages/*/src`), Node chỉ thấy đường dẫn thật. Task 1.3 kiểm chứng điều này sớm. Nếu hỏng thì phương án dự phòng là `tsc` build cho riêng `packages/*`.
- [Biome thiếu một số luật mà ESLint có] → chấp nhận cho MVP; thêm ESLint sau nếu thấy thiếu.
- [Giá cloud lấy từ nguồn bên thứ ba có thể sai] → chỉ là đề xuất; quyết định cuối dựa trên báo giá Harry tự kiểm tra.
- [CI nặng chạy tay, có thể bị quên] → mẫu PR có ô "đã chạy `pnpm ci:runner`"; bật self-hosted runner khi cần.

## Migration Plan

Không có hệ thống cũ. Rollback = revert PR.

## Open Questions

- Nhà cung cấp cloud chính thức và kích thước máy: chốt sau khi Harry có báo giá. Không làm đổi spec hay task (D11). Thuê máy, tên miền và sao lưu thật làm ở change 5a `deploy-staging` (#21, 0.2 #031).
