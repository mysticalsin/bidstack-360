# syntax=docker/dockerfile:1
# BidStack 360° — Multi-stage monorepo build
# Targets: base → builder → api | web | worker | mcp-server

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.0.0

# ─── Base ───────────────────────────────────────────────────────────────────
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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ─── Builder ────────────────────────────────────────────────────────────────
FROM base AS builder
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_URL=/api
ARG BIDSTACK_BUILD_AUTH_MODE=stub
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_API_URL=${VITE_API_URL}
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @bidstack/db build
RUN pnpm --filter @bidstack/shared build
RUN pnpm --filter @bidstack/dust-client build
RUN pnpm --filter @bidstack/memos build
RUN pnpm --filter @bidstack/odoo-mcp-client build
RUN pnpm --filter @bidstack/api build
RUN if [ "$BIDSTACK_BUILD_AUTH_MODE" = "clerk" ]; then pnpm --filter @bidstack/web build:prod; else pnpm --filter @bidstack/web build; fi
RUN pnpm --filter @bidstack/worker build
RUN pnpm --filter @bidstack/mcp-server build

# ─── API ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS api
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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/memos/dist ./packages/memos/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/readyz', (r) => r.statusCode===200?process.exit(0):process.exit(1))"
CMD ["node", "dist/main.js"]

# ─── Web ────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY --from=builder /app/apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

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
RUN apk add --no-cache curl ghostscript ocrmypdf qpdf tesseract-ocr tesseract-ocr-data-eng
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/dust-client/package.json ./packages/dust-client/
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
WORKDIR /app/apps/worker
EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4002/health || exit 1
CMD ["node", "dist/main.js"]

# ─── MCP Server ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS mcp-server
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk add --no-cache curl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/mcp-server/package.json ./apps/mcp-server/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/dust-client/package.json ./packages/dust-client/
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
WORKDIR /app/apps/mcp-server
EXPOSE 3001
EXPOSE 4003
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD curl -f http://localhost:4003/health || exit 1
CMD ["node", "dist/main.js"]
