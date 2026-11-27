# syntax=docker/dockerfile:1
# Targets: api, runner, caddy (serves the built web app). See compose.prod.yaml.
# api/runner run TypeScript directly with Node type stripping (0.2 #027): no build step.
# Workspace packages stay symlinked to /repo/packages/*, outside node_modules,
# which Node requires before it strips types.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- api + runner: production dependencies only --------------------------
FROM base AS server-deps
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@dw/api..." --filter "@dw/runner..."

FROM node:24-alpine AS server
ENV NODE_ENV=production
WORKDIR /repo
# Root-owned: the node user can run the code but not modify it.
COPY --from=server-deps /repo /repo
USER node

FROM server AS api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "apps/api/src/main.ts"]

FROM server AS runner
CMD ["node", "apps/runner/src/main.ts"]

# --- web: static build served by Caddy ------------------------------------
FROM base AS web-build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@dw/web..." && pnpm --filter @dw/web build

FROM caddy:2-alpine AS caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /repo/apps/web/dist /srv
