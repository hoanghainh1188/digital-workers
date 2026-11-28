# Design: add-worker-profile

## Context

- Có sẵn từ 1a / 1b (đã merge): `withCompany` + RLS `ENABLE` + `FORCE` theo `app.company_id` (`packages/db/src/tenancy.ts`), `recordAudit`, guard `requireCompany` / `requirePermission` / `notFound` (`apps/api/src/tenancy/guards.ts`), `companyOutcome()` cho ghi nhiều bước (`apps/api/src/org/outcome.ts`), FK ghép `(company_id, id)` (`departments_company_id_id_unique`), trưởng phòng suy ra từ `members.role = 'manager'` + `department_id` (#061), ma trận quyền một nguồn (`packages/core/src/access/permissions.ts`, đã có `worker.create`, `worker.startProbation`, `worker.approve`, `worker.suspend`), chuỗi giao diện trong `apps/web/src/i18n/vi.ts`.
- Quyết định nghiệp vụ đã có cho change này: #047–#054. Quyết định mới của proposal này: #105–#114 (ghi vào docs/requirements.md 0.2 trong cùng PR).
- Change 3 (`add-skill-library`, đã propose) giả định: bảng `workers`, trạng thái 5 giá trị, lỗi `409 WORKER_OFFBOARDED`, và một điểm móc trong transaction lên Chính thức (`suspendScriptSkillsOnActivation`). Change 4 giả định ngân sách tháng đọc từ hồ sơ worker và thêm số worker vào tổng của platform admin.
- Chưa có: `Task`, kênh chat, connector, lịch (change 5–9), `Review` (change 11), gửi thông báo nền theo lịch (change 8).

## Goals / Non-Goals

**Goals:**
- Một máy trạng thái thuần trong `packages/core`, dùng chung cho API (luôn kiểm lại) và web (ẩn nút), test dạng bảng đủ mọi ô (trạng thái × đích × vai trò × cùng / khác phòng).
- Chuyển trạng thái an toàn khi bấm đồng thời; lịch sử chỉ thêm.
- Cho change 5 một hàm duy nhất trả "worker này có nhận việc không, từ ai".

**Non-Goals:**
- Kiểm duyệt (`Review`, quét, kiểm tra quyền thừa) — change 11. Ở đây "duyệt chính thức" chỉ là Owner / Admin bấm.
- Tạo hồ sơ từ mô tả tiếng Việt bằng AI (FR-02-07 phần 2) — cần gateway (4) và runtime (5); thẻ "Kể việc bằng tiếng Việt" giữ nhãn Sắp có.
- Thu hồi `WorkerGrant`, gỡ bot, dừng lịch, trả lời "đã nghỉ việc" / "đang tạm nghỉ" — change 5, 6, 8, 9 đọc trạng thái từ `workerRuntimeState()`; change này không có gì để thu hồi.
- Email / tin nhắn nhắc hết hạn thử việc — change 8 (cần lịch nền). Change 2 chỉ báo trên web (#114).
- Tải ảnh đại diện — MVP sinh từ chữ cái + màu (#111).
- Rút lại đề nghị chính thức — Owner / Admin trả lại là đủ cho MVP (#114).

## Decisions

### D1. Bảng dữ liệu

```
workers                    (id, company_id, department_id, name, name_key, avatar_color,
                            job_description, voice_preset, voice_custom,
                            monthly_budget_vnd bigint, manager_member_id NULL,
                            status, template_id NULL,
                            probation_started_on date NULL, probation_ends_on date NULL,
                            status_changed_at, offboarded_at NULL,
                            revision int, created_by, created_at, updated_at)
                            UNIQUE (company_id, id)
                            UNIQUE (company_id, name_key) WHERE status <> 'offboarded'
                            CHECK monthly_budget_vnd BETWEEN 0 AND 100000000
worker_testers             (company_id, worker_id, member_id, added_by, created_at)
                            PRIMARY KEY (worker_id, member_id)
worker_promotion_requests  (id, company_id, worker_id, requested_by, note, status,
                            decided_by NULL, decided_at NULL, return_reason NULL, created_at)
                            UNIQUE (worker_id) WHERE status = 'pending'
worker_status_events       (id, company_id, worker_id, kind, from_status, to_status,
                            actor_member_id, reason NULL, request_id NULL, days NULL, created_at)
```

- `status` là enum `worker_status`: `draft | probation | active | suspended | offboarded` (tên tiếng Anh trong code, nhãn tiếng Việt trong i18n). `active` là "Chính thức" — khớp luật CLAUDE.md "worker không ở `active` thì không nhận việc từ kênh thật".
- `name_key` = `lower(trim(normalize(name, NFC)))`, tính trong code và kiểm lại bằng `CHECK`/generated column; unique index một phần thực thi #049 ngay trong DB (hai người tạo trùng tên cùng lúc → một người nhận `409 WORKER_NAME_TAKEN` qua `isUniqueViolation`).
- FK ghép: `(company_id, department_id) → departments`, `(company_id, manager_member_id) → members`, `(company_id, worker_id) → workers` ở 3 bảng con. Không trỏ được sang công ty khác kể cả khi code sai.
- Mọi bảng `company_id NOT NULL`, RLS `ENABLE` + `FORCE`. Quyền `dw_app`: `SELECT, INSERT, UPDATE` trên `workers`, `worker_promotion_requests`; `SELECT, INSERT, DELETE` trên `worker_testers`; **chỉ `SELECT, INSERT`** trên `worker_status_events` (lịch sử chỉ thêm, như `audit_events`). Không `DELETE` trên `workers`: bỏ bản nháp = Nghỉ việc (#106).
- Trigger `workers_offboarded_frozen`: hàng có `status = 'offboarded'` không `UPDATE` được nữa. Code đã chặn (409), trigger là lớp cuối cho luật "không quay lại".
- Tiền: `bigint` số nguyên VNĐ (CLAUDE.md). Zod `z.number().int().min(0).max(100_000_000)`.

*Đã cân nhắc:* (a) lưu lịch sử chỉ trong `audit_events` — nhưng spec `audit-log` cấm lý do / nội dung, mà lịch sử trạng thái phải hiện lý do (#054); tách bảng riêng chỉ thêm. (b) Một cột JSON `history` trên `workers` — không chỉ-thêm được bằng quyền DB, khó phân trang.

### D2. Máy trạng thái thuần (`packages/core/src/workers/lifecycle.ts`)

Đường hợp lệ (FR-02-02, #106):

| Từ \ Sang | Thử việc | Chính thức | Tạm nghỉ | Nghỉ việc |
|---|---|---|---|---|
| Nháp | `startProbation` | — | — | `offboard` |
| Thử việc | — | `activate` | — | `offboard` |
| Chính thức | — | — | `suspend` | `offboard` |
| Tạm nghỉ | — | `resume` | — | `offboard` |
| Nghỉ việc | — | — | — | — |

Ai được (ma trận mục 1 + #051, #053):

| Sự kiện | Owner / Admin | Trưởng phòng, worker phòng mình | Trưởng phòng, phòng khác | Nhân viên |
|---|---|---|---|---|
| `startProbation` | ✓ | ✓ | 403 | 403 |
| `activate` | ✓ (có / không có đề nghị) | 403 (dùng `propose`) | 403 | 403 |
| `propose` / `extendProbation` | ✓ gia hạn; đề nghị không cần | ✓ | 403 | 403 |
| `returnProposal` | ✓ | 403 | 403 | 403 |
| `suspend` / `resume` / `offboard` | ✓ | ✓ | 403 | 403 |

- "Trưởng phòng" = `role = 'manager'` và `department_id = worker.department_id` (#061). Người quản lý worker là Nhân viên thì **không** có quyền trạng thái (#053) — quyền chỉ theo vai trò, không theo cột `manager_member_id`.
- Hàm `decideTransition(actor, worker, event, input)` trả `{ ok: true, next }` hoặc `{ ok: false, error }` với mã: `FORBIDDEN` (403), `INVALID_TRANSITION` (409), `WORKER_OFFBOARDED` (409), `STATUS_CHANGED` (409), `JOB_DESCRIPTION_REQUIRED` (400), `REASON_REQUIRED` (400), `CONFIRM_NAME_MISMATCH` (400), `PROPOSAL_PENDING` (409), `NO_PENDING_PROPOSAL` (409). Thứ tự kiểm: quyền theo vai trò + phạm vi phòng → đã nghỉ việc → trạng thái thấy ≠ thật → đường hợp lệ → điều kiện dữ liệu. Thứ tự cố định để test bảng ổn định và không lộ trạng thái worker phòng khác qua mã lỗi.
- `requirePermission` của 1b chỉ kiểm "vai trò có quyền"; phạm vi phòng kiểm trong `decideTransition`, như `decideAssignment` của change 3.
- Test: một bảng sinh mọi tổ hợp 5 trạng thái × 9 sự kiện × 4 vai trò × {cùng phòng, khác phòng} và so với bảng mong đợi viết tay — đúng ba test bắt buộc của ROADMAP (hợp lệ / không hợp lệ, Trưởng phòng phòng khác, Nghỉ việc không quay lại).

*Đã cân nhắc:* thư viện máy trạng thái (XState…) — không có trong danh sách được phép, và 5 trạng thái × 9 sự kiện vừa một bảng hằng số.

### D3. Chuyển trạng thái trong một transaction

`POST /api/workers/:id/transitions` với `{ event, expectedStatus, reason?, confirmName? }`:

1. `withCompany` → `SELECT … FROM workers WHERE id = $1 FOR UPDATE` (không thấy → `notFound`, 404 + `access.not_found`).
2. `decideTransition(...)`; lỗi → trả mã, có `AuditEvent access.denied` cho 403.
3. `UPDATE workers SET status, status_changed_at, revision = revision + 1, …` + `INSERT worker_status_events` + `recordAudit('worker.status_changed', fields: ['status'])`.
4. Theo sự kiện: `startProbation` đặt `probation_started_on = hôm nay (Asia/Ho_Chi_Minh)`, `probation_ends_on = +14 ngày`; `activate` đóng đề nghị đang chờ là `approved` (lưu `request_id` vào sự kiện để lịch sử ghi "duyệt đề nghị của …"), nâng ngân sách 300.000 → 800.000 (#108), và gọi `onWorkerActivated(tx, workerId)` — hàm rỗng ở change 2, change 3 thêm `suspendScriptSkillsOnActivation` vào đây; `offboard` đặt `offboarded_at`, đóng đề nghị đang chờ là `closed`.

`expectedStatus` + `FOR UPDATE` giải quyết bấm đồng thời: người thứ hai thấy trạng thái đã đổi → `409 STATUS_CHANGED`, không có lần chuyển thứ hai. Đề nghị: `POST /api/workers/:id/promotion-request` (`{ note? }`), `POST …/promotion-request/return` (`{ reason }`); unique index một phần chặn hai đề nghị chờ cùng lúc. Gia hạn: `POST …/probation/extend` (`{ days: 7 | 14 }`, #107).

### D4. Hồ sơ, phạm vi xem, sửa

| Route | Quyền |
|---|---|
| `GET /api/worker-templates` | `worker.create` |
| `GET /api/workers?status=` | mọi thành viên; trả thẻ trong phạm vi + `otherDepartments: [{ departmentId, name, count }]` (#047, #105) |
| `POST /api/workers` | `worker.create` + phòng trong phạm vi |
| `GET /api/workers/:id`, `GET /api/workers/:id/history` | `worker.view` + phạm vi |
| `PATCH /api/workers/:id` (`{ revision, …fields }`) | `worker.edit` + phạm vi + luật ngân sách (#109) |
| `POST /api/workers/:id/department` | `org.manage` (Owner / Admin, #052) |
| `PUT /api/workers/:id/testers` | như quyền đổi trạng thái (#110) |
| `POST /api/workers/:id/transitions`, `…/promotion-request*`, `…/probation/extend` | D2 |

- Phạm vi: Owner / Admin `all`; Trưởng phòng và Nhân viên `own-department` theo `members.department_id`. Worker trong công ty mà ngoài phạm vi → 403 + `access.denied`; id không có trong công ty → 404 (spec `access-control`). Thẻ phòng khác trên sơ đồ chỉ có số lượng — API không trả tên.
- `PATCH` dùng `revision` (optimistic lock) → `409 PROFILE_CHANGED` khi người khác đã lưu. Worker `offboarded` → `409 WORKER_OFFBOARDED`.
- Luật ngân sách `budgetError(actorRole, current, next)`: Trưởng phòng gửi `next > 2.000.000` hoặc sửa khi `current > 2.000.000` → `403 BUDGET_ABOVE_MANAGER_CAP`. Gửi đúng giá trị hiện tại thì không tính là sửa (form luôn gửi đủ trường). Trần 2.000.000đ là hằng số `MANAGER_BUDGET_CAP_VND`; cài đặt công ty làm sau (#050).
- Người quản lý hợp lệ (`managerError`): thành viên `active` và (`department_id = worker.department_id` hoặc vai trò Owner / Admin). Mặc định khi tạo: trưởng phòng → người tạo (#110).
- Người được giao thử: tối đa 10, cùng luật hợp lệ như người quản lý; mặc định `[người quản lý]` nếu có.

### D5. Thành viên rời phòng và lưu trữ phòng ban (sửa code 1b)

- Trong các route của 1b khoá thành viên, chuyển phòng, đổi trưởng phòng (đều đã chạy trong một transaction `companyOutcome()`), gọi thêm `reassignWorkersOf(tx, memberId)`: worker chưa nghỉ việc có `manager_member_id = memberId` mà người đó không còn hợp lệ → người quản lý = trưởng phòng hiện tại của phòng worker (hoặc `NULL`), `AuditEvent worker.manager_reassigned`; xoá họ khỏi `worker_testers` của worker phòng cũ. Owner / Admin chuyển phòng vẫn hợp lệ làm người quản lý nên không bị đổi.
- `archiveDepartment` đếm thêm worker `status <> 'offboarded'` của phòng → `409 DEPARTMENT_HAS_WORKERS` kèm số lượng (#112). Worker đã nghỉ việc giữ `department_id` trỏ phòng đã lưu trữ; hồ sơ hiện tên phòng cũ.

### D6. Ba mẫu worker (`packages/core/src/workers/templates.ts`)

Mẫu là hằng số trong code (không phải bảng): có id ổn định để `AuditEvent` và `workers.template_id` ghi lại; nội dung tiếng Việt đặt trong file i18n riêng `apps/web/src/i18n/worker-templates.vi.ts` cho phần hiển thị thẻ, còn mô tả công việc / giọng văn điền vào hồ sơ là dữ liệu mẫu tiếng Việt (#020) đọc từ `packages/core` vì API cần chép vào hồ sơ.

| id | Tên gợi ý | Mô tả công việc (tóm tắt) | Giọng văn | Kỹ năng gợi ý (change 3) |
|---|---|---|---|---|
| `quote-assistant` | Trợ lý báo giá | Nhận yêu cầu báo giá, tra bảng giá đại lý, lập báo giá nháp theo mẫu công ty, gửi người phụ trách duyệt trước khi gửi khách. Không tự hứa chiết khấu ngoài bảng giá. | Lịch sự, ngắn gọn | lập báo giá |
| `internal-support` | Trợ lý CSKH nội bộ | Trả lời nhân viên về chính sách đổi trả, bảo hành, quy trình, thông tin sản phẩm dựa trên tài liệu được giao; không chắc thì nói rõ và chỉ người phụ trách. | Thân thiện | tra cứu chính sách |
| `report-digest` | Trợ lý tổng hợp báo cáo | Gom số liệu từ bảng tính được giao, viết báo cáo ngày / tuần ngắn gọn: số chính, thay đổi so với kỳ trước, điểm bất thường cần xem. | Trang trọng | tổng hợp báo cáo ngày |

Mô tả đầy đủ (3–6 câu mỗi mẫu, viết như giao việc cho nhân viên mới) nằm trong file mẫu, có test: không rỗng, ≤ 4.000 ký tự, không trùng tên gợi ý. Tên gợi ý trùng tên worker đang có → form gợi ý thêm hậu tố (" 2"), API vẫn kiểm #049. "Kỹ năng gợi ý" chỉ là chữ trên thẻ ở change 2; change 3 nối vào 10 kỹ năng mẫu.

*Đã cân nhắc:* lưu mẫu trong DB cho từng công ty sửa được — FR-02-07 chỉ đòi "mẫu có sẵn"; mẫu riêng của công ty để sau MVP.

### D7. Ma trận quyền

Thêm vào docs/requirements.md mục 1 và `permissions.ts` (#113):

| Hàng | Action | Owner | Admin | Trưởng phòng | Nhân viên |
|---|---|:-:|:-:|:-:|:-:|
| Xem hồ sơ worker | `worker.view` | ✓ | ✓ | ✓ (phòng mình) | ✓ (phòng mình) |
| Sửa hồ sơ worker | `worker.edit` | ✓ | ✓ | ✓ (phòng mình) | — |
| Đề nghị worker lên chính thức | `worker.propose` | — | — | ✓ (phòng mình) | — |

Hàng "Tạm nghỉ / nghỉ việc worker" (`worker.suspend`) phủ cả "Đi làm lại" và gia hạn thử việc; hàng "Duyệt worker lên chính thức" (`worker.approve`) phủ cả trả lại đề nghị. Đổi phòng của worker dùng `org.manage`. Test ma trận hiện có tự kiểm hàng mới khớp tài liệu.

### D8. Điểm nối cho change sau

- `workerRuntimeState(tx, workerId)` trong `packages/db`: `{ status, acceptsRealChannels: status === 'active', acceptsWebChatFrom: memberId[] (người được giao thử khi Thử việc; mọi người được giao việc khi Chính thức), autoReply: 'suspended' | 'offboarded' | null, monthlyBudgetVnd }`. Change 5 / 6 / 8 dùng, không tự đọc cột.
- `onWorkerActivated(tx, workerId)` (D3) cho change 3. `onWorkerOffboarded(tx, workerId)` rỗng cho change 6 / 8 / 9 nối thu hồi.
- Tên worker cho trang Credit / platform admin của change 4: nếu change 4 apply trước, task 6.x nối tên và số worker; nếu sau, change 4 đọc thẳng bảng `workers`.

### D9. Web

- `/workers` (sơ đồ) và `/workers/:id` (hồ sơ) theo hai màn thiết kế; TanStack Router, TanStack Query; bộ lọc trạng thái trên URL (`?status=probation`). Nhóm "Đã nghỉ việc" dùng `<details>`.
- Nút trên hồ sơ lấy từ `availableEvents(actor, worker)` của D2 — cùng hàm API dùng để kiểm, nên giao diện không hiện nút API sẽ từ chối. Hộp "Cho nghỉ việc" bắt gõ đúng tên; API kiểm lại.
- Ảnh đại diện: chữ cái đầu của hai từ đầu tên + một trong 8 màu cố định (`avatar_color`), worker hình vuông bo góc có dấu lấp lánh, người thật hình tròn (ghi chú màn thiết kế).
- Ngày thử việc tính phía API (`probationDay`, `probationExpired`) theo giờ Việt Nam để web và test không lệch múi giờ.
- Tab Kỹ năng / Kênh chat / Quyền dữ liệu / Lịch / Quy tắc duyệt / Việc đã làm: nhãn "Sắp có · change N" như thiết kế.

## Risks / Trade-offs

- [Sửa code 1b (khoá / chuyển phòng / lưu trữ phòng) có thể làm hỏng test 1b] → chỉ thêm một lời gọi trong transaction sẵn có; chạy lại toàn bộ test tích hợp của `members` / `departments`, thêm kịch bản mới vào cùng file.
- [Trưởng phòng mất người quản lý khi phòng không có trưởng phòng → worker không ai nhận cảnh báo] → sơ đồ và hồ sơ hiện "Chưa có người quản lý" cho Owner / Admin; cảnh báo ngân sách của change 13 rơi về Owner khi không có người quản lý (ghi ở change đó).
- [Không có email nhắc hết hạn thử việc tới change 8] → hồ sơ / sơ đồ báo rõ; worker vẫn an toàn vì Thử việc chỉ chạy web chat và mọi việc cần duyệt.
- [`name_key` dựa trên chuẩn hoá NFC + lower có thể khác nhau giữa JS và PostgreSQL với vài ký tự] → tính `name_key` duy nhất trong code (một hàm có test với tên tiếng Việt có dấu), DB chỉ giữ unique index trên cột đã tính.
- [Bảng kỳ vọng 360 ô dễ viết sai] → bảng mong đợi viết theo hai bảng D2 (đường × vai trò), test sinh tổ hợp; mỗi lỗi in ra ô cụ thể.

## Migration Plan

- Migration `0004_workers.sql` (số tiếp theo sau migration mới nhất lúc apply): enum, 4 bảng, index, FK ghép, RLS, quyền, trigger. Không có dữ liệu cũ cần chuyển.
- Rollback: chưa có dữ liệu worker thật trước staging; migration lùi xoá 4 bảng + enum.
