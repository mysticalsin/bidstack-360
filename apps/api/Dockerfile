# syntax=docker/dockerfile:1
# Standalone API image (build context = repo root). Used by Railway, which
# builds a single final stage per service — point the service's
# RAILWAY_DOCKERFILE_PATH at this file. Mirrors the `api` target of the root
# Dockerfile; that multi-target file stays for docker-compose / Azure.
ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.0.0

# ─── Base (install workspace deps) ────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/dust-client/package.json ./packages/dust-client/
COPY packages/memos/package.json ./packages/memos/
COPY packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile

# ─── Builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @bidstack/db build \
 && pnpm --filter @bidstack/shared build \
 && pnpm --filter @bidstack/dust-client build \
 && pnpm --filter @bidstack/memos build \
 && pnpm --filter @bidstack/odoo-mcp-client build \
 && pnpm --filter @bidstack/api build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/dust-client/package.json ./packages/dust-client/
COPY --from=builder /app/packages/memos/package.json ./packages/memos/
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile --prod
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/memos/dist ./packages/memos/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
WORKDIR /app/apps/api
RUN addgroup -S bidstack && adduser -S -G bidstack bidstack && chown -R bidstack:bidstack /app
USER bidstack
EXPOSE 4000
# Apply pending migrations (idempotent) then boot. Only the API runs migrations.
# Uses npx prisma (devDep is absent in --prod) → fall back to the workspace bin
# if present; migrations are also runnable out-of-band (see DEPLOY.md).
CMD ["node", "dist/main.js"]
