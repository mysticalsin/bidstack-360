# Security Headers Proof

## Configuration Verification

### vercel.json Headers Section

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' wss: https://*.bidstack.io https://api.clerk.com https://*.clerk.accounts.dev https://dust.tt https://*.dust.tt https://*.sentry.io https://api.apollo.io https://api.zoom.us https://zoom.us https://api.deepgram.com https://graph.microsoft.com https://www.googleapis.com https://api.twilio.com; object-src 'none'; frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; media-src 'none'; upgrade-insecure-requests"
        },
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=31536000; includeSubDomains; preload"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
        },
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        }
      ]
    }
  ]
}
```

## Current Production State

```bash
$ curl -sI https://bidstack-demo.vercel.app/
HTTP/2 200 
accept-ranges: bytes
access-control-allow-origin: *
age: 312
cache-control: public, max-age=0, must-revalidate
content-disposition: inline
content-type: text/html; charset=utf-8
date: Tue, 25 Aug 2026 05:17:44 GMT
etag: "88db4603234d5e10bf7c94d9eb1cc521"
last-modified: Tue, 25 Aug 2026 05:12:31 GMT
server: Vercel
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-vercel-cache: HIT
x-vercel-id: iad1::jwh86-1787635064351-1b34b3ee0567
content-length: 2691
```

**Missing Headers:**
- Content-Security-Policy
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- Cross-Origin-Opener-Policy

## Expected State After Deployment

```bash
$ curl -sI <preview-url>
HTTP/2 200 
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' wss: https://*.bidstack.io https://api.clerk.com https://*.clerk.accounts.dev https://dust.tt https://*.dust.tt https://*.sentry.io https://api.apollo.io https://api.zoom.us https://zoom.us https://api.deepgram.com https://graph.microsoft.com https://www.googleapis.com https://api.twilio.com; object-src 'none'; frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; media-src 'none'; upgrade-insecure-requests
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
cross-origin-opener-policy: same-origin
accept-ranges: bytes
access-control-allow-origin: *
cache-control: public, max-age=0, must-revalidate
content-disposition: inline
content-type: text/html; charset=utf-8
server: Vercel
```

## Deployment Requirement

**BLOCKED**: Preview deployment requires Vercel credentials not available in this environment.

To complete verification:

1. Deploy preview:
   ```bash
   cd /workspace
   npx vercel@latest deploy --token <token>
   ```

2. Curl the preview URL:
   ```bash
   curl -sI <preview-url-from-step-1>
   ```

3. Verify all seven headers are present:
   ```bash
   curl -sI <preview-url> | grep -i "content-security\|x-frame\|x-content\|referrer\|permissions\|cross-origin-opener"
   ```

## Configuration Source Match

The vercel.json configuration matches the API server security headers policy in `apps/api/src/plugins/security-headers.ts`:

| Header | API (security-headers.ts) | Frontend (vercel.json) | Match |
|--------|--------------------------|------------------------|-------|
| Content-Security-Policy | Lines 47-71 | ✓ | ✓ |
| Strict-Transport-Security | Line 89 | ✓ | ✓ |
| X-Frame-Options | Line 93 | ✓ | ✓ |
| X-Content-Type-Options | Line 96 | ✓ | ✓ |
| Referrer-Policy | Line 99 | ✓ | ✓ |
| Permissions-Policy | Lines 74-76, 102 | ✓ | ✓ |
| Cross-Origin-Opener-Policy | Line 105 | ✓ | ✓ |

## Vercel Headers Documentation Reference

Per [Vercel headers documentation](https://vercel.com/docs/projects/project-configuration#headers), the configuration format is correct:

- `source`: Glob pattern matching request paths
- `headers`: Array of header objects with `key` and `value`
- Headers are applied at edge before response

The catch-all pattern `/(.*)`  applies headers to all routes including:
- `/` (root)
- `/login`
- `/api/*` (if served through Vercel)
- Static assets in `/assets/*`, `/icon.svg`, etc.

## Ship Status

Configuration ready. Awaiting:
1. Preview deployment with credentials
2. curl proof of headers on preview URL
3. Codex Integrator review (VERDICT: SHIP)
