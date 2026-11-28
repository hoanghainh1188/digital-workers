# Tasks: add-worker-runtime-webchat

> Change này là nền + runner + API + WebSocket (chạy được bằng API và test). Màn hình web chat đã tách sang change 5b `add-webchat-ui`, làm sau khi có `docs/design/screens/web-chat.html` (#128, #142).
> Mọi test runtime dùng mô hình giả (`@dw/llm/testing`) và kênh giả (`@dw/channels/testing`); không gọi API thật.

## 1. Khung và phụ thuộc

- [ ] 1.1 Thêm `pg-boss` vào `apps/runner` và `apps/api`, `@fastify/websocket` vào `apps/api` (đều có trong danh sách CLAUDE.md); verify: `pnpm install` sạch, license MIT
- [ ] 1.2 Tạo package `@dw/channels` (rỗng, có `testing` export) và nối vào workspace; verify: `pnpm typecheck` xanh
- [ ] 1.3 Cấu hình runner: `DATABASE_URL`, `ENCRYPTION_KEY` bắt buộc; `WORKER_MODEL` (mặc định `anthropic:claude-sonnet-5-5`), `RUNNER_CONCURRENCY` (4), `TASK_MAX_STEPS` (12), `TASK_MAX_SECONDS` (180), `TASK_MAX_CHARGE_VND` (8000) không bắt buộc; thêm vào `*server-env` của `compose.prod.yaml` và `.env.example`; `stop_grace_period: 200s` cho service `runner` (#136); verify: `docker compose -f compose.prod.yaml config` có `stop_grace_period` của runner; test config thiếu `DATABASE_URL` báo lỗi gom một lần, không in giá trị (spec runtime-config)

## 2. Cơ sở dữ liệu

- [ ] 2.1 Schema + migration `chat_conversations`, `tasks`, `task_messages`, `worker_budget_alerts` theo design D1 (RLS ENABLE + FORCE, khoá ngoại ghép theo công ty, UNIQUE partial một cuộc `open` mỗi (worker, member), `task_messages.task_id` NULL được + `conversation_id NOT NULL` (#134), `client_message_id` + UNIQUE `(company_id, conversation_id, client_message_id)` (#135), CHECK trạng thái / lý do dừng); verify: `pnpm --filter @dw/db generate` không còn khác biệt, migration chạy trên DB có dữ liệu change 4
- [ ] 2.2 Khoá ngoại `cost_entries (company_id, task_id) → tasks` (`NOT VALID` → `VALIDATE`); verify: test tích hợp chèn `CostEntry` với `task_id` của công ty khác bị từ chối
- [ ] 2.3 Tạo schema `pgboss` trong migration, cấp quyền cho `dw_app` để pg-boss không cần `CREATE` trên database; verify: runner khởi động bằng `dw_app` trên DB trống tạo được bảng của pg-boss
- [ ] 2.4 Test tách công ty cho cả bốn bảng mới: `withCompany(A)` không đọc / chèn / sửa được dòng của B; verify: `pnpm test:int` xanh

## 3. `packages/core` — quyền và runtime thuần

- [ ] 3.1 Test ma trận theo hàng "Giao việc cho worker" của `docs/requirements.md` mục 1 (đã sửa ở PR propose, #139), rồi `permissions.ts` (`task.assign.manager = own-department`); verify: test ma trận xanh
- [ ] 3.2 `canChatWith(member, worker, testerIds)` theo design D7; verify: unit test đủ các ca của spec web-chat (Thử việc chỉ danh sách, kể cả Owner; Chính thức theo vai trò; Nháp 403; phòng khác)
- [ ] 3.3 `evaluateIntake(snapshot)` theo D5 trả `accept` hoặc lý do + khoá i18n; verify: unit test Tạm nghỉ, Nghỉ việc, Nháp, hết credit, hết ngân sách, còn ngân sách
- [ ] 3.4 `wrapData(source, content)` theo D8.4; verify: unit test nguồn sai ký tự bị từ chối, `</data>` và `<data` trong nội dung bị vô hiệu hoá, nội dung còn lại giữ nguyên
- [ ] 3.5 `buildSystemPrompt(profile, skills, now)` theo D8.1; verify: snapshot test có hồ sơ, dòng thử việc, giờ Việt Nam, chỉ tên + mô tả kỹ năng, không có nội dung `SKILL.md`
- [ ] 3.6 `checkTaskLimits(task, limits, now)` theo D6; verify: unit test 12 bước, 8.000đ (dừng trước lần gọi khi đã 9.000đ), 180 giây

## 4. `packages/channels`

- [ ] 4.1 Kiểu `IncomingMessage`, `ChannelTarget`, `OutgoingMessage`, `ChannelAdapter` theo D10; verify: `pnpm typecheck` xanh
- [ ] 4.2 `splitText(text, max)`; verify: unit test 4.500 ký tự / 2.000 → 3 phần ghép đúng nguyên văn, không cắt giữa từ, emoji, chữ có dấu tổ hợp; test thuộc tính với chuỗi ngẫu nhiên
- [ ] 4.3 Kênh giả (`@dw/channels/testing`) ghi lại tin gửi và lần báo đang làm; verify: unit test thứ tự ghi lại
- [ ] 4.4 Adapter `web`: `send` lưu `task_messages` + `pg_notify('chat_events', ids)` trong cùng transaction, `sendTyping` chỉ NOTIFY; khai báo khả năng (không nhóm / nút / file), `maxTextLength` 8000; verify: test tích hợp NOTIFY chỉ tới sau commit và payload không có nội dung

## 5. `apps/runner` — hàng đợi và vòng đời `Task`

- [ ] 5.1 Khởi động pg-boss, đăng ký `task.start`, `task.run` (`singletonKey`, `retryLimit 0`, đồng thời theo `RUNNER_CONCURRENCY`), `task.reap` mỗi phút; `/health/ready` báo không sẵn sàng khi chưa nối DB; tắt êm theo D9 (ngừng nhận job, giữ heartbeat, chờ tới `TASK_MAX_SECONDS` + 10 giây, #136); verify: test tích hợp runner khởi động / tắt trên DB thật; SIGTERM khi `Task` đang chạy 20 giây → `Task` `succeeded`, không có `Task` mới bắt đầu trong lúc chờ
- [ ] 5.2 `task.start`: gom tin theo D4 (5 giây, tối đa 30 giây / 20 tin, giờ lấy từ PostgreSQL), rồi `collecting → queued` dưới khoá cuộc trò chuyện; verify: test tích hợp 3 tin cách 2–3 giây → 1 `Task`; tin cách 8 giây → 2 `Task`; gửi liên tục 40 giây → `Task` đầu đóng ở giây 30
- [ ] 5.3 `task.run`: nhận việc bằng `UPDATE … WHERE status='queued' RETURNING`, chạy tuần tự trong cuộc trò chuyện, kết thúc thì đẩy `Task` `queued` kế tiếp; verify: test tích hợp hai runner cùng nhận một job → một lần chạy; hai `Task` cùng cuộc trò chuyện chạy lần lượt; hai cuộc khác nhau chạy song song
- [ ] 5.4 `task.reap` theo D9 (heartbeat > 60 giây → `failed` + notice, không chạy lại; `collecting` quá hạn gom / `queued` không có `Task` `running` đứng trước, quá **2 phút** → gửi lại job, #137); verify: test tích hợp giết runner giữa chừng → `Task` Lỗi, không có `CostEntry` mới, `Task` chờ phía sau được chạy; giết runner sau khi lấy `task.run` nhưng trước `queued → running` → `Task` chạy đúng một lần trong 3 phút (đồng hồ giả)
- [ ] 5.5 Kiểm tra lại điều kiện nhận việc lúc `queued → running` (D5); không đạt → `cancelled` + notice; verify: test **worker Tạm nghỉ không nhận Task** (tạm nghỉ khi đang gom → `cancelled`, không có lần gọi mô hình) và test tạm nghỉ khi đang chạy → làm nốt

## 6. Worker runtime — vòng lặp và tool

- [ ] 6.1 Nạp ngữ cảnh `Task` qua `withCompany`: hồ sơ worker, công ty, phòng ban, kỹ năng có hiệu lực (spec worker-skills "Version worker được dùng"), 30 tin gần nhất (D8.3), các tin đã gom; verify: test tích hợp không có dữ liệu công ty khác trong prompt
- [ ] 6.2 Tool `load_skill` và `read_skill_file` theo D8.2; verify: test **load_skill trả đúng version đang dùng** (v2 đang dùng, v3 chờ duyệt → v2; quay lại v3 → v2 ở `Task` mới), tên chưa giao / chờ duyệt / của công ty khác → "không có kỹ năng này", file `.xlsx` hoặc `scripts/` → "file này chưa đọc được", file văn bản được bọc `<data source="skill:…">`; file 100 KB → 32 KB đầu + dòng "File đã bị cắt, còn 68 KB chưa đọc." ngoài thẻ `<data>`, không cắt giữa ký tự có dấu (#138)
- [ ] 6.3 Vòng lặp D6 qua `gateway.generate` (truyền `taskId`, `abortSignal`, `maxOutputTokens 2048`), cập nhật `steps`, `charge_vnd`, `heartbeat_at`; tool không có trong danh sách → kết quả lỗi; verify: test với mô hình giả trả chữ ngay → `succeeded`, 1 bước; mô hình gọi tool lạ → không chạy gì, vẫn tính bước
- [ ] 6.4 Giới hạn và dừng; verify: test **vượt số bước** (mô hình giả luôn gọi tool → đúng 12 lần gọi, `stopped/max_steps`, có notice), test **vượt chi phí** (3.000đ mỗi lần → dừng sau lần 3, `stopped/max_charge`), test hết thời gian (mô hình giả trễ 200 giây với đồng hồ giả → cắt ở 180 giây, không trừ credit), test hết credit giữa chừng (500đ, lần đầu 700đ → `stopped/credit_exhausted`, số dư −200đ)
- [ ] 6.5 Lỗi (`ModelNotPricedError`, `ProviderCallError`, `UsageNotRecordedError`, lỗi tool) → `failed` + notice chung; log chỉ tên lỗi và id; verify: test log không chứa nội dung tin hay API key
- [ ] 6.6 Tổng `CostEntry` theo `task_id` bằng `tasks.charge_vnd`; verify: test tích hợp sau 4 lần gọi
- [ ] 6.7 Báo "đang làm…" khi bắt đầu chạy (qua adapter); verify: test kênh giả nhận `sendTyping` trước lần gọi mô hình đầu tiên
- [ ] 6.8 Email "hết ngân sách" cho người quản lý một lần mỗi worker mỗi tháng (`worker_budget_alerts`), mẫu trong `packages/mail`; verify: test hai tin lúc hết ngân sách → một email; sang tháng mới → báo lại được; worker không có người quản lý → không gửi, có log

## 7. `apps/api` — web chat

- [ ] 7.1 `GET /api/chat/workers` (worker người dùng được trò chuyện, theo `canChatWith`), `POST /api/chat/workers/:workerId/conversations` (mở / bắt đầu mới), `GET /api/chat/conversations/:id/messages?after=` ; quyền theo `canChatWith`; id công ty khác / cuộc của người khác → 404 + `access.not_found`; verify: test tích hợp các ca của spec web-chat, gồm công ty A không đọc được cuộc trò chuyện công ty B
- [ ] 7.2 `POST /api/chat/conversations/:id/messages` (Zod: `text` 1–4.000 ký tự, `clientMessageId` uuid bắt buộc; `@fastify/rate-limit` 20 / phút / người): kiểm tra điều kiện nhận việc → lưu tin + notice, hoặc gom / tạo `Task` + job `task.start` dưới khoá cuộc trò chuyện; verify: test tích hợp worker Tạm nghỉ / hết credit → notice, không `Task`, không `CostEntry`; tin 4.001 ký tự → 400; tin thứ 21 → 429; **gửi lại cùng `clientMessageId`** → 200 với tin cũ, vẫn một tin, một `Task`, một job, không `CostEntry` thêm; gửi lại cho worker Tạm nghỉ → vẫn một notice; thiếu `clientMessageId` → 400 (#135)
- [ ] 7.3 Một kết nối `LISTEN chat_events`, nối lại có lùi thời gian, `/health/ready` báo lỗi khi đứt quá 30 giây; verify: test tích hợp sự kiện NOTIFY tới đúng socket
- [ ] 7.4 WebSocket `/api/chat/ws`: xác thực cookie, kiểm `Origin`, đăng ký theo dõi kiểm lại quyền, kiểm phiên / khoá mỗi 60 giây, tối đa 5 kết nối mỗi người; verify: test đăng ký cuộc của người khác bị từ chối; khoá thành viên → socket đóng trong 60 giây
- [ ] 7.5 Test đầu-cuối không có web: gửi tin qua API → runner (mô hình giả) → tin worker tới WebSocket, kèm "đang làm…" trước; verify: `pnpm test:int` xanh

## 8. Tài liệu và kiểm tra cuối

- [ ] 8.1 Cập nhật `docs/architecture.md` mục 4 (trạng thái `Task`, giới hạn, NOTIFY) và mục 5 (giao diện `ChannelAdapter` theo D10); verify: không còn mâu thuẫn với design
- [ ] 8.2 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `openspec validate --all --strict` (không có Playwright: chưa có màn hình); verify: tất cả xanh

## Workflow follow-up

- Sau khi merge: archive change và đồng bộ spec, đánh dấu change 5 ✅ trong ROADMAP (đóng issue #6).
- Change 5b `add-webchat-ui` (trang `/chat`, nút "Trò chuyện" trên hồ sơ worker, Playwright, ảnh chụp 4 kích thước) propose sau khi `docs/design/screens/web-chat.html` có trong main (#128, #142).
