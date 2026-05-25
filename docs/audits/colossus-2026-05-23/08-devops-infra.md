# DevOps & Infrastructure Audit

## Summary
- Dockerfile targets: 6 (base, builder, api, web, worker, mcp-server)
- Health check endpoints: `/health`, `/livez`, `/readyz` (api only); `/health` (nginx web only)
- Missing env vars: `STORAGE_DRIVER`, `STORAGE_SCAN_REQUIRED`, `JOB_SIGNING_SECRET` / `BIDSTACK_JOB_SIGNING_SECRET`, `BIDSTACK_OCR_ENABLED`, `BIDSTACK_OCR_TIMEOUT_MS`, `BIDSTACK_OCR_LANGUAGES`, `BIDSTACK_TESSERACT_BIN`, `BIDSTACK_OCRMYPDF_BIN`
- Top risk: Worker and MCP server containers have no health checks — orchestrators cannot detect crash loops or deadlocks.

## Findings

| Severity | File | Issue | Fix |
|----------|------|-------|-----|
| Critical | `Dockerfile` (worker, mcp-server targets) | No `HEALTHCHECK` instruction. Worker and MCP server have no `/health`, `/livez`, or `/readyz` endpoints in source code. | Add lightweight HTTP health endpoints to worker and MCP server; add `HEALTHCHECK` to both Dockerfile targets. |
| High | `.env.example` | Missing `STORAGE_DRIVER` and `STORAGE_SCAN_REQUIRED`. These are required by `docker-compose.prod.yml` (`:?` syntax) and by the API readiness probe (`storageConfigReady`). | Add `STORAGE_DRIVER=local` and `STORAGE_SCAN_REQUIRED=false` to `.env.example` with comments. |
| High | `.env.example` | Missing `JOB_SIGNING_SECRET` / `BIDSTACK_JOB_SIGNING_SECRET` and OCR env vars (`BIDSTACK_OCR_ENABLED`, `BIDSTACK_OCR_TIMEOUT_MS`, `BIDSTACK_OCR_LANGUAGES`, `BIDSTACK_TESSERACT_BIN`, `BIDSTACK_OCRMYPDF_BIN`). Worker and queue code reference them. | Add all worker/OCR configuration variables to `.env.example`. |
| High | `.dockerignore` | Does not exclude dev/tooling directories (`.claude/`, `.playwright-mcp/`, `.swarm_state/`, `.tmp*/`, `.audit-screens/`, etc.). These directories bloat the build context copied in `COPY . .`. | Add exclusions for all non-source dev/tooling directories. |
| Medium | `Dockerfile` (web target) | `HEALTHCHECK` runs `wget http://localhost/` instead of `http://localhost/health`. The nginx config defines a lightweight `/health` endpoint. | Change wget URL to `http://localhost/health` for a precise, lightweight probe. |
| Medium | `docker-compose.prod.yml` (api build) | Passes `BIDSTACK_BUILD_AUTH_MODE: clerk` as a build arg to the api service, but the `api` Dockerfile target does not declare or consume this `ARG`. | Remove the unused build arg from the api service, or document why it is needed. |
| Medium | `.github/workflows/ci.yml` (e2e job) | Builds web without `VITE_CLERK_PUBLISHABLE_KEY` or `BIDSTACK_BUILD_AUTH_MODE=clerk`. E2E tests stub auth; production builds Clerk auth — risk of auth-path regressions passing CI. | Pass `VITE_CLERK_PUBLISHABLE_KEY` and `BIDSTACK_BUILD_AUTH_MODE=clerk` to the e2e build step (use a test/dev Clerk key). |
| Medium | `docker-compose.prod.yml` (redis service) | Redis has no `healthcheck` block, unlike postgres. Other services depend on it with `condition: service_started`, which is weaker. | Add a `healthcheck` to redis (`redis-cli ping`) and change dependent conditions to `service_healthy` for consistency. |
| Low | `docker-compose.yml` (dev) | Live-reload volume mount (`./apps/api/src:/app/apps/api/src:ro`) is only defined for the api service. Worker and MCP server lack equivalent mounts. | Add read-only source mounts to worker and mcp-server for consistent dev hot-reload. |
| Low | `.github/workflows/lighthouse.yml` | Uses `npm install -g @lhci/cli` instead of `pnpm dlx` or adding the dependency to the workspace. Breaks monorepo package-manager consistency. | Replace with `pnpm dlx @lhci/cli@0.14.x autorun` or pin as a devDependency. |
