---
source_agent: codex
generated: 2026-06-29T06:48:00-04:00
confidence: 0.86
target_path: D:\BIDCRM
---

# CSP Single Source In Security Headers

## Problem

`apps/api/src/server.ts` registered a Helmet Content-Security-Policy while
`apps/api/src/plugins/security-headers.ts` overwrote `Content-Security-Policy`
in an `onSend` hook. The effective policy was the plugin policy, but the dead
Helmet policy could drift and mislead audits.

## Fix

- Disable Helmet CSP in `server.ts`.
- Keep CSP construction in `buildContentSecurityPolicy` inside
  `security-headers.ts`.
- Move the provider `connect-src` allowlist into that builder.
- Let `securityHeadersPlugin` own `Permissions-Policy` too, removing the
  duplicate server-level hook.
- Add a focused test that compares the effective server header with the builder.

## Prevention

Future CSP changes go through `buildContentSecurityPolicy` and its test. Do not
add another CSP source in Helmet, nginx, route hooks, or middleware unless it is
a route-specific stricter override such as file downloads.
