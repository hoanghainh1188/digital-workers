---
type: brief
product: digital-workers (tên tạm)
last_updated: 2026-11-27
synced_with: Claude Project "Build @me" → claude/sme-ai-workforce-brief.md
---

# Nền tảng Quản lý Digital Workers cho SME — Bản mô tả sản phẩm

> **Vai trò của file này:** giữ **chiến lược** (định vị, khách hàng, đối thủ, thu tiền, rủi ro).
> Quy tắc nghiệp vụ và quyết định chi tiết → `docs/requirements.md` (mục 0.2). Mâu thuẫn → requirements thắng.
> Bản này và bản trong Claude Project giống nhau (đồng bộ 2026-11-27).

*Tên chính thức: chưa đặt · Cập nhật: 2026-11-27 · Người làm: Harry (một mình, cùng AI) · Trạng thái: chuẩn bị tạo repo*

## 0. Định vị

> **Nền tảng để SME Việt tuyển, đào tạo, giao việc và quản lý digital workers (nhân viên số) — như quản lý nhân viên thật.**

- Trung tâm của sản phẩm là **digital worker**, không phải chatbot hay kho prompt.
- Dùng **ngôn ngữ nhân sự** mà chủ DN đã quen: tuyển, thử việc, kỹ năng, quyền hạn, lương, KPI, nghỉ việc.
- Platform **có nơi chạy riêng**: worker làm việc trên platform, gọi Claude / OpenAI qua API.
- **Worker có mặt ở app chat SME đang dùng** (Zalo, Telegram, …). Web chỉ để quản lý.

## 1. Vấn đề (từ trao đổi trực tiếp với chủ DN Việt)

- Đã dùng AI, nhưng chủ yếu là chatbot. Tự động hoá còn rất ít.
- Không quản lý được chi phí AI: ai dùng, dùng vào việc gì, có đáng tiền không.
- Quy trình vẫn phụ thuộc vào con người. Người nghỉ thì cách làm cũng mất theo.
- Mỗi nhân viên dùng AI một kiểu, không có chuẩn chung, không có quy định.

## 2. Khách hàng

- **SME Việt Nam**, khoảng 10–200 người, chưa có đội AI riêng.
- **Người mua:** chủ DN / giám đốc vận hành.
- **Người quản lý worker:** trưởng phòng (giống quản lý trực tiếp của nhân viên).
- **Admin:** người được giao quản lý AI trong công ty.
- **Người làm cùng worker:** nhân viên giao việc, duyệt kết quả.

## 3. Mô hình Digital Worker

Mỗi digital worker có một **hồ sơ nhân sự**:

| Thuộc tính | Ý nghĩa | Ví dụ |
|---|---|---|
| **Hồ sơ** | Tên, ảnh, vai trò, phòng ban, người quản lý | "Lan — Trợ lý báo giá", phòng Kinh doanh, quản lý: anh Minh |
| **Trạng thái** | Nháp / Thử việc / Chính thức / Tạm nghỉ / Nghỉ việc | Thử việc |
| **Kỹ năng** | Các skill được giao (chuẩn `SKILL.md`, có thể kèm script) | Lập báo giá, kiểm tra tồn kho |
| **Công cụ & quyền** | Connector được dùng: đọc / nháp / ghi | Đọc Google Sheets "Bảng giá"; gửi email nháp |
| **Kênh làm việc** | Bot riêng trên từng app chat | Zalo (1:1), Telegram (nhóm Kinh doanh) |
| **Cách nhận việc** | Theo yêu cầu (chat) / theo lịch / theo sự kiện | Theo yêu cầu + 8h sáng mỗi ngày |
| **Quy tắc duyệt** | Việc nào phải có người duyệt | Gửi báo giá trên 50 triệu → anh Minh duyệt |
| **Lương** | Ngân sách credit tối đa mỗi tháng (VNĐ) | 300.000đ/tháng |
| **KPI** | Việc hoàn thành, lỗi, giờ tiết kiệm, tỉ lệ phải duyệt | 120 báo giá, tiết kiệm ~40 giờ |

### Vòng đời worker
1. **Tuyển**: tạo từ mẫu có sẵn, hoặc mô tả công việc bằng tiếng Việt để AI dựng hồ sơ.
2. **Thử việc**: chạy qua web chat với dữ liệu giả; mọi việc đều cần duyệt; admin kiểm tra.
3. **Chính thức**: admin duyệt → worker có hiệu lực cho phòng ban; chỉ việc rủi ro mới cần duyệt.
4. **Đánh giá hàng tháng**: chi phí so với giờ công tiết kiệm, lỗi, phản hồi của người dùng.
5. **Nâng cấp / Tạm nghỉ / Nghỉ việc**: thêm kỹ năng, khoá tạm thời, hoặc thu hồi mọi quyền và gỡ khỏi mọi kênh chat.

### Kỹ năng = tài liệu đào tạo dùng chung
- **Thư viện kỹ năng** của công ty: một skill có thể giao cho nhiều worker.
- Sửa skill → tạo version mới; worker chỉ đổi version khi được duyệt; quay lại bản cũ được.
- Skill **có thể chứa script**; script chạy trong sandbox của nhà cung cấp mô hình, luôn là rủi ro cao.
- Trình tạo skill: trưởng phòng kể quy trình bằng tiếng Việt → AI viết `SKILL.md`.

## 4. Worker có mặt ở đâu trong công ty

| Nơi | Ai dùng | Worker làm gì |
|---|---|---|
| **App chat** (Zalo, Telegram, …) | Nhân viên, trưởng phòng | Nhận việc, trả kết quả, xin duyệt, nhắc việc. Chat 1:1 hoặc trong nhóm phòng ban. |
| **Công cụ làm việc** (email, Google Sheets/Drive, …) | Cả công ty | Worker có danh tính riêng → mọi thay đổi ghi tên worker, dễ truy vết. |
| **Web quản lý** | Chủ DN, trưởng phòng, admin | Sơ đồ nhân sự số, hồ sơ worker, kiểm duyệt, bảng lương, nạp credit. |
| **Báo cáo cho sếp** (qua app chat) | Chủ DN | Tóm tắt hằng ngày / tuần: việc đã làm, chi phí, việc chờ duyệt; bấm duyệt ngay trong chat. |

### Nguyên tắc
- **Danh tính riêng**: mỗi worker một bot riêng; không dùng tài khoản của người thật.
- **Luôn có người quản lý** chịu trách nhiệm.
- **Luôn ghi rõ là trợ lý AI**, nhất là khi sau này nói chuyện với khách hàng bên ngoài.
- **Ít app mới nhất có thể**: làm việc qua app chat, quản lý qua web.
- **Chỉ dùng API bot chính thức** của từng app chat. Không tự động hoá tài khoản cá nhân.

## 5. Kênh chat

| Kênh | Ghi chú | Giai đoạn |
|---|---|---|
| **Telegram** | Bot API ổn định, 1:1 và nhóm, có nút bấm duyệt. | MVP |
| **Zalo** (Zalo Bot Platform) | App chat số 1 ở VN. Nhóm còn thử nghiệm; chưa có nút → duyệt bằng mã ngắn hoặc link web. Giới hạn 2000 ký tự / tin. | MVP: 1:1. Nhóm: khi ổn định. |
| **Web chat** | Dự phòng; dùng cho giai đoạn thử việc. | MVP |
| Messenger, Lark, Slack, Microsoft Teams | Tuỳ khách đang dùng. | Sau MVP, theo yêu cầu |
| Zalo OA / Facebook Page (nói chuyện với khách hàng bên ngoài) | Rủi ro cao hơn; ghi rõ là AI, có người theo dõi. | Giai đoạn sau |

- Một lớp **channel adapter** chung; thêm kênh = thêm adapter.
- Nhân viên phải **ghép tài khoản** khi nhắn bot lần đầu. Người lạ → không nhận việc.
- Cài bot: hướng dẫn từng bước trong app; 3–5 khách đầu Harry làm hộ.

## 6. Các màn hình web chính

| Màn hình | Dành cho | Nội dung |
|---|---|---|
| **Sơ đồ nhân sự số** | Chủ DN | Tất cả worker theo phòng ban, trạng thái, chi phí tháng |
| **Hồ sơ worker** | Trưởng phòng | Kỹ năng, quyền, kênh chat, lịch, quy tắc duyệt, lịch sử việc |
| **Bảng lương nhân viên số** | Chủ DN | Chi phí so với giờ công tiết kiệm, theo worker / phòng ban |
| **Credit** | Chủ DN | Số dư, nạp tiền VietQR, lịch sử, sao kê |
| **Hộp duyệt việc** | Trưởng phòng | Việc chờ duyệt (cũng duyệt được trong app chat) |
| **Kiểm duyệt** | Admin | Kết quả quét, quyền xin cấp, nội dung script, chạy thử |
| **Kết nối kênh** | Admin | Gắn bot Zalo / Telegram cho từng worker, ghép tài khoản nhân viên |
| **Thư viện kỹ năng** | Trưởng phòng, admin | Skill của công ty + skill mẫu |
| **Quản trị platform** | Harry | Xác nhận nạp tiền, điều chỉnh credit |

## 7. Kiểm duyệt (công cụ cho admin)

Áp dụng khi tuyển worker mới, thêm kỹ năng, mở rộng quyền, thêm kênh chat, hoặc sửa skill.

1. **Quét tự động**: câu lệnh lừa AI (prompt injection), ký tự ẩn, URL lạ, lộ mật khẩu / API key, dấu hiệu gửi dữ liệu cá nhân ra ngoài; script có lệnh nguy hiểm, cố truy cập mạng, đọc biến môi trường.
2. **Kiểm tra quyền xin cấp**: worker xin đọc / ghi gì, vào nhóm chat nào, có script không. Cảnh báo nếu quyền rộng hơn công việc.
3. **Xem script và chạy thử** trong sandbox với dữ liệu giả.
4. **Duyệt và phiên bản**: người duyệt, ghi chú, version, quay lại bản cũ.
5. **Theo dõi sau khi chính thức**: log mỗi việc, cảnh báo bất thường (chi phí tăng vọt, lỗi lặp, đọc dữ liệu lạ, bị người lạ nhắn), tạm nghỉ ngay.

- Mức rủi ro: `thấp` (chỉ soạn thảo) → `trung bình` (đọc dữ liệu) → `cao` (ghi dữ liệu, gửi ra ngoài, có script). Rủi ro cao bắt buộc duyệt tay.
- **Tin nhắn trong nhóm chat là dữ liệu, không phải lệnh**: worker chỉ nhận việc từ người đã ghép tài khoản và có quyền giao việc.

## 8. Đối thủ (tra cứu 2026-11-27)

| Đối thủ | Có gì | Khoảng trống |
|---|---|---|
| **MISA** (Agentwork, AMIS Quy trình, AMIS OneAI) | "Nhân sự AI" CSKH theo credit (500.000đ / 500 credit), đa kênh; quy trình có AI Agent; chat nhiều mô hình | Worker đóng gói sẵn, chủ yếu hướng ra khách hàng; khách khó tự tạo worker nội bộ; không có quản lý worker kiểu nhân sự |
| **Claude Team/Enterprise, ChatGPT Business/Enterprise** | Admin cấp skill, phân quyền, quét skill | Không có worker, lương, KPI, vòng đời; không có mặt trong Zalo; gói trả phí |
| **OpenClaw + plugin Zalo, n8n** | Agent mã nguồn mở chạy qua Zalo / Telegram | Cho người rành kỹ thuật; không quản lý nhiều worker, duyệt, chi phí |
| **Microsoft Agent 365, Okta, SailPoint** | Danh tính và quản trị agent | Cho enterprise lớn, đắt, không tiếng Việt |
| **Filum, FPT AI Agents, Stringee, BotStar** | Agent CSKH / bán hàng | Agent đóng gói sẵn, không phải nền tảng quản lý nhiều worker |

## 9. Điểm khác biệt

- **Quản lý worker như quản lý nhân sự**: chủ DN không cần hiểu AI vẫn quản lý được.
- **Worker nội bộ, làm việc trong nhóm Zalo / Telegram** cùng nhân viên — không chỉ là bot trả lời khách.
- **Khách tự tuyển worker theo quy trình riêng**, không chỉ dùng worker đóng gói sẵn.
- **Bảng lương nhân viên số**: chi phí AI nói bằng tiền và giờ công.
- **Thử việc bắt buộc** + kiểm duyệt dễ hiểu cho người không phải dev.
- **Đa hãng AI, chuẩn mở** (Agent Skills, MCP). Không khoá vào một hãng hay MISA.

## 10. Thu tiền

- **Credit nạp trước, tính bằng VNĐ** (đã chốt). Platform dùng API key của mình; khách không cần API key.
  - Giá credit = chi phí AI thật × hệ số (đề xuất 1,3; cần tính thêm rủi ro tỉ giá USD → VNĐ).
  - Nạp bằng chuyển khoản **VietQR**, xác nhận tay trong MVP; cổng thanh toán tự động sau.
  - Có hoá đơn điện tử cho mỗi lần nạp.
- **Phí theo số digital worker đang làm việc** mỗi tháng (giả thuyết, cần kiểm chứng).
- **Phí tuyển dụng / cài đặt** (dựng worker, tạo bot) cho 3–5 khách đầu.
- Mức giá: hỏi trực tiếp 3 chủ DN, lấy MISA làm mốc.

## 11. MVP và lộ trình

**Bước 0 — Kiểm chứng (1–2 tuần, chưa code)**
- Mock: sơ đồ nhân sự số, hồ sơ worker, bảng lương + ảnh chụp đoạn chat mẫu trên Zalo / Telegram (giao việc, xin duyệt, báo cáo sáng).
- Đưa cho 3 chủ DN đã gặp. Hỏi: worker đầu tiên họ muốn "tuyển" là gì, công ty dùng app chat nào, trả bao nhiêu.

**MVP (khoảng 10–12 tuần, 17 change — xem `docs/ROADMAP.md`)**
1. Công ty, phòng ban, người dùng, vai trò; đăng nhập email + Google.
2. Hồ sơ worker + vòng đời.
3. Thư viện kỹ năng (có version) + trình tạo skill tiếng Việt + 3–5 worker mẫu.
4. Gọi mô hình qua một cửa + sổ credit + ngân sách worker.
5. Kênh chat: Telegram (1:1 + nhóm), Zalo (1:1), web chat; mỗi worker một bot.
6. Nhận việc theo yêu cầu và theo lịch.
7. Connector: Google Sheets, email.
8. Duyệt việc (nút trong Telegram, mã ngắn / link trên Zalo, hộp duyệt web).
9. Kiểm duyệt: quét, kiểm tra quyền, xem script, duyệt tay.
10. Chạy script của skill trong sandbox nhà cung cấp.
11. Nạp credit VietQR, sao kê, quản trị platform.
12. Bảng lương + báo cáo sáng qua chat.

- Sau change 6: demo được trên Telegram. Sau change 10: dùng thử với khách đầu tiên (credit cộng tay).

**v0.2**: Zalo nhóm, KPI + giờ tiết kiệm, nhận việc theo sự kiện, cổng thanh toán tự động.
**v0.3**: thêm kênh theo yêu cầu khách (Messenger, Lark, Slack, Teams), connector phần mềm kế toán, worker phối hợp với nhau.
**Sau đó**: worker nói chuyện với khách hàng bên ngoài (Zalo OA, Facebook Page); chợ worker mẫu theo ngành.

## 12. Công nghệ (đã chốt — chi tiết ở `docs/architecture.md`)

- **TypeScript**: React + Vite + shadcn/ui (web), **Fastify** (API), tiến trình chạy nền riêng.
- **PostgreSQL** + Drizzle + Row-Level Security; **pg-boss** cho hàng đợi và lịch (không Redis).
- **Kênh chat**: grammY (Telegram), client Zalo tự viết, giao diện adapter riêng; không dùng Chat SDK.
- **Gọi mô hình**: Vercel AI SDK + bảng giá trong DB; API key của platform.
- **Script của skill**: sandbox code execution của nhà cung cấp mô hình, không có mạng.
- **Đăng nhập**: Better Auth (email + Google).
- **Triển khai**: Docker Compose + Caddy trên **cloud Việt Nam**; dữ liệu và bản sao lưu ở Việt Nam.
- **Dùng lại từ KnotSync**: hệ thống plugin, quét prompt injection, che dữ liệu cá nhân, thiết kế hồ sơ agent + audit log.

## 13. Rủi ro

- **Phạm vi rộng cho một người.** MVP 10–12 tuần. Không thêm kênh / tính năng trước khi có 3 khách dùng thật.
- **Bán credit**: cần **pháp nhân** để nhận tiền và xuất hoá đơn; cần kiểm tra **điều khoản Anthropic / OpenAI** về tính phí lại; **rủi ro tỉ giá** (trả USD, thu VNĐ); trách nhiệm giữ tiền nạp trước.
- **Script trong skill** có thể gây hại → chỉ chạy trong sandbox nhà cung cấp, không có mạng, luôn duyệt tay.
- **Pháp lý dữ liệu**: gọi API mô hình và gửi file vào sandbox là chuyển dữ liệu ra nước ngoài theo Luật Bảo vệ dữ liệu cá nhân 2025 → ghi trong điều khoản, cần tư vấn pháp lý.
- **API của app chat thay đổi hoặc hạn chế** (Zalo Bot nhóm còn thử nghiệm, chưa có nút). Lớp adapter + web chat dự phòng.
- **Prompt injection qua nhóm chat** → chỉ nhận việc từ người có quyền; nội dung chat là dữ liệu.
- **Lộ dữ liệu trong nhóm chat** → dữ liệu nhạy cảm gửi riêng cho người giao việc.
- **MISA dùng từ "nhân sự AI", có kênh phân phối rất lớn.** Khác biệt: worker *nội bộ* do khách *tự tuyển* + quản lý như nhân sự + bảng lương.
- **Worker làm sai việc thật** → thử việc, duyệt việc rủi ro, mặc định chỉ đọc / gửi nháp.
- **Khâu cài bot nặng** (mỗi worker một bot) → hướng dẫn trong app + làm hộ khách đầu.
- **Phụ thuộc API của hãng AI** (giá, chính sách thay đổi).
- **SME có thể không chịu trả tiền cho "quản lý"** → bán bằng worker làm được việc thật.
- Sản phẩm làm ngoài giờ: cần xem hợp đồng lao động về quyền sở hữu sản phẩm.

## 14. Quyết định đã chốt (tóm tắt — đầy đủ ở `docs/requirements.md` 0.2)

- **Tạm dừng KnotSync**, tập trung sản phẩm này.
- Khách: **SME Việt Nam**. Định vị: **nền tảng quản lý digital workers**, ngôn ngữ nhân sự.
- Skill / worker **chỉ nội bộ từng công ty**; nhân viên đề xuất, admin duyệt.
- **Có nơi chạy riêng**; worker có mặt qua **app chat** (MVP: Telegram + Zalo 1:1 + web chat); **mỗi worker một bot**.
- Worker mới **bắt buộc thử việc**; admin có **công cụ kiểm duyệt**.
- **Script trong skill có trong MVP**; **bán credit ngay** (VNĐ, nạp trước).
- **Cloud Việt Nam**; đăng nhập **email + Google**; **Fastify + grammY**.
- Nhóm chat: dữ liệu nhạy cảm gửi riêng. Hết ngân sách: ngừng nhận việc mới. Lưu hội thoại 90 ngày, log 1 năm. Giao diện tiếng Việt.

## 15. Câu hỏi còn mở

- Tên sản phẩm?
- Mức giá: hệ số credit, phí theo số worker?
- Pháp nhân để nhận tiền và xuất hoá đơn?
- Nhà cung cấp cloud Việt Nam cụ thể?
- 3 chủ DN đầu tiên làm ngành gì? Worker đầu tiên họ muốn tuyển là gì? Họ dùng app chat nào?
- Có mở chợ worker mẫu cho agency ở giai đoạn sau không?
