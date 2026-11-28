# Proposal: add-worker-profile

## Why

Sản phẩm định vị là quản lý digital worker **như nhân sự** (#002): có hồ sơ, người quản lý, ngân sách và vòng đời thử việc → chính thức (#006). Chưa có bảng worker thì change 3 (giao kỹ năng, #085), change 4 (chi phí theo worker), change 5 (chạy worker) đều không có chỗ bám. Change này dựng hồ sơ worker và máy trạng thái FR-02, với luật quyền đã chốt ở #047–#054; bước "Chính thức hoá" ở đây chỉ cần Owner / Admin bấm duyệt, kiểm duyệt đầy đủ làm ở change 11.

## What Changes

- **Hồ sơ worker** (FR-02-01): tên hiển thị (duy nhất trong công ty, không tính worker đã nghỉ việc — #049), ảnh đại diện sinh từ chữ cái + màu, mô tả công việc, phòng ban (bắt buộc), người quản lý (#053), ngân sách tháng VNĐ số nguyên (#050), giọng văn (mẫu hoặc tự viết), danh sách người được giao thử.
- **Tuyển từ mẫu** (FR-02-07, phần mẫu): 3 mẫu có sẵn — Trợ lý báo giá, Trợ lý CSKH nội bộ, Trợ lý tổng hợp báo cáo — hoặc hồ sơ trống. Luôn tạo ở **Nháp**. Tạo từ mô tả tiếng Việt bằng AI để sau (cần change 4, 5).
- **Vòng đời** (FR-02-02): Nháp → Thử việc → Chính thức ⇄ Tạm nghỉ; mọi trạng thái → Nghỉ việc, **không quay lại**. Mọi đường khác bị từ chối trong API.
- **Chính thức hoá bản đơn giản** (FR-02-04): Trưởng phòng **đề nghị**; Owner / Admin **duyệt** hoặc **trả lại kèm lý do** (#054); Owner / Admin cũng cho chính thức thẳng không cần đề nghị (#051). Worker ở Thử việc cho tới khi được duyệt.
- **Thử việc 14 ngày** (#048): đếm ngày, gia hạn được; hết hạn thì hồ sơ và sơ đồ báo người quản lý, worker vẫn ở Thử việc.
- **Tạm nghỉ / Nghỉ việc** (FR-02-05/06): ghi người, thời điểm, lý do (bắt buộc khi nghỉ việc — #054); nghỉ việc cần gõ lại tên để xác nhận. Phần thu hồi connector, gỡ bot, dừng lịch thực thi ở các change có những thứ đó (5, 6, 8, 9); change này đặt trạng thái và cờ để chúng đọc.
- **Phạm vi xem và sửa** (#047): Owner / Admin cả công ty; Trưởng phòng quản lý worker phòng mình, chỉ thấy **số lượng** worker phòng khác; Nhân viên **chỉ xem** worker phòng mình. Đổi phòng ban của worker chỉ Owner / Admin (#052).
- **Người quản lý rời phòng**: người quản lý bị khoá hoặc chuyển phòng thì worker tự về trưởng phòng hiện tại (hoặc "chưa có người quản lý").
- **Phòng ban** (sửa `departments`): không lưu trữ được phòng còn worker chưa nghỉ việc.
- **Ma trận quyền**: thêm hàng "Xem hồ sơ worker", "Sửa hồ sơ worker", "Đề nghị chính thức"; hàng "Tạm nghỉ / nghỉ việc" phủ cả "Đi làm lại" và gia hạn thử việc.
- **Nhật ký**: `AuditEvent` cho tạo, sửa (tên trường), đổi phòng, mỗi lần chuyển trạng thái, đề nghị / trả lại đề nghị, gia hạn thử việc.
- **Web**: trang Sơ đồ nhân sự số (`docs/design/screens/org-chart.html`) và Hồ sơ worker (`worker-profile.html`): tab Hồ sơ dùng thật, các tab khác giữ nhãn "sắp có" kèm số change.

## Capabilities

### New Capabilities
- `worker-profile`: hồ sơ digital worker — tạo từ mẫu / trống, các trường, ngân sách tháng, người quản lý, người được giao thử, phạm vi xem / sửa, sơ đồ nhân sự số.
- `worker-lifecycle`: máy trạng thái worker — ai chuyển được trạng thái nào, đề nghị và duyệt chính thức, thời hạn thử việc, tạm nghỉ, nghỉ việc không quay lại, lịch sử trạng thái.

### Modified Capabilities
- `departments`: "Lưu trữ thay cho xoá" — thêm điều kiện phòng không còn worker chưa nghỉ việc.

## Impact

- **Phụ thuộc**: 1b (`departments`, `members.department_id`, `companyOutcome()`) — đã merge. Change 3 apply sau change này (#085) và nối `suspendScriptSkillsOnActivation` vào bước lên Chính thức.
- **DB** (migration mới): `workers`, `worker_testers`, `worker_status_events`, `worker_promotion_requests`; đều `company_id NOT NULL` + RLS `ENABLE` + `FORCE`, FK ghép `(company_id, id)`.
- **Code**: `packages/core` (ma trận quyền, `workers/lifecycle.ts` máy trạng thái thuần, `workers/templates.ts`, schema Zod), `packages/db` (schema, migration, `workerRuntimeState()` cho change 5), `apps/api` (route `/api/workers*`, sửa route khoá / chuyển phòng thành viên và lưu trữ phòng ban), `apps/web` (2 trang, i18n).
- **Thư viện**: không thêm.
- **Tài liệu**: docs/requirements.md mục 1 (hàng ma trận mới), 0.2 #105–#114.
- **Về sau**: change 4 thêm số worker vào tổng của platform admin và tên worker trên trang Credit; change 5 đọc trạng thái, ngân sách, người được giao thử; change 11 thay "Owner / Admin bấm duyệt" bằng `Review`.
