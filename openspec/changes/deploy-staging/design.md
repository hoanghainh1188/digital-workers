# Design: deploy-staging

## Context

- Change 0 đã có `Dockerfile` (target `api`, `runner`, `caddy` — caddy chứa luôn web đã build), `compose.prod.yaml` (postgres không publish cổng, `migrate` chạy trước `api` / `runner`, chỉ `caddy` mở 80/443) và `Caddyfile` (HTTPS tự động, chặn `/health/*` từ ngoài, header bảo mật). `pnpm ci:runner` build ảnh bằng `.env.prod.example`.
- API và runner chạy TypeScript thẳng bằng Node 24 (#027) — ảnh không có bước build riêng.
- Kiến trúc mục 8: 1 máy ảo 2–4 vCPU / 4–8 GB, ổ đĩa riêng cho PostgreSQL; staging và prod sau này chung máy, khác project compose / khác DB.
- Lời mời (change 1b): tối đa 50 email mỗi lần, gửi lại làm mới token; chưa có hạn mức theo công ty (#082 dời sang change này).
- Báo giá cloud (#029) **chưa có** — xem Q1.

## Goals / Non-Goals

**Goals:**
- Một người (Harry) dựng lại được staging từ đầu chỉ bằng runbook + các bí mật giữ ngoài máy.
- Deploy và quay lại bằng một lệnh, biết bản nào đang chạy.
- Mất máy chủ không mất dữ liệu quá 24 giờ và không mất khả năng giải mã API key.

**Non-Goals:**
- Prod, nhiều máy, tự co giãn, Kubernetes.
- Giám sát / cảnh báo tự động (uptime, đầy đĩa) — ghi vào Open Questions, làm khi có khách thật.
- Sao lưu liên tục (WAL / PITR): RPO 24 giờ là đủ cho staging và MVP.
- Deploy tự động khi merge: deploy vẫn do người bấm (staging dùng để demo, không muốn bản đổi giữa buổi demo).

## Decisions

### D1. Nhà cung cấp và máy

- **VNG Cloud** (vServer + vStorage S3-compatible, region HCM), **Viettel Cloud** dự phòng (#029). Mọi thứ dùng giao diện chuẩn (máy ảo Ubuntu, object storage S3-compatible, DNS ở nhà đăng ký tên miền) để đổi nhà cung cấp chỉ là đổi runbook.
- Kích thước khởi đầu đề xuất: **2 vCPU / 4 GB RAM / 40 GB ổ hệ thống + 50 GB ổ dữ liệu riêng** gắn vào `/var/lib/docker/volumes` (chứa `pgdata`). Đủ cho staging (NFR-10); nâng cấp được không mất dữ liệu vì DB ở ổ riêng. Chốt theo báo giá (Q1).
- Ubuntu 24.04 LTS, Docker Engine + compose plugin từ repo chính thức của Docker, `unattended-upgrades` bật cho bản vá bảo mật.
- Đã cân nhắc: dịch vụ PostgreSQL có quản lý của nhà cung cấp — dễ sao lưu hơn nhưng đắt hơn và lệch khỏi `compose.prod.yaml`; để lại khi lên prod.

### D2. Build và đưa bản mới lên

- **Build ở GitHub Actions** (workflow mới `images.yml`, chạy khi push lên `main` và chạy tay): build 3 target `api`, `runner`, `caddy` cho `linux/amd64`, đẩy lên **GHCR riêng tư** `ghcr.io/<owner>/dw-{api,runner,caddy}:<git sha>`. Ảnh chỉ chứa code + web đã build, không có dữ liệu hay bí mật → đặt ngoài Việt Nam không trái #011.
  - Đã cân nhắc: build trên máy chủ (`git pull && compose build`) — đơn giản nhưng tốn RAM / CPU của máy 4 GB, máy chủ cần quyền đọc repo, và mỗi lần build có thể ra ảnh khác. Build trên Mac của Harry — kiến trúc arm64, phải cross-build. Registry của VNG — cần thêm tài khoản; đổi được sau vì chỉ là `IMAGE_REPO`. **Đã chốt GHCR (0.2 #145).**
  - `ci.yml` giữ nguyên (kiểm tra nhẹ, #030); `images.yml` là job riêng, không chạy test.
- **`compose.prod.yaml`**: mỗi service app có `image: ${IMAGE_REPO:-dw}/dw-api:${IMAGE_TAG:-local}` cạnh `build:` — `pnpm ci:runner` vẫn build tại chỗ, máy chủ chỉ `pull`. Thêm `logging: json-file, max-size 10m, max-file 5`. Tên project lấy từ `COMPOSE_PROJECT_NAME=dw-staging` trong file env.
- **`scripts/deploy.sh <git-sha>`** chạy trên máy Harry, SSH vào máy chủ:
  1. Kiểm tra ảnh của tag có trên GHCR.
  2. Trên máy chủ: ghi tag đang chạy vào `/opt/dw/staging/.deploy/previous`, đặt `IMAGE_TAG` mới, `docker compose pull`.
  3. `docker compose run --rm migrate` — lỗi thì dừng, **không** đụng container đang chạy.
  4. `docker compose up -d api runner caddy` (runner có `stop_grace_period: 200s`, #136).
  5. Chờ tới 60 giây: `docker compose exec caddy wget -qO- http://api:3000/health/ready` trả `ready`; rồi `curl https://<staging>/health` từ máy Harry. Ghi `/opt/dw/staging/.deploy/current`.
- **`scripts/deploy.sh --rollback`**: deploy lại tag trong `previous`, bỏ qua bước migrate.
- **Luật migration chỉ thêm** (expand / contract): một bản không được xoá / đổi tên cột hay bảng mà bản trước còn dùng; xoá làm ở bản sau nữa. Ghi luật vào `CLAUDE.md` mục "Hay quên" và runbook. Nhờ vậy quay lại không cần khôi phục DB. Migration phá vỡ thật sự (hiếm) → sao lưu tay ngay trước deploy, ghi trong runbook.

### D3. Kiểm tra sức khoẻ (đối chiếu ROADMAP)

ROADMAP ghi test "`https://<staging>/health/ready` trả 200", nhưng `Caddyfile` (change 0) cố ý trả 404 cho `/health/*` từ ngoài vì `/health/ready` chạm DB. Spec (`service-health`) và Caddyfile thắng ROADMAP. Change này **giữ chặn** (đã chốt, 0.2 #144) và tách test thành: (a) `https://<staging>/health` 200 + chứng chỉ hợp lệ từ ngoài — chứng minh DNS, TLS, Caddy, api; (b) `/health/ready` 200 gọi trong mạng nội bộ từ script deploy — chứng minh DB.

### D4. Bí mật

- Thư mục `/opt/dw/staging/` thuộc user `deploy` (không sudo đầy đủ, trong nhóm `docker`). `.env.prod` quyền **600**. Không commit, không vào ảnh (`.dockerignore` đã loại `.env*` — kiểm lại trong task), không nằm trong bản sao lưu (chỉ sao lưu DB).
- **`ENCRYPTION_KEY`** và **khoá riêng `age`** (D5) giữ trong trình quản lý mật khẩu của Harry (ví dụ Bitwarden / 1Password), thêm một bản in / USB cất riêng. Không bao giờ để cùng bucket sao lưu. Người giữ: Harry; người thứ hai: Q4.
- GHCR: máy chủ dùng một token chỉ có quyền `read:packages`.
- Xoay khoá: runbook có bước đổi mật khẩu DB, `BETTER_AUTH_SECRET`; xoay `ENCRYPTION_KEY` cần mã hoá lại dữ liệu — ngoài phạm vi, chỉ ghi là việc sau.

### D5. Sao lưu

- **systemd timer** lúc 02:00 `Asia/Ho_Chi_Minh` chạy `scripts/backup/backup.sh`:
  `docker compose exec -T postgres pg_dump -U postgres -Fc dw` → `age -r <khoá công khai>` → `rclone rcat vstorage:dw-staging-backup/dw-<YYYYMMDD-HHMM>.dump.age`. Dữ liệu không ghi ra đĩa ở dạng rõ.
- Sau khi tải lên thành công (kiểm tra kích thước bằng `rclone lsjson`), `prune.sh` giữ **14 bản mới nhất** theo tên, xoá phần còn lại. Đã cân nhắc: luật vòng đời (lifecycle) của bucket theo tuổi — xoá theo ngày nên ngày sao lưu lỗi vẫn làm mất bản cũ; đếm bản an toàn hơn.
- Lỗi ở bất kỳ bước nào → exit khác 0, `journalctl` ghi lỗi, không chạy prune.
- `pg_dump -Fc` bao gồm schema `pgboss`, vai trò không có trong dump → `restore.sh` tạo lại vai trò bằng `docker/postgres/roles.sql` trước khi `pg_restore`.
- Công cụ máy chủ: `age` (mã hoá bằng khoá công khai — máy chủ bị chiếm cũng không đọc được bản cũ), `rclone` (S3-compatible, không phụ thuộc nhà cung cấp). Đều không phải thư viện npm. Đã cân nhắc: `gpg --symmetric` (khoá giải mã phải nằm trên máy chủ), `aws` CLI (nặng hơn, cũng được).

### D6. Khôi phục

- `scripts/backup/restore.sh [tên bản | latest]` chạy trên **máy có khoá riêng** (máy Harry): tải bản, giải mã, chạy một container `postgres:16-alpine` trống, tạo vai trò, `pg_restore`, rồi kiểm tra: số migration = số file trong `packages/db/migrations`, `relrowsecurity` + `relforcerowsecurity` bật trên mọi bảng có `company_id`, và chạy `api` trỏ vào DB đó trả `/health/ready` 200.
- Cùng script, tham số `--target` cho phép khôi phục thật vào máy chủ (dừng `api` / `runner` trước). Ghi kết quả mỗi lần thử vào bảng trong `docs/ops/staging.md`.

### D7. Tường lửa và SSH

- Hai lớp: **security group** của nhà cung cấp (lớp ngoài, chặn trước khi tới máy) và `ufw` (lớp trong). Mở: 80/tcp, 443/tcp, 443/udp cho mọi nơi; 22/tcp chỉ cho IP trong runbook.
- Docker tự viết luật iptables cho cổng publish và vượt qua `ufw` — vì vậy chỉ `caddy` publish cổng, `postgres` không publish (đã có), và security group là lớp quyết định. Test cổng 5432 / 3000 chạy **từ một máy ngoài** (máy Harry ngoài mạng staging), không phải trên chính máy chủ.
- `sshd`: `PasswordAuthentication no`, `PermitRootLogin no`, chỉ user `deploy` và user quản trị.

### D8. Tên miền và email

- `staging.<tên miền>` trỏ A record về IP tĩnh của máy; Caddy lấy chứng chỉ Let's Encrypt (HTTP-01). `SITE_ADDRESS` và `PUBLIC_URL` đặt theo đó; `PUBLIC_BASE_URL` cũng đặt luôn để change 6 dùng.
- SMTP (#042): ưu tiên dịch vụ email của nhà cung cấp cloud Việt Nam nếu có; không thì một dịch vụ email giao dịch có SMTP. Tên miền gửi có SPF, DKIM, DMARC (`p=none` lúc đầu). Chọn ở Q3.

### D9. Hạn mức lời mời (#082)

- **Bảng `invitation_sends`** (chỉ thêm): `id`, `company_id NOT NULL`, `invitation_id` (khoá ngoại ghép `(company_id, invitation_id)`), `kind` (`initial` | `resend`), `sent_at`. RLS ENABLE + FORCE như các bảng khác; `dw_app` chỉ có `SELECT, INSERT`. Chỉ mục `(company_id, sent_at)`. Không có email / token. Đã cân nhắc: đếm từ `audit_events` — trộn mục đích, và nhật ký có thể đổi cách ghi; đếm trong bộ nhớ (`@fastify/rate-limit`) — mất khi khởi động lại và không đúng khi chạy nhiều tiến trình.
- Trong `createInvitations` / `resendInvitation` (cùng transaction `withCompany`):
  1. `pg_advisory_xact_lock` theo công ty (khoá tên `invite-quota` + `company_id`) — hai Admin mời cùng lúc không vượt hạn mức.
  2. Đếm `invitation_sends` của công ty trong 24 giờ; hạn mức = 20 nếu `companies.created_at > now() - 7 ngày`, ngược lại 200.
  3. Số lời mời sẽ tạo (sau khi loại email đã là thành viên / đang được mời) cộng số đã gửi > hạn mức → trả 429 `INVITATION_QUOTA_EXCEEDED` kèm `retryAfter` (thời điểm lần gửi cũ nhất trong cửa sổ hết 24 giờ). Không tạo gì, không gửi email.
  4. Gửi lại: thêm kiểm tra số `resend` của lời mời < 3 và lần gửi gần nhất cách ≥ 10 phút, không thì 429 `INVITATION_RESEND_LIMITED`.
  5. Chèn `invitation_sends` cho mỗi lời mời được tạo / gửi lại. Email gửi sau khi commit như hiện tại; gửi email lỗi vẫn tính (an toàn về phía chống rác).
- Con số (20 / 200 / 7 ngày / 3 lần / 10 phút) là hằng số trong `apps/api/src/org/invitation-quota.ts`, không phải biến môi trường — đổi số là đổi spec. Đã chốt (0.2 #143).
- `apps/web`: chuỗi tiếng Việt cho hai mã lỗi mới trong i18n, hiện trong hộp mời / nút gửi lại đã có.

## Risks / Trade-offs

- [Báo giá chưa có, nhà cung cấp có thể đổi] → mọi thứ dùng giao diện chuẩn (D1); đổi nhà cung cấp chỉ sửa runbook và remote của `rclone`.
- [Một máy, một ổ: máy hỏng là staging ngừng] → chấp nhận cho staging; RPO 24 giờ, RTO vài giờ theo runbook. Ghi rõ trước khi dùng thử với khách.
- [GHCR ngoài Việt Nam, GitHub ngừng thì không deploy được] → ảnh không chứa dữ liệu; vẫn build tại chỗ được bằng `build:` trong compose như đường lùi.
- [Docker vượt qua `ufw`] → chỉ caddy publish cổng, security group là lớp chính, test từ máy ngoài (D7).
- [Mất khoá `age` hoặc `ENCRYPTION_KEY` là mất dữ liệu / API key] → hai bản giữ ở hai nơi ngoài máy chủ; lần thử khôi phục đầu tiên dùng đúng bản giữ ngoài.
- [Migration "chỉ thêm" bị quên] → luật trong `CLAUDE.md`, mục kiểm tra trong mô tả PR; migration phá vỡ thì sao lưu tay trước.
- [Hạn mức quá chặt với công ty mới mời cả phòng] → 20 người / ngày đầu đủ cho SME 10–200 người thử dần; đã chốt (#143); đổi số là đổi spec.

## Migration Plan

1. Merge PR code (bảng `invitation_sends`, hạn mức, script, workflow, compose).
2. Thuê máy, gắn ổ, DNS, security group theo runbook; cài Docker, `age`, `rclone`, `ufw`; tạo user `deploy`.
3. Tạo `.env.prod` (600) trên máy; cất `ENCRYPTION_KEY` + khoá riêng `age` ngoài máy.
4. `scripts/deploy.sh <sha>` lần đầu; chạy test HTTPS, cổng, SSH.
5. Bật timer sao lưu; chạy tay một lần; thử khôi phục trên máy Harry; ghi vào runbook.
Quay lại: `scripts/deploy.sh --rollback`. Bỏ cả change: tắt máy, xoá bucket — không ảnh hưởng dev.

## Open Questions

Không còn câu hỏi hoãn được; các câu còn mở trước khi dựng máy (Q1–Q4: nhà cung cấp, tên miền, SMTP, người giữ khoá) nằm trong mô tả PR.
