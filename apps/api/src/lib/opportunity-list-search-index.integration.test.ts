/**
 * GET /opportunities?search= filters with an OR of ILIKE on customer, name,
 * and code. The expression GIN index opps_search_gin_idx only matches the
 * concatenated predicate used by GET /search, so the list seq-scans the book.
 *
 * On the sweep 11 org (50,000 opportunities) that scan removed 50,037 rows
 * and took 50 ms to return 3 hits. A column trigram index can serve the OR
 * the list actually emits. enable_seqscan is off so a small test table does
 * not hide a missing index behind a sequential scan.
 */
import { prisma } from '@bidstack/db';
import { afterAll, beforeAll, expect } from 'vitest';

import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let dbReady = false;
const skipIfNoDb = makeSkipIfNoDb(() => dbReady);

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

skipIfNoDb('GET /opportunities?search= can use opps_list_search_trgm_idx', async () => {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN SELECT id FROM opportunities
       WHERE customer ILIKE '%mantu%' OR name ILIKE '%mantu%' OR code ILIKE '%mantu%'`,
    );
  });
  const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
  expect(plan).toContain('opps_list_search_trgm_idx');
});
