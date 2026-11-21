/**
 * GET /companies?search= and GET /search?types=company filter with ILIKE on
 * the account name. Contacts, leads, and tasks already have trigram indexes.
 * Companies do not, so a selective name search seq-scans the book.
 *
 * On the sweep 11 org (20,000 accounts) `name ILIKE '%Sentinel%'` removed
 * 20,007 rows and took 8.4 ms. enable_seqscan is off so a small test table
 * does not hide a missing index behind a sequential scan.
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

async function plan(sql: string): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN ${sql}`);
  });
  return rows.map((r) => r['QUERY PLAN']).join('\n');
}

skipIfNoDb('GET /companies?search= can use companies_search_trgm_idx', async () => {
  const text = await plan(
    `SELECT id FROM companies
     WHERE name ILIKE '%mantu%' OR domain ILIKE '%mantu%' OR industry ILIKE '%mantu%'`,
  );
  expect(text).toContain('companies_search_trgm_idx');
});

skipIfNoDb('GET /search company tokens can use companies_search_trgm_idx', async () => {
  const text = await plan(
    `SELECT id FROM companies
     WHERE name ILIKE '%mantu%' OR legal_name ILIKE '%mantu%'
        OR domain ILIKE '%mantu%' OR industry ILIKE '%mantu%'`,
  );
  expect(text).toContain('companies_search_trgm_idx');
});
