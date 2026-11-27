#!/usr/bin/env bash
# Full CI on this machine (decision 0.2 #030): run before merging any code PR.
# Needs Docker (Testcontainers, image build). Stops at the first failing step.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

step "lint"
pnpm lint

step "typecheck"
pnpm typecheck

step "unit tests"
pnpm test

step "integration tests (Docker)"
pnpm test:int

step "e2e (Playwright)"
pnpm e2e

step "openspec validate"
if command -v openspec >/dev/null; then
  openspec validate --all --strict
else
  npx --yes @fission-ai/openspec@1 validate --all --strict
fi

step "build production images"
docker compose --env-file .env.prod.example -f compose.prod.yaml build

printf '\n\033[1;32m✔ ci:runner passed\033[0m\n'
