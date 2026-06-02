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
RUN pnpm install --no-frozen-lockfile

# ─── Builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @bidstack/shared build \
 && pnpm --filter @bidstack/db build \
 && pnpm --filter @bidstack/dust-client build \
 && pnpm --filter @bidstack/memos build \
 && pnpm --filter @bidstack/odoo-mcp-client build \
 && pnpm --filter @bidstack/api build

# ─── Runtime ──────────────────────────────────────────────────────────────────
# Ship the builder's fully-resolved workspace wholesale (node_modules with all
# pnpm symlinks + every dist + generated Prisma client). A fresh `--prod`
# install pruned hoisted/undeclared deps (e.g. pino) that the compiled bundle
# resolves at runtime, crashing the boot. Copying the proven tree eliminates
# that whole class of failure. Larger image, but image size is not a concern
# for the demo. Runs as root — acceptable for an isolated demo container.
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY --from=builder /app ./
WORKDIR /app/apps/api
EXPOSE 4000
# Apply pending Prisma migrations against Railway's private Postgres (reachable
# only from inside the container) then boot. `migrate deploy` is idempotent —
# it applies only unapplied migrations, so it's safe on every restart. The
# Prisma CLI is present because the runtime ships the builder's full deps.
CMD ["sh", "-c", "pnpm --filter @bidstack/db migrate:deploy && node dist/main.js"]
