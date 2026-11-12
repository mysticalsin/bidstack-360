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
  it('uses the same predicate as migration_jobs_one_active_per_org_source', () => {
    const migration = readFileSync(
      resolve(
        root,
        'packages/db/prisma/migrations/20261112170000_migration_jobs_one_active_per_org_source/migration.sql',
      ),
      'utf8',
    );
    const notes = readFileSync(resolve(root, 'docs/deploy/active-import-index.md'), 'utf8');
    const precheck = notes.slice(notes.indexOf('SELECT org_id'), notes.indexOf('HAVING count(*) > 1;') + 'HAVING count(*) > 1;'.length);

    expect(wherePredicate(precheck)).toBe(wherePredicate(migration));
    expect(precheck.toLowerCase()).toContain('group by org_id, source');
    expect(migration).toContain('("org_id", "source")');
  });
});
