# Public Demo Mode Production Acknowledgement

## Problem

`DEMO_MODE=true` intentionally exposes a public passwordless demo door: any
visitor email gets a fresh ephemeral org. That is acceptable for a dedicated
public demo deployment, but unsafe as an accidental enterprise production
configuration.

Before this fix, production boot validation required the demo session secret
and blocked Clerk coexistence, but it did not require a second operator
acknowledgement that the production instance was intentionally public demo
infrastructure.

## Solution

- Add `DEMO_PUBLIC_DEPLOYMENT_ACK=false` to the API environment contract.
- When `DEMO_MODE=true` and `NODE_ENV=production`, fail boot unless
  `DEMO_PUBLIC_DEPLOYMENT_ACK=true`.
- Document the env in `.env.example` as public-demo-only and never for a real
  enterprise tenant.
- Preserve the existing demo-mode rules: demo mode remains mutually exclusive
  with Clerk and still requires `DEMO_SESSION_SECRET`.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/env.ts src/env.test.ts`:
  pass.
- `git diff --check -- .env.example apps/api/src/env.ts apps/api/src/env.test.ts`:
  pass with LF/CRLF warnings only.

## Residual Risk

This closes one production misconfiguration path. It does not certify demo mode
for real enterprise tenants, and it does not replace full Clerk staging proof,
live security review, clean source review, or platform approval.
