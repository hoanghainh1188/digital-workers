# Tasks: add-worker-profile

## 1. Ma trận quyền và luật thuần (`packages/core`)

- [ ] 1.1 Thêm 3 hàng ma trận ("Xem hồ sơ worker", "Sửa hồ sơ worker", "Đề nghị worker lên chính thức") vào docs/requirements.md mục 1 rồi `worker.view`, `worker.edit`, `worker.propose` vào `permissions.ts` (design D7, #113); verify `pnpm test` — test ma trận khớp tài liệu qua.
- [ ] 1.2 Viết test bảng trước cho `decideTransition` / `availableEvents` (5 trạng thái × 9 sự kiện × 4 vai trò × cùng / khác phòng, kỳ vọng theo hai bảng D2), gồm: đường không hợp lệ → `INVALID_TRANSITION`, Trưởng phòng phòng khác → `FORBIDDEN`, mọi sự kiện trên worker Nghỉ việc → `WORKER_OFFBOARDED`, `expectedStatus` lệch → `STATUS_CHANGED`; verify test đỏ.
- [ ] 1.3 Cài `packages/core/src/workers/lifecycle.ts` (D2, thứ tự kiểm cố định, mã lỗi) cho test 1.2 xanh; verify `pnpm test`.
- [ ] 1.4 Cài và test `budgetError` (trần Trưởng phòng 2.000.000đ, sửa worker > 2.000.000đ, gửi lại giá trị cũ không tính sửa, #109), `activationBudget` (300.000 → 800.000, giá trị khác giữ, #108), `probationDay` / `probationExpired` theo giờ Việt Nam (D9, gồm ca qua nửa đêm UTC); verify `pnpm test`.
- [ ] 1.5 Cài và test `workerNameKey` (NFC, lower, trim; tên tiếng Việt có dấu, hoa thường khác nhau ra cùng khoá) và schema Zod `workerInput` / `workerPatchInput` / `transitionInput` / `extendProbationInput` (tên 1–60, mô tả ≤ 4.000, giọng văn ≤ 500, ngân sách số nguyên 0–100.000.000, lý do ≤ 500, `days` chỉ 7 | 14); verify `pnpm test`.
- [ ] 1.6 Thêm `packages/core/src/workers/templates.ts` với 3 mẫu (D6) và test: id ổn định, mô tả không rỗng và ≤ 4.000 ký tự, tên gợi ý không trùng nhau; verify `pnpm test`.

## 2. Dữ liệu (`packages/db`)

- [ ] 2.1 Viết schema Drizzle + migration `workers`, `worker_testers`, `worker_promotion_requests`, `worker_status_events`, enum `worker_status` (D1): FK ghép `(company_id, …)`, unique `name_key` một phần, unique đề nghị chờ một phần, `CHECK` ngân sách, RLS `ENABLE` + `FORCE`, quyền `dw_app` (sự kiện chỉ `SELECT, INSERT`), trigger `workers_offboarded_frozen`; verify `pnpm db:migrate` trên DB trống và `pnpm typecheck`.
- [ ] 2.2 Test tích hợp DB (Testcontainers): `dw_app` không `UPDATE` / `DELETE` được `worker_status_events` và không `DELETE` được `workers`; `UPDATE` worker đã nghỉ việc bị trigger từ chối; trùng tên với worker đang làm bị từ chối nhưng trùng với worker đã nghỉ việc thì được; trỏ phòng / thành viên công ty khác bị FK từ chối; đọc dưới `app.company_id` công ty B không thấy worker công ty A; verify `pnpm test:int`.
- [ ] 2.3 Cài `workerRuntimeState(tx, workerId)` và hai móc rỗng `onWorkerActivated` / `onWorkerOffboarded` (D8) kèm test cho từng trạng thái (Thử việc chỉ người được giao thử, Chính thức nhận kênh thật, Tạm nghỉ / Nghỉ việc trả `autoReply`); verify `pnpm test:int`.

## 3. API hồ sơ (`apps/api`)

- [ ] 3.1 Route `GET /api/worker-templates`, `POST /api/workers` (mẫu hoặc trống, phòng trong phạm vi, người quản lý mặc định, người được giao thử mặc định, ngân sách 300.000đ, `AuditEvent worker.created` kèm `template_id`); test tích hợp: Trưởng phòng tạo phòng mình được / phòng khác 403, Nhân viên 403, phòng đã lưu trữ 400, phòng công ty khác 404; verify `pnpm test:int`.
- [ ] 3.2 Route `GET /api/workers` (thẻ trong phạm vi + số lượng phòng khác, lọc `status`) và `GET /api/workers/:id`, `GET /api/workers/:id/history`; test: Owner thấy hết, Trưởng phòng và Nhân viên chỉ phòng mình + chỉ số lượng phòng khác (không có tên), mở hồ sơ phòng khác 403 + `access.denied`, id công ty khác 404 + `access.not_found`; verify `pnpm test:int`.
- [ ] 3.3 Route `PATCH /api/workers/:id` (`revision`, luật ngân sách, người quản lý hợp lệ, `AuditEvent` chỉ tên trường); test: trùng tên 409, `revision` cũ 409 `PROFILE_CHANGED`, Trưởng phòng vượt trần / sửa worker > 2.000.000đ 403, Owner đặt 3.000.000đ được, người quản lý phòng khác 400, id thành viên công ty khác 404, worker đã nghỉ việc 409, Nhân viên 403; verify `pnpm test:int`.
- [ ] 3.4 Route `POST /api/workers/:id/department` (chỉ Owner / Admin, giữ trạng thái, đặt người quản lý mới, lọc người được giao thử) và `PUT /api/workers/:id/testers` (tối đa 10, luật hợp lệ); test: Trưởng phòng đổi phòng 403, worker Chính thức đổi phòng vẫn Chính thức, 11 người 400, Nhân viên sửa người được giao thử 403, công ty khác 404; verify `pnpm test:int`.

## 4. API vòng đời (`apps/api`)

- [ ] 4.1 Route `POST /api/workers/:id/transitions` theo D3 (`FOR UPDATE`, `decideTransition`, sự kiện lịch sử, `AuditEvent worker.status_changed`, ngày thử việc, nâng ngân sách, đóng đề nghị, gọi móc); test tích hợp mỗi đường hợp lệ một ca và ca không hợp lệ (Nháp → Chính thức, Thử việc → Tạm nghỉ, Chính thức → Thử việc) 409; verify `pnpm test:int`.
- [ ] 4.2 Test tích hợp quyền chuyển trạng thái: Trưởng phòng không cho chính thức được (403), Trưởng phòng thao tác worker phòng khác 403 + `access.denied`, Nhân viên là người quản lý 403, worker công ty khác 404; verify `pnpm test:int`.
- [ ] 4.3 Test tích hợp Nghỉ việc: thiếu lý do / sai tên xác nhận 400, mọi sự kiện sau Nghỉ việc 409 `WORKER_OFFBOARDED`, bỏ bản nháp giải phóng tên, đề nghị đang chờ bị đóng; và đồng thời: hai yêu cầu song song với cùng `expectedStatus` → một thành công, một 409, lịch sử một dòng; verify `pnpm test:int`.
- [ ] 4.4 Route đề nghị / trả lại / gia hạn (`…/promotion-request`, `…/promotion-request/return`, `…/probation/extend`); test: Trưởng phòng đề nghị được, đề nghị thứ hai 409, Nhân viên 403, trả lại thiếu lý do 400, Trưởng phòng duyệt / trả lại 403, Owner duyệt đề nghị → lịch sử ghi người đề nghị và người duyệt, gia hạn 10 ngày 400, gia hạn 7 ngày lùi ngày hết hạn; verify `pnpm test:int`.

## 5. Sửa code 1b: thành viên rời phòng, lưu trữ phòng

- [ ] 5.1 Gọi `reassignWorkersOf(tx, memberId)` trong các route khoá thành viên, chuyển phòng, đổi / bỏ trưởng phòng (D5); test tích hợp: khoá người quản lý → về trưởng phòng, chuyển trưởng phòng đi → worker "chưa có người quản lý", người được giao thử bị bỏ khi rời phòng, Owner chuyển phòng vẫn giữ vai trò người quản lý; verify toàn bộ `pnpm test:int` của `members` / `departments` vẫn xanh.
- [ ] 5.2 `archiveDepartment` từ chối khi còn worker chưa nghỉ việc (`409 DEPARTMENT_HAS_WORKERS` kèm số lượng), cho phép khi chỉ còn worker đã nghỉ việc (spec `departments` sửa); verify `pnpm test:int`.

## 6. Web (`apps/web`)

- [ ] 6.1 Chuỗi tiếng Việt cho trạng thái, nút, lỗi, ghi chú mẫu vào `apps/web/src/i18n/vi.ts` (và file mẫu nếu tách, D6); verify `pnpm test` (test i18n không thiếu khoá) và `pnpm lint` không còn chuỗi viết cứng.
- [ ] 6.2 Trang `/workers` (sơ đồ) theo `org-chart.html`: tổng theo trạng thái, bộ lọc trên URL, cột theo phòng, phòng khác chỉ số lượng với Trưởng phòng / Nhân viên, nhóm "Đã nghỉ việc" thu gọn, trạng thái trống với 3 mẫu, hộp "Tuyển nhân viên số" (mẫu / trống, chọn phòng theo phạm vi, thẻ AI "Sắp có"); verify bằng Playwright ở 320 / 768 / 1440 cho Owner và Trưởng phòng.
- [ ] 6.3 Trang `/workers/:id` (hồ sơ) theo `worker-profile.html`: đầu trang + thanh vòng đời, nút từ `availableEvents`, tab Hồ sơ (form, ngân sách khoá với Trưởng phòng khi > 2.000.000đ, chế độ chỉ xem cho Nhân viên và worker đã nghỉ việc), khối Thử việc (ngày x/14, hết hạn, gia hạn, người được giao thử), lịch sử trạng thái, hộp đề nghị / trả lại / tạm nghỉ / cho nghỉ việc (gõ tên), các tab khác "Sắp có · change N"; verify bằng Playwright mỗi trạng thái × vai trò chính và kiểm tra bàn phím / axe không có lỗi nghiêm trọng.
- [ ] 6.4 E2E Playwright luồng chính: Trưởng phòng tuyển từ mẫu → cho thử việc → đề nghị chính thức → Owner duyệt (ngân sách lên 800.000đ) → Trưởng phòng cho tạm nghỉ → đi làm lại → cho nghỉ việc; sau đó hồ sơ chỉ xem và không còn nút; verify `pnpm e2e`.

## 7. Kiểm tra tổng

- [ ] 7.1 Chạy `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `pnpm e2e`, `openspec validate --all --strict`; verify tất cả xanh, ghi kết quả vào mô tả PR apply.
- [ ] 7.2 Nếu change 4 đã apply: nối tên worker vào trang Credit và số worker vào `app.platform_company_summaries()` (design D8), kèm test platform admin vẫn chỉ thấy số lượng; nếu chưa, ghi vào mô tả PR rằng change 4 làm phần này; verify bằng test tích hợp của change 4 hoặc ghi chú trong PR.

## Workflow follow-up

- Archive change sau khi PR apply được duyệt và merge (`/opsx:archive add-worker-profile`).
- Cập nhật ROADMAP: change 2 ✅.
