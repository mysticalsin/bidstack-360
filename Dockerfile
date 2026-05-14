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
COPY packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ─── Builder ────────────────────────────────────────────────────────────────
FROM base AS builder
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @bidstack/shared build
RUN pnpm --filter @bidstack/dust-client build
RUN pnpm --filter @bidstack/odoo-mcp-client build
RUN pnpm -r build

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
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => r.statusCode===200?process.exit(0):process.exit(1))"
CMD ["node", "dist/main.js"]

# ─── Web ────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY --from=builder /app/apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# ─── Worker ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS worker
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
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
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

# ─── MCP Server ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS mcp-server
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
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
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
WORKDIR /app/apps/mcp-server
EXPOSE 3001
CMD ["node", "dist/main.js"]
