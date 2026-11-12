// Same import as the partial index: org, source, and file hash, while the
// row is PENDING or RUNNING. The boot guard reads this and does not write.

export const ACTIVE_IMPORT_MIGRATION = '20261112170000_migration_jobs_one_active_per_org_source';

export const DUPLICATE_PRECHECK_SQL = `
SELECT org_id::text, sum(active)::text
FROM (
  SELECT org_id, count(*) AS active
  FROM migration_jobs
  WHERE "status" IN ('PENDING', 'RUNNING')
    AND "source" IN ('CSV', 'SALESFORCE_CSV')
    AND "file_hash" IS NOT NULL
  GROUP BY org_id, source, file_hash
  HAVING count(*) > 1
) duplicates
GROUP BY org_id
`.trim();

export function decideBootMigration(rows) {
  const totals = new Map();
  for (const row of rows) {
    const orgId = String(row.orgId ?? row.org_id ?? '').trim();
    const active = Number(row.active);
    if (!orgId || !Number.isFinite(active) || active < 1) continue;
    totals.set(orgId, (totals.get(orgId) ?? 0) + active);
  }
  const log = [...totals.entries()].map(([orgId, active]) => ({ orgId, active }));
  if (log.length === 0) return { applyMigration: true, modifyRows: false, log: [] };
  return { applyMigration: false, modifyRows: false, log };
}
