# Verification Status

## Configuration Complete

The security headers are configured in `/workspace/vercel.json` (lines 8-42). All seven headers are present with correct values matching the API security policy.

## Deployment Required for Proof

**Status**: Cannot deploy preview from this environment (VERCEL_TOKEN not available)

Tony requested: "curl -sI a preview URL and show the new headers"

### Options for Verification

1. **Manual Vercel CLI deployment** (requires VERCEL_TOKEN):
   ```bash
   cd /workspace
   npx vercel@latest deploy
   ```
   Then curl the preview URL shown in output.

2. **Git-based deployment** (requires git-linking the Vercel project):
   - Not pursued per constraint: "do not git-link Vercel"

3. **Vercel API deployment** (requires files upload):
   - Not practical for full monorepo

### Local Simulation

The test-headers-server.js can demonstrate the headers locally:

```bash
# Build the app first (requires Node 24)
bash -c 'source ~/.nvm/nvm.sh && nvm use 24 && corepack enable && pnpm --filter @bidstack/web build:demo'

# Start test server
node test-headers-server.js

# In another terminal:
curl -sI http://localhost:8080/
```

Expected output:
```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), ...
Cross-Origin-Opener-Policy: same-origin
```

## Configuration Proof

The vercel.json configuration is correct and ready:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; ..."
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

## Next Steps

1. Deploy preview manually with Vercel CLI (requires credentials)
2. Curl preview URL to verify headers
3. Document curl output in PR
4. Ready for Codex Integrator review
