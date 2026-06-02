# syntax=docker/dockerfile:1
# Standalone Worker image (build context = repo root). Point the Railway
# worker service's RAILWAY_DOCKERFILE_PATH at this file. Mirrors the `worker`
# target of the root Dockerfile (incl. OCR tools + Python scoring sidecar).
ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.0.0

# ─── Base ─────────────────────────────────────────────────────────────────────
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
 && pnpm --filter @bidstack/worker build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# OCR pipeline (ocrmypdf/tesseract/ghostscript) + Python for the XGBoost scoring
# sidecar. Omitting these only degrades OCR + predictive scoring; Apollo
# enrichment + the core RFP pipeline run on Node alone.
RUN apk add --no-cache curl ghostscript ocrmypdf qpdf tesseract-ocr tesseract-ocr-data-eng python3 py3-pip
COPY --from=builder /app/apps/worker/python/requirements.txt /tmp/worker-py-reqs.txt
RUN python3 -m venv /opt/python-venv \
 && /opt/python-venv/bin/pip install --no-cache-dir -r /tmp/worker-py-reqs.txt \
 && rm /tmp/worker-py-reqs.txt
ENV PATH="/opt/python-venv/bin:$PATH"
ENV PREDICTIVE_PYTHON_BIN=/opt/python-venv/bin/python3
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/dust-client/package.json ./packages/dust-client/
COPY --from=builder /app/packages/odoo-mcp-client/package.json ./packages/odoo-mcp-client/
COPY --from=builder /app/packages/memos/package.json ./packages/memos/
RUN pnpm install --no-frozen-lockfile --prod
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/dust-client/dist ./packages/dust-client/dist
COPY --from=builder /app/packages/odoo-mcp-client/dist ./packages/odoo-mcp-client/dist
COPY --from=builder /app/packages/memos/dist ./packages/memos/dist
COPY --from=builder /app/apps/worker/python ./apps/worker/python
WORKDIR /app/apps/worker
RUN addgroup -S bidstack && adduser -S -G bidstack bidstack && chown -R bidstack:bidstack /app
USER bidstack
EXPOSE 4002
CMD ["node", "dist/main.js"]
