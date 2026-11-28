# Proposal: add-skill-library

## Why

Worker chỉ làm được việc của doanh nghiệp khi có quy trình viết sẵn để làm theo. Change 5 (`add-worker-runtime-webchat`) cần biết mỗi worker được giao kỹ năng nào và nạp nội dung `SKILL.md` của version đang dùng (FR-04-02). Change này dựng thư viện kỹ năng của từng công ty theo chuẩn mở Agent Skills (#007), có version và duyệt (FR-03), cùng luật giao kỹ năng cho worker đã chốt ở #056–#060. Skill có `scripts/` được nhận ngay nhưng chưa chạy cho tới change 15 (#015).

## What Changes

- **Thư viện kỹ năng của công ty**: mọi thành viên xem danh sách (tìm, lọc theo trạng thái và mức rủi ro) và chi tiết (cây file, xem trước `SKILL.md`, lịch sử version, worker đang dùng). Dữ liệu chỉ thuộc một công ty (#004).
- **Định dạng `SKILL.md`**: kiểm tra frontmatter theo đặc tả agentskills.io (`name` 1–64 ký tự `a-z0-9-`, `description` 1–1024 ký tự, các trường tuỳ chọn `license`, `compatibility`, `metadata`, `allowed-tools`); file đi kèm theo #059.
- **Version và duyệt** (FR-03-02, FR-03-03): mọi vai trò tạo và sửa bản nháp; gửi duyệt; Owner / Admin duyệt hoặc từ chối và **chốt mức rủi ro** (#056). Sửa kỹ năng đang dùng tạo version mới; worker vẫn dùng version đang dùng tới khi bản mới được duyệt, duyệt xong mọi worker chuyển sang bản mới. Owner / Admin quay lại version đã duyệt trước đó bằng một thao tác.
- **Mức rủi ro**: hệ thống gợi ý (luật đơn giản, chưa có quét — change 11), người tạo chọn, Owner / Admin chốt khi duyệt; có `scripts/` luôn **cao**, không hạ được (#056, FR-03-06).
- **Nhập / xuất `.zip`** (FR-03-05): nhập tạo kỹ năng ở trạng thái Nháp, kèm danh sách kiểm tra và lý do từ chối rõ ràng (`SKILL.md` phải ở gốc, tối đa 25 MB, loại file theo #059, chặn đường dẫn nguy hiểm và zip bomb); xuất một version ra `.zip` nhập lại được.
- **10 kỹ năng mẫu tiếng Việt** (FR-03-04, #020): tab "Mẫu có sẵn"; "Dùng mẫu" tạo bản nháp của công ty.
- **Lưu trữ kỹ năng** (#060): chỉ khi không còn worker nào dùng; nếu còn thì báo số worker và danh sách.
- **Giao kỹ năng cho worker** (#057, #058): từ màn kỹ năng ("Giao thêm") và tab Kỹ năng trong hồ sơ worker, cùng một luật. Worker Nháp / Thử việc: giao thẳng. Worker Chính thức / Tạm nghỉ: Owner / Admin giao thẳng, Trưởng phòng giao thì chờ Owner / Admin duyệt. Kỹ năng có script luôn chờ duyệt, và **không giao được cho worker Chính thức / Tạm nghỉ** cho tới khi có kiểm duyệt (change 11). Gỡ kỹ năng khỏi worker. Mọi kiểm tra quyền nằm trong API.
- **Ma trận quyền**: thêm hàng "Giao / gỡ kỹ năng cho worker" và "Lưu trữ kỹ năng, quay lại version cũ" (chờ chốt, xem câu hỏi trong PR).
- **Nhật ký**: `AuditEvent` cho tạo kỹ năng, tạo / gửi / duyệt / từ chối version, quay lại version, nhập, xuất, lưu trữ, giao / duyệt giao / từ chối giao / gỡ kỹ năng (chỉ id và tên trường, không ghi nội dung kỹ năng).
- **Web**: trang Thư viện kỹ năng theo `docs/design/screens/skill-library.html` (5 màn: thư viện, mẫu, chi tiết, nhập `.zip`, nhập lỗi), trình sửa `SKILL.md` và file đi kèm, tab Kỹ năng trong hồ sơ worker.

## Capabilities

### New Capabilities
- `skill-library`: kỹ năng của công ty — tạo, sửa, version, duyệt, mức rủi ro, quay lại version cũ, lưu trữ, xem danh sách và chi tiết, dùng mẫu.
- `skill-package`: định dạng gói kỹ năng `SKILL.md` + file đi kèm, kiểm tra hợp lệ, nhập và xuất `.zip`.
- `worker-skills`: giao, duyệt giao, gỡ kỹ năng cho worker và cho biết worker đang dùng version nào.

### Modified Capabilities
(không có — nhật ký của các hành động mới ghi trong requirement của từng capability mới, để không đụng `audit-log` mà change 1b đang sửa)

## Impact

- **Phụ thuộc**: phần `worker-skills` cần bảng worker của change 2 (`add-worker-profile`). Đề xuất apply change này **sau change 2** (câu hỏi Q1 trong PR). Phần còn lại chỉ cần 1a.
- **DB** (migration mới): `skills`, `skill_versions`, `skill_version_files`, `skill_blobs`, `worker_skills`; đều có `company_id NOT NULL` + RLS `ENABLE` + `FORCE`.
- **Code**: `packages/skills` (mới: đọc / kiểm tra `SKILL.md`, luật file, đọc / ghi zip, gợi ý rủi ro, 10 mẫu), `packages/core` (ma trận quyền, luật giao kỹ năng, schema Zod), `packages/db` (schema, migration), `apps/api` (route `/api/skills*`, `/api/skill-templates*`, `/api/workers/:id/skills*`), `apps/web` (trang thư viện, chi tiết, nhập, trình sửa, tab Kỹ năng).
- **Thư viện**: cần một thư viện đọc / ghi zip; đề xuất `fflate` (MIT, không phụ thuộc) — **hỏi trong PR** (Q2) vì chưa có trong danh sách CLAUDE.md. `gray-matter` đã có trong danh sách.
- **Tài liệu**: docs/requirements.md mục 1 (hàng ma trận mới), 0.2 #085–#094 (câu trả lời cho câu hỏi trong PR), ROADMAP (phụ thuộc của change 3 nếu Q1 được chốt).
- **Về sau**: change 5 đọc version đang dùng qua `worker_skills`; change 11 thay luật "chưa kiểm duyệt thì chặn" bằng `Review`; change 14 sinh `SKILL.md` nháp vào cùng thư viện; change 15 chạy `scripts/`.
