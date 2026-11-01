# syntax=docker/dockerfile:1
# Always-on Polo preview: Postgres (pgvector) + Redis + API + the built SPA.
# The Worker proxies port 8080. Build context is the repository root.

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:${PATH}
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# `api` `tsc` exits 2 on main (msa detail response types). It still emits dist.
RUN pnpm db:generate \
  && pnpm --filter @bidstack/shared build \
  && pnpm --filter @bidstack/db build \
  && pnpm --filter @bidstack/dust-client build \
  && pnpm --filter @bidstack/memos build \
  && pnpm --filter @bidstack/odoo-mcp-client build \
  && (pnpm --filter @bidstack/api build || test -f apps/api/dist/main.js)
# The web `build` script typechecks first. `tsc -b` is red on main
# (missing names in a few pages). Vite still produces the SPA the preview serves.
ENV VITE_API_URL=
ENV VITE_AUTH_MODE=stub
ENV BIDSTACK_ALLOW_STUB_AUTH=true
ENV NODE_ENV=production
RUN pnpm --filter @bidstack/web exec vite build

FROM pgvector/pgvector:pg16
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates nginx redis-server libatomic1 \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=build /app /app
COPY apps/polo-preview/src/nginx.preview.conf /etc/nginx/conf.d/preview.conf
COPY apps/polo-preview/src/preview-entrypoint.sh /usr/local/bin/preview-entrypoint.sh
RUN chmod 755 /usr/local/bin/preview-entrypoint.sh \
  && node -v \
  && nginx -t
ENV POSTGRES_USER=bidstack \
    POSTGRES_PASSWORD=bidstack \
    POSTGRES_DB=bidstack \
    NODE_ENV=development \
    PORT_API=4000 \
    HOST=127.0.0.1 \
    DATABASE_URL=postgres://bidstack:bidstack@127.0.0.1:5432/bidstack \
    REDIS_URL=redis://127.0.0.1:6379 \
    PUBLIC_BASE_URL=https://polo-preview.tony-walteur.workers.dev \
    PUBLIC_API_URL=https://polo-preview.tony-walteur.workers.dev \
    PUPPETEER_SKIP_DOWNLOAD=true
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/preview-entrypoint.sh"]
