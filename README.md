# digital-workers (working name)

A platform for Vietnamese SMEs to hire and manage digital workers: AI agents with HR-style profiles (probation → full-time → paused → offboarded), skills (`SKILL.md`), connector permissions, approval rules and budgets, working through Telegram, Zalo and web chat.

Docs: [`docs/requirements.md`](docs/requirements.md) (decision log 0.2), [`docs/architecture.md`](docs/architecture.md), [`docs/ROADMAP.md`](docs/ROADMAP.md). Working rules for Claude Code: [`CLAUDE.md`](CLAUDE.md). Changes go through OpenSpec (`openspec/`).

## Requirements

- Node.js **24 LTS** (`.nvmrc`) — TypeScript runs directly via Node type stripping, no build step for api / runner.
- pnpm **9** (`corepack enable`)
- Docker (PostgreSQL for dev, Testcontainers for integration tests, production images)

## Run locally

```bash
corepack enable
pnpm install
cp .env.example .env          # dev values already match compose.yaml
docker compose up -d --wait   # PostgreSQL 16 (roles dw_owner / dw_app) + Mailpit
pnpm db:migrate
pnpm dev                      # api :3000, runner, web :5173
```

Check: `curl localhost:3000/health/ready` → `{"status":"ready"}`, and open http://localhost:5173.

### Try signing up

1. Open http://localhost:5173/signup, create a company (password ≥ 10 characters, e.g. a phrase like `gom an phu bat trang`).
2. You land in the app with a yellow "Xác minh email" banner.
3. Open Mailpit at http://localhost:8025 — every email sent in dev lands there. Click the link in "Xác minh email của bạn"; the banner disappears.

Google sign-in shows up only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set (redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google`).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | api + runner (`node --watch`) and web (Vite) in parallel |
| `pnpm lint` | Biome lint + format check (`pnpm format` to fix) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Unit tests (Vitest), no Docker needed |
| `pnpm test:int` | Integration tests against real PostgreSQL (Testcontainers, needs Docker) |
| `pnpm e2e` | Playwright against the built web app (first time: `pnpm --filter @dw/web exec playwright install chromium`) |
| `pnpm db:migrate` | Apply migrations as `dw_owner` (`MIGRATION_DATABASE_URL`) |
| `pnpm ci:runner` | Everything above + `openspec validate` + production image build. Run before merging a code PR. |
| `openspec validate --all --strict` | Validate specs and changes |

GitHub Actions runs only lint, typecheck, unit tests and `openspec validate` (decision 0.2 #030).

## Layout

```
apps/api       Fastify API: health, Better Auth (/api/auth/*), signup, /api/me, company, members
apps/runner    background process (queue arrives with add-worker-runtime-webchat)
apps/web       React + Vite + shadcn/ui + TanStack Router/Query, Vietnamese strings in src/i18n/vi.ts
packages/core  config loading (Zod), logger with redaction, graceful shutdown,
               permission matrix (can), password policy, shared input schemas
packages/db    PostgreSQL pool, Drizzle schema + migrations, RLS helper withCompany, Testcontainers helper
packages/mail  nodemailer wrapper, in-memory mailer for tests, Vietnamese email templates
```

Other packages (`llm`, `billing`, `crypto`, …) are created by the change that needs them.

## Database roles

- `dw_owner` owns the schema and runs migrations.
- `dw_app` is what api / runner use: not a table owner and `NOBYPASSRLS`, so Row-Level Security applies.
- Business tables (`companies`, `members`, `audit_events`, …) have RLS keyed on `app.company_id`. Query them only through `withCompany(db, companyId, fn)` from `@dw/db`; outside it they return no rows.
- Better Auth's tables live in schema `auth` without RLS (global identities). Only `apps/api/src/auth/` may touch them; a test enforces this.

## Production (try on this machine)

```bash
cp .env.prod.example .env.prod   # set real passwords (openssl rand -hex 24), BETTER_AUTH_SECRET, PUBLIC_URL, SMTP_URL
docker compose --env-file .env.prod -f compose.prod.yaml up -d --build --wait
curl -k https://localhost/health/ready
```

Caddy serves the web app and proxies `/api/*` (including Better Auth at `/api/auth/*`; session cookies are `Secure` in production), `/webhooks/*`, `/health*` to the API. With `SITE_ADDRESS` set to a real domain it obtains TLS certificates itself. Deploying to the Vietnamese cloud happens in change `deploy-staging`.
