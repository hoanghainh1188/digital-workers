# Tasks: setup-monorepo

## 1. Khung workspace

- [ ] 1.1 Tạo `package.json` gốc (`private`, `packageManager: pnpm@9`, `engines.node >=24`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc`; kiểm tra `pnpm install` chạy không lỗi và sinh `pnpm-lock.yaml`
- [ ] 1.2 Tạo `tsconfig.base.json` (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`, `module`/`moduleResolution: nodenext`) và `tsconfig.json` của từng package kế thừa nó; kiểm tra `pnpm typecheck` qua
- [ ] 1.3 Tạo `packages/core` (`@dw/core`, export `src/index.ts`) và `apps/api` import nó; kiểm tra `node apps/api/src/main.ts` chạy được qua symlink của pnpm mà không cần build (rủi ro D1/D2; hỏng thì chuyển sang phương án dự phòng và ghi vào design.md)
- [ ] 1.4 Thêm Biome (`biome.json`, `pnpm lint` = `biome check .`) và `vitest.config.ts` gốc với `test.projects`; kiểm tra `pnpm lint` qua và `pnpm test` chạy được khi chưa có test

## 2. Cấu hình lúc khởi động (`runtime-config`)

- [ ] 2.1 Viết `loadConfig(schema, env)` và `ConfigError` trong `packages/core/src/config`, kèm unit test cho mọi kịch bản của spec `runtime-config` (thiếu biến, sai định dạng, nhiều lỗi gom một lần, không lộ giá trị, biến tuỳ chọn); kiểm tra `pnpm test` qua
- [ ] 2.2 Khai schema env cho `api` và `runner`, nối vào `main.ts` (in danh sách lỗi ra stderr, `exit(1)`); test chạy tiến trình con với env thiếu / sai và kiểm tra mã thoát khác 0, stderr không chứa giá trị
- [ ] 2.3 Cập nhật `.env.example`: thêm `PORT`, `HOST`, `LOG_LEVEL`, `MIGRATION_DATABASE_URL`, ghi chú biến nào bắt buộc ở change này; kiểm tra `api` khởi động được với `.env` chép từ `.env.example` cộng giá trị dev

## 3. Cơ sở dữ liệu (`packages/db`)

- [ ] 3.1 Tạo `compose.yaml` (postgres:16-alpine, healthcheck, volume) và `docker/postgres/init.sql` tạo `dw_owner` và `dw_app` (không owner, không BYPASSRLS); kiểm tra `docker compose up -d` lên healthy và `psql` đăng nhập được bằng cả hai vai trò
- [ ] 3.2 Tạo `packages/db`: pool `pg` + Drizzle, `drizzle.config.ts`, một migration rỗng, lệnh `pnpm db:migrate` chạy bằng `MIGRATION_DATABASE_URL`; kiểm tra lệnh chạy được hai lần liên tiếp không lỗi
- [ ] 3.3 Viết helper Testcontainers `packages/db/test/pg.ts` (dựng PG, chạy `init.sql` + migration, trả pool owner / app) và test tích hợp: `dw_app` không tạo được bảng, không có `BYPASSRLS`; kiểm tra `pnpm test:int` qua

## 4. API (`service-health`)

- [ ] 4.1 Viết `buildApp`, plugin Zod (validator/serializer compiler), error handler trả envelope, logger có `redact`; unit test: lỗi 5xx không lộ chi tiết, log có token / mật khẩu bị che
- [ ] 4.2 Viết route `/health` và `/health/ready` (timeout 2 giây); unit test bằng `app.inject` với DB giả: 200 / 200 / 503, thân chỉ có `status`
- [ ] 4.3 Test tích hợp với PostgreSQL thật: `/health/ready` trả 200 khi DB chạy, 503 khi container DB bị dừng, `/health` vẫn 200; log lỗi không chứa mật khẩu; kiểm tra `pnpm test:int` qua
- [ ] 4.4 Tắt êm (SIGTERM → đóng app + pool) cho api; test gửi SIGTERM cho tiến trình con và kiểm tra thoát mã 0 trong 5 giây

## 5. Runner

- [ ] 5.1 Tạo `apps/runner`: khởi động, kiểm tra cấu hình, log "đã khởi động", tắt êm khi SIGTERM; test tiến trình con kiểm tra log khởi động không chứa giá trị bí mật và thoát mã 0 khi SIGTERM

## 6. Web

- [ ] 6.1 Tạo `apps/web` (Vite + React + Tailwind v4 + shadcn/ui init), `src/styles/tokens.css` theo Bright Blue Base; kiểm tra `pnpm --filter web build` qua
- [ ] 6.2 Viết `src/i18n/vi.ts` + hàm `t()` có kiểu chặt, trang chủ giữ chỗ chỉ dùng chuỗi từ `t()`; unit test `t()` và kiểm tra key sai gây lỗi typecheck (`@ts-expect-error`)
- [ ] 6.3 Cấu hình Playwright (Chromium, `vite preview`) và test e2e trang chủ hiện tiêu đề tiếng Việt; kiểm tra `pnpm e2e` qua

## 7. Lệnh dev và CI

- [ ] 7.1 Thêm `pnpm dev` (api + runner với `node --watch --env-file-if-exists=.env`, web với Vite, chạy song song); kiểm tra sau `docker compose up -d`, `curl localhost:3000/health/ready` trả 200 và web mở được
- [ ] 7.2 Viết `scripts/ci-runner.sh` (`pnpm ci:runner`: lint, typecheck, test, test:int, e2e, `openspec validate --all --strict`, `docker compose -f compose.prod.yaml build`; dừng ở lỗi đầu tiên); kiểm tra chạy hết trên máy
- [ ] 7.3 Viết `.github/workflows/ci.yml` (ubuntu-latest: install frozen lockfile, lint, typecheck, test, openspec validate) và mẫu PR có ô "đã chạy `pnpm ci:runner`"; kiểm tra workflow xanh trên PR này

## 8. Đóng gói prod

- [ ] 8.1 Viết `Dockerfile` nhiều stage (`node:24-alpine`, `pnpm deploy --prod`, user không phải root, HEALTHCHECK) cho target `api` và `runner`; kiểm tra `docker build --target api` và `--target runner` qua
- [ ] 8.2 Viết `compose.prod.yaml` (postgres không mở cổng, service `migrate` chạy một lần, api, runner, caddy phục vụ web tĩnh + proxy `/api/*`, `/webhooks/*`, `/health*`) và `Caddyfile` dùng `{$SITE_ADDRESS}`; kiểm tra với `SITE_ADDRESS=localhost`, `curl -k https://localhost/health/ready` trả 200 và trang web hiện

## 9. Tài liệu

- [ ] 9.1 Cập nhật README: yêu cầu (Node 24, pnpm, Docker), các bước chạy dev, bảng lệnh; kiểm tra làm theo README từ một bản clone mới chạy được tới `/health/ready` 200
- [x] 9.2 Ghi câu trả lời của PR propose: CLAUDE.md (Node 24, thư viện được phép), `docs/requirements.md` 0.2 #027–#031, `docs/architecture.md` mục 8 và 12, `docs/ROADMAP.md` + issue #21 (`deploy-staging`); `openspec validate --all --strict` qua

## Workflow follow-up

- Sau khi merge: `/opsx:archive setup-monorepo`, đánh dấu ✅ change 0 trong `docs/ROADMAP.md`, đóng issue #1.
- Change tiếp theo về hạ tầng: 5a `deploy-staging` (#21), cần báo giá cloud trước.
