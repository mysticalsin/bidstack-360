# Web Edge Security Headers

## Problem

The production web nginx config only shipped the basic `X-Frame-Options`,
`X-Content-Type-Options`, and `Referrer-Policy` headers. App-shell and asset
locations also declare their own `add_header Cache-Control` directives; in
nginx, that shadows parent `add_header` directives unless the security headers
are repeated in those locations.

For a 100k-user enterprise CRM, the edge must carry a browser hardening policy
without weakening the fresh app-shell cache contract.

## Pattern

- Declare the baseline security headers at the server edge.
- Repeat the same security headers in every location that declares cache
  headers.
- Keep app-shell entrypoints (`/`, `/index.html`, `/manifest.json`, `/sw.js`)
  `no-store`.
- Keep hashed assets immutable.
- Treat CSP as a deployable contract: include Clerk and Cloudflare challenge
  frame/script origins, allow HTTPS/WSS connections for provider SDKs and
  telemetry, and keep dangerous defaults closed (`object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`).

## Implementation

- `apps/web/nginx.conf`
- `apps/web/src/lib/nginx-cache-policy.test.ts`

## Verification

- Red regression first: `pnpm --filter @bidstack/web test -- src/lib/nginx-cache-policy.test.ts --reporter=dot`
  failed while HSTS, CSP, COOP/CORP, and Permissions-Policy were absent.
- `pnpm --filter @bidstack/web test -- src/lib/nginx-cache-policy.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/web exec eslint src/lib/nginx-cache-policy.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `docker run --rm -v <nginx.conf>:/etc/nginx/conf.d/default.conf:ro nginxinc/nginx-unprivileged:alpine nginx -t`:
  pass.
- Live container header smoke on `/health`: 200 with XFO, XCTO,
  Referrer-Policy, HSTS, COOP, CORP, Permissions-Policy, and CSP.
- Live container header smoke on `/`: 200 with the same security headers and
  `Cache-Control: no-cache, no-store, must-revalidate`.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 396
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed source review
  packets.

## Remaining Risk

The CSP includes Clerk/Cloudflare challenge allowances and broad HTTPS/WSS
connectivity, but live Clerk/Sentry/provider staging still must be verified
before release. Do not treat local header smokes as full browser-matrix
certification.
