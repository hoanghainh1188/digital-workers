# Design: add-skill-library

## Context

- Có sẵn từ 1a: `withCompany` + RLS `ENABLE` + `FORCE` theo `app.company_id` (`packages/db/src/tenancy.ts`), `recordAudit`, guard `requireCompany` / `requirePermission` / `notFound` (`apps/api/src/tenancy/guards.ts`), ma trận quyền một nguồn (`packages/core/src/access/permissions.ts`, đã có `skill.edit` cho mọi vai trò và `skill.approve` cho Owner / Admin), lỗi dạng `{ error: { code, message } }`, chuỗi giao diện trong `apps/web/src/i18n/vi.ts`.
- Đang apply song song (1b): `departments`, `members.department_id`, mẫu FK ghép `(company_id, id)` chống tham chiếu chéo công ty, `companyOutcome()` cho ghi nhiều bước. Change này dùng các thứ đó qua change 2.
- Chưa có: bảng worker (change 2 — `add-worker-profile`), `Review` (change 11), chạy script (change 15), object storage (#029 chưa chốt nhà cung cấp).
- Đặc tả agentskills.io: thư mục kỹ năng có `SKILL.md` (frontmatter `name`, `description` bắt buộc; `license`, `compatibility`, `metadata`, `allowed-tools` tuỳ chọn), thư mục tuỳ chọn `scripts/`, `references/`, `assets/`; khuyên `SKILL.md` dưới 500 dòng, tham chiếu file bằng đường dẫn tương đối một cấp. Chuẩn đòi `name` trùng tên thư mục cha; với gói `.zip` có `SKILL.md` ở gốc (theo màn hình), thư mục khi xuất / chạy chính là `name`.
- Thư viện: `gray-matter` đã được phép; **chưa có thư viện zip** (xem D5).

## Goals / Non-Goals

**Goals:**
- Lưu kỹ năng theo version bất biến, một con trỏ "version đang dùng", luật duyệt và luật giao kiểm tra trong code (`packages/core`), không dựa vào giao diện.
- Nhập `.zip` không tin dữ liệu: giới hạn kiểm trong lúc giải nén, từ chối cả gói khi có một lỗi, không lưu gì dở dang.
- Cho change 5 một hàm duy nhất trả "kỹ năng có hiệu lực + version" của một worker.

**Non-Goals:**
- Quét nội dung (prompt injection, ký tự ẩn, URL lạ) — change 11. Mức rủi ro ở đây chỉ là gợi ý theo luật đơn giản (D7).
- Chạy script, xem / chạy thử script trong màn kiểm duyệt — change 15.
- Worker dùng version riêng (ghim version theo từng worker) — mọi worker theo version đang dùng của kỹ năng (D2).
- Nhập từ **thư mục** (FR-03-05 nói "`.zip` / thư mục"): để sau, xem câu hỏi Q8 trong PR.
- Trình tạo kỹ năng bằng tiếng Việt — change 14 (tab "CHANGE 14" trên màn hình giữ nguyên nhãn sắp có).
- Dọn blob không còn version nào dùng — chưa cần trong MVP (không có thao tác xoá version).

## Decisions

### D1. Lưu kỹ năng trong PostgreSQL, file theo nội dung (content-addressed)

Mọi nội dung kỹ năng nằm trong DB:

```
skills               (id, company_id, name, title, current_version_id → skill_versions,
                      created_by, archived_at, archived_by, created_at)
                      UNIQUE (company_id, name) WHERE archived_at IS NULL
skill_versions       (id, company_id, skill_id, number, status, title, description,
                      has_scripts, suggested_risk, proposed_risk, risk, change_note,
                      revision, created_by, submitted_by, submitted_at,
                      decided_by, decided_at, reject_reason, ever_approved, created_at)
                      UNIQUE (skill_id, number)
                      UNIQUE (skill_id) WHERE status = 'draft'
                      UNIQUE (skill_id) WHERE status = 'pending'
skill_version_files  (company_id, version_id, path, sha256, size, media_type)
                      PRIMARY KEY (version_id, path)   -- SKILL.md cũng là một dòng
skill_blobs          (company_id, sha256, size, content bytea)
                      PRIMARY KEY (company_id, sha256)
worker_skills        (id, company_id, worker_id → workers, skill_id → skills, status,
                      assigned_by, requested_at, decided_by, decided_at, created_at)
                      UNIQUE (worker_id, skill_id)
```

- Mọi bảng có `company_id NOT NULL`, RLS `ENABLE` + `FORCE`, policy so với `app.current_company_id()`. Khoá ngoại dạng ghép `(company_id, x_id) → (company_id, id)` như 1b, để DB tự từ chối version / file / phần giao trỏ sang công ty khác.
- `skill_blobs` khoá theo `(company_id, sha256)`: sửa một dòng `SKILL.md` không nhân đôi file Excel 5 MB đi kèm; blob không dùng chung giữa công ty (tránh lộ "công ty khác có file này").
- Quyền `dw_app`: `SELECT, INSERT, UPDATE` trên `skills`, `skill_versions`; `SELECT, INSERT` trên `skill_blobs`; `SELECT, INSERT, DELETE` trên `skill_version_files` (chỉ khi version là `draft`) và `worker_skills`. Không `DELETE` trên `skills` / `skill_versions`.
- Trigger `skill_version_files_draft_only`: `INSERT` / `DELETE` file của version không ở `draft` bị DB từ chối; trigger `skill_versions_frozen`: không đổi `title`, `description`, `has_scripts`, file của version đã rời `draft`. Code đã chặn, trigger là lớp cuối.
- `skill_versions.status`: `draft | pending | approved | rejected | superseded`. `ever_approved` đánh dấu version từng được duyệt (đích hợp lệ của quay lại, D3).

**Phương án đã cân nhắc:** (a) file trên đĩa + DB giữ đường dẫn — phải sao lưu thêm một nơi, không có RLS, khó giữ đồng bộ khi transaction lỗi; (b) object storage — chưa chọn nhà cung cấp (#029), thêm một dịch vụ cho dữ liệu nhỏ (gói ≤ 50 MB sau giải nén). Chọn DB vì một transaction ghi được cả version + file, RLS phủ luôn nội dung, sao lưu PostgreSQL hằng ngày (architecture mục 8) đã có. Khi có object storage có thể chuyển `skill_blobs.content` ra ngoài mà không đổi API.

### D2. Mô hình version: bất biến sau khi gửi duyệt, một con trỏ "đang dùng"

```
            sửa (ghi đè, revision+1)
              ┌──────┐
              ▼      │
 tạo / sửa ─► draft ─┘ ──gửi duyệt──► pending ──duyệt──► approved ◄── con trỏ current_version_id
                                        │   │                          (duyệt mới / quay lại)
                     gửi duyệt bản khác │   └──từ chối (lý do)──► rejected
                                        ▼
                                    superseded
```

- **Bản nháp sửa tại chỗ**: mỗi kỹ năng có tối đa một `draft`. Lần sửa đầu sau một version đã gửi duyệt tạo version mới (số kế tiếp, chép file từ version mới nhất — chỉ chép dòng `skill_version_files`, không chép blob). Các lần lưu sau ghi đè bản nháp đó. "Mỗi lần sửa tạo `SkillVersion` mới" (FR-03-02) hiểu là mỗi lần sửa *được gửi duyệt*; lưu nháp nhiều lần không sinh hàng chục version.
- **Khoá lạc quan**: mọi lệnh ghi bản nháp mang `revision`; khác `revision` trong DB → `409 DRAFT_CHANGED`.
- **Gửi duyệt bản mới khi đã có `pending`**: bản cũ → `superseded` (màn hình có nút "Sửa (tạo v4)" khi v3 đang chờ). Partial unique index giữ "tối đa một `pending`".
- **Duyệt**: trong một transaction, `SELECT … FROM skills WHERE id = $1 FOR UPDATE`, đổi version → `approved`, `ever_approved = true`, chốt `risk`, đặt `skills.current_version_id`. Worker không ghim version: `worker_skills` chỉ trỏ `skill_id`, nên mọi worker chuyển sang version mới cùng lúc — đúng câu "duyệt xong cả hai chuyển sang v3" trên màn hình.
- **Phương án đã cân nhắc:** ghim version theo từng worker (`worker_skills.version_id`) — cho phép thử version mới trên một worker trước, nhưng thêm thao tác "nâng version cho từng worker" mà FR-03 không đòi và màn hình không có. Để sau MVP; thêm cột `pinned_version_id` nullable là đủ, không phá dữ liệu.

### D3. Quay lại version cũ = trỏ lại, không tạo version mới

"Quay lại v1" đặt `current_version_id` về v1 (phải `ever_approved`), ghi `AuditEvent skill.rolled_back` (trường `current_version_id`). Không tạo bản sao vì bản sao là version chưa duyệt, sẽ phải duyệt lại — trái "một thao tác" (FR-03-03). Version `pending` / `draft` đang mở giữ nguyên. Mức rủi ro của kỹ năng đi theo version đang dùng. Câu hỏi Q6 xác nhận.

### D4. Đọc `SKILL.md` an toàn bằng `gray-matter`

- `gray-matter` mặc định nhận `---js` / `---coffee` và **chạy** frontmatter đó (`eval`). Gọi với `engines` chỉ có `yaml`, đồng thời tự kiểm dòng mở đầu phải đúng `---` (không có tên ngôn ngữ) → khác thì từ chối `FRONTMATTER_NOT_YAML` trước khi gọi `gray-matter`. YAML đọc bằng schema an toàn (không tag tuỳ biến).
- Frontmatter kiểm bằng Zod trong `packages/skills` (dùng chung web để báo lỗi khi gõ): luật ở spec `skill-package`. Trường ngoài chuẩn → cảnh báo, giữ nguyên vì lưu nguyên văn `SKILL.md`.
- `title` (tên hiển thị tiếng Việt) = dòng `# …` đầu tiên của phần thân, không có thì dùng `name`. `name` cố định sau khi tạo: bản nháp đổi `name` → `400 NAME_IMMUTABLE` (Q9).
- `description`, `title`, `has_scripts` lưu thành cột của version để danh sách và runtime (change 5: "luôn biết tên + mô tả", FR-04-02) không phải đọc blob.

### D5. Zip: dùng `fflate` (cần duyệt thêm thư viện)

- **Chọn `fflate`** (MIT, không phụ thuộc, chạy cả Node lẫn trình duyệt): giải nén từng mục với bộ lọc trước khi inflate (bỏ qua `__MACOSX/`, từ chối mục mã hoá / symlink theo `attrs`), và inflate theo luồng nên đếm được byte thật để dừng ngay khi vượt 50 MB tổng / 200 file — không tin kích thước khai trong central directory. Xuất bằng `zipSync` với thứ tự đường dẫn cố định và thời gian cố định để cùng nội dung ra cùng file.
- **Đã cân nhắc:** (a) tự viết đọc / ghi zip trên `node:zlib` (`inflateRaw`) — không thêm thư viện, nhưng phải tự xử lý central directory, zip64, data descriptor: ~300 dòng mã nhạy cảm bảo mật, dễ sai. Là phương án dự phòng nếu không duyệt `fflate`; (b) `yauzl` + `yazl` (MIT) — hai thư viện, API callback, chỉ chạy Node; (c) `adm-zip` — từng có lỗi zip slip, đọc cả file vào bộ nhớ không giới hạn. Câu hỏi Q2.
- **Tải lên không cần `@fastify/multipart`**: route nhập nhận thân `application/zip` thô với `bodyLimit` 25 MB riêng của route (thêm content-type parser trả `Buffer` cho đúng route đó); vượt → `413 PACKAGE_TOO_LARGE`. Web gửi `fetch(…, { body: file })`. Route sửa file đi kèm của bản nháp dùng cách tương tự (`application/octet-stream`, đường dẫn trong query, kiểm như một mục zip).
- **Luồng nhập**: `POST /api/skills/import?dryRun=1` trả danh sách kiểm tra (màn "Nhập .zip" hiện danh sách rồi mới bấm "Nhập làm bản nháp"); bấm thật gửi lại file không có `dryRun`. Server kiểm lại toàn bộ, không giữ trạng thái giữa hai lần gọi. Có lỗi → `422 PACKAGE_INVALID` kèm cùng danh sách, không ghi gì.
- **Danh sách kiểm tra** là mảng `{ check, level: 'ok'|'warn'|'error', path?, params? }` với `check` là mã cố định (`ROOT_SKILL_MD`, `SKILL_MD_IN_SUBFOLDER`, `NAME_FORMAT`, `DESCRIPTION_MISSING`, `NAME_TAKEN`, `HAS_SCRIPTS`, `FILE_TYPE`, `CONTENT_MISMATCH`, `PATH_UNSAFE`, `TOO_LARGE_UNPACKED`, `TOO_MANY_FILES`, …). Web dịch mã sang tiếng Việt trong `vi.ts` (CLAUDE.md: chuỗi hiển thị nằm trong i18n).
- **Kiểm loại file**: đuôi theo danh sách ở spec; văn bản kiểm UTF-8 bằng `TextDecoder('utf-8', { fatal: true })`; nhị phân kiểm chữ ký đầu file (PNG, JPEG, GIF, WEBP, PDF; `.xlsx` / `.docx` là zip `PK\x03\x04`). Không nhận SVG (chứa được script).

### D6. Hiển thị nội dung không qua HTML

- Xem trước `SKILL.md` hiển thị như màn hình: khối `<pre>` với tô màu theo dòng (frontmatter, dòng `#`), dựng bằng phần tử React — **không** dùng thư viện render Markdown (chưa có trong danh sách và không cần), không `dangerouslySetInnerHTML`. Vì vậy HTML trong kỹ năng chỉ là chữ.
- Tải file: `Content-Disposition: attachment; filename=` (tên đã làm sạch), `X-Content-Type-Options: nosniff`, kiểu nội dung lấy từ danh sách cho phép, không bao giờ `text/html`. File ảnh chỉ xem trước qua `blob:` URL tạo từ phản hồi đã kiểm kiểu.
- Trình sửa: `textarea` cho `SKILL.md` (kiểm frontmatter ngay khi gõ bằng schema chung), thêm / thay / xoá file đi kèm, ô ghi chú thay đổi, chọn mức rủi ro khi gửi duyệt (mặc định = gợi ý).

### D7. Gợi ý mức rủi ro bằng luật đơn giản

`suggestRisk(package)` trong `packages/skills`, chỉ để gợi ý (#056):
- có `scripts/` → **cao** (khoá, không hạ được — kiểm cả ở API khi gửi duyệt và khi duyệt);
- thân `SKILL.md` có từ chỉ ghi / gửi ra ngoài (`gửi cho khách`, `gửi email`, `ghi vào`, `cập nhật sheet`, `xoá`, `chuyển khoản`, …) → **cao**;
- có từ chỉ đọc dữ liệu (`Google Sheets`, `bảng tính`, `email`, `đọc file`, `tra`, …) → **trung bình**;
- còn lại → **thấp**.

Danh sách từ nằm trong một hằng số có test. Thay bằng kết quả quét ở change 11. Mức rủi ro của kỹ năng không cấp quyền gì — quyền thật của worker vẫn do `WorkerGrant` và quy tắc duyệt quyết (change 7, 9).

### D8. Quyền: một action mới, luật giao trong `packages/core`

- Ma trận (docs/requirements.md mục 1, rồi `permissions.ts`): thêm hàng **"Giao / gỡ skill cho worker"** → action `skill.assign` (Owner, Admin: `all`; Trưởng phòng: `own-department`; Nhân viên: —). Hàng "Duyệt skill" (`skill.approve`) phủ: duyệt / từ chối version, quay lại version cũ, lưu trữ kỹ năng, duyệt / từ chối yêu cầu giao. Xem thư viện không có hàng riêng: mọi thành viên đang hoạt động (`requireCompany`). Câu hỏi Q3.
- `requirePermission` chỉ trả lời "vai trò có quyền không". Phần còn lại là hàm thuần `decideAssignment(actor, worker, skill)` trong `packages/core/src/skills/assignment-rules.ts`, trả `'grant' | 'request' | { error }`:

| Worker \ Người giao | Owner / Admin | Trưởng phòng (phòng mình) | Kỹ năng có script |
|---|---|---|---|
| Nháp, Thử việc | grant | grant | request (mọi người giao) |
| Chính thức, Tạm nghỉ | grant | request | `409 SKILL_NEEDS_REVIEW` (tới change 11) |
| Nghỉ việc | `409 WORKER_OFFBOARDED` | `409 WORKER_OFFBOARDED` | — |

  Trước bảng: kỹ năng lưu trữ → `409 SKILL_ARCHIVED`; chưa có version đang dùng → `409 SKILL_NOT_APPROVED`; Trưởng phòng với worker phòng khác → `403` + `access.denied`; đã giao → `409 ALREADY_ASSIGNED`. Test dạng bảng mọi ô. Cả hai nơi giao (màn kỹ năng, tab Kỹ năng) gọi cùng một route `POST /api/workers/:id/skills`.
- `worker_skills.status`: `active | pending | suspended`. Khi worker chuyển Thử việc → Chính thức (code của change 2), cùng transaction gọi `suspendScriptSkillsOnActivation(tx, workerId)`: phần giao kỹ năng có script → `suspended` + `AuditEvent`. Từ chối yêu cầu / gỡ kỹ năng = `DELETE` dòng (lịch sử ở `AuditEvent`).
- **Hàm cho runtime**: `effectiveSkills(tx, workerId)` trong `packages/db` trả `{ skillId, name, description, versionId, number }[]` chỉ của `worker_skills.status = 'active'` + kỹ năng chưa lưu trữ + `current_version_id`. Change 5 dùng hàm này cho bước "nạp danh sách skill" và `load_skill(name)`.

### D9. API

| Route | Quyền |
|---|---|
| `GET /api/skills` (`q`, `status`, `risk`, `archived`) | mọi thành viên |
| `POST /api/skills` (`{ skillMd }`) | `skill.edit` |
| `POST /api/skills/import[?dryRun=1]` (`application/zip`) | `skill.edit` + giới hạn theo IP |
| `GET /api/skills/:id` (kèm version, worker đang dùng, yêu cầu giao) | mọi thành viên |
| `GET /api/skills/:id/versions/:n`, `…/files/*`, `…/export` | mọi thành viên |
| `PUT /api/skills/:id/draft` (`{ skillMd, revision }`), `PUT|DELETE /api/skills/:id/draft/files/*` | `skill.edit` |
| `POST /api/skills/:id/draft/submit` (`{ changeNote, proposedRisk }`) | `skill.edit` |
| `POST /api/skills/:id/versions/:n/approve` (`{ risk }`), `…/reject` (`{ reason }`) | `skill.approve` |
| `POST /api/skills/:id/rollback` (`{ versionNumber }`), `POST /api/skills/:id/archive` | `skill.approve` |
| `GET /api/skill-templates`, `POST /api/skill-templates/:name/use` | mọi thành viên / `skill.edit` |
| `GET /api/workers/:id/skills` | người xem được hồ sơ worker (luật change 2, #047) |
| `POST /api/workers/:id/skills` (`{ skillId }`), `DELETE /api/workers/:id/skills/:skillId` | `skill.assign` + D8 |
| `POST /api/workers/:id/skills/:skillId/approve|reject` | `skill.approve` |

Id của công ty khác (kỹ năng, version, worker, phần giao) → `guards.notFound` (404 + `access.not_found`). Nhiều bước ghi dùng `companyOutcome()` của 1b để lỗi giữa chừng rollback cả transaction.

### D10. 10 kỹ năng mẫu nằm trong mã nguồn

`packages/skills/templates/<name>/SKILL.md` (+ file đi kèm nếu cần), đọc một lần khi khởi động, chung cho mọi công ty, không phải bảng nghiệp vụ nên không cần RLS. Unit test: mỗi mẫu qua đủ kiểm tra của `skill-package`, `name` không trùng, không mẫu nào có `scripts/`, giọng văn tiếng Việt (#020). "Dùng mẫu" = tạo kỹ năng như `POST /api/skills` với nội dung mẫu; trùng `name` → `409 NAME_TAKEN` (giao diện gợi ý sửa kỹ năng đã có).

Mỗi mẫu có các mục **Khi nào dùng / Các bước / Không làm / Đầu ra**; mục "Không làm" luôn có "không tự gửi ra ngoài, chỉ soạn nháp cho người giao việc" khi kỹ năng có bước gửi.

| # | `name` | Tên hiển thị | Mô tả (`description`) | Gợi ý rủi ro | File đi kèm |
|---|---|---|---|---|---|
| 1 | `lap-bao-gia` | Lập báo giá | Tra bảng giá, áp chiết khấu theo khách, soạn báo giá theo mẫu. Dùng khi khách hoặc đại lý hỏi giá. | Trung bình | `references/bang-gia-mau.md`, `assets/bao-gia-mau.xlsx` |
| 2 | `soan-hop-dong-tu-mau` | Soạn hợp đồng từ mẫu | Điền thông tin khách vào mẫu hợp đồng, đánh dấu chỗ cần người kiểm. Dùng khi cần hợp đồng mua bán / dịch vụ theo mẫu công ty. | Thấp | `assets/hop-dong-mau.docx` |
| 3 | `tom-tat-email` | Tóm tắt email | Tóm tắt email dài, nêu việc cần làm, người phụ trách và hạn. Dùng khi được chuyển một email hoặc chuỗi email. | Trung bình | — |
| 4 | `tong-hop-bao-cao-ngay` | Tổng hợp báo cáo ngày | Gom số liệu từ bảng tính, viết báo cáo ngắn cho trưởng phòng. Dùng cuối ngày hoặc theo lịch. | Trung bình | `references/mau-bao-cao.md` |
| 5 | `tra-loi-cau-hoi-noi-bo` | Trả lời câu hỏi nội bộ | Trả lời nhân viên dựa trên tài liệu quy trình của công ty; không biết thì nói không biết. | Thấp | `references/quy-trinh-mau.md` |
| 6 | `nhac-cong-no` | Nhắc công nợ | Soạn tin nhắc thanh toán theo hạn và số tiền; việc gửi cho khách luôn cần duyệt. | Trung bình | `references/mau-tin-nhac.md` |
| 7 | `soan-bien-ban-hop` | Soạn biên bản họp | Từ ghi chú rời rạc ra biên bản có quyết định, việc giao, người phụ trách, hạn. | Thấp | — |
| 8 | `kiem-tra-don-hang` | Kiểm tra đơn hàng | So đơn đặt với tồn kho, báo dòng thiếu hàng và đề xuất hàng thay thế. | Trung bình | — |
| 9 | `viet-bai-dang-san-pham` | Viết bài đăng sản phẩm | Viết mô tả sản phẩm cho Zalo / Facebook theo giọng văn của công ty. | Thấp | `references/giong-van.md` |
| 10 | `tong-hop-cham-cong` | Tổng hợp chấm công | Gom bảng chấm công các phòng, tính giờ làm thêm, soạn bảng gửi kế toán. | Trung bình | `assets/bang-cham-cong-mau.xlsx` |

File `references/*-mau.md` có dòng đầu "Thay nội dung này bằng tài liệu của công ty bạn". File `.xlsx` / `.docx` mẫu sinh một lần bằng tay (không thêm thư viện), commit vào repo, kiểm bằng cùng luật loại file.

### D11. `packages/skills`

Package mới, không phụ thuộc DB / Fastify (dùng được ở web để kiểm khi gõ):
- `parseSkillMd(text)` → frontmatter đã kiểm + `title` + cảnh báo (D4).
- `readZip(bytes, limits)` / `writeZip(files)` (D5), `checkFile(path, bytes)` (loại file, đường dẫn), `checkPackage(files)` → danh sách kiểm tra.
- `suggestRisk(files)` (D7), `templates` (D10).
- Hằng số giới hạn (`MAX_ZIP_BYTES = 25 MiB`, `MAX_UNPACKED_BYTES = 50 MiB`, `MAX_FILES = 200`, `MAX_PATH = 200`, `MAX_DEPTH = 5`, `MAX_SKILL_MD = 200 KiB`) — chờ chốt Q5.

### D12. Nhật ký

`AuditEvent.action`: `skill.created`, `skill.created_from_template`, `skill.imported` (nguồn tạo là action riêng, không phải giá trị trong `fields`), `skill.version_created`, `skill.version_submitted`, `skill.version_approved`, `skill.version_rejected`, `skill.rolled_back`, `skill.archived`, `skill.exported`, `worker_skill.assigned`, `worker_skill.requested`, `worker_skill.approved`, `worker_skill.rejected`, `worker_skill.suspended`, `worker_skill.removed`. `target_type` = `skill` / `worker`, `target_id` = id; `fields` chỉ là tên trường (`risk`, `current_version_id`). Không ghi nội dung, tên file hay lý do từ chối (spec `audit-log`: chỉ định danh và tên trường).

## Risks / Trade-offs

- [Phần `worker-skills` cần bảng worker của change 2, mà change 2 phụ thuộc 1b đang apply] → Đề xuất apply change 3 sau change 2 (Q1). Nếu muốn apply trước, nhóm task 7–8 (giao kỹ năng) chuyển sang change 2 và change này vẫn đứng được với 1a.
- [Change lớn: thư viện + version + zip + mẫu + giao kỹ năng + 2 màn web, sát giới hạn "1–2 buổi"] → Nhóm task độc lập theo thứ tự `packages/skills` → DB → API → web; nếu quá giờ, tách nhóm 8 (web giao kỹ năng) thành change nhỏ tiếp theo mà không đổi spec.
- [DB phình vì `bytea`] → Giới hạn 50 MB / gói, blob dùng chung giữa version; theo dõi kích thước bảng; chuyển `content` ra object storage khi có (#029) mà không đổi API.
- [Zip độc (zip slip, zip bomb, symlink, tên trùng hoa thường)] → Kiểm từng mục trước khi inflate, đếm byte thật, từ chối cả gói; unit test có file zip độc tự tạo cho từng trường hợp.
- [`gray-matter` chạy frontmatter `---js`] → Chặn trước khi gọi, chỉ bật engine YAML; test riêng (D4).
- [Hai Admin duyệt hai version cùng lúc, hoặc duyệt khi đang có người gửi duyệt bản mới] → `FOR UPDATE` trên dòng `skills` cho mọi thao tác đổi trạng thái version / con trỏ; partial unique index là lớp cuối.
- [Không thư viện zip được duyệt] → Phương án tự viết trên `node:zlib` (D5 a), thêm khoảng nửa buổi.
- [Gợi ý rủi ro theo từ khoá sai nhiều] → Chỉ là gợi ý, người tạo đổi được, Owner / Admin chốt; thay bằng quét ở change 11.
- [Xung đột với 1b khi merge] → 1b cũng thêm hàng vào ma trận mục 1 và `permissions.ts` (xung đột văn bản nhỏ); change này không sửa spec `audit-log` mà 1b đang sửa; số migration lấy số kế tiếp lúc apply.

## Migration Plan

- Một migration mới (số kế tiếp sau change 2): tạo enum, 5 bảng, index, RLS, policy, quyền, trigger. Không có dữ liệu cũ cần chuyển.
- Rollback: migration xuống xoá 5 bảng và enum (chưa có dữ liệu khách ở giai đoạn này).
- Không cần biến môi trường mới.

## Open Questions

- Ngưỡng cảnh báo `SKILL.md` dài (chuẩn khuyên dưới 500 dòng / ~5000 token): đề xuất chỉ cảnh báo trong danh sách kiểm tra, không chặn; chỉnh số được lúc apply mà không đổi spec.
