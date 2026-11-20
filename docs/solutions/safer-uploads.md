# Safer uploads (D3 / D4 / D5)

**Problem:** Account-file finalize treated `STORAGE_SCAN_REQUIRED=true` as
a hard 409 without scanning bytes, S3 PUTs requested no SSE, and
`text/html` stayed on the allow-list.

**Fix:** Finalize INSTREAM-scans the stored object against clamd when the
flag is on (`CLAMAV_HOST` / `CLAMAV_PORT`). Infected objects are deleted
and the row is never written. S3/R2 `PutObject` (presigned and server)
requests SSE-S3 `AES256`. `text/html` is rejected at the shared schema;
org-chart HTML import is unchanged.

**Do not:** mark an upload malware-safe when the scanner host is missing
or down. Do not re-allow HTML on `/api/files/*`.
