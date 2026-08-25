# Plan: Add Security Headers to Vercel Deployment

## Objective

Configure Vercel to send Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy headers on all Polo static responses.

## Current State

Production HTML (https://bidstack-demo.vercel.app/) contains a comment claiming CSP enforcement:
```html
<!-- Must stay an external file: the production CSP forbids inline scripts. -->
```

However, `curl -sI https://bidstack-demo.vercel.app/` shows:
- ✓ Strict-Transport-Security (Vercel default)
- ✗ Content-Security-Policy (missing)
- ✗ X-Frame-Options (missing)
- ✗ X-Content-Type-Options (missing)
- ✗ Referrer-Policy (missing)
- ✗ Permissions-Policy (missing)

The API server already enforces these headers via `apps/api/src/plugins/security-headers.ts`. The static frontend does not.

## Root Cause

The root `vercel.json` configures build/output but has no `headers` section. Vercel does not automatically apply security headers to static assets.

## Solution

Add a `headers` array to `vercel.json` with a catch-all route pattern `/(.*)` that applies:

1. **Content-Security-Policy**: Match the policy in `security-headers.ts` line 47-71
   - Allow `'self'` for most resources
   - Allow `'unsafe-inline'` for scripts (needed for theme-init inline script in index.html)
   - Allow external origins for Clerk (auth), Sentry (errors), Dust, Apollo, Zoom, Deepgram, Microsoft Graph, Google APIs, Twilio
   - Block `object-src`, `media-src`
   - Lock down `frame-ancestors`, `base-uri`, `form-action`

2. **Strict-Transport-Security**: `max-age=31536000; includeSubDomains; preload`

3. **X-Frame-Options**: `DENY`

4. **X-Content-Type-Options**: `nosniff`

5. **Referrer-Policy**: `strict-origin-when-cross-origin`

6. **Permissions-Policy**: Disable camera, microphone, geolocation, payment, usb, magnetometer, gyroscope, accelerometer

7. **Cross-Origin-Opener-Policy**: `same-origin`

## Files Changed

- `vercel.json` (root) - add `headers` section

## Constraints

- One logical change only: security headers configuration
- No Clerk tenant changes (accounts.dev stays)
- No Vercel git-link
- No product features
- No force-push
- No production deployment (PR only)

## CSP Compatibility

The CSP must not break:

- **Clerk login**: `connect-src` includes `https://api.clerk.com` and `https://*.clerk.accounts.dev`; `frame-src` includes `https://*.clerk.accounts.dev`
- **Sentry error tracking**: `connect-src` includes `https://*.sentry.io`
- **Theme initialization**: `script-src` includes `'unsafe-inline'` for the inline script in index.html lines 24-34

## Verification

After deployment to preview:

```bash
curl -sI <preview-url>
```

Must show all seven headers with correct values.

After merge and production deployment:

```bash
curl -sI https://bidstack-demo.vercel.app/
```

Must show the same headers.

## Ship Gate

PR must pass Codex Integrator review (VERDICT: SHIP) before merge.
