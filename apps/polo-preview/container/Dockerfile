# syntax=docker/dockerfile:1
# Polo on Cloudflare Containers: Postgres (pgvector) + Redis + API + the built
# SPA, all from one `main` checkout. Build context is the repository root.
# Data is restored from R2 on boot (see container/entrypoint.mjs).

FROM node:24-bookworm-slim AS build
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate \
  && pnpm --filter @bidstack/shared build \
  && pnpm --filter @bidstack/db build \
  && pnpm --filter @bidstack/dust-client build \
  && pnpm --filter @bidstack/memos build \
  && pnpm --filter @bidstack/odoo-mcp-client build \
  && pnpm --filter @bidstack/integrations build \
  && pnpm --filter @bidstack/api build
# Same-origin API (empty VITE_API_URL) and Cloudflare Access sign-in.
RUN VITE_API_URL= VITE_AUTH_MODE=cf-access NODE_ENV=production pnpm --filter @bidstack/web exec vite build

FROM pgvector/pgvector:pg16
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates redis-server libatomic1 tar gzip \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app
ENV PATH=/usr/lib/postgresql/16/bin:/usr/local/bin:$PATH \
    PUPPETEER_SKIP_DOWNLOAD=true
RUN mkdir -p /data && chown postgres:postgres /data
WORKDIR /app
USER postgres
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/').then((r) => process.exit(r.status < 500 || r.status === 503 ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "/app/apps/polo-preview/container/entrypoint.mjs"]
