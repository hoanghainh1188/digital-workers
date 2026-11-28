# Tasks: add-skill-library

> Điều kiện trước khi apply: change 2 (`add-worker-profile`) đã apply (bảng worker, trạng thái, phòng ban của worker) — xem design.md Risks và câu hỏi Q1 trong PR. Câu trả lời Q1–Q10 đã ghi vào docs/requirements.md 0.2 #085–#094.

## 1. Tài liệu và luật dùng chung (`packages/core`)

- [ ] 1.1 Thêm hàng "Giao / gỡ skill cho worker" (Owner ✓, Admin ✓, Trưởng phòng ✓ phòng mình, Nhân viên —) và mở rộng hàng "Duyệt skill" theo câu trả lời Q3 trong docs/requirements.md mục 1, rồi action `skill.assign` trong `permissions.ts` (design D8); test ma trận đọc tài liệu vẫn xanh (`pnpm test`).
- [ ] 1.2 `skills/assignment-rules.ts`: `decideAssignment(actor, worker, skill)` theo bảng D8 và mã lỗi (`SKILL_ARCHIVED`, `SKILL_NOT_APPROVED`, `SKILL_NEEDS_REVIEW`, `WORKER_OFFBOARDED`, `ALREADY_ASSIGNED`); unit test dạng bảng vai trò × trạng thái worker × có / không script × cùng / khác phòng.
- [ ] 1.3 Schema Zod dùng chung cho API và web: tạo kỹ năng, lưu bản nháp (`skillMd`, `revision`), gửi duyệt (`changeNote`, `proposedRisk`), duyệt (`risk`), từ chối (`reason` bắt buộc, theo Q7), quay lại (`versionNumber`), bộ lọc danh sách; unit test.

## 2. Gói kỹ năng (`packages/skills`, mới)

- [ ] 2.1 Tạo package `@dw/skills` (tsconfig, `package.json`, vitest), thêm `gray-matter` và `fflate` (nếu Q2 duyệt; không thì nhánh tự viết trên `node:zlib`, design D5 a); `pnpm typecheck` và `pnpm test` chạy được với package mới.
- [ ] 2.2 `parseSkillMd`: chặn frontmatter không phải `---` thuần trước khi gọi `gray-matter`, chỉ engine YAML, kiểm `name` / `description` / trường tuỳ chọn, cảnh báo trường ngoài chuẩn, lấy `title` từ dòng `#` đầu (design D4); unit test mọi kịch bản "Frontmatter của SKILL.md", "Trường tuỳ chọn của frontmatter", kể cả `---js` không chạy mã.
- [ ] 2.3 `checkFile` / `checkPackage`: danh sách đuôi, UTF-8, chữ ký file nhị phân, luật `scripts/*.py`, đường dẫn an toàn, trùng hoa thường, bỏ `__MACOSX/` và `.DS_Store`, giới hạn (D5, D11); trả danh sách kiểm tra mã cố định; unit test mỗi kịch bản "Loại file đi kèm", "Thư mục scripts", "Đường dẫn an toàn trong gói".
- [ ] 2.4 `readZip` / `writeZip`: đếm byte thật khi inflate và dừng khi vượt 50 MB / 200 file, từ chối mục mã hoá / symlink, xuất có thứ tự và thời gian cố định; unit test với zip độc tự tạo (zip slip, zip bomb, symlink, mã hoá) và round-trip `writeZip` → `readZip` cho cùng nội dung.
- [ ] 2.5 `suggestRisk` theo D7; unit test: có `scripts/` → cao, câu "gửi email cho khách" → cao, "đọc Google Sheets" → trung bình, chỉ soạn văn bản → thấp.
- [ ] 2.6 10 kỹ năng mẫu trong `packages/skills/templates/` theo bảng D10 (tiếng Việt, đủ mục Khi nào dùng / Các bước / Không làm / Đầu ra, file đi kèm mẫu); unit test: mọi mẫu qua `checkPackage`, `name` không trùng, không mẫu nào có `scripts/`.

## 3. Cơ sở dữ liệu (`packages/db`)

- [ ] 3.1 Schema Drizzle + migration mới: enum, `skills`, `skill_versions`, `skill_version_files`, `skill_blobs`, `worker_skills`, FK ghép `(company_id, …)`, partial unique index (một `draft`, một `pending`, `name` chưa lưu trữ), RLS `ENABLE` + `FORCE`, quyền `dw_app` theo D1; `pnpm --filter @dw/db migrate` chạy được trên DB trống và DB sau change 2.
- [ ] 3.2 Trigger `skill_version_files_draft_only`, `skill_versions_frozen` (D1); test tích hợp: thêm / xoá file của version `pending` / `approved` bị DB từ chối, đổi `description` của version đã duyệt bị từ chối.
- [ ] 3.3 Test RLS bằng SQL thô dưới `dw_app`: kỹ năng / version / blob / phần giao công ty B không thấy trong phiên công ty A; chèn version trỏ kỹ năng công ty B bị từ chối; `worker_skills` trỏ worker công ty B bị từ chối; phiên chưa đặt công ty thấy rỗng; `DELETE` trên `skills` / `skill_versions` bị từ chối.
- [ ] 3.4 Hàm `effectiveSkills(tx, workerId)` (D8) và truy vấn đếm worker đang dùng (trừ worker Nghỉ việc); test tích hợp kịch bản "Version worker được dùng" (chỉ `active`, bỏ `pending` / `suspended` / kỹ năng lưu trữ, trả version đang dùng chứ không phải version chờ duyệt).

## 4. API thư viện và version (`apps/api`)

- [ ] 4.1 `GET /api/skills` (tìm, lọc, ẩn lưu trữ), `GET /api/skills/:id`, `GET /api/skills/:id/versions/:n` (D9); test tích hợp "Xem thư viện kỹ năng", "Xem chi tiết kỹ năng", kể cả id công ty B → 404 + `access.not_found`.
- [ ] 4.2 `POST /api/skills`, `PUT /api/skills/:id/draft` (tạo bản nháp từ version mới nhất hoặc ghi đè, khoá `revision`, `NAME_IMMUTABLE`), `POST …/draft/submit` (supersede `pending` cũ, rủi ro script khoá cao) trong `companyOutcome()` + `FOR UPDATE` (D2); test mọi kịch bản "Tạo kỹ năng", "Sửa kỹ năng tạo version mới", "Gửi duyệt version", kể cả hai người cùng sửa → 409.
- [ ] 4.3 `POST …/versions/:n/approve|reject`, `POST /api/skills/:id/rollback`, `POST /api/skills/:id/archive` (409 kèm số worker); test mọi kịch bản "Duyệt version", "Từ chối version", "Quay lại version cũ", "Lưu trữ kỹ năng", "Mức rủi ro của kỹ năng", và test bắt buộc: **sửa kỹ năng tạo version mới; 3 worker vẫn dùng version cũ tới khi duyệt, duyệt xong cả 3 dùng version mới**.
- [ ] 4.4 Test tách công ty + quyền cho mọi route nhóm 4: công ty A đọc / sửa / gửi duyệt / duyệt / quay lại / lưu trữ kỹ năng B → 404, dữ liệu B không đổi; Trưởng phòng / Nhân viên duyệt, từ chối, quay lại, lưu trữ → 403 + `access.denied`; `AuditEvent` đủ loại theo D12 và không chứa nội dung `SKILL.md` hay lý do từ chối.

## 5. API nhập, xuất, file, mẫu (`apps/api`)

- [ ] 5.1 Content-type parser `application/zip` / `application/octet-stream` chỉ cho route nhập và route file, `bodyLimit` 25 MB riêng, giới hạn theo IP (`perIpLimit`); `POST /api/skills/import[?dryRun=1]` trả danh sách kiểm tra, có lỗi → 422 không ghi gì; test tích hợp mọi kịch bản "Nhập kỹ năng từ zip", "Giới hạn kích thước gói" và test bắt buộc: **nhập zip sai định dạng bị từ chối với lý do rõ** (thiếu `SKILL.md` ở gốc, thiếu `description`, file `.exe`, zip slip, quá 25 MB → 413).
- [ ] 5.2 `PUT|DELETE /api/skills/:id/draft/files/*` (kiểm như một mục zip, tổng ≤ 50 MB, blob dùng chung) và `GET …/versions/:n/files/*` (attachment, `nosniff`, kiểu từ danh sách, không `text/html`); test: tải lên `.svg` → từ chối, tải xuống `.md` có `Content-Disposition: attachment`, sửa file làm `has_scripts` / rủi ro gợi ý cập nhật.
- [ ] 5.3 `GET …/versions/:n/export` (mặc định version đang dùng, tên file an toàn, `AuditEvent skill.exported`); test "Xuất rồi nhập lại" cho cùng nội dung và id công ty B → 404.
- [ ] 5.4 `GET /api/skill-templates`, `POST /api/skill-templates/:name/use` (trùng `name` → 409); test "Dùng mẫu" và "Mẫu của một công ty không ảnh hưởng công ty khác".

## 6. API giao kỹ năng cho worker (`apps/api`)

- [ ] 6.1 `GET /api/workers/:id/skills` (theo luật xem hồ sơ của change 2), `POST /api/workers/:id/skills` dùng `decideAssignment`, `DELETE /api/workers/:id/skills/:skillId`; test mọi kịch bản "Chỉ giao kỹ năng đã duyệt", "Ai được giao kỹ năng", "Giao kỹ năng cho worker Nháp hoặc Thử việc", "Giao kỹ năng cho worker Chính thức hoặc Tạm nghỉ", "Gỡ kỹ năng khỏi worker".
- [ ] 6.2 `POST /api/workers/:id/skills/:skillId/approve|reject`; test "Duyệt yêu cầu giao kỹ năng" và test bắt buộc: **kỹ năng có `scripts/` được gắn rủi ro cao và không giao được cho worker chính thức khi chưa qua kiểm duyệt** (Owner giao → 409 `SKILL_NEEDS_REVIEW`; giao cho worker Thử việc → Chờ duyệt).
- [ ] 6.3 Gọi `suspendScriptSkillsOnActivation` trong transaction chuyển Thử việc → Chính thức của change 2 (D8); test "Worker được chính thức hoá khi đang có kỹ năng script" (kỹ năng script → Tạm khoá, kỹ năng khác giữ nguyên, có `AuditEvent worker_skill.suspended`).
- [ ] 6.4 Test tách công ty + quyền cho mọi route nhóm 6: công ty A giao / gỡ / duyệt phần giao của worker hoặc kỹ năng công ty B → 404; Nhân viên giao / gỡ → 403; Trưởng phòng giao cho phòng khác → 403; Trưởng phòng duyệt yêu cầu giao → 403; `AuditEvent` theo D12.

## 7. Web — thư viện, chi tiết, trình sửa (`apps/web`)

- [ ] 7.1 Mục "Thư viện kỹ năng" trên thanh bên; trang thư viện theo `skill-library.html` (tab Của công ty / Mẫu có sẵn, tìm, lọc trạng thái + rủi ro trên URL, 3 vạch rủi ro, nhãn "Có script", tab "Kể quy trình bằng tiếng Việt" hiện nhãn CHANGE 14); mọi chuỗi trong `vi.ts`; kiểm ở 320 / 768 / 1024 / 1440 px không tràn ngang.
- [ ] 7.2 Trang chi tiết: cây file, xem trước `SKILL.md` bằng `<pre>` tô màu theo dòng (không render HTML, design D6), lịch sử version với nút "Quay lại vN" (Owner / Admin), thông báo "vN chờ duyệt, worker vẫn dùng vM" theo vai trò, nút Xuất .zip / Sửa / Duyệt / Từ chối / Lưu trữ ẩn theo quyền nhưng API vẫn là chỗ chặn; hộp duyệt chọn rủi ro (khoá "Cao" khi có script), hộp từ chối bắt buộc lý do, hộp lưu trữ báo số worker và dẫn tới danh sách.
- [ ] 7.3 Trình sửa: `textarea` `SKILL.md` kiểm frontmatter khi gõ bằng schema chung, thêm / thay / xoá file đi kèm, ghi chú thay đổi, chọn rủi ro (mặc định gợi ý), lưu nháp với `revision` (báo rõ khi 409 `DRAFT_CHANGED`), gửi duyệt; "Dùng mẫu" và "Viết kỹ năng" mở trình sửa.
- [ ] 7.4 Playwright: Nhân viên tạo kỹ năng từ mẫu → sửa → gửi duyệt; Admin duyệt; `SKILL.md` chứa `<script>` hiện như chữ và không chạy (`pnpm e2e`).

## 8. Web — nhập .zip, giao kỹ năng (`apps/web`)

- [ ] 8.1 Hộp "Nhập kỹ năng từ .zip": chọn file, gọi `dryRun` hiện danh sách kiểm tra (đạt / cảnh báo / lỗi, đường dẫn, cách sửa) theo màn "Nhập .zip" và "Nhập .zip lỗi", nút "Nhập làm bản nháp" chỉ bật khi không có lỗi; chặn file > 25 MB ở trình duyệt trước khi gửi.
- [ ] 8.2 Khối "Nhân viên số đang dùng" + "Giao thêm" trên màn kỹ năng và tab Kỹ năng trong hồ sơ worker (cùng route, cùng thông báo theo D8: "sẽ chờ Owner / Admin duyệt", "cần kiểm duyệt — change 11"), nút Duyệt / Từ chối yêu cầu giao cho Owner / Admin, gỡ kỹ năng, nhãn Tạm khoá.
- [ ] 8.3 Playwright: nhập zip lỗi thấy lý do rõ; nhập zip có `scripts/` thấy cảnh báo rủi ro cao; Trưởng phòng giao kỹ năng cho worker Chính thức → Chờ duyệt → Owner duyệt → tab Kỹ năng hiện đang dùng (`pnpm e2e`).

## 9. Kiểm tra tổng

- [ ] 9.1 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `pnpm e2e` (hoặc `pnpm ci:runner`) xanh; `npx @fission-ai/openspec@1.17.0 validate --all --strict` xanh.
- [ ] 9.2 Chạy tay trên máy dev: nén một kỹ năng mẫu của agentskills.io (có `references/`, `assets/`) theo luật gốc gói đã chốt ở Q10, nhập, xuất lại, so nội dung; ghi kết quả vào mô tả PR apply.

## Workflow follow-up

- Sau khi PR apply được merge: `/opsx:archive add-skill-library`, đồng bộ `skill-library`, `skill-package`, `worker-skills` vào `openspec/specs/`, đánh dấu change 3 ✅ trong ROADMAP.
