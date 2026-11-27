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
# Pinned to the same version as .github/workflows/ci.yml so local and CI agree.
npx --yes @fission-ai/openspec@1.17.0 validate --all --strict

step "build production images"
docker compose --env-file .env.prod.example -f compose.prod.yaml build

printf '\n\033[1;32m✔ ci:runner passed\033[0m\n'
