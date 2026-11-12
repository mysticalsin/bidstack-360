// A restored snapshot can hold two active rows for one file. prisma migrate
// deploy would fail the index, the container would stay failed, and the
// 15-minute cron would restore the same snapshot. The boot guard has to
// refuse that migration, log only org ids and counts, and leave the rows.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACTIVE_IMPORT_MIGRATION,
  decideBootMigration,
  DUPLICATE_PRECHECK_SQL,
  planBootMigration,
} from './active-import-precheck.js';

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
      join(here, '../../../packages/db/prisma/migrations/20261112170100_migration_jobs_one_active_per_file/migration.sql'),
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

  it('skips only the index migration when duplicates exist', () => {
    // WHY: the column and the app role can still apply. Refusing the whole
    // deploy leaves the container on the previous schema. Deleting the rows
    // is Tony's decision, so the plan must not modify them.
    const decision = decideBootMigration([{ org_id: 'org-1', active: 2 }]);
    expect(planBootMigration(decision)).toEqual({
      deploy: true,
      skipIndexMigration: true,
      servePreviousSchema: false,
      modifyRows: false,
    });
    expect(planBootMigration(decideBootMigration([]))).toEqual({
      deploy: true,
      skipIndexMigration: false,
      servePreviousSchema: false,
      modifyRows: false,
    });
    expect(ACTIVE_IMPORT_MIGRATION).toBe('20261112170100_migration_jobs_one_active_per_file');
    const entry = readFileSync(join(here, '../container/entrypoint.mjs'), 'utf8');
    expect(entry).toContain('skipIndexMigration');
    expect(entry).toContain('ACTIVE_IMPORT_MIGRATION');
    const skip = entry.indexOf('skipIndexMigration');
    const giveUp = entry.indexOf('serving the restored schema');
    const deploy = entry.indexOf("['migrate', 'deploy'");
    expect(skip).toBeGreaterThan(-1);
    expect(giveUp).toBeGreaterThan(skip);
    expect(deploy).toBeGreaterThan(giveUp);
  });
});
