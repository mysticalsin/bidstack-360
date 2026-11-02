# Main full-suite green (E2E, Semgrep, Lighthouse)

**Problem:** After #245 / #247, `main` required unit CI was green, but the extra
gates failed: full E2E, Semgrep ERROR, and Lighthouse CI.

**Fixes:**

- Viewer / Read-Only must not open Audit Log. The matrix strips `audit-log:read`
  from Read-Only; the UI gate is still `settings:write` (`RequireAdmin`). The
  capabilities API was already correct. The SPA only forwards
  `x-bidstack-e2e-role` when `VITE_ENABLE_E2E_ROLE_HEADER` is baked in. CI
  built the web artifact without that flag, so `/audit-log` treated the viewer
  as the stub admin and redirected to `/settings?tab=audit-log`. Bake the flag
  into the E2E web build and set the header on the Playwright context.
- iPhone SE / iPad Mini device descriptors set `defaultBrowserType: 'webkit'`.
  Spreading them into `test.use()` launched WebKit on the chromium-desktop
  project. CI only installs Chromium. Use viewport / UA / touch only.
- Full-suite workflow installs Chromium only, then ran firefox + webkit
  projects. Pin the shard command to `--project=chromium-desktop`.
- Proposals seed/cleanup now hit `E2E_API_URL` so a hung preview proxy cannot
  eat the 60s test timeout during `finally`.
- Semgrep ERROR: move Actions interpolations into `env:` (e2e shard, tsdoc
  base ref) and run the standalone API image as `USER bidstack`.
- Lighthouse `NO_FCP`: Vite preview prints `Local:`, not `ready in`. Match
  that, add CI chrome flags, and paint the login card at opacity 1.
- `playwright merge-reports` has no `--output`. Emit blob reports per shard
  and merge those into HTML via `PLAYWRIGHT_HTML_REPORT`.

**Do not:** skip the failing specs, install WebKit just to satisfy a device
spread, or treat Semgrep workflow YAML as out of scope when the gate is red.
