# Local dashboard proxy 500

## Symptom

The web app shows `Could not load dashboard` and API calls through the Vite origin return HTTP 500.

## Cause

In local dev, `apps/web/vite.config.ts` proxies `/api` to the API target, defaulting to `http://localhost:4000`. If the web server is running but the API server is not, Vite returns proxy-layer 500s. The backend route tests can still pass because they build the API in-process.

## Fast Check

```powershell
netstat -ano | findstr ":38081"
netstat -ano | findstr ":4000"
Invoke-WebRequest -UseBasicParsing http://localhost:38081/api/v1/crm/summary
Invoke-WebRequest -UseBasicParsing http://localhost:38081/api/v1/reports/pipeline
Invoke-WebRequest -UseBasicParsing http://localhost:38081/api/v1/crm/dashboard
```

## Fix

Run the full dev stack with `pnpm dev`, or keep the existing web server and start the API with:

```powershell
corepack pnpm --filter @bidstack/api dev
```

The dashboard is healthy when the three web-origin API checks return 200 and a browser smoke of `/dashboard` has no API responses with status >= 500.
