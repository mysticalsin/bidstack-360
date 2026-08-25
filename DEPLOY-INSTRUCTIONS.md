# Deployment Instructions for Verification

## Prerequisites

- Vercel CLI credentials
- Access to tonywalteur-4867 team on Vercel
- Project: polo-presales (prj_PSFdk5P5XiBPOHW5tgA15i8YjctQ)

## Steps to Deploy Preview

1. **Authenticate with Vercel** (if not already done):
   ```bash
   npx vercel@latest login
   ```

2. **Deploy from workspace root**:
   ```bash
   cd /workspace
   npx vercel@latest deploy
   ```
   
   This will:
   - Upload the project files
   - Run the build command from vercel.json: `pnpm --filter @bidstack/web build:demo`
   - Deploy to a preview URL
   - Apply the headers configuration from vercel.json

3. **Capture the preview URL** from the output:
   ```
   Preview: https://bidstack-360-<hash>.vercel.app
   ```

4. **Verify headers with curl**:
   ```bash
   curl -sI https://bidstack-360-<hash>.vercel.app/
   ```

5. **Extract security headers**:
   ```bash
   curl -sI https://bidstack-360-<hash>.vercel.app/ | grep -i "content-security\|x-frame\|x-content\|referrer\|permissions\|cross-origin-opener\|strict-transport"
   ```

## Expected Output

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' wss: https://*.bidstack.io https://api.clerk.com https://*.clerk.accounts.dev https://dust.tt https://*.dust.tt https://*.sentry.io https://api.apollo.io https://api.zoom.us https://zoom.us https://api.deepgram.com https://graph.microsoft.com https://www.googleapis.com https://api.twilio.com; object-src 'none'; frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; media-src 'none'; upgrade-insecure-requests
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
cross-origin-opener-policy: same-origin
```

## Functional Testing

After verifying headers are present:

1. **Test Clerk Login**:
   - Navigate to preview URL
   - Click sign in
   - Verify Clerk authentication flow works
   - Check browser console for CSP violations (should be none)

2. **Test Sentry** (if test error tracking is available):
   - Trigger a test error
   - Verify error is captured by Sentry
   - Confirms CSP allows sentry.io connections

3. **Visual Inspection**:
   - Verify app loads correctly
   - Verify fonts load (confirms fonts.googleapis.com / fonts.gstatic.com allowed)
   - Verify theme loads correctly (confirms inline script works with CSP)

## Documentation of Results

Add curl output to PR comment or update PROOF.md with actual preview URL and headers.
