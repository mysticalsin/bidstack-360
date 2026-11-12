import { Prisma } from '@bidstack/db';
import { describe, expect, it } from 'vitest';

import { isActiveImportConflict } from './migrations.js';

const INDEX = 'migration_jobs_one_active_per_org_source';

function unique(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

describe('active import conflict', () => {
  it('matches only the one-active-import index', () => {
    // WHY: any P2002 was treated as "an import is already running", including
    // a mapping upsert that collided on a different constraint.
    expect(isActiveImportConflict(unique(INDEX))).toBe(true);
    expect(isActiveImportConflict(unique(['org_id', 'source']))).toBe(true);
    expect(isActiveImportConflict(unique(['orgId', 'source']))).toBe(true);
    expect(isActiveImportConflict(unique(['org_id', 'source', 'source_entity']))).toBe(false);
    expect(isActiveImportConflict(unique('migration_mappings_org_source_entity_key'))).toBe(false);
    expect(isActiveImportConflict(new Error('P2002'))).toBe(false);
  });
});
