# AUDIT-EXPORT-001: Audit Log Export Was Client-Only

- Severity: High
- State: resolved
- Source: 2026-06-07 Audit Log hardening pass
- Owner: Codex
- Files:
  - `apps/api/src/routes/audit-logs.ts`
  - `apps/api/src/routes/audit-logs.test.ts`
  - `packages/shared/src/schemas/audit-log.ts`
  - `apps/web/src/components/settings/AuditLogSection.tsx`
  - `apps/web/src/pages/audit-log/AuditLogFilters.tsx`

## Problem

The Audit Log could only export the currently loaded client page as CSV. That
made compliance exports incomplete, unaudited, and not safe enough for
enterprise evidence handling.

## Fix

Added a tenant-scoped server-side XLSX export with metadata, full audit rows,
bounded rich scans, Excel formula-prefix neutralization, `private, no-store`,
and an `audit_log.export.xlsx` audit event for every export. The old CSV remains
available as a secondary "Visible CSV" action for quick page-level sharing.

## Verification

- `pnpm --filter @bidstack/shared build` - PASS.
- `pnpm --filter @bidstack/shared typecheck` - PASS.
- `pnpm --filter @bidstack/api typecheck` - PASS.
- `pnpm --filter @bidstack/api exec vitest run src/routes/audit-logs.test.ts --reporter=dot` - PASS, 4/4.
- `pnpm --filter @bidstack/web typecheck` - PASS.
- `pnpm --filter @bidstack/web exec playwright test e2e/audit-log.spec.ts --reporter=line` - PASS, 5 passed / 1 skipped.
- Live proxy workbook parse - PASS.
