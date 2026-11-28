# Tasks: deploy-staging

> Nhóm 1–4 là code trong repo (làm và test trên máy, không cần máy chủ). Nhóm 5–8 là dựng và kiểm tra staging thật, cần câu trả lời Q1–Q4 trong PR (nhà cung cấp, tên miền, SMTP, người giữ khoá).

## 1. Hạn mức lời mời (#082)

- [ ] 1.1 Schema + migration `invitation_sends` theo design D9 (`company_id NOT NULL`, khoá ngoại ghép `(company_id, invitation_id)`, `kind`, `sent_at`, chỉ mục `(company_id, sent_at)`, RLS ENABLE + FORCE, `dw_app` chỉ `SELECT, INSERT`); verify: `pnpm --filter @dw/db generate` không còn khác biệt; test tích hợp `withCompany(A)` không đọc / chèn được dòng của B, `UPDATE` / `DELETE` bị từ chối
- [ ] 1.2 `apps/api/src/org/invitation-quota.ts`: hằng số 20 / 200 / 7 ngày / 3 lần / 10 phút và hàm `checkInviteQuota(tx, count)` + `checkResend(tx, invitationId)` (khoá `pg_advisory_xact_lock` theo công ty, đếm 24 giờ, tính `retryAfter`); verify: unit test ranh giới công ty 6 ngày 23 giờ / 7 ngày, đúng 20 / 21 người
- [ ] 1.3 Nối vào `createInvitations` và `resendInvitation`: kiểm tra trước khi tạo, chèn `invitation_sends` mỗi lần gửi, trả 429 `INVITATION_QUOTA_EXCEEDED` / `INVITATION_RESEND_LIMITED`; verify: test tích hợp đủ kịch bản spec `invitations` (công ty mới vượt, còn hạn mức, gửi lại sớm, lần thứ tư, id công ty khác 404 không tính)
- [ ] 1.4 Test hai yêu cầu mời cùng lúc của cùng công ty mới (15 + 15): đúng một thành công; verify: `pnpm test:int` xanh, chạy 20 lần không lệch
- [ ] 1.5 `apps/web`: chuỗi tiếng Việt cho hai mã lỗi trong i18n, hiện trong hộp mời và nút gửi lại (kèm giờ gửi tiếp được); verify: test component hiện đúng câu, không chuỗi viết cứng

## 2. Ảnh và compose

- [ ] 2.1 `.dockerignore` thêm `.env`, `.env.*` (giữ `!.env.example`, `!.env.prod.example`) — hiện `COPY . .` sẽ chép `.env` của máy build vào ảnh; verify: build ảnh khi có `.env` giả, `docker run --rm <ảnh> ls -a /repo` không có `.env`
- [ ] 2.2 `compose.prod.yaml`: `image: ${IMAGE_REPO:-dw}/dw-<service>:${IMAGE_TAG:-local}` cho `migrate`, `api`, `runner`, `caddy` (giữ `build:`), `logging` json-file 10m × 5; `.env.prod.example` thêm `COMPOSE_PROJECT_NAME`, `IMAGE_REPO`, `IMAGE_TAG`, `PUBLIC_BASE_URL`; verify: `docker compose --env-file .env.prod.example -f compose.prod.yaml config` hợp lệ; `pnpm ci:runner` vẫn build được
- [ ] 2.3 `.github/workflows/images.yml`: push lên `main` + chạy tay, build 3 target `linux/amd64`, đẩy GHCR tag git sha, quyền `packages: write` chỉ ở job này; verify: chạy trên nhánh bằng `workflow_dispatch`, thấy 3 ảnh trên GHCR; `ci.yml` không đổi
- [ ] 2.4 Test ảnh không chứa bí mật: script kiểm `docker image inspect` (Env) và danh sách file của 3 ảnh không có `.env*` hay giá trị trong `.env.prod.example`; thêm vào `scripts/ci-runner.sh` sau bước build; verify: `pnpm ci:runner` xanh

## 3. Script deploy

- [ ] 3.1 `scripts/deploy.sh <sha>` theo design D2 (kiểm ảnh có trên GHCR, ghi `previous`, pull, `run --rm migrate`, `up -d`, chờ `/health/ready` nội bộ, `curl https://…/health`, ghi `current`); `--status` in sha đang chạy và trước đó; verify: chạy thử với máy chủ giả là một VM / container SSH local, hoặc `shellcheck` sạch + chạy thật ở 6.1
- [ ] 3.2 `scripts/deploy.sh --rollback`: chạy lại tag `previous`, bỏ migrate; migration lỗi ở 3.1 dừng trước `up`; verify: ở 6.3
- [ ] 3.3 `CLAUDE.md` mục "Hay quên": luật migration chỉ thêm (không xoá / đổi tên cột, bảng bản trước còn dùng); verify: có dòng trong `CLAUDE.md`

## 4. Script sao lưu và khôi phục

- [ ] 4.1 `scripts/backup/backup.sh` (pg_dump `-Fc` → `age -r` → `rclone rcat`, không ghi file rõ ra đĩa, exit khác 0 khi lỗi) và `prune.sh` (giữ 14 bản theo tên, chỉ chạy khi tải lên đủ); verify: `shellcheck` sạch; chạy với remote `rclone` kiểu thư mục local: 15 lần → còn 14, lần lỗi giữa chừng không xoá gì
- [ ] 4.2 `scripts/backup/restore.sh [tên | latest] [--target]` theo design D6 (tạo vai trò từ `docker/postgres/roles.sql`, `pg_restore`, kiểm số migration, RLS bật + FORCE trên mọi bảng có `company_id`); verify: sao lưu DB dev có dữ liệu 2 công ty → khôi phục vào container trống → `dw_app` với `app.company_id` của A chỉ thấy A
- [ ] 4.3 File `systemd` `dw-backup.service` + `dw-backup.timer` (02:00 `Asia/Ho_Chi_Minh`, `Persistent=true`) trong `scripts/backup/systemd/`; verify: `systemd-analyze verify` sạch (trên máy chủ ở 7.1)

## 5. Dựng máy (cần Q1, Q2)

- [ ] 5.1 `docs/ops/staging.md`: nhà cung cấp + vùng của máy / ổ / bucket, kích thước, IP SSH được phép, các bước dựng máy, deploy, quay lại, khôi phục, nơi giữ khoá (không ghi giá trị), bảng nhật ký thử khôi phục; verify: người khác đọc runbook làm được bước 5.2–5.4
- [ ] 5.2 Thuê máy ảo + ổ dữ liệu + IP tĩnh + bucket ở vùng Việt Nam; security group 80/443 tcp, 443 udp, 22 từ IP cho phép; verify: bảng điều khiển khớp runbook (spec "Máy chủ đặt ở Việt Nam")
- [ ] 5.3 Cài Ubuntu 24.04, Docker + compose, `age`, `rclone`, `ufw` (cùng luật), `unattended-upgrades`; user `deploy`; `sshd` không mật khẩu, không root; gắn ổ dữ liệu vào thư mục volume Docker; verify: `ssh -o PreferredAuthentications=password` bị từ chối
- [ ] 5.4 DNS `staging.<tên miền>`; SMTP + SPF / DKIM / DMARC (Q3); `.env.prod` quyền 600 chủ `deploy`; cất `ENCRYPTION_KEY` + khoá riêng `age` ngoài máy (Q4); verify: `stat -c '%a %U' .env.prod` = `600 deploy`

## 6. Deploy lần đầu và kiểm tra

- [ ] 6.1 `scripts/deploy.sh <sha của main>`; verify: từ máy ngoài `curl -sv https://<staging>/health` 200, chứng chỉ hợp lệ đúng tên miền; `http://` chuyển sang `https://`; script báo `/health/ready` nội bộ 200
- [ ] 6.2 Test cổng từ máy ngoài: `nc -vz <ip> 5432`, `3000`, `3001` không kết nối được; `https://<staging>/health/ready` trả 404; SSH từ IP ngoài danh sách bị chặn (thử qua mạng điện thoại); verify: ghi kết quả vào runbook
- [ ] 6.3 Thử quay lại: deploy một sha mới rồi `--rollback`; thử một migration lỗi trên nhánh thử → bản cũ vẫn chạy; verify: `--status` đúng, dữ liệu tạo giữa chừng còn
- [ ] 6.4 Đăng ký một công ty thử trên staging, xác minh email thật, mời 21 người trong ngày đầu → lần thứ 21 bị 429; verify: email tới hộp thư thật, không vào spam với nhà cung cấp lớn (Gmail)

## 7. Sao lưu và khôi phục thật

- [ ] 7.1 Cài timer, chạy `systemctl start dw-backup.service` một lần; verify: bucket có bản mới; tải bản về và mở không có khoá → không đọc được
- [ ] 7.2 Thử khôi phục bản mới nhất trên máy Harry bằng khoá riêng lấy từ nơi giữ ngoài máy chủ (không dùng bản trên ổ đang làm việc); verify: `restore.sh latest` xanh, `api` trỏ vào DB khôi phục trả `/health/ready` 200, ghi dòng đầu tiên vào nhật ký thử khôi phục
- [ ] 7.3 Sau 2 ngày: kiểm timer chạy đúng 02:00 (`journalctl -u dw-backup`); verify: có 2 bản tự động

## 8. Kết thúc

- [ ] 8.1 Ghi các quyết định đã trả lời (Q1–Q6) vào `docs/requirements.md` 0.2 (số tiếp theo + ngày), sửa `docs/architecture.md` mục 8 theo nhà cung cấp đã chốt; verify: `openspec validate --all --strict` xanh
- [ ] 8.2 `pnpm ci:runner` xanh; mô tả PR có kết quả 6.1, 6.2, 7.2

## Workflow follow-up

- Archive change, cập nhật `docs/ROADMAP.md` (5a ✅, gỡ dòng "Báo giá cloud" ở điều kiện trước khi bắt đầu).
- Change 6 dùng `PUBLIC_BASE_URL` của staging cho webhook Telegram.
