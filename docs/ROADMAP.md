---
type: roadmap
product: digital-workers (tên tạm)
version: 0.1-draft
last_updated: 2026-11-27
---

# ROADMAP — MVP

> Nguồn sự thật cho **thứ tự công việc**. Mỗi change = 1 GitHub issue (nhãn `change`) theo mẫu trong quy trình OpenSpec.
> Issue lộ trình: #18.
> Đi theo dòng chảy dữ liệu: nền → worker → kỹ năng → chạy → kênh → duyệt → tự động → quản lý.
> Mỗi change xong trong 1–2 buổi. To hơn thì chia.

## Điều kiện trước khi bắt đầu

- [ ] Bước 0 kiểm chứng với 3 chủ DN xong (mock + phỏng vấn).
- [ ] Trả lời được các câu hỏi ở `docs/requirements.md` mục 0.4 có ảnh hưởng tới MVP (máy chủ, đăng nhập).
- [x] Duyệt P-01 … P-09 (2026-11-27 → 0.2 #015 – #022).
- [x] Duyệt P-10 … P-13 (2026-11-27 → 0.2 #023 – #026).
- [ ] Báo giá cloud Việt Nam (máy ảo + object storage) để chốt nhà cung cấp (#029) — cần trước change 5a.
- [ ] Kiểm tra điều khoản Anthropic / OpenAI về tính phí lại dưới dạng credit; chuẩn bị pháp nhân xuất hoá đơn.

## Tổng quan

| # | Issue | Change | Phụ thuộc | Màn hình | Trạng thái |
|---|---|---|---|---|---|
| 0 | #1 | `setup-monorepo` | — | — | ⏳ |
| 1 | #2 | `add-tenancy-and-users` | 0 | Đăng ký, phòng ban, người dùng | ⏳ |
| 2 | #3 | `add-worker-profile` | 1 | Sơ đồ nhân sự số, hồ sơ worker | ⏳ |
| 3 | #4 | `add-skill-library` | 1 | Thư viện kỹ năng | ⏳ |
| 4 | #5 | `add-llm-gateway-and-credit` | 1 | Số dư credit (đơn giản) | ⏳ |
| 5 | #6 | `add-worker-runtime-webchat` | 2, 3, 4 | Web chat | ⏳ |
| 5a | #21 | `deploy-staging` | 0 | — | ⏳ |
| 6 | #7 | `add-channel-telegram` | 5, 5a | Kết nối kênh | ⏳ |
| 7 | #8 | `add-approval-inbox` | 5, 6 | Hộp duyệt việc | ⏳ |
| 8 | #9 | `add-schedules` | 5 | Tab lịch trong hồ sơ worker | ⏳ |
| 9 | #10 | `add-connector-google-sheets` | 5 | Kết nối connector | ⏳ |
| 10 | #11 | `add-connector-email` | 9 | (dùng lại màn connector) | ⏳ |
| 11 | #12 | `add-review-and-scanner` | 2, 3, 9 | Kiểm duyệt | ⏳ |
| 12 | #13 | `add-channel-zalo-dm` | 6 | (dùng lại màn kết nối kênh) | ⏳ |
| 13 | #14 | `add-payroll-and-morning-report` | 4, 7 | Bảng lương | ⏳ |
| 14 | #15 | `add-skill-builder-vi` | 3, 5 | Trình tạo skill | ⏳ |
| 15 | #16 | `add-skill-scripts` | 5, 11 | Kiểm duyệt (xem script, chạy thử) | ⏳ |
| 16 | #17 | `add-credit-topup` | 4 | Nạp credit, sao kê, quản trị platform | ⏳ |

→ Sau change 6: **demo được** worker trả lời trên Telegram.
→ Sau change 10: **dùng thử được** với khách đầu tiên (thử việc; credit cộng tay qua change 4).
→ Sau change 16: **MVP đủ**.

---

## 0. `setup-monorepo`

**Mục tiêu:** khung pnpm workspaces, lint, typecheck, test, CI chạy trên máy, Docker Compose (postgres, caddy).

```text
/opsx:propose setup-monorepo

Dựng khung monorepo theo docs/architecture.md mục 3 và CLAUDE.md (Stack, Cấu trúc thư mục, Lệnh).

Đọc trước:
- docs/architecture.md mục 3, 8, 9
- CLAUDE.md

Design.md cần chốt rõ:
1. Cấu trúc thư mục apps/ và packages/, tsconfig dùng chung.
2. Docker Compose cho dev: postgres 16, (caddy để sau).
3. Lệnh pnpm: dev, lint, typecheck, test, test:int, e2e, ci:runner.
4. apps/api dùng Fastify (0.2 #014): cấu trúc plugin, cách validate bằng Zod.
5. Docker Compose cho prod trên cloud Việt Nam (0.2 #011): so sánh ngắn 2–3 nhà cung cấp, đề xuất một.

Test bắt buộc:
- Một test mẫu ở mỗi package chạy được.
- apps/api có route /health trả 200.

Quyết định cần chốt: nêu trong mô tả PR. Khi tôi trả lời, ghi vào docs/requirements.md 0.2 trong chính PR này.

Tạo nhánh setup-monorepo, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 1. `add-tenancy-and-users`

**Mục tiêu:** công ty, phòng ban, người dùng, vai trò, đăng nhập, RLS (FR-01, mục 1, NFR-01).

```text
/opsx:propose add-tenancy-and-users

Thêm công ty (tenant), phòng ban, người dùng, 4 vai trò và đăng nhập web, theo FR-01 và mục 1 (ma trận quyền).

Đọc trước:
- docs/requirements.md 0.2, 0.4, mục 1, 2, FR-01, NFR-01
- docs/design/screens/signup.html, departments.html, users.html
- docs/architecture.md mục 7
- CLAUDE.md mục "Dữ liệu nhiều công ty"

Design.md cần chốt rõ:
1. Schema Company, Department, User; RLS và helper đặt app.company_id.
2. Ma trận quyền nằm ở packages/core, kiểm tra ở API.
3. Đăng nhập Better Auth: email + mật khẩu và Google (0.2 #012).
4. Luồng mời người dùng.

Test bắt buộc:
- Người công ty A không đọc/sửa được dữ liệu công ty B (API + truy vấn thô bị RLS chặn).
- Member không tạo được phòng ban.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi câu trả lời vào 0.2 trong chính PR này.

Tạo nhánh add-tenancy-and-users, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 2. `add-worker-profile`

**Mục tiêu:** hồ sơ worker + vòng đời 5 trạng thái (FR-02, trừ FR-02-04 phần kiểm duyệt → change 11; FR-02-07 tạo từ mẫu).

```text
/opsx:propose add-worker-profile

Thêm hồ sơ digital worker và vòng đời Nháp → Thử việc → Chính thức ⇄ Tạm nghỉ → Nghỉ việc, theo FR-02.
Ở change này, "Chính thức hoá" chỉ cần Admin/Owner bấm duyệt; kiểm duyệt đầy đủ làm ở change 11.

Đọc trước:
- docs/requirements.md 0.2 #002 #006, mục 1, 2, FR-02
- docs/design/screens/org-chart.html, worker-profile.html
- packages/core (ma trận quyền)

Design.md cần chốt rõ:
1. Máy trạng thái worker: ai được chuyển trạng thái nào (theo ma trận quyền).
2. Trường hồ sơ, ngân sách tháng (VNĐ), người quản lý.
3. 3 mẫu worker có sẵn: trợ lý báo giá, trợ lý CSKH nội bộ, trợ lý tổng hợp báo cáo.

Test bắt buộc:
- Chuyển trạng thái hợp lệ / không hợp lệ.
- Manager không thao tác được worker phòng khác.
- Nghỉ việc không quay lại được.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-worker-profile, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 3. `add-skill-library`

**Mục tiêu:** skill theo `SKILL.md`, version, giao skill cho worker, nhập/xuất zip, 10 skill mẫu (FR-03).

```text
/opsx:propose add-skill-library

Thêm thư viện kỹ năng của công ty theo chuẩn Agent Skills (SKILL.md), có version, giao skill cho worker, theo FR-03.

Đọc trước:
- docs/requirements.md 0.2 #007 #015, FR-03
- docs/design/screens/skill-library.html
- https://agentskills.io (đặc tả SKILL.md)

Design.md cần chốt rõ:
1. Lưu skill: DB hay file + DB; cấu trúc SkillVersion.
2. Quy tắc đổi version cho worker đang dùng (FR-03-02).
3. Kiểm tra định dạng khi nhập zip; skill có scripts/ được nhận nhưng gắn rủi ro cao, chưa chạy được cho tới change 15 (#015).
4. Nội dung 10 skill mẫu tiếng Việt (liệt kê tên + mô tả).

Test bắt buộc:
- Sửa skill tạo version mới; worker vẫn dùng version cũ tới khi duyệt.
- Nhập zip sai định dạng bị từ chối với lý do rõ.
- Skill có scripts/ được gắn rủi ro cao và không giao được cho worker chính thức khi chưa qua kiểm duyệt.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-skill-library, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 4. `add-llm-gateway-and-credit`

**Mục tiêu:** gọi mô hình qua một cửa bằng API key của platform, ghi `CostEntry`, sổ credit của công ty, trừ credit, ngân sách worker, cộng credit tay (FR-04-05, FR-10-01, FR-10-03, FR-13-01, FR-13-02, FR-13-04, FR-13-07 phần điều chỉnh tay, NFR-02).

```text
/opsx:propose add-llm-gateway-and-credit

Thêm packages/llm, packages/billing, packages/crypto: gọi mô hình Anthropic/OpenAI qua một cửa bằng API key của platform (mã hoá),
tính chi phí mỗi lần gọi, trừ credit của công ty theo hệ số giá, kiểm tra ngân sách worker và số dư công ty,
cho platform admin cộng / trừ credit tay có ghi lý do. Nạp tiền VietQR làm ở change 16.

Đọc trước:
- docs/requirements.md 0.2 #016 #018 #025 #026, FR-04-05, FR-10-01, FR-10-03, FR-13, NFR-02, NFR-09
- docs/architecture.md mục 6 (Credit), 7
- CLAUDE.md mục "Bí mật", "Chi phí"

Design.md cần chốt rõ:
1. Bảng giá mô hình trong DB (đơn vị, ngày hiệu lực), tỉ giá, hệ số giá.
2. Sổ credit: CreditAccount, CreditTransaction chỉ thêm, số dư cập nhật trong cùng transaction; tiền là số nguyên VNĐ.
3. Kiểm tra số dư trước mỗi bước; hết số dư / hết ngân sách worker (#018, FR-13-04).
4. Vai trò platform admin (ngoài 4 vai trò của công ty) và cách bảo vệ.
5. Mô hình giả cho test.

Test bắt buộc:
- API key không bao giờ xuất hiện trong response/log.
- CostEntry và CreditTransaction đúng với số token giả lập × hệ số.
- Hai lần trừ đồng thời không làm số dư sai (khoá / transaction).
- Số dư bằng 0 → từ chối gọi mới.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-llm-gateway-and-credit, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 5. `add-worker-runtime-webchat`

**Mục tiêu:** `Task`, hàng đợi, vòng lặp mô hình ⇄ tool, `load_skill`, giới hạn, web chat (FR-04, kênh web của FR-05).

```text
/opsx:propose add-worker-runtime-webchat

Thêm apps/runner và worker runtime: nhận Task từ web chat, nạp skill theo cách tiết lộ dần, vòng lặp mô hình ⇄ tool
có giới hạn bước/thời gian/chi phí, trả lời về web chat. Worker ở Thử việc chỉ chạy qua web chat.

Đọc trước:
- docs/requirements.md 0.2 #009 #010, FR-02-03, FR-04, FR-05-01, FR-05-07
- docs/architecture.md mục 4, 5
- docs/design/screens/web-chat.html

Design.md cần chốt rõ:
1. Trạng thái Task và hàng đợi pg-boss (chống chạy trùng).
2. Giao diện ChannelAdapter (dùng chung cho change 6, 12).
3. Prompt hệ thống: hồ sơ worker, danh sách skill, bọc <data>.
4. Gom tin nhắn ngắn liên tiếp (FR-04-07).

Test bắt buộc (dùng mô hình giả):
- load_skill trả đúng version đang dùng.
- Vượt số bước / chi phí → dừng và báo.
- Worker Tạm nghỉ không nhận Task.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-worker-runtime-webchat, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 5a. `deploy-staging`

**Mục tiêu:** staging trên cloud Việt Nam: máy ảo, tên miền, HTTPS, sao lưu PostgreSQL ra object storage trong nước (0.2 #011, #029, #031). Làm trước change 6 vì webhook Telegram cần HTTPS công khai. Làm song song được với change 1–5.

```text
/opsx:propose deploy-staging

Đưa staging lên cloud Việt Nam: thuê máy ảo, gắn tên miền, HTTPS qua Caddy, chạy compose.prod.yaml,
sao lưu PostgreSQL hằng ngày ra object storage ở Việt Nam (giữ 14 bản), có cách khôi phục đã thử.

Đọc trước:
- docs/requirements.md 0.2 #011 #019 #027 #029 #030 #031, NFR-04, NFR-10
- docs/architecture.md mục 8
- compose.prod.yaml, Caddyfile, Dockerfile (từ change 0)

Design.md cần chốt rõ:
1. Nhà cung cấp và kích thước máy theo báo giá (#029); ghi quyết định cloud chính thức vào 0.2.
2. Cách đưa bản mới lên máy (build ảnh ở đâu, kéo về thế nào, chạy migration) và cách quay lại bản cũ.
3. Bí mật trên máy chủ (file .env quyền 600, ai giữ khoá ENCRYPTION_KEY) — không commit.
4. Sao lưu: lịch, mã hoá, giữ 14 bản, thử khôi phục.
5. Tường lửa: chỉ mở 80/443 (và SSH giới hạn IP).

Test bắt buộc:
- https://<staging>/health/ready trả 200 với chứng chỉ hợp lệ.
- Khôi phục bản sao lưu mới nhất vào DB trống chạy được.
- Cổng PostgreSQL không truy cập được từ ngoài.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh deploy-staging, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 6. `add-channel-telegram`

**Mục tiêu:** adapter Telegram 1:1 + nhóm, ghép tài khoản, nhóm phải đăng ký, mention (FR-05).

```text
/opsx:propose add-channel-telegram

Thêm adapter Telegram (1:1 + nhóm) cho worker: gắn bot token cho worker, ghép tài khoản người dùng bằng mã,
đăng ký nhóm được vào, chỉ phản hồi khi được mention, gửi riêng khi dữ liệu không dành cho cả nhóm.

Đọc trước:
- docs/requirements.md 0.2 #005 #008 #009 #013 #014, 0.2 #017 #022, FR-05
- docs/architecture.md mục 5 (Nhiều bot), 11
- docs/design/screens/channel-connect.html

Design.md cần chốt rõ:
1. ChannelAdapter + adapter Telegram bằng grammY (0.2 #014); webhook /webhooks/telegram/{workerChannelId} + secret_token riêng.
2. Mỗi worker một bot (0.2 #013): luồng Admin dán token → kiểm tra token → đặt webhook; giới hạn số bot cần lưu ý.
3. Luồng mã ghép tài khoản.
4. Cách quyết định "dữ liệu không dành cho cả nhóm" (#017).

Test bắt buộc (adapter giả):
- Người chưa ghép → chỉ nhận hướng dẫn, không có Task.
- Bot bị thêm vào nhóm chưa đăng ký → báo Admin, không xử lý.
- Trong nhóm, không mention → không phản hồi.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-channel-telegram, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 7. `add-approval-inbox`

**Mục tiêu:** quy tắc duyệt, `Approval`, duyệt trong chat và trên web, hạn duyệt (FR-08).

```text
/opsx:propose add-approval-inbox

Thêm quy tắc duyệt cho worker, tạo Approval khi worker định làm hành động rủi ro, duyệt bằng nút trong Telegram/web chat
và trên hộp duyệt web, nhắc và hủy khi quá hạn.

Đọc trước:
- docs/requirements.md 0.2 #010, FR-04-04, FR-08
- docs/design/screens/approval-inbox.html, worker-profile.html (tab quy tắc duyệt)

Design.md cần chốt rõ:
1. Cách khai báo quy tắc (hành động + điều kiện + người duyệt) đủ đơn giản cho trưởng phòng.
2. Worker ở Thử việc: mọi hành động đều cần duyệt.
3. Nhắc / hủy quá hạn (24h / 72h).

Test bắt buộc:
- Hành động có quy tắc không chạy trước khi duyệt.
- Người không có quyền bấm duyệt → bị từ chối.
- Quá 72 giờ → Task bị hủy, người giao việc được báo.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-approval-inbox, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 8. `add-schedules`

**Mục tiêu:** lịch chạy theo giờ Việt Nam (FR-06).

```text
/opsx:propose add-schedules

Thêm lịch chạy cho worker (giờ/ngày/thứ, giờ Việt Nam), mỗi lịch kèm chỉ dẫn, tạo Task đúng giờ, báo lỗi cho người quản lý.

Đọc trước:
- docs/requirements.md FR-06, FR-02-05
- docs/design/screens/worker-profile.html (tab lịch)

Design.md cần chốt rõ:
1. Biểu diễn lịch (cron hay form đơn giản) và múi giờ.
2. Worker Tạm nghỉ / hết ngân sách thì lịch xử lý thế nào.
3. Kết quả lịch gửi về đâu (nhóm / người quản lý).

Test bắt buộc:
- Lịch tạo Task đúng giờ (đồng hồ giả).
- Worker Tạm nghỉ → lịch không chạy.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-schedules, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 9. `add-connector-google-sheets`

**Mục tiêu:** giao diện connector kiểu MCP + Google Sheets, `WorkerGrant` read/draft/write (FR-07).

```text
/opsx:propose add-connector-google-sheets

Thêm khung connector (giao diện kiểu MCP tool, cắm thêm được) và connector Google Sheets, cấp quyền cho worker theo từng file
với mức read / draft / write; kiểm tra quyền trong code trước mỗi lần gọi.

Đọc trước:
- docs/requirements.md 0.2 #007 #010, FR-04-03, FR-07
- docs/architecture.md mục 3, 10 (hệ thống plugin của KnotSync)
- docs/design/screens/connectors.html

Design.md cần chốt rõ:
1. Giao diện Connector / Tool; cách đăng ký connector mới.
2. Xác thực Google: service account hay OAuth của công ty.
3. "draft" nghĩa là gì với Sheets (vd. ghi vào sheet nháp).
4. Nội dung ô Sheets bọc <data>.

Test bắt buộc:
- Worker chỉ có read mà ghi → bị chặn, Task ghi lỗi quyền.
- Thông tin xác thực không trả ra API.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-connector-google-sheets, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 10. `add-connector-email`

**Mục tiêu:** đọc thư theo bộ lọc, tạo nháp, gửi (rủi ro cao) (FR-07-02).

```text
/opsx:propose add-connector-email

Thêm connector email (IMAP/SMTP; Gmail nếu đơn giản): đọc thư theo bộ lọc, tạo thư nháp, gửi thư.
Gửi thư ra ngoài luôn là rủi ro cao, bắt buộc có quy tắc duyệt.

Đọc trước:
- docs/requirements.md 0.2 #010, FR-07, FR-08
- packages/connectors (khung từ change 9)

Design.md cần chốt rõ:
1. IMAP/SMTP hay Gmail API cho MVP.
2. Bộ lọc thư worker được đọc (hộp thư, nhãn, người gửi).
3. Nội dung thư bọc <data>; tệp đính kèm xử lý thế nào.

Test bắt buộc:
- Worker không có write mà gửi → bị chặn.
- Gửi thư luôn tạo Approval.
- Thư chứa câu lệnh lừa AI không làm worker gửi thư.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-connector-email, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 11. `add-review-and-scanner`

**Mục tiêu:** kiểm duyệt đầy đủ: quét, kiểm tra quyền thừa, mức rủi ro, theo dõi sau chính thức (FR-09, FR-02-04).

```text
/opsx:propose add-review-and-scanner

Thêm kiểm duyệt cho worker và skill: quét tự động (prompt injection, ký tự ẩn, URL lạ, lộ bí mật, file chạy được),
kiểm tra quyền thừa, phân mức rủi ro, Admin duyệt/từ chối, cảnh báo sau chính thức. Thay luồng duyệt đơn giản ở change 2.

Đọc trước:
- docs/requirements.md 0.2 #006, FR-02-04, FR-09
- docs/architecture.md mục 10 (guard-rule, pii-rule của KnotSync)
- docs/design/screens/review.html

Design.md cần chốt rõ:
1. Danh sách quy tắc quét ban đầu và cách thêm quy tắc.
2. Cách so "quyền xin" với "mô tả công việc" (quy tắc hay hỏi mô hình).
3. Mức rủi ro và việc chặn "duyệt nhanh" cho mức cao.
4. Ngưỡng cảnh báo sau chính thức.

Test bắt buộc:
- Skill chứa câu lệnh lừa AI / ký tự zero-width bị gắn cờ.
- Worker rủi ro cao không có nút duyệt nhanh.
- Thêm skill cho worker chính thức → tạo Review mới.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-review-and-scanner, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 12. `add-channel-zalo-dm`

**Mục tiêu:** adapter Zalo Bot 1:1 (FR-05-02).

```text
/opsx:propose add-channel-zalo-dm

Thêm adapter Zalo Bot Platform cho chat 1:1, dùng lại ChannelAdapter, ghép tài khoản và nút duyệt như Telegram.
Nhóm Zalo để v0.2.

Đọc trước:
- docs/requirements.md 0.2 #005 #008, FR-05
- packages/channels (adapter Telegram từ change 6)
- Tài liệu Zalo Bot Platform (bot.zaloplatforms.com)

Design.md cần chốt rõ:
1. Client Zalo riêng bằng fetch (0.2 #014); webhook /webhooks/zalo/{workerChannelId}, kiểm tra X-Bot-Api-Secret-Token bằng so sánh thời gian hằng.
2. Giới hạn 2000 ký tự / tin: cách chia.
3. Duyệt trên Zalo theo #021 (mã ngắn hoặc link web) — thử thực tế API trước khi chốt.

Test bắt buộc (adapter giả):
- Webhook sai bí mật bị từ chối.
- Tin dài được chia đúng.
- Tin từ nhóm bị bỏ qua (MVP chỉ 1:1).

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-channel-zalo-dm, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 13. `add-payroll-and-morning-report`

**Mục tiêu:** bảng lương, cảnh báo 80%, giờ công tiết kiệm (ước tính), báo cáo sáng qua chat (FR-10, FR-11).

```text
/opsx:propose add-payroll-and-morning-report

Thêm bảng lương nhân viên số (chi phí theo worker/phòng ban/tháng, số việc, tỉ lệ phải duyệt, giờ công tiết kiệm ước tính),
cảnh báo 80% ngân sách, và báo cáo sáng gửi Owner/Manager qua app chat (có nút duyệt).

Đọc trước:
- docs/requirements.md FR-10, FR-11
- docs/design/screens/payroll.html

Design.md cần chốt rõ:
1. Cách gom số liệu (truy vấn trực tiếp hay bảng tổng hợp).
2. Người quản lý nhập "thời gian ước tính mỗi loại việc" ở đâu.
3. Nội dung và giờ gửi báo cáo sáng.

Test bắt buộc:
- Tổng chi phí khớp CostEntry.
- Manager chỉ thấy phòng mình.
- Báo cáo sáng không lộ dữ liệu phòng khác cho Manager.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-payroll-and-morning-report, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 14. `add-skill-builder-vi`

**Mục tiêu:** kể quy trình bằng tiếng Việt → `SKILL.md` nháp → chạy thử (FR-12).

```text
/opsx:propose add-skill-builder-vi

Thêm trình tạo skill: người dùng kể quy trình bằng tiếng Việt, AI hỏi lại chỗ thiếu, sinh SKILL.md nháp,
cho chạy thử trên web chat với dữ liệu giả trước khi gửi kiểm duyệt.

Đọc trước:
- docs/requirements.md FR-03, FR-12
- packages/skills, apps/runner
- docs/design/screens/skill-builder.html

Design.md cần chốt rõ:
1. Luồng hỏi lại (tối đa mấy câu) và mẫu SKILL.md đầu ra.
2. Dữ liệu giả cho chạy thử lấy từ đâu.
3. Chi phí của trình tạo skill tính vào đâu.

Test bắt buộc (mô hình giả):
- Đầu ra luôn là SKILL.md hợp lệ.
- Skill tạo ra ở trạng thái nháp, chưa giao được cho worker chính thức.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-skill-builder-vi, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 15. `add-skill-scripts`

**Mục tiêu:** chạy script của skill trong sandbox code execution của nhà cung cấp; kiểm duyệt script (FR-14, FR-09-02b).

```text
/opsx:propose add-skill-scripts

Cho skill có scripts/ chạy được: gửi skill + file đầu vào tới code execution của nhà cung cấp mô hình (không có mạng),
nhận file kết quả, ghi SkillRun + CostEntry, giới hạn thời gian / dung lượng. Màn kiểm duyệt hiển thị nội dung script
và cho chạy thử với file giả trước khi duyệt.

Đọc trước:
- docs/requirements.md 0.2 #015 #024, FR-03-06, FR-09-02, FR-09-02b, FR-14
- docs/architecture.md mục 6 (Chạy script của skill), 12
- Tài liệu code execution + Skills API của Anthropic; công cụ tương đương của OpenAI

Design.md cần chốt rõ:
1. Gọi code execution của từng nhà cung cấp: cách tải skill lên, giới hạn, cách tính phí.
2. File nào được gửi vào sandbox (chỉ dữ liệu worker có quyền đọc).
3. Quy tắc quét script bổ sung (lệnh nguy hiểm, cố truy cập mạng, đọc biến môi trường).
4. Hành vi khi quá thời gian / quá dung lượng.

Test bắt buộc (sandbox giả):
- Skill có script chưa qua kiểm duyệt không chạy được ở worker chính thức.
- Quá thời gian → dừng, Task ghi lỗi, chỉ trừ credit phần đã dùng.
- Worker Thử việc chỉ chạy script với dữ liệu giả.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-skill-scripts, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

## 16. `add-credit-topup`

**Mục tiêu:** nạp credit bằng VietQR, xác nhận trên màn quản trị platform, biên nhận, sao kê, ghi số hoá đơn (FR-13-03, FR-13-05, FR-13-06, FR-13-07).

```text
/opsx:propose add-credit-topup

Thêm luồng nạp credit: Owner chọn số tiền → hệ thống tạo TopUp với nội dung chuyển khoản duy nhất và mã VietQR →
platform admin xác nhận (hoặc huỷ) trên màn quản trị → cộng credit một lần duy nhất → gửi biên nhận qua email / chat.
Owner xem lịch sử, tải sao kê tháng. Ghi số hoá đơn điện tử (xuất bên ngoài) vào TopUp.

Đọc trước:
- docs/requirements.md 0.2 #016 #023 #025 #026, FR-13
- packages/billing (từ change 4)
- docs/design/screens/credit.html, platform-admin.html

Design.md cần chốt rõ:
1. Định dạng nội dung chuyển khoản và cách sinh VietQR (chuẩn NAPAS, không cần thư viện ngoài nếu được).
2. Trạng thái TopUp và chống cộng hai lần.
3. Nội dung biên nhận và sao kê.
4. Đường lên cổng thanh toán tự động sau MVP (giao diện để thay thế xác nhận tay).

Test bắt buộc:
- Xác nhận một TopUp hai lần → credit chỉ cộng một lần.
- Owner công ty A không thấy TopUp của công ty B.
- Manager / Member không vào được màn nạp tiền.

Quyết định cần chốt: nêu trong mô tả PR propose; ghi vào 0.2 trong chính PR này.

Tạo nhánh add-credit-topup, commit, mở PR (Refs #<issue>). Chưa code.
Dừng lại sau khi propose để tôi duyệt.
```

