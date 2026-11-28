# Proposal: deploy-staging

## Why

Tới change 5, mọi thứ mới chạy trên máy Harry. Change 6 (Telegram) cần một **địa chỉ HTTPS công khai** để nhận webhook (#031), và trước khi mời khách thật phải có máy chủ ở Việt Nam (#011, NFR-04), sao lưu thật có thử khôi phục, và chặn việc dùng lời mời để gửi email rác (#082). Change này đưa staging lên cloud Việt Nam với đúng `compose.prod.yaml` đã có từ change 0.

## What Changes

- **Máy chủ staging** trên cloud Việt Nam: 1 máy ảo Ubuntu 24.04 LTS + ổ đĩa riêng cho PostgreSQL, tên miền `staging.<tên miền>`, HTTPS tự động qua Caddy. Đề xuất **VNG Cloud**, Viettel Cloud dự phòng (#029); **chốt nhà cung cấp và kích thước máy khi có báo giá** (câu hỏi mở trong PR).
- **Cách đưa bản mới lên**: GitHub Actions build ảnh `api` / `runner` / `caddy` theo commit trên `main`, đẩy lên registry riêng; máy chủ kéo ảnh theo tag (git sha), chạy `migrate` rồi mới chạy `api` / `runner`. Quay lại bản cũ = deploy lại tag trước. Migration chỉ được thêm (bản cũ chạy được trên schema mới).
- **`compose.prod.yaml`**: thêm `image:` theo `IMAGE_TAG` (giữ `build:` để `pnpm ci:runner` vẫn build được), xoay log, tên project theo môi trường để sau này prod chạy cùng máy.
- **Bí mật trên máy**: `.env.prod` quyền 600, chủ là user `deploy`, không commit. `ENCRYPTION_KEY` và khoá giải mã sao lưu có bản sao ngoài máy chủ, tách khỏi bản sao lưu.
- **Sao lưu PostgreSQL** hằng ngày ra object storage cùng nhà cung cấp, đặt ở Việt Nam; mã hoá trước khi tải lên; **giữ 14 bản**; script khôi phục vào DB trống, chạy thử được.
- **Tường lửa**: chỉ mở 80, 443 (TCP + UDP), SSH chỉ từ IP cho phép, chỉ đăng nhập bằng khoá. PostgreSQL không có cổng ra ngoài.
- **Gửi email thật** qua SMTP của nhà cung cấp chọn ở change này (#042); bản ghi SPF / DKIM / DMARC cho tên miền gửi.
- **Hạn mức gửi lời mời theo công ty** (#082): số người nhận mỗi ngày (công ty mới thấp hơn), giới hạn số lần và khoảng cách gửi lại một lời mời. Vượt hạn mức → từ chối, không gửi email.
- Không có trong change này: môi trường prod, giám sát / cảnh báo tự động, webhook Telegram (change 6), xoá hội thoại quá 90 ngày (change 8).

## Capabilities

### New Capabilities

- `server-deployment`: máy chủ chạy ở đâu và được truy cập thế nào — HTTPS với chứng chỉ hợp lệ, chỉ mở cổng cần thiết, cơ sở dữ liệu không ra ngoài, đưa bản mới lên và quay lại bản cũ, bí mật trên máy chủ.
- `database-backup`: sao lưu PostgreSQL hằng ngày, mã hoá, lưu ở Việt Nam, giữ 14 bản, khôi phục được vào DB trống.

### Modified Capabilities

- `invitations`: thêm requirement hạn mức số người nhận lời mời mỗi ngày theo công ty và giới hạn gửi lại một lời mời (#082). Các requirement cũ giữ nguyên.

## Impact

- File mới: `.github/workflows/images.yml` (build + đẩy ảnh), `scripts/deploy.sh`, `scripts/backup/` (sao lưu, dọn bản cũ, khôi phục), `docs/ops/staging.md` (runbook: dựng máy, deploy, quay lại, khôi phục, xoay khoá).
- `compose.prod.yaml`, `.env.prod.example`: `IMAGE_REPO`, `IMAGE_TAG`, xoay log, tên project.
- `packages/db`: migration bảng `invitation_sends` (chỉ thêm, có `company_id` + RLS) để đếm lần gửi.
- `apps/api`: kiểm tra hạn mức khi tạo / gửi lại lời mời; mã lỗi mới; chuỗi tiếng Việt trong i18n của `apps/web` cho mã lỗi đó.
- Công cụ trên máy chủ (không phải thư viện của code): Docker Engine + compose plugin, `age` (mã hoá sao lưu), `rclone` (tải lên object storage S3-compatible), `ufw`. Không thêm thư viện npm.
- Chi phí: máy ảo + ổ đĩa + object storage + tên miền (theo báo giá #029).
- `docs/requirements.md` 0.2: ghi các quyết định khi được trả lời trong PR này (nhà cung cấp cloud, SMTP, tên miền, con số hạn mức).
