import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WHY: the CI unit job has no Postgres. Suites that throw when the database
// is down have to be named in that job's exclude list. Integration runs them.

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const FAIL_LOUD_WITHOUT_DB = [
  'src/lib/workspace-token.revoke.integration.test.ts',
  'src/queues/migration.attempt.test.ts',
  'src/queues/migration.complete-race.test.ts',
  'src/queues/migration.exhausted.test.ts',
  'src/queues/migration.guard.test.ts',
  'src/queues/migration.hubspot-page.test.ts',
  'src/queues/migration.org-lock.test.ts',
  'src/queues/migration.orphan-rows.test.ts',
  'src/queues/migration.savepoint.test.ts',
  'src/queues/migration.stale.test.ts',
];

describe('CI unit job database excludes', () => {
  it('excludes every worker suite that throws when DATABASE_URL is unset', () => {
    const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8');
    const worker = ci.split('Test (no DB — worker')[1]?.split('- name:')[0] ?? '';
    const missing = FAIL_LOUD_WITHOUT_DB.filter((path) => !worker.includes(`--exclude ${path}`));
    expect(missing).toEqual([]);
  });
});
