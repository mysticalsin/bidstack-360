# syntax=docker/dockerfile:1
# BidStack 360° — Multi-stage monorepo build
# Targets: base → builder → api | web | worker | mcp-server

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.27.0

# ─── Base ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY apps/marketing/package.json ./apps/marketing/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/dust-client/package.json ./packages/dust-client/
COPY packages/memos/package.json ./packages/memos/
COPY packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
COPY packages/integrations/package.json ./packages/integrations/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ─── Builder ────────────────────────────────────────────────────────────────
FROM base AS builder
ARG PUBLIC_CLERK_PUBLISHABLE=
ARG VITE_API_URL=/api
ARG ASSET_CDN_URL=
ARG BIDSTACK_WEB_BUILD_MODE=stub
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @bidstack/shared build
RUN pnpm --filter @bidstack/db build
RUN pnpm --filter @bidstack/dust-client build
RUN pnpm --filter @bidstack/memos build
RUN pnpm --filter @bidstack/odoo-mcp-client build
RUN pnpm --filter @bidstack/api build
RUN case "$BIDSTACK_WEB_BUILD_MODE" in \
      clerk) VITE_CLERK_PUBLISHABLE_KEY="$PUBLIC_CLERK_PUBLISHABLE" VITE_API_URL="$VITE_API_URL" ASSET_CDN_URL="$ASSET_CDN_URL" pnpm --filter @bidstack/web build:prod ;; \
      demo) VITE_API_URL="$VITE_API_URL" ASSET_CDN_URL="$ASSET_CDN_URL" pnpm --filter @bidstack/web build:demo ;; \
      stub) VITE_API_URL="$VITE_API_URL" ASSET_CDN_URL="$ASSET_CDN_URL" pnpm --filter @bidstack/web build ;; \
      *) echo "Unsupported BIDSTACK_WEB_BUILD_MODE=$BIDSTACK_WEB_BUILD_MODE" >&2; exit 1 ;; \
    esac
RUN pnpm --filter @bidstack/worker build
RUN pnpm --filter @bidstack/mcp-server build

# Worker-only builder used by the `worker` target. The full `builder` stage
# above intentionally builds every deployable artifact for api/web/mcp-server
# targets, but forcing that path for worker-only deploys makes the worker image
# slow and fragile to rebuild. Keep this stage aligned with apps/worker/Dockerfile.
FROM base AS worker-builder
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @bidstack/shared build \
 && pnpm --filter @bidstack/db build \
 && pnpm --filter @bidstack/dust-client build \
 && pnpm --filter @bidstack/memos build \
 && pnpm --filter @bidstack/odoo-mcp-client build \
 && pnpm --filter @bidstack/worker build

# ─── Migrate (one-shot: applies pending migrations, then exits) ───────────────
# Run this image to completion BEFORE rolling app revisions — locally via the
# `migrate` compose service, on Azure as a Container Apps Job. Keep this target
# schema-only: `prisma migrate deploy` needs Prisma CLI + schema/migrations, not
# compiled app artifacts or the full monorepo dependency tree.
FROM node:${NODE_VERSION} AS migrate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @bidstack/db --prod=false
ENV NODE_ENV=production
RUN addgroup -S bidstack && adduser -S -G bidstack bidstack
COPY --chown=bidstack:bidstack packages/db/prisma ./packages/db/prisma
COPY --chown=bidstack:bidstack scripts/run-safe-migrate-deploy.mjs ./scripts/run-safe-migrate-deploy.mjs
RUN mkdir -p /run/bidstack && chown bidstack:bidstack /run/bidstack
RUN rm -rf /root/.cache/node /pnpm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER bidstack
CMD ["node", "scripts/run-safe-migrate-deploy.mjs", "--prisma-bin", "./packages/db/node_modules/.bin/prisma", "--schema", "packages/db/prisma/schema.prisma"]

# ─── API ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS api
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache ca-certificates chromium freetype harfbuzz nss openssl ttf-freefont
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
RUN addgroup -S bidstack && adduser -S -G bidstack bidstack
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/dust-client/package.json ./packages/dust-client/
COPY --from=builder /app/packages/memos/package.json ./packages/memos/
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --chown=bidstack:bidstack --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/db/dist ./packages/db/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/db/generated ./packages/db/generated
COPY --chown=bidstack:bidstack --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/memos/dist ./packages/memos/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/db/prisma ./packages/db/prisma
RUN rm -rf /root/.cache/node /pnpm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app/apps/api
# Run as non-root — reduces container-escape blast radius.
USER bidstack
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/readyz', (r) => r.statusCode===200?process.exit(0):process.exit(1))"
CMD ["node", "dist/main.js"]

# ─── Web ────────────────────────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:alpine AS web
USER root
RUN apk upgrade --no-cache
COPY --chown=nginx:nginx --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY --chown=nginx:nginx --from=builder /app/apps/web/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# CDN configuration:
# 1. Build the web app with ASSET_CDN_URL=https://cdn.example.com
#    to rewrite asset URLs in the generated HTML/JS.
# 2. Upload the contents of /app/apps/web/dist/assets to your CDN.
# 3. Serve index.html and non-asset files from this nginx container.
# 4. For CloudFront/S3: set Cache-Control: max-age=31536000, immutable on assets.
# 5. For Cloudflare: enable Auto Minify + Brotli.

# ─── Worker ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS worker
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# System tools: OCR pipeline (ocrmypdf, tesseract, ghostscript). Predictive
# XGBoost remains opt-in in code and falls back to logistic regression when the
# Python sidecar is unavailable.
RUN apk add --no-cache curl ghostscript ocrmypdf openssl qpdf tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-osd python3 py3-pip
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
# Create the runtime user before copying the workspace so Docker can assign
# ownership during COPY instead of emitting a second recursive chown layer.
RUN addgroup -S bidstack && adduser -S -G bidstack bidstack
# Ship the builder's fully resolved workspace, matching the certified standalone
# worker image. A second --prod install can prune hoisted workspace deps that the
# compiled worker imports at runtime.
COPY --chown=bidstack:bidstack --from=worker-builder /app ./
RUN rm -rf /root/.cache/node /pnpm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app/apps/worker
# Run as non-root — reduces container-escape blast radius.
USER bidstack
EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4002/health || exit 1
CMD ["node", "dist/main.js"]

# ─── MCP Server ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS mcp-server
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk add --no-cache curl openssl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
RUN addgroup -S bidstack && adduser -S -G bidstack bidstack
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/mcp-server/package.json ./apps/mcp-server/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/dust-client/package.json ./packages/dust-client/
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --chown=bidstack:bidstack --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/db/dist ./packages/db/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/db/generated ./packages/db/generated
COPY --chown=bidstack:bidstack --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --chown=bidstack:bidstack --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
RUN rm -rf /root/.cache/node /pnpm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app/apps/mcp-server
# Run as non-root — reduces container-escape blast radius.
USER bidstack
EXPOSE 4001
EXPOSE 4003
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4003/health || exit 1
CMD ["node", "dist/main.js"]
