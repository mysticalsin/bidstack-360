# syntax=docker/dockerfile:1
# BidStack 360° — Marketing site build.
#
# Two-stage: builder runs pnpm/vite/sitemap script, runtime is nginx-unprivileged
# (rootless) listening on port 8080. Maps to host:8081 via docker-compose.prod.yml.

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.0.0

# ─── Builder ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Copy workspace manifests first so the dep-install layer caches across code-only
# changes. Marketing has no @bidstack/* workspace deps — keeps the install lean.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/marketing/package.json ./apps/marketing/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @bidstack/marketing...

# Now copy source and build.
COPY apps/marketing ./apps/marketing
COPY tsconfig.base.json ./
RUN pnpm --filter @bidstack/marketing build

# ─── Runtime ────────────────────────────────────────────────────────────────
# nginx-unprivileged runs as UID 101 on port 8080 — no root, no port binding
# under 1024. Safer default than vanilla nginx:alpine.
FROM nginxinc/nginx-unprivileged:alpine AS marketing
COPY --from=builder /app/apps/marketing/dist /usr/share/nginx/html
COPY --from=builder /app/apps/marketing/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1
