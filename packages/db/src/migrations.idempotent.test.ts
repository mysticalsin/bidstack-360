// A migration that Prisma runs outside a transaction (CREATE INDEX CONCURRENTLY)
// or that commits an enum label must be safe to re-apply. If the DDL lands and
// the _prisma_migrations row does not, the next deploy runs the file again.
// Editing a file that already shipped changes its checksum, so the known
// offenders are listed here and the list may only shrink.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDir = join(import.meta.dirname, '../prisma/migrations');

function migrationSql(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      // Comments mention the unsafe form on purpose. Only executable SQL counts.
      sql: readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n'),
    }));
}

const CONCURRENT_INDEX_WITHOUT_IF_NOT_EXISTS = new Set([
  '20261112170100_migration_jobs_one_active_per_file',
]);

const ADD_VALUE_WITHOUT_IF_NOT_EXISTS = new Set([
  '20260525010000_sync_drift',
  '20261031200000_msa_library',
]);

function concurrentIndexOffenders(files: Array<{ name: string; sql: string }>): string[] {
  return files
    .filter((file) =>
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY(?!\s+IF\s+NOT\s+EXISTS)/i.test(file.sql),
    )
    .map((file) => file.name)
    .sort();
}

function addValueOffenders(files: Array<{ name: string; sql: string }>): string[] {
  return files
    .filter((file) => /ADD\s+VALUE(?!\s+IF\s+NOT\s+EXISTS)/i.test(file.sql))
    .map((file) => file.name)
    .sort();
}

describe('migration SQL can be retried', () => {
  const files = migrationSql();

  it('CREATE INDEX CONCURRENTLY uses IF NOT EXISTS, except the recorded file', () => {
    // WHY: Prisma runs a concurrent index outside a transaction. A crash after
    // the index exists and before the migration row is written makes the retry
    // fail with "already exists" unless the statement is IF NOT EXISTS.
    expect(concurrentIndexOffenders(files)).toEqual(
      [...CONCURRENT_INDEX_WITHOUT_IF_NOT_EXISTS].sort(),
    );
  });

  it('ALTER TYPE ADD VALUE uses IF NOT EXISTS, except the recorded files', () => {
    // WHY: a second apply of a bare ADD VALUE stops at "enum label already exists".
    expect(addValueOffenders(files)).toEqual([...ADD_VALUE_WITHOUT_IF_NOT_EXISTS].sort());
  });
});
