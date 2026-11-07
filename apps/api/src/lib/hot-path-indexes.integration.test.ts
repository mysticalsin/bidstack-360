/**
 * Hot-path index contract. The stress suite (load/run.mjs) showed these reads
 * seq-scanning and sorting every live row in the org at 20k rows. Each case
 * runs EXPLAIN on the query shape Prisma emits, with seq scans disabled, and
 * asserts the planner can serve it from the named index. A dropped or renamed
 * index fails here instead of as a slow page in production.
 */
import { prisma } from '@bidstack/db';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let dbReady = false;
const skipIfNoDb = makeSkipIfNoDb(() => dbReady);
const ORG = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReady = true;
  } catch {
    dbReady = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function planFor(sql: string): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN ${sql}`);
  });
  return rows.map((r) => r['QUERY PLAN']).join('\n');
}

const CASES: Array<{ name: string; index: string; sql: string }> = [
  {
    name: 'GET /tasks default sort',
    index: 'tasks_org_list_sort_idx',
    sql: `SELECT id FROM tasks WHERE org_id = '${ORG}' AND deleted_at IS NULL
          ORDER BY due_date ASC, created_at DESC, id ASC LIMIT 51`,
  },
  {
    name: 'GET /opportunities default sort',
    index: 'opps_org_list_sort_idx',
    sql: `SELECT id FROM opportunities WHERE org_id = '${ORG}' AND deleted_at IS NULL
          ORDER BY updated_at DESC, id DESC LIMIT 51`,
  },
  {
    name: 'GET /search task title',
    index: 'tasks_title_trgm_idx',
    sql: `SELECT id FROM tasks WHERE org_id = '${ORG}' AND deleted_at IS NULL
          AND title ILIKE '%mantu%' ORDER BY id LIMIT 21`,
  },
  {
    name: 'GET /search lead names',
    index: 'leads_search_trgm_idx',
    sql: `SELECT id FROM leads WHERE org_id = '${ORG}' AND deleted_at IS NULL
          AND (first_name ILIKE '%mantu%' OR last_name ILIKE '%mantu%' OR company_name ILIKE '%mantu%')
          LIMIT 21`,
  },
  {
    name: 'GET /search contact name or role',
    index: 'contacts_search_trgm_idx',
    sql: `SELECT id FROM contacts WHERE org_id = '${ORG}' AND deleted_at IS NULL
          AND (name ILIKE '%mantu%' OR role ILIKE '%mantu%') ORDER BY id LIMIT 21`,
  },
];

describe('hot-path indexes', () => {
  for (const c of CASES) {
    skipIfNoDb(`${c.name} uses ${c.index}`, async () => {
      expect(await planFor(c.sql)).toContain(c.index);
    });
  }
});
