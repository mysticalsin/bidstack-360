// A restored snapshot can hold two active rows for one file. prisma migrate
// deploy would fail the index, the container would stay failed, and the
// 15-minute cron would restore the same snapshot. The boot guard has to
// refuse that migration, log only org ids and counts, and leave the rows.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decideBootMigration, DUPLICATE_PRECHECK_SQL } from './active-import-precheck.js';

const here = dirname(fileURLToPath(import.meta.url));

function wherePredicate(sql: string): string {
  const match = /WHERE\s+([\s\S]*?)(?:GROUP BY|;)/i.exec(sql);
  if (!match?.[1]) throw new Error('missing WHERE');
  return match[1].replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('active import boot guard', () => {
  it('refuses the migration and logs only org ids and counts', () => {
    const decision = decideBootMigration([
      { org_id: 'org-1', source: 'CSV', file_hash: 'hash-a', active: 2 },
      { org_id: 'org-1', source: 'SALESFORCE_CSV', file_hash: 'hash-b', active: 3 },
      { org_id: 'org-2', source: 'CSV', file_hash: 'hash-c', active: 2 },
    ]);

    // WHY: logging the file hash or deleting a row would either leak the
    // upload or do the cleanup Tony has not asked for.
    expect(decision.applyMigration).toBe(false);
    expect(decision.modifyRows).toBe(false);
    expect(decision.log).toEqual([
      { orgId: 'org-1', active: 5 },
      { orgId: 'org-2', active: 2 },
    ]);
    const encoded = JSON.stringify(decision);
    expect(encoded).not.toContain('hash-a');
    expect(encoded).not.toContain('file_hash');
    expect(encoded).not.toContain('DELETE');
  });

  it('applies the migration when the precheck returns nothing', () => {
    expect(decideBootMigration([])).toEqual({ applyMigration: true, modifyRows: false, log: [] });
  });

  it('uses the current index predicate', () => {
    const migration = readFileSync(
      join(here, '../../../packages/db/prisma/migrations/20261112170000_migration_jobs_one_active_per_org_source/migration.sql'),
      'utf8',
    );
    expect(wherePredicate(DUPLICATE_PRECHECK_SQL)).toBe(wherePredicate(migration));
    const entry = readFileSync(join(here, '../container/entrypoint.mjs'), 'utf8');
    const guard = entry.indexOf('decideBootMigration');
    const deploy = entry.indexOf("['migrate', 'deploy'");
    expect(guard).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(guard);
    expect(entry).not.toMatch(/DELETE\s+FROM\s+migration_jobs/i);
  });
});
