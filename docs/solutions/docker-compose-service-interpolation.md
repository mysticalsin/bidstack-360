# Docker Compose Service Interpolation

## Problem

`docker compose up -d redis` can still fail when another service in the same compose file has a required environment interpolation, such as `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}`. Compose interpolates the full file before selecting the requested service.

## Solution

For one-off service starts that do not need the required value, provide a process-local placeholder only for interpolation:

```powershell
$env:POSTGRES_PASSWORD = 'unused-for-redis-start'
docker compose up -d redis
Remove-Item Env:\POSTGRES_PASSWORD
```

Do not print or reuse real `.env` secrets for this.

## Prevention

When adding required interpolation to Compose files, remember it affects every `docker compose` invocation. For developer convenience, consider either documenting the placeholder pattern or moving required checks into service-specific env files/scripts.
