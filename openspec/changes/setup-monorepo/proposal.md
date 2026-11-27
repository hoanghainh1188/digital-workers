# Proposal: setup-monorepo

## Why

Repo mới có tài liệu, chưa có code. Mọi change sau (từ `add-tenancy-and-users` trở đi) cần chung một khung: workspace, TypeScript strict, lệnh lint / typecheck / test, PostgreSQL chạy được trên máy, CI, cách đóng gói để triển khai. Dựng khung này trước giúp mỗi change sau chỉ tập trung vào nghiệp vụ, và chốt sớm nhà cung cấp cloud Việt Nam (0.2 #011, câu hỏi mở ở 0.4).

## What Changes

- Tạo monorepo pnpm workspaces: `apps/api`, `apps/runner`, `apps/web`, `packages/core`, `packages/db`, cùng cấu hình TypeScript dùng chung. Các package khác (`llm`, `billing`, `crypto`, `skills`, …) **chưa tạo**; change cần nó thì tạo.
- `apps/api` (Fastify): hàm dựng app để test được, cách validate bằng Zod, log pino có che bí mật, hai route kiểm tra sức khoẻ `/health` và `/health/ready`.
- Kiểm tra cấu hình lúc khởi động: thiếu hoặc sai biến môi trường bắt buộc thì tiến trình dừng ngay, báo **tên** biến (không in giá trị).
- `apps/runner`: tiến trình chạy nền rỗng (khởi động, kiểm tra cấu hình, tắt êm). Hàng đợi pg-boss thêm ở change 5.
- `apps/web`: React + Vite + shadcn/ui (Bright Blue Base), một trang giữ chỗ, chuỗi hiển thị lấy từ file i18n tiếng Việt.
- `packages/db`: kết nối PostgreSQL, cấu hình Drizzle + drizzle-kit, **chưa có bảng nghiệp vụ**; tách sẵn vai trò DB chủ sở hữu (chạy migration) và vai trò ứng dụng (không bỏ qua được RLS) để change 1 dùng.
- Lệnh: `pnpm dev`, `lint`, `typecheck`, `test`, `test:int`, `e2e`, `ci:runner`. Mỗi package có ít nhất một test chạy được.
- Docker Compose dev (PostgreSQL 16) và prod (`api`, `runner`, `web` qua Caddy, `postgres`, `caddy`), Dockerfile cho api / runner.
- CI: GitHub Actions chạy kiểm tra nhẹ; `pnpm ci:runner` chạy đủ (kể cả test tích hợp, e2e) trên máy.
- Sửa `openspec/config.yaml`: trường `rules` phải là object theo từng artifact. Dạng danh sách cũ bị CLI bỏ qua với lỗi `Invalid 'rules' field`.
- Đề xuất nhà cung cấp cloud Việt Nam (so sánh trong design.md). Chọn chính thức ghi vào 0.2 khi được duyệt.

## Capabilities

### New Capabilities
- `service-health`: điểm kiểm tra sức khoẻ của API cho Docker / Caddy / giám sát: còn sống, sẵn sàng (kết nối được DB), không lộ thông tin nhạy cảm.
- `runtime-config`: cách mọi tiến trình (api, runner) nhận và kiểm tra cấu hình từ biến môi trường lúc khởi động; dừng sớm, báo lỗi rõ, không lộ bí mật.

### Modified Capabilities
- (không có — chưa có spec nào)

## Impact

- **Code mới**: toàn bộ khung `apps/`, `packages/core`, `packages/db`, file cấu hình gốc, `compose.yaml`, `compose.prod.yaml`, `Caddyfile`, `Dockerfile`, `.github/workflows/ci.yml`, `scripts/`.
- **Thư viện ngoài danh sách CLAUDE.md** cần duyệt (chi tiết và lý do ở design.md, mục D9): `pg`, `@biomejs/biome`, cùng các gói đi kèm shadcn/ui (Tailwind CSS, Radix, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`).
- **Phiên bản Node**: đề xuất **Node 24 LTS** thay cho Node 22 trong CLAUDE.md, vì Node 22 hết hỗ trợ tháng 4/2027 (design.md, D1). Được duyệt thì sửa CLAUDE.md trong chính PR này.
- **Tài liệu**: README (cách chạy), CLAUDE.md (nếu đổi Node / thư viện), `docs/requirements.md` 0.2 (quyết định mới), `docs/architecture.md` mục 8 và 12 (nhà cung cấp cloud).
- Chưa có API nghiệp vụ, chưa có dữ liệu công ty → chưa áp dụng test tách công ty; khung test tích hợp (Testcontainers) dựng sẵn cho change 1.
