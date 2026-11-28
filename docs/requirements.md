---
type: requirements
product: digital-workers (tên tạm)
version: 0.1-draft
last_updated: 2026-11-27
status: draft
source: docs/brief.md
---

# Yêu cầu — Nền tảng Quản lý Digital Workers cho SME

> Đây là **tầng cao nhất** trong 3 tầng nguồn sự thật (yêu cầu → spec → code).
> Mâu thuẫn với `docs/brief.md` → **file này thắng**. Brief chỉ giữ chiến lược (định vị, giá, đối thủ).
> Mọi quyết định nghiệp vụ mới ghi vào **mục 0.2**, đánh số tiếp, có ngày.

---

## 0. Tổng quan

### 0.1. Một câu

Nền tảng để SME Việt **tuyển, đào tạo, giao việc và quản lý digital workers** (nhân viên số) như quản lý nhân viên thật. Worker làm việc qua **app chat** (Telegram, Zalo, …); chủ DN quản lý qua **web**.

### 0.2. Sổ quyết định

| # | Ngày | Quyết định |
|---|---|---|
| 001 | 2026-11-27 | Khách hàng: **SME Việt Nam**, khoảng 10–200 người, chưa có đội AI riêng. |
| 002 | 2026-11-27 | Định vị: **nền tảng quản lý digital workers**, dùng ngôn ngữ nhân sự (tuyển, thử việc, kỹ năng, lương, KPI, nghỉ việc). |
| 003 | 2026-11-27 | Platform **có nơi chạy riêng**: worker chạy trên platform, gọi mô hình AI (Claude / OpenAI) qua API. Đồng bộ ra công cụ ngoài để sau MVP. |
| 004 | 2026-11-27 | Kho skill / worker **chỉ nội bộ từng công ty**. Nhân viên đề xuất, admin duyệt. Không làm chợ công khai trong MVP. |
| 005 | 2026-11-27 | Worker có mặt qua **app chat SME đang dùng**. MVP: **Telegram (1:1 + nhóm), Zalo (1:1), web chat**. Web dùng để quản lý. |
| 006 | 2026-11-27 | Worker mới **bắt buộc thử việc** trước khi chính thức. Admin có công cụ kiểm duyệt. |
| 007 | 2026-11-27 | Kỹ năng theo chuẩn mở **Agent Skills (`SKILL.md`)**. Connector theo chuẩn **MCP**. |
| 008 | 2026-11-27 | Chỉ dùng **API bot chính thức** của app chat. Không tự động hoá tài khoản cá nhân. |
| 009 | 2026-11-27 | Worker **chỉ nhận việc từ người đã ghép tài khoản** và có quyền giao việc. Nội dung khác trong chat là **dữ liệu, không phải lệnh**. |
| 010 | 2026-11-27 | Quyền mặc định của worker: **chỉ đọc / soạn nháp**. Ghi dữ liệu, gửi ra ngoài = **rủi ro cao**, bắt buộc có quy tắc duyệt. |
| 011 | 2026-11-27 | Máy chủ và dữ liệu lưu trữ đặt ở **cloud Việt Nam**. Gọi mô hình AI (Claude / OpenAI) vẫn là chuyển dữ liệu ra nước ngoài → ghi rõ trong điều khoản, và cần tư vấn pháp lý trước khi bán. |
| 012 | 2026-11-27 | Đăng nhập web MVP: **email + mật khẩu và Google**. Đăng nhập Zalo để sau MVP. |
| 013 | 2026-11-27 | **Mỗi worker một bot riêng** trên mỗi kênh chat (tên, ảnh riêng). Admin tạo bot và dán token cho từng worker. (Chốt từ P-03.) |
| 014 | 2026-11-27 | API: **Fastify**. Telegram: **grammY**. Zalo: client riêng, mỏng. Giao diện `ChannelAdapter` tự định nghĩa; **không dùng Chat SDK** trong MVP. |
| 015 | 2026-11-27 | **Skill được chạy script ngay trong MVP** (không chọn P-01). Script luôn là **rủi ro cao**: bắt buộc quét và duyệt tay. Cách chạy: xem P-11. |
| 016 | 2026-11-27 | **Bán credit ngay trong MVP** (không chọn P-02). Platform dùng API key của chính platform; khách trả bằng credit nạp trước. Không có BYOK trong MVP. |
| 017 | 2026-11-27 | Trong nhóm chat, dữ liệu không phải ai cũng được xem → **gửi riêng (DM)** cho người giao việc, trong nhóm chỉ báo "đã gửi riêng". (P-04) |
| 018 | 2026-11-27 | Hết ngân sách tháng → worker **ngừng nhận việc mới**, báo người quản lý; việc đang chạy làm nốt. (P-05) |
| 019 | 2026-11-27 | Lưu nội dung hội thoại **90 ngày**; log việc (không có nội dung) lưu **1 năm**. (P-06) |
| 020 | 2026-11-27 | Giao diện và skill mẫu **tiếng Việt**; code và tên kỹ thuật tiếng Anh. (P-07) |
| 021 | 2026-11-27 | Duyệt trên **Zalo**: trả lời **mã ngắn** (`1` đồng ý / `2` từ chối, kèm mã việc) hoặc **link mở hộp duyệt web**. (P-08) |
| 022 | 2026-11-27 | Cài bot: **hướng dẫn từng bước trong app**; 3–5 khách đầu **Harry làm hộ**. (P-09) |
| 023 | 2026-11-27 | Nạp credit trong MVP bằng **chuyển khoản VietQR** với nội dung chuyển khoản duy nhất; platform admin đối soát và **xác nhận tay** rồi cộng credit. Cổng thanh toán tự động (PayOS / VNPay / MoMo) để sau MVP. (P-10) |
| 024 | 2026-11-27 | Script trong skill chạy trong **sandbox code execution của nhà cung cấp mô hình** (Claude / OpenAI): không có mạng, chỉ nhận file đầu vào, trả file kết quả. Không tự dựng sandbox trong MVP. (P-11) |
| 025 | 2026-11-27 | Credit tính và hiển thị bằng **VNĐ** (1 credit = 1 đồng). Giá bán = chi phí thật × **hệ số giá** (vd. 1,3; cấu hình được), hiển thị rõ trong bảng lương. (P-12) |
| 026 | 2026-11-27 | Credit **không hết hạn** trong 12 tháng đầu; **không hoàn tiền** credit đã nạp, trừ khi platform ngừng dịch vụ. (P-13) |
| 027 | 2026-11-27 | Chạy trên **Node.js 24 LTS** (không dùng Node 22, vì Node 22 hết hỗ trợ tháng 4/2027). API và runner chạy thẳng file TypeScript bằng type stripping của Node, không có bước build. (`setup-monorepo`) |
| 028 | 2026-11-27 | Thêm vào danh sách thư viện được phép: **`pg`** (driver PostgreSQL), **`@biomejs/biome`** (lint + format) và **các phụ thuộc chuẩn của shadcn/ui** (Tailwind CSS, Radix, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`). (`setup-monorepo`) |
| 029 | 2026-11-27 | Cloud Việt Nam: đề xuất **VNG Cloud**, Viettel Cloud làm dự phòng. **Chốt chính thức khi có báo giá** máy ảo + object storage (Harry kiểm tra); ghi thành quyết định mới lúc đó. (`setup-monorepo`) |
| 030 | 2026-11-27 | CI: **GitHub Actions** chạy kiểm tra nhẹ (lint, typecheck, unit, `openspec validate`) cho mỗi PR; test tích hợp + e2e chạy tay bằng `pnpm ci:runner` trên máy trước khi merge. Self-hosted runner để sau. (`setup-monorepo`) |
| 031 | 2026-11-27 | Thêm change **`deploy-staging`** (thuê máy, tên miền, HTTPS, sao lưu thật) vào lộ trình, làm **trước** `add-channel-telegram` vì webhook cần HTTPS công khai. (`setup-monorepo`) |
| 032 | 2026-11-27 | Mật khẩu đăng nhập web: **tối thiểu 10 ký tự**, không bắt buộc ký tự đặc biệt; chặn các mật khẩu quá phổ biến. (`add-tenancy-and-users`) |
| 033 | 2026-11-27 | Đăng ký xong **dùng được ngay**; phải **xác minh email trước khi nạp credit hoặc mời người khác**. Người vào bằng lời mời coi như đã xác minh email. (`add-tenancy-and-users`) |
| 034 | 2026-11-27 | Lời mời tham gia công ty **hết hạn sau 7 ngày**; Owner / Admin gửi lại được. (`add-tenancy-and-users`) |
| 035 | 2026-11-27 | MVP: **mỗi email thuộc đúng một công ty**. Một tài khoản nhiều công ty để sau. (`add-tenancy-and-users`) |
| 036 | 2026-11-27 | Mỗi phòng ban có **tối đa một trưởng phòng**; mỗi người thuộc **tối đa một phòng**. Trưởng phòng và Nhân viên **bắt buộc** có phòng; Owner / Admin không bắt buộc. Chọn một Nhân viên làm trưởng phòng thì **tự đổi vai trò** sang Trưởng phòng (báo rõ trước khi lưu). (`add-tenancy-and-users`) |
| 037 | 2026-11-27 | Xoá phòng ban = **lưu trữ** (ẩn khỏi danh sách, giữ lịch sử), chỉ làm được khi phòng **không còn người**. (`add-tenancy-and-users`) |
| 038 | 2026-11-27 | Trưởng phòng **xem được** (không sửa) danh sách người trong phòng mình. Nhân viên không vào trang Người dùng. (`add-tenancy-and-users`) |
| 039 | 2026-11-27 | Một công ty có **nhiều Owner** được. **Chỉ Owner** gán vai trò Owner hoặc Admin; Admin không sửa / khoá được Owner. Công ty luôn có **ít nhất một Owner đang hoạt động** (không hạ vai trò, không khoá Owner cuối cùng). (`add-tenancy-and-users`) |
| 040 | 2026-11-27 | Người nghỉ việc bị **khoá**, không xoá: không đăng nhập, không giao việc được; tên vẫn hiện trong lịch sử; mở khoá được. (`add-tenancy-and-users`) |
| 041 | 2026-11-27 | Số điện thoại khi đăng ký công ty: **không bắt buộc**. (`add-tenancy-and-users`) |
| 042 | 2026-11-27 | Gửi email ở prod qua SMTP; **nhà cung cấp chọn ở change `deploy-staging`** (ưu tiên SMTP của nhà cung cấp cloud Việt Nam). Dev dùng Mailpit. (`add-tenancy-and-auth`) |
| 043 | 2026-11-27 | Phiên đăng nhập web **30 ngày, tự gia hạn** khi người dùng còn dùng (gia hạn tối đa mỗi ngày một lần). (`add-tenancy-and-auth`) |
| 044 | 2026-11-27 | Đăng nhập sai **10 lần trong 15 phút** (theo email) → tạm chặn tới hết 15 phút; ngoài ra có giới hạn theo IP. (`add-tenancy-and-auth`) |
| 045 | 2026-11-27 | Font giao diện **Be Vietnam Pro, tự host** qua `@fontsource/be-vietnam-pro` (OFL); không gọi Google Fonts. (`add-tenancy-and-auth`) |
| 046 | 2026-11-27 | `AuditEvent` giữ **1 năm**, như log việc (#019). Việc xoá bản quá hạn chạy nền, làm khi runner có lịch (change `add-schedules`). (`add-tenancy-and-auth`) |
| 047 | 2026-11-27 | Trưởng phòng chỉ thấy **số lượng** nhân viên số của phòng khác; không mở được hồ sơ của phòng khác. (`add-worker-profile`) |
| 048 | 2026-11-27 | Thử việc mặc định **14 ngày**; hết hạn thì **nhắc người quản lý** đề nghị chính thức hoặc gia hạn; worker vẫn ở thử việc tới khi có người quyết. (`add-worker-profile`) |
| 049 | 2026-11-27 | Tên nhân viên số **duy nhất trong công ty** (không tính worker đã nghỉ việc). (`add-worker-profile`) |
| 050 | 2026-11-27 | Ngân sách tháng mặc định **300.000đ** khi thử việc, **800.000đ** khi chính thức. Trưởng phòng đặt được tới **2.000.000đ**; cao hơn do Owner / Admin đặt. Trần này chỉnh được trong cài đặt công ty sau. (`add-worker-profile`) |
| 051 | 2026-11-27 | Owner / Admin cho chính thức được **mà không cần đề nghị**; lịch sử ghi người duyệt. Trưởng phòng chỉ đề nghị. (`add-worker-profile`) |
| 052 | 2026-11-27 | Đổi phòng ban của worker (kể cả đang chính thức): **chỉ Owner / Admin**; giữ nguyên trạng thái, chọn lại người quản lý theo phòng mới, có `AuditEvent`. (`add-worker-profile`) |
| 053 | 2026-11-27 | Người quản lý worker: **bất kỳ ai trong phòng** hoặc Owner / Admin; mặc định là trưởng phòng. Người quản lý nhận cảnh báo và duyệt việc; chỉ trưởng phòng / Owner / Admin đổi trạng thái. (`add-worker-profile`) |
| 054 | 2026-11-27 | **Bắt buộc lý do** khi cho nghỉ việc và khi trả lại đề nghị chính thức; tạm nghỉ không bắt buộc. (`add-worker-profile`) |
| 055 | 2026-11-27 | Thêm **`@types/nodemailer`** (devDependency, MIT, chỉ khai báo kiểu cho `nodemailer`) vào danh sách thư viện được phép. Ma trận quyền mục 1 có thêm hàng **"Đổi thông tin công ty (tên, số điện thoại)"**: Owner và Admin được, Trưởng phòng và Nhân viên không. (`add-tenancy-and-auth`) |
| 056 | 2026-11-27 | Mức rủi ro của kỹ năng (trước khi có quét tự động ở change 11): **hệ thống gợi ý**, người tạo chọn, **Owner / Admin chốt** khi duyệt. Kỹ năng có `scripts/` luôn rủi ro **cao**, không hạ được. (`add-skill-library`) |
| 057 | 2026-11-27 | Giao kỹ năng cho nhân viên số từ **cả hai nơi**: màn kỹ năng ("Giao thêm") và tab Kỹ năng trong hồ sơ nhân viên số, cùng một luật quyền. (`add-skill-library`) |
| 058 | 2026-11-27 | Giao kỹ năng cho worker **chính thức**: Owner / Admin giao thẳng; Trưởng phòng giao thì **chờ Owner / Admin duyệt**. Worker Nháp / Thử việc không cần duyệt. Kỹ năng có script luôn cần duyệt. (`add-skill-library`) |
| 059 | 2026-11-27 | Nhập kỹ năng từ `.zip`: tối đa **25 MB**; chỉ nhận text / markdown / csv / xlsx / docx / pdf / ảnh; script chỉ `.py`. File khác bị từ chối kèm lý do. (`add-skill-library`) |
| 060 | 2026-11-27 | **Không lưu trữ** kỹ năng còn nhân viên số đang dùng: phải gỡ khỏi các worker trước; nút Lưu trữ báo số worker còn dùng và dẫn tới danh sách. (`add-skill-library`) |
| 061 | 2026-11-27 | Trưởng phòng là người có **vai trò Trưởng phòng** trong phòng đó; Owner / Admin **không làm trưởng phòng** trong MVP. Chọn trưởng phòng mới cho phòng đã có trưởng phòng → người cũ thành **Nhân viên của cùng phòng**; bỏ trưởng phòng cũng vậy (báo trước khi lưu). (`add-departments-and-invites`) |
| 062 | 2026-11-27 | Chuyển một Trưởng phòng sang phòng khác → người đó thành **Nhân viên của phòng mới**, phòng cũ không còn trưởng phòng (báo trước khi lưu). (`add-departments-and-invites`) |
| 063 | 2026-11-27 | **Chỉ Owner** đổi vai trò, chuyển phòng, khoá / mở khoá **Owner và Admin** (kể cả gửi lại / huỷ lời mời Owner / Admin); Admin không quản lý Admin khác. (`add-departments-and-invites`) |
| 064 | 2026-11-27 | Lưu trữ phòng ban chỉ khi phòng **không còn ai, kể cả người đã khoá**, và không còn lời mời còn hạn vào phòng đó. Phòng đã lưu trữ không khôi phục trong MVP. (`add-departments-and-invites`) |
| 065 | 2026-11-27 | Mời email đã có tài khoản ở công ty khác: lúc mời **không báo** (không lộ email giữa các công ty); người được mời thấy lỗi khi nhận lời mời. (`add-departments-and-invites`) |
| 066 | 2026-11-27 | Người đã có tài khoản nhưng **chưa có công ty** (Google, đăng ký dở) **nhận được lời mời** khi đăng nhập bằng đúng email trong lời mời. (`add-departments-and-invites`) |
| 067 | 2026-11-27 | Đặt lại mật khẩu xong: **coi như đã xác minh email** và **huỷ mọi phiên cũ** (đường lấy lại email bị người khác đăng ký trước). Link đặt lại có hạn **1 giờ**; giới hạn 3 lần / 15 phút / email và 5 lần / phút / IP. (`add-departments-and-invites`) |
| 068 | 2026-11-27 | Ma trận quyền mục 1 thêm hàng **"Xem danh sách người dùng"** (ghi vào bảng cùng code khi apply, task 1.1): Owner, Admin cả công ty; Trưởng phòng phòng mình; Nhân viên không (khớp #038). Mọi thành viên xem được danh sách phòng ban. (`add-departments-and-invites`) |
| 069 | 2026-11-27 | Trang **Quên mật khẩu / Đặt lại mật khẩu** dựng theo phong cách trang đăng nhập, **không vẽ màn riêng**. (`add-departments-and-invites`) |
| 070 | 2026-11-27 | Khoá tài khoản **không ghi lý do** trong MVP: chỉ lưu ngày khoá, hiện "Đã khoá · dd/mm". (`add-departments-and-invites`) |
| 071 | 2026-11-28 | Báo Owner "credit sắp hết" khi số dư xuống dưới **20% của lần cộng credit gần nhất** (nạp tiền, cộng tay "đã nhận chuyển khoản", hoặc credit dùng thử); báo một lần mỗi lần xuống dưới ngưỡng. Owner chưa đổi được tỉ lệ trong MVP. (`add-llm-gateway-and-credit`) |
| 072 | 2026-11-28 | Sổ credit ghi **từng lần** gọi mô hình; trang Credit **gộp mỗi worker mỗi ngày một dòng**, mở ra xem từng lần. (`add-llm-gateway-and-credit`) |
| 073 | 2026-11-28 | Công ty mới nhận **200.000đ credit dùng thử**, cộng tự động **một lần** khi Owner xác minh email (#033). (`add-llm-gateway-and-credit`) |
| 074 | 2026-11-28 | Trang Credit chỉ hiện **số đã nhân hệ số giá**; không hiện chi phí thật hay hệ số (hệ số ghi trong điều khoản và bảng lương, #025). (`add-llm-gateway-and-credit`) |
| 075 | 2026-11-28 | Tỉ giá USD → VNĐ **chung cho mọi công ty**. Hệ số giá mặc định chung (1,3); platform admin **đặt hệ số riêng cho từng công ty** được. Đổi tỉ giá / hệ số không tính lại giao dịch cũ. (Thay câu "tỉ giá theo công ty" ở architecture.md mục 6.) (`add-llm-gateway-and-credit`) |
| 076 | 2026-11-28 | Platform admin là các email đặt trong **biến môi trường**, đăng nhập **bắt buộc xác thực 2 bước TOTP** (plugin `twoFactor` có sẵn trong Better Auth, không thêm thư viện). Không phải vai trò trong công ty nào. (`add-llm-gateway-and-credit`) |
| 077 | 2026-11-28 | Platform admin chỉ xem **tổng theo công ty** (số dư, đã trừ, số worker, email Owner); không xem tên worker, nội dung việc hay dữ liệu nghiệp vụ. (`add-llm-gateway-and-credit`) |
| 080 | 2026-11-28 | Trang Phòng ban giữ số **"N người chưa có phòng ban"** như spec. Theo ràng buộc mới, chỉ Owner / Admin có thể không có phòng nên con số thực chất đếm Owner / Admin chưa gán phòng. (`add-departments-and-invites`) |
| 081 | 2026-11-28 | Owner / Admin **được gán vào phòng ban** (không bắt buộc, #036). Khi đã gán, họ **tính là người trong phòng** và chặn lưu trữ phòng như mọi thành viên khác (#064). (`add-departments-and-invites`) |
| 082 | 2026-11-28 | **Hạn mức gửi lời mời** theo công ty (chống dùng lời mời để gửi email lừa đảo / rác: số người nhận mỗi ngày cho công ty mới, giới hạn gửi lại) **làm ở change `deploy-staging`**, trước khi mở cho khách thật. 1b chỉ có giới hạn 50 email mỗi lần mời. (`add-departments-and-invites`) |
| 083 | 2026-11-28 | Giới hạn "Quên mật khẩu" **giữ như #067**: quá 3 lần / 15 phút cho một email thì **trả 429**. Chấp nhận rủi ro người lạ làm chậm việc lấy lại mật khẩu tối đa 15 phút. (`add-departments-and-invites`) |
| 084 | 2026-11-28 | **Admin không tự đổi vai trò của mình** (theo #063: Admin không quản lý Admin). Owner tự hạ vai trò được khi còn Owner khác đang hoạt động. (`add-departments-and-invites`) |
| 085 | 2026-11-28 | Change 3 **apply sau change 2** (`add-worker-profile`): `worker_skills` cần bảng worker. ROADMAP: change 3 phụ thuộc `1a, 2`. (`add-skill-library`) |
| 086 | 2026-11-28 | Thêm **`fflate`** (MIT, không phụ thuộc) vào danh sách thư viện được phép, để đọc / ghi `.zip` của kỹ năng (Node và trình duyệt, inflate theo luồng để chặn zip bomb). (`add-skill-library`) |
| 087 | 2026-11-28 | Ma trận quyền mục 1 thêm hàng **"Giao / gỡ skill cho worker"**: Owner, Admin cả công ty; Trưởng phòng phòng mình; Nhân viên không. Hàng "Duyệt skill" gồm cả từ chối version, quay lại version cũ, lưu trữ kỹ năng, duyệt yêu cầu giao. Mọi thành viên xem được thư viện và xuất `.zip`. (Ghi vào bảng cùng code khi apply, task 1.1.) (`add-skill-library`) |
| 088 | 2026-11-28 | Trước khi có kiểm duyệt (change 11), kỹ năng có script **không giao được** cho worker Chính thức / Tạm nghỉ; giao cho worker Nháp / Thử việc thì **luôn chờ Owner / Admin duyệt**. Worker Thử việc lên Chính thức → kỹ năng có script của nó **Tạm khoá** tới khi có kiểm duyệt. (`add-skill-library`) |
| 089 | 2026-11-28 | Giới hạn gói kỹ năng (bổ sung #059): sau giải nén tối đa **50 MB, 200 file**, đường dẫn 200 ký tự, sâu 5 cấp; `SKILL.md` tối đa 200 KB. "Text" = `.md .txt .csv .tsv .json .yaml .yml .xml`; "ảnh" = `.png .jpg .jpeg .webp .gif` (**không nhận SVG**); `.py` chỉ trong `scripts/`. (`add-skill-library`) |
| 090 | 2026-11-28 | Quay lại version cũ = **trỏ lại một version đã từng được duyệt**, không tạo bản sao, không duyệt lại; chỉ Owner / Admin; mọi worker chuyển ngay. (`add-skill-library`) |
| 091 | 2026-11-28 | Từ chối version kỹ năng **bắt buộc lý do** (như #054). (`add-skill-library`) |
| 092 | 2026-11-28 | MVP **chỉ nhập kỹ năng từ `.zip`**; nhập từ thư mục để sau. (`add-skill-library`) |
| 093 | 2026-11-28 | `name` của kỹ năng **cố định sau khi tạo** (đổi = tạo kỹ năng mới), duy nhất trong các kỹ năng chưa lưu trữ của công ty; tên hiển thị lấy từ dòng `#` đầu tiên của `SKILL.md`. (`add-skill-library`) |
| 094 | 2026-11-28 | Gói `.zip` nhận `SKILL.md` ở gốc, **hoặc** đúng một thư mục ở gốc trùng `name` chứa `SKILL.md` (quy ước agentskills); trường hợp khác bị từ chối kèm hướng dẫn. (`add-skill-library`) |
| 095 | 2026-11-28 | Chi phí chỉ biết sau khi gọi xong → lần gọi cuối **trừ đủ**, số dư **được âm** (vd. −150đ); lần cộng credit sau bù vào. Số dư ≤ 0 thì mọi lần gọi mới bị từ chối. (`add-llm-gateway-and-credit`) |
| 096 | 2026-11-28 | Hết credit giữa chừng: việc đang chạy **dừng ở lần gọi mô hình tiếp theo** (không làm nốt), người nhắn nhận "công ty đã hết credit". Lỗ tối đa là một lần gọi. (`add-llm-gateway-and-credit`) |
| 097 | 2026-11-28 | Số trừ credit mỗi lần là số nguyên đồng: **làm tròn xuống, phần lẻ dưới 1 đồng cộng dồn** cho lần sau của công ty; tổng đã trừ = phần nguyên của tổng số tiền bán. (`add-llm-gateway-and-credit`) |
| 098 | 2026-11-28 | Email platform admin **không là thành viên công ty nào** và **không tạo công ty được**; email trong danh sách mà thuộc một công ty thì không vào được màn quản trị. (`add-llm-gateway-and-credit`) |
| 099 | 2026-11-28 | Bật TOTP cho platform admin: **không thêm thư viện mã QR**; hiện khoá bí mật dạng chữ + link `otpauth://` để nhập tay. (`add-llm-gateway-and-credit`) |
| 100 | 2026-11-28 | Quyền quản trị platform **hết sau 12 giờ** kể từ lúc đăng nhập; **không ghi nhớ thiết bị**, nhập mã TOTP mỗi lần đăng nhập. (`add-llm-gateway-and-credit`) |
| 101 | 2026-11-28 | Change 4 chỉ báo **qua email**: "credit sắp hết" gửi Owner; "hết credit" gửi **Owner, Admin và Trưởng phòng** đang hoạt động (rộng hơn FR-13-04). Báo qua app chat để sau. (`add-llm-gateway-and-credit`) |
| 102 | 2026-11-28 | Giá trị ban đầu: tỉ giá **25.400đ / USD**, hệ số giá mặc định **1,30**. Không nạp sẵn giá mô hình; platform admin nhập giá thật. (`add-llm-gateway-and-credit`) |
| 103 | 2026-11-28 | Điều chỉnh credit tay: tối đa **100.000.000đ mỗi lần**, bắt buộc lý do và ghi chú (≤ 200 ký tự), từ chối ghi chú có **từ 9 chữ số liền nhau** trở lên, chặn gửi trùng bằng `Idempotency-Key`. (`add-llm-gateway-and-credit`) |
| 104 | 2026-11-28 | Công ty có từ trước change 4: migration tạo tài khoản credit 0đ và **cấp credit dùng thử** cho công ty đã có Owner xác minh email. (`add-llm-gateway-and-credit`) |

### 0.3. Đề xuất chờ chốt

> Claude đề xuất. Harry duyệt → chuyển lên 0.2 với số tiếp theo.
> P-01 … P-09 đã xử lý ngày 2026-11-27 (xem 0.2 #015 – #022).
> P-10 … P-13 đã xử lý ngày 2026-11-27 (xem 0.2 #023 – #026).

Hiện không có đề xuất chờ chốt.

### 0.4. Câu hỏi còn mở

- Tên sản phẩm?
- Mô hình thu tiền và mức giá? (Credit đã chốt ở #016; còn phí theo số worker và hệ số giá.)
- Pháp nhân để nhận tiền và xuất hoá đơn: công ty hay hộ kinh doanh? Điều khoản của Anthropic / OpenAI có cho bán lại dưới dạng credit trong sản phẩm không — cần kiểm tra.
- 3 khách đầu làm ngành gì? Worker đầu tiên họ muốn tuyển? Họ dùng app chat nào?
- Nhà cung cấp cloud Việt Nam: đề xuất VNG Cloud (#029); chờ báo giá máy ảo + object storage để chốt.
- Nghĩa vụ theo Luật Bảo vệ dữ liệu cá nhân 2025 (đánh giá tác động, chuyển dữ liệu ra nước ngoài): platform là bên xử lý, khách là bên kiểm soát — cần tư vấn pháp lý xác nhận.

### 0.5. Phạm vi MVP

**Trong MVP:** mục 3.1 – 3.14.
**Ngoài MVP:** xem mục 5.

---

## 1. Vai trò và quyền

| Vai trò | Là ai | Việc chính |
|---|---|---|
| **Owner** | Chủ DN | Xem toàn bộ, bảng lương, cấu hình công ty, gán Admin |
| **Admin** | Người phụ trách AI | Kiểm duyệt worker/skill, kết nối kênh chat & connector |
| **Manager** | Trưởng phòng | Tuyển & quản lý worker của phòng mình, duyệt việc, đề xuất skill |
| **Member** | Nhân viên | Giao việc cho worker được phép, xem kết quả, đề xuất skill |

### Ma trận quyền (MVP)

| Hành động | Owner | Admin | Manager | Member |
|---|:-:|:-:|:-:|:-:|
| Đổi thông tin công ty (tên, số điện thoại) | ✓ | ✓ | — | — |
| Quản lý phòng ban, người dùng | ✓ | ✓ | — | — |
| Xem danh sách người dùng | ✓ | ✓ | ✓ (phòng mình) | — |
| Tạo worker (bản nháp) | ✓ | ✓ | ✓ (phòng mình) | — |
| Chuyển worker sang thử việc | ✓ | ✓ | ✓ (phòng mình) | — |
| Duyệt worker lên chính thức | ✓ | ✓ | — | — |
| Tạm nghỉ / nghỉ việc worker | ✓ | ✓ | ✓ (phòng mình) | — |
| Tạo / sửa skill (bản nháp) | ✓ | ✓ | ✓ | ✓ |
| Duyệt skill | ✓ | ✓ | — | — |
| Giao việc cho worker | ✓ | ✓ | ✓ | ✓ (nếu được gán) |
| Duyệt việc của worker | theo quy tắc duyệt của worker |||
| Kết nối kênh chat, connector | ✓ | ✓ | — | — |
| Nạp credit, xem sao kê | ✓ | ✓ (xem) | — | — |
| Xem bảng lương | ✓ (cả công ty) | ✓ (cả công ty) | ✓ (phòng mình) | — |

---

## 2. Thực thể chính

| Thực thể | Mô tả ngắn |
|---|---|
| `Company` | Một khách hàng (tenant). Mọi dữ liệu thuộc đúng một công ty. |
| `Department` | Phòng ban. |
| `User` | Người thật, có vai trò, thuộc phòng ban. |
| `ChannelIdentity` | Tài khoản chat của người dùng (Telegram id, Zalo id) đã ghép với `User`. |
| `Worker` | Digital worker: hồ sơ, trạng thái, người quản lý, ngân sách. |
| `WorkerChannel` | Bot của worker trên một kênh (token, kênh, nhóm được vào). |
| `Skill` / `SkillVersion` | Kỹ năng theo `SKILL.md`; mỗi lần sửa là một version. |
| `WorkerSkill` | Worker được giao skill nào, version nào. |
| `Connector` / `WorkerGrant` | Kết nối ngoài (Google Sheets, email) và quyền của worker trên đó (đọc / nháp / ghi). |
| `Schedule` | Lịch chạy của worker. |
| `Task` | Một việc worker nhận: từ chat, từ lịch. Có trạng thái, kết quả. |
| `Approval` | Yêu cầu duyệt cho một hành động rủi ro. |
| `Review` | Một lần kiểm duyệt worker / skill: kết quả quét, người duyệt, ghi chú. |
| `CostEntry` | Chi phí AI của một lần gọi mô hình: worker, task, token, tiền. |
| `AuditEvent` | Nhật ký hành động (ai, làm gì, khi nào), không chứa nội dung nhạy cảm. |
| `ProviderKey` | API key mô hình AI **của platform** (mã hoá, cấp hệ thống, không thuộc công ty nào). |
| `CreditAccount` | Số dư credit của một công ty (VNĐ). |
| `CreditTransaction` | Mỗi lần cộng / trừ credit: nạp tiền, trừ theo `CostEntry`, điều chỉnh tay. Không sửa, không xoá. |
| `TopUp` | Một lần nạp tiền: số tiền, mã chuyển khoản, trạng thái (chờ / đã xác nhận / huỷ). |
| `SkillRun` | Một lần chạy script của skill trong sandbox: file vào, file ra, thời gian, chi phí. |

---

## 3. Yêu cầu chức năng

> Mỗi yêu cầu có mã `FR-xx-yy`. Kịch bản viết dạng **KHI … THÌ …** để chuyển thẳng sang spec OpenSpec.

### 3.1. Công ty, phòng ban, người dùng (`FR-01`)

- **FR-01-01** Owner đăng ký công ty, trở thành Owner đầu tiên.
- **FR-01-02** Owner / Admin tạo phòng ban, mời người dùng, gán vai trò.
- **FR-01-03** Mọi truy vấn dữ liệu đều lọc theo `Company`.
  - KHI người dùng công ty A gọi API với id của dữ liệu công ty B, THÌ hệ thống trả "không tìm thấy" và ghi `AuditEvent`.

### 3.2. Hồ sơ worker và vòng đời (`FR-02`)

- **FR-02-01** Hồ sơ gồm: tên, ảnh, vai trò (mô tả công việc), phòng ban, người quản lý, ngân sách tháng, mô tả tính cách / giọng văn.
- **FR-02-02** Vòng đời:

```
Nháp ──► Thử việc ──► Chính thức ◄──► Tạm nghỉ
  │          │             │              │
  └──────────┴─────────────┴──────────────┴──► Nghỉ việc (không quay lại)
```

- **FR-02-03** Ở **Thử việc**: worker chỉ làm việc qua web chat với người được chỉ định; **mọi việc** đều cần duyệt; không vào nhóm chat thật.
- **FR-02-04** Lên **Chính thức** cần một `Review` được Admin / Owner duyệt (xem 3.9).
  - KHI Manager bấm "Chính thức hoá" một worker, THÌ hệ thống tạo yêu cầu kiểm duyệt và worker vẫn ở Thử việc cho tới khi Admin duyệt.
- **FR-02-05** **Tạm nghỉ**: worker ngừng nhận việc mới, lịch chạy dừng, bot trả lời "đang tạm nghỉ".
- **FR-02-06** **Nghỉ việc**: thu hồi mọi quyền connector, gỡ bot khỏi mọi kênh, giữ lịch sử để tra cứu.
  - KHI worker chuyển sang Nghỉ việc, THÌ mọi `WorkerGrant` bị thu hồi và mọi tin nhắn tới bot nhận câu trả lời cố định "đã nghỉ việc".
- **FR-02-07** Tạo worker **từ mẫu** (3–5 mẫu có sẵn) hoặc **mô tả công việc bằng tiếng Việt** để AI dựng bản nháp hồ sơ.

### 3.3. Thư viện kỹ năng (`FR-03`)

- **FR-03-01** Skill lưu theo chuẩn Agent Skills: `SKILL.md` (frontmatter `name`, `description` + nội dung) và file đính kèm (mẫu, bảng tham chiếu).
- **FR-03-02** Mỗi lần sửa tạo `SkillVersion` mới. Skill đang dùng chỉ đổi version khi được duyệt.
  - KHI một skill đang được 3 worker dùng có bản sửa mới, THÌ 3 worker vẫn dùng version cũ cho tới khi bản mới được duyệt.
- **FR-03-03** Quay lại version cũ bằng một thao tác.
- **FR-03-04** Có 10 skill mẫu tiếng Việt (vd. lập báo giá, soạn hợp đồng từ mẫu, tóm tắt email, tổng hợp báo cáo ngày).
- **FR-03-05** Nhập skill từ file `.zip` / thư mục; xuất skill ra `.zip`.
- **FR-03-06** (Theo #015) Skill được có thư mục `scripts/`. Skill có script luôn ở mức rủi ro **cao** và chỉ giao được cho worker sau khi qua kiểm duyệt (FR-09).
  - KHI một skill có script được sửa, THÌ version mới bắt buộc qua kiểm duyệt lại trước khi worker dùng.

### 3.4. Chạy worker (`FR-04`)

- **FR-04-01** Một `Task` được tạo khi: người dùng nhắn bot, lịch chạy tới giờ.
- **FR-04-02** Worker nạp skill theo cách **tiết lộ dần**: luôn biết tên + mô tả của mọi skill được giao; chỉ nạp nội dung skill khi cần.
- **FR-04-03** Worker chỉ gọi được connector có `WorkerGrant`, đúng mức quyền.
  - KHI worker có quyền "đọc" Google Sheets mà cố ghi, THÌ thao tác bị chặn, `Task` ghi lỗi quyền, người quản lý được báo.
- **FR-04-04** Hành động có quy tắc duyệt → tạo `Approval`, `Task` chờ, không thực hiện cho tới khi được duyệt.
- **FR-04-05** Mỗi lần gọi mô hình (và mỗi lần chạy script) ghi `CostEntry` và trừ credit của công ty (FR-13).
- **FR-04-06** Giới hạn mỗi `Task`: số bước tối đa, thời gian tối đa, chi phí tối đa. Vượt → dừng và báo.
- **FR-04-07** Gom tin nhắn ngắn liên tiếp (vd. trong 5 giây) của cùng một người thành một `Task`.

### 3.5. Kênh chat (`FR-05`)

- **FR-05-01** Lớp **channel adapter** chung. Mỗi adapter: nhận tin, gửi tin (tự chia tin dài), gửi file, nút bấm, nhận diện người gửi, phân biệt 1:1 / nhóm.
- **FR-05-02** Adapter MVP: **Telegram** (1:1 + nhóm), **Zalo Bot** (1:1), **web chat**.
- **FR-05-03** **Ghép tài khoản**: người lạ nhắn bot lần đầu → nhận mã ghép; người dùng nhập mã trên web để ghép `ChannelIdentity`.
  - KHI người chưa ghép tài khoản nhắn bot, THÌ bot chỉ trả hướng dẫn ghép tài khoản và không tạo `Task`.
- **FR-05-04** Trong nhóm: worker chỉ phản hồi khi được gọi tên (mention) hoặc trả lời tin của worker.
- **FR-05-05** Nhóm được vào phải được Admin đăng ký trước.
  - KHI bot của worker bị thêm vào một nhóm chưa đăng ký, THÌ bot báo Admin và không xử lý tin trong nhóm đó.
- **FR-05-06** (Theo #017) Dữ liệu không phải ai trong nhóm cũng được xem → gửi DM cho người giao việc.
- **FR-05-07** Tin của người khác trong nhóm, file gửi vào nhóm, nội dung email đọc được… luôn đánh dấu là **dữ liệu** khi đưa cho mô hình.

### 3.6. Lịch chạy (`FR-06`)

- **FR-06-01** Đặt lịch theo giờ / ngày / thứ trong tuần, theo giờ Việt Nam.
- **FR-06-02** Mỗi lịch gắn với một chỉ dẫn ("8h sáng: đọc email hỏi giá mới, soạn báo giá nháp, gửi nhóm Kinh doanh").
- **FR-06-03** Lỗi khi chạy theo lịch → báo người quản lý worker.

### 3.7. Connector (`FR-07`)

- **FR-07-01** **Google Sheets**: đọc dải ô, thêm dòng, sửa ô. Quyền theo từng file.
- **FR-07-02** **Email** (IMAP/SMTP hoặc Gmail): đọc thư theo bộ lọc, tạo thư nháp, gửi thư.
- **FR-07-03** Mức quyền: `read` / `draft` / `write`. `write` luôn là rủi ro cao.
- **FR-07-04** Thông tin đăng nhập connector mã hoá, chỉ Admin thấy là "đã cấu hình", không xem lại được giá trị.
- **FR-07-05** Connector viết theo giao diện MCP để thêm connector mới không sửa lõi.

### 3.8. Duyệt việc (`FR-08`)

- **FR-08-01** Quy tắc duyệt gắn với worker: hành động nào, điều kiện nào (vd. "gửi email ra ngoài", "báo giá > 50 triệu"), ai duyệt.
- **FR-08-02** Duyệt được **ngay trong app chat** (Telegram: nút Đồng ý / Từ chối / Sửa; Zalo: theo #021) và trên **hộp duyệt** web.
- **FR-08-03** Quá hạn duyệt (mặc định 24 giờ) → nhắc lại; quá 72 giờ → hủy việc.
- **FR-08-04** Mỗi lần duyệt ghi `AuditEvent`.
  - KHI người không có quyền duyệt bấm nút "Đồng ý", THÌ hệ thống từ chối và báo "bạn không có quyền duyệt việc này".

### 3.9. Kiểm duyệt (`FR-09`)

- **FR-09-01** Kích hoạt khi: worker lên chính thức, thêm skill, sửa skill, mở rộng quyền connector, thêm kênh / nhóm.
- **FR-09-02** **Quét tự động** nội dung skill và cấu hình:
  - câu lệnh lừa AI (prompt injection), ký tự ẩn (zero-width, bidi);
  - URL lạ, địa chỉ gửi dữ liệu ra ngoài;
  - mật khẩu / API key lộ trong file;
  - script trong skill: lệnh hệ thống nguy hiểm, cố truy cập mạng, đọc biến môi trường, ghi ngoài thư mục được phép, thư viện lạ.
- **FR-09-02b** Skill có script: Admin **phải xem nội dung script** (hiển thị trong màn kiểm duyệt) và chạy thử trong sandbox với file giả trước khi duyệt.
- **FR-09-03** **Kiểm tra quyền**: so quyền worker xin với mô tả công việc; cảnh báo quyền thừa (vd. worker "tóm tắt email" xin quyền `write` Sheets).
- **FR-09-04** Phân mức rủi ro: `thấp` (chỉ soạn thảo) / `trung bình` (đọc dữ liệu) / `cao` (ghi, gửi ra ngoài).
- **FR-09-05** Admin xem kết quả, ghi chú, chọn Duyệt / Từ chối. Rủi ro cao không có nút "duyệt nhanh".
- **FR-09-06** **Theo dõi sau chính thức**: cảnh báo khi chi phí ngày tăng vọt, lỗi lặp lại, gọi connector bất thường, người lạ nhắn bot nhiều lần.

### 3.10. Chi phí và bảng lương (`FR-10`)

- **FR-10-01** Tính tiền mỗi lần gọi mô hình theo bảng giá mô hình (cập nhật được), quy ra VNĐ theo tỉ giá cấu hình.
- **FR-10-02** Bảng lương: chi phí theo worker / phòng ban / tháng; số việc hoàn thành; tỉ lệ phải duyệt.
- **FR-10-03** Ngân sách tháng cho từng worker; cảnh báo ở 80%; hết ngân sách → theo #018.
- **FR-10-04** "Giờ công tiết kiệm" = số việc × thời gian ước tính cho mỗi loại việc (người quản lý nhập). Ghi rõ là ước tính.

### 3.11. Báo cáo sáng (`FR-11`)

- **FR-11-01** Gửi cho Owner (và Manager, nếu bật) qua app chat lúc giờ cấu hình.
- **FR-11-02** Nội dung: việc đã làm hôm qua theo worker, chi phí, việc chờ duyệt (có nút duyệt), cảnh báo.

### 3.12. Trình tạo skill tiếng Việt (`FR-12`)

- **FR-12-01** Người dùng kể quy trình bằng tiếng Việt (gõ hoặc dán) → AI hỏi lại chỗ thiếu → sinh `SKILL.md` nháp.
- **FR-12-02** Cho chạy thử skill nháp trên web chat với dữ liệu giả trước khi gửi duyệt.

### 3.13. Credit và nạp tiền (`FR-13`)

- **FR-13-01** Mỗi công ty có một `CreditAccount` (VNĐ, theo #025). Mọi thay đổi số dư đi qua `CreditTransaction`, không sửa trực tiếp.
- **FR-13-02** Trừ credit theo từng `CostEntry` = chi phí thật × hệ số giá (cấu hình được, theo #025).
- **FR-13-03** Nạp tiền theo #023: tạo `TopUp` → hiện mã VietQR + nội dung chuyển khoản riêng → xác nhận → cộng credit → gửi biên nhận.
  - KHI một `TopUp` được xác nhận hai lần, THÌ credit chỉ được cộng một lần.
- **FR-13-04** Số dư dưới ngưỡng (vd. 20%) → báo Owner; số dư bằng 0 → mọi worker ngừng nhận việc mới, báo Owner và Manager.
  - KHI số dư bằng 0, THÌ worker trả lời "công ty đã hết credit" và không gọi mô hình.
- **FR-13-05** Owner xem lịch sử nạp / trừ, tải sao kê theo tháng.
- **FR-13-06** Có **hoá đơn điện tử** cho mỗi lần nạp (MVP: xuất qua phần mềm hoá đơn bên ngoài, ghi số hoá đơn vào `TopUp`).
- **FR-13-07** Màn quản trị cho platform (chỉ Harry): xác nhận / huỷ `TopUp`, điều chỉnh credit có ghi lý do.

### 3.14. Chạy script của skill (`FR-14`)

- **FR-14-01** Theo #024: script chạy trong sandbox của nhà cung cấp mô hình; không có mạng.
- **FR-14-02** Dữ liệu vào sandbox chỉ là file / nội dung worker được phép đọc; kết quả trả về là file, worker gửi qua kênh chat hoặc ghi qua connector (theo quyền).
- **FR-14-03** Mỗi lần chạy ghi `SkillRun`: thời gian, kích thước file, chi phí; giới hạn thời gian và dung lượng.
  - KHI script chạy quá thời gian giới hạn, THÌ bị dừng, `Task` ghi lỗi, credit chỉ trừ phần đã dùng.
- **FR-14-04** Worker ở Thử việc chỉ chạy script với dữ liệu giả.

---

## 4. Yêu cầu phi chức năng

| Mã | Nhóm | Yêu cầu |
|---|---|---|
| NFR-01 | Tách dữ liệu | Mọi bảng nghiệp vụ có `company_id`; bật Row-Level Security ở PostgreSQL làm lớp bảo vệ thứ hai. |
| NFR-02 | Bí mật | API key của platform (`ProviderKey`), token bot, mật khẩu connector mã hoá khi lưu (AES-256-GCM, khoá ngoài DB). Không ghi vào log. |
| NFR-03 | Quyền riêng tư | Che dữ liệu cá nhân (CCCD, số điện thoại, số tài khoản) trong log và `AuditEvent`. Thời gian lưu theo #019. |
| NFR-04 | Pháp lý | Tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 (Luật 91/2025/QH15) và Nghị định hướng dẫn; dữ liệu lưu ở Việt Nam (#011); trang điều khoản nêu rõ việc gửi nội dung tới nhà cung cấp mô hình AI ở nước ngoài; hợp đồng xử lý dữ liệu với khách. |
| NFR-05 | Độ tin cậy | Việc chạy nền qua hàng đợi; thử lại khi lỗi mạng; không chạy trùng một `Task`. |
| NFR-06 | Phản hồi | Bot báo "đang làm…" trong vòng 3 giây sau khi nhận việc. |
| NFR-07 | Ngôn ngữ | Giao diện tiếng Việt (theo #020). |
| NFR-08 | Truy vết | Mọi hành động quản trị và mọi hành động rủi ro của worker có `AuditEvent`. |
| NFR-09 | Phụ thuộc | Không khoá vào một hãng mô hình: lớp gọi mô hình đổi được nhà cung cấp. |
| NFR-10 | Chi phí vận hành | MVP chạy được trên 1 máy chủ + 1 PostgreSQL. |

---

## 5. Ngoài phạm vi MVP

| Hạng mục | Dự kiến |
|---|---|
| Zalo nhóm | v0.2, khi API ổn định |
| Nhận việc theo sự kiện (email đến, dòng mới trong Sheet) | v0.2 |
| KPI chi tiết, đánh giá hàng tháng tự động | v0.2 |
| Kênh Messenger, Lark, Slack, Teams | v0.3, theo yêu cầu khách |
| Connector phần mềm kế toán, CRM | v0.3 |
| Worker phối hợp với nhau | v0.3 |
| Đồng bộ skill ra Claude Code / Codex / ChatGPT | Sau v0.3 |
| Worker nói chuyện với khách hàng bên ngoài (Zalo OA, Facebook Page) | Sau v0.3 |
| Cổng thanh toán tự động (PayOS / VNPay / MoMo), xuất hoá đơn tự động | Sau MVP |
| Khách dùng API key của mình (BYOK) | Chưa quyết (#016) |
| Chợ worker / skill công khai | Chưa quyết |
