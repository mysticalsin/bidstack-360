/**
 * Cursor pagination contract on the core list endpoints.
 *
 * Walking every page with a small limit must return each row exactly once,
 * in the same set as one large page, with no page over the limit and a null
 * cursor on the last page. Each backing table must have an index leading
 * with org_id so the tenant-scoped page query stays index-backed.
 */
import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const LISTS = [
  { path: '/api/v1/leads', table: 'leads' },
  { path: '/api/v1/contacts', table: 'contacts' },
  { path: '/api/v1/companies', table: 'companies' },
  { path: '/api/v1/tasks', table: 'tasks' },
  { path: '/api/v1/opportunities', table: 'opportunities' },
  { path: '/api/v1/audit-logs', table: 'audit_log' },
] as const;

const PAGE = 2;
const MAX_PAGES = 500;

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

type Page = { items: Array<{ id: string | number }>; nextCursor?: string | null };

async function page(path: string, limit: number, cursor?: string | null): Promise<Page> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const res = await server.inject({ method: 'GET', url: `${path}?${qs}` });
  expect(res.statusCode, `${path}?${qs} -> ${res.statusCode} ${res.body.slice(0, 200)}`).toBe(200);
  return res.json() as Page;
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const org = await createIsolatedOrg('cursor-pages');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
  await prisma.auditLog.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      orgId: org.orgId,
      action: 'test.cursor_page',
      targetType: 'test',
      targetId: String(i),
    })),
  });
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
});

describe('cursor pagination', () => {
  for (const list of LISTS) {
    it(`${list.path}: pages are disjoint, complete and bounded`, async () => {
      const all = await page(list.path, 100);
      expect(all.items.length, `${list.path} needs more than one page of seed data`).toBeGreaterThan(
        PAGE,
      );
      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let i = 0; i < MAX_PAGES; i += 1) {
        const p = await page(list.path, PAGE, cursor);
        expect(p.items.length).toBeLessThanOrEqual(PAGE);
        seen.push(...p.items.map((it) => String(it.id)));
        cursor = p.nextCursor;
        if (!cursor) break;
      }
      expect(cursor ?? null).toBeNull();
      expect(new Set(seen).size, `${list.path} repeated a row across pages`).toBe(seen.length);
      if (!all.nextCursor) {
        expect(new Set(seen)).toEqual(new Set(all.items.map((it) => String(it.id))));
      }
    });
  }

  it('every paged table has an index leading with org_id', async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`
      SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = current_schema()`;
    const missing = LISTS.filter(
      (l) => !rows.some((r) => r.tablename === l.table && /\(org_id\b/.test(r.indexdef)),
    ).map((l) => l.table);
    expect(missing).toEqual([]);
  });
});
