// WHY: CREATE UNIQUE INDEX fails on the same rows this precheck counts.
// A precheck whose WHERE drifts from the partial index would either stop a
// deploy that can succeed or let a deploy hit 23505.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

function wherePredicate(sql: string): string {
  const match = /WHERE\s+([\s\S]*?)(?:GROUP BY|;)/i.exec(sql);
  if (!match?.[1]) throw new Error('missing WHERE');
  return match[1].replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('active import index precheck', () => {
  it('builds the same-import index concurrently, in its own file', () => {
    // WHY: Prisma runs a migration outside a transaction only when the file
    // is a single CREATE INDEX CONCURRENTLY. A failed CONCURRENTLY leaves an
    // INVALID index. Cleanup drops that index outside a transaction and does
    // not delete the duplicate rows.
    const notes = readFileSync(resolve(root, 'docs/deploy/active-import-index.md'), 'utf8');
    const precheck = notes.slice(
      notes.indexOf('SELECT org_id'),
      notes.indexOf('HAVING count(*) > 1;') + 'HAVING count(*) > 1;'.length,
    );
    const column = readFileSync(
      resolve(
        root,
        'packages/db/prisma/migrations/20261112170000_migration_jobs_one_active_per_org_source/migration.sql',
      ),
      'utf8',
    );
    const index = readFileSync(
      resolve(
        root,
        'packages/db/prisma/migrations/20261112170100_migration_jobs_one_active_per_file/migration.sql',
      ),
      'utf8',
    );
    const statements = index
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(column).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^CREATE UNIQUE INDEX CONCURRENTLY "migration_jobs_one_active_per_file"/);
    expect(index).not.toMatch(/\b(DELETE|UPDATE|INSERT|ALTER)\b/i);
    expect(wherePredicate(precheck)).toBe(wherePredicate(index));
    expect(precheck.toLowerCase()).toContain('group by org_id, source');
    expect(notes).toContain('DROP INDEX CONCURRENTLY IF EXISTS migration_jobs_one_active_per_file');
    expect(notes).toContain(
      'prisma migrate resolve --rolled-back 20261112170100_migration_jobs_one_active_per_file',
    );
    expect(notes).not.toMatch(/DELETE\s+FROM\s+migration_jobs/i);
  });
});
