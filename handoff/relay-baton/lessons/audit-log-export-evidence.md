# 2026-06-07: Audit Exports Are Evidence, Not Client Convenience

## Context

The Audit Log export was a current-page CSV generated in the browser.

## Lesson

Compliance exports must be backend-owned, tenant-scoped, audited, bounded,
cache-safe, and Excel-injection-safe. The export action itself should create an
audit event, and the workbook should include provenance metadata.

## Codified In

- `apps/api/src/routes/audit-logs.ts`
- `apps/api/src/routes/audit-logs.test.ts`
- `docs/solutions/audit-log-server-side-xlsx-export.md`
