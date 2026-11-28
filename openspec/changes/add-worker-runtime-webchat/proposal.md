# Proposal: add-worker-runtime-webchat

## Why

Tới change 4, worker mới có hồ sơ, kỹ năng và một cửa gọi mô hình có tính tiền, nhưng chưa làm được việc gì. Change này cho worker **nhận việc và trả lời** lần đầu tiên, qua kênh an toàn nhất là web chat, để người được giao thử dùng được worker Thử việc (FR-02-03) và để change 6 (Telegram), 7 (duyệt việc), 8 (lịch), 9–10 (connector) chỉ việc cắm vào một runtime đã có.

## What Changes

- **`Task`** (`packages/db`, `packages/core`): bảng `tasks` + `task_messages`, trạng thái `collecting → queued → running → succeeded | failed | stopped | cancelled`, lý do dừng, số bước, chi phí. Khoá ngoại `cost_entries.task_id → tasks` (change 4 để dành cho change này).
- **`apps/runner`**: tiến trình chạy nền thật (pg-boss trên PostgreSQL). Lấy `Task` từ hàng đợi, **không chạy trùng** một `Task` (chuyển trạng thái có điều kiện), chạy tuần tự trong một cuộc trò chuyện, dọn `Task` bị treo khi tiến trình chết.
- **Worker runtime** (`packages/core/runtime` + `apps/runner`): kiểm tra trạng thái worker, số dư công ty và ngân sách tháng trước khi nhận việc (#018, FR-13-04); dựng prompt hệ thống từ hồ sơ worker + danh sách kỹ năng (chỉ tên + mô tả, FR-04-02); vòng lặp mô hình ⇄ tool qua `packages/llm` với **giới hạn bước / thời gian / chi phí** mỗi `Task` (FR-04-06); tool `load_skill` (nội dung `SKILL.md` của **version đang dùng**) và `read_skill_file` (file đính kèm của version đó). Nội dung ngoài bọc `<data source="…">` (FR-05-07).
- **Gom tin nhắn** (FR-04-07): tin của cùng một người tới liên tiếp trong 5 giây gộp thành một `Task`.
- **`packages/channels`** (mới): giao diện `ChannelAdapter` chung (tin vào chuẩn hoá, tin ra tự chia theo độ dài, báo "đang làm…") và adapter `web`. Telegram (change 6) và Zalo (change 12) cài cùng giao diện.
- **Web chat** (`apps/api` + `apps/web`): API gửi tin (REST) + đẩy tin về bằng WebSocket (`@fastify/websocket`); runner báo cho api qua `LISTEN / NOTIFY` của PostgreSQL. Ai được trò chuyện với worker nào kiểm tra trong code; worker Thử việc chỉ với người được giao thử. Màn hình web chat trong `apps/web`.
- Không có trong change này: tool connector và `Approval` (change 7, 9, 10), kênh Telegram / Zalo (change 6, 12), lịch chạy và xoá hội thoại quá 90 ngày (change 8), chạy script (change 15), bảng lương / cảnh báo 80% ngân sách (change 13).

## Capabilities

### New Capabilities

- `worker-tasks`: `Task` là gì, các trạng thái, hàng đợi, không chạy trùng, chạy tuần tự trong một cuộc trò chuyện, gom tin nhắn ngắn, dọn việc treo.
- `worker-runtime`: worker nhận và làm một `Task` — điều kiện nhận việc, prompt hệ thống, nạp kỹ năng tiết lộ dần, đóng khung dữ liệu ngoài, giới hạn bước / thời gian / chi phí, ghi chi phí theo `Task`.
- `channel-adapter`: giao diện kênh chat dùng chung (tin vào, tin ra, chia tin dài, báo đang làm) mà mọi kênh phải cài.
- `web-chat`: kênh web chat — ai được trò chuyện với worker nào, cuộc trò chuyện, gửi / nhận tin thời gian thực, câu trả lời cố định khi worker không nhận việc, màn hình.

### Modified Capabilities

(không có — `worker-lifecycle` đã nói worker Tạm nghỉ không nhận việc mới và trạng thái được cung cấp cho phần chạy worker; `worker-skills` đã có "Version worker được dùng"; `worker-budget` và `llm-gateway` đã có kiểm tra mà runtime gọi. Change này dùng các requirement đó, không đổi chúng.)

## Impact

- Package mới: `packages/channels`. Thư viện mới, đều có trong danh sách được phép: `pg-boss` (runner, api), `@fastify/websocket` (api). Không thêm thư viện ngoài danh sách.
- `packages/db`: migration `tasks`, `task_messages`, `chat_conversations`; khoá ngoại `cost_entries (company_id, task_id) → tasks`; schema `pgboss` do pg-boss tạo (không RLS, chỉ chứa id).
- `packages/core`: `runtime/` (điều kiện nhận việc, dựng prompt, bọc `<data>`, giới hạn); quyền `task.assign` đổi phạm vi Trưởng phòng sang phòng mình (xem câu hỏi Q2).
- `apps/runner`: biến môi trường mới `DATABASE_URL` (bắt buộc), `ENCRYPTION_KEY` (bắt buộc, để mở API key), `WORKER_MODEL` (không bắt buộc, có mặc định); kiểm tra sẵn sàng.
- `apps/api`: route `/api/chat/*`, WebSocket `/api/chat/ws`, giới hạn gửi tin; tạo job pg-boss.
- `apps/web`: trang web chat, nút "Trò chuyện" trên hồ sơ worker; chuỗi trong `i18n/chat.vi.ts`. **Chưa có `docs/design/screens/web-chat.html`** — xem câu hỏi Q10.
