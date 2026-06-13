// Integration tests for /api/search.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
// Distinctive tokens that live in DIFFERENT fields, so the only way to find this
// lead with a two-word query is the token-AND retrieval + multi-term scorer.
const FIRST = 'Zphoenix';
const COMPANY = 'Qmetricscorp';
let leadId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (orgId) {
    const lead = await prisma.lead.create({
      data: {
        orgId,
        firstName: FIRST,
        lastName: 'Tester',
        companyName: COMPANY,
        email: 'zphoenix@qmetricscorp.test',
        status: 'new',
      },
    });
    leadId = lead.id;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (leadId) await prisma.lead.deleteMany({ where: { id: leadId } });
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    }
    await fn();
  });

describe('search routes', () => {
  skipIfNoDb('GET /api/search finds opportunities by customer', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=MAHLE' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.some((r: { type: string }) => r.type === 'opportunity')).toBe(true);
  });

  skipIfNoDb('GET /api/search filters by types', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=MAHLE&types=opportunity' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((r: { type: string }) => r.type === 'opportunity')).toBe(true);
  });

  skipIfNoDb('GET /api/search limits results per type', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=a&limit=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(30); // totalCap
  });

  skipIfNoDb('GET /api/search returns empty for nonsense query', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=xyznonsense12345' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(0);
  });

  skipIfNoDb('GET /api/search rejects empty query', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=' });
    expect(res.statusCode).toBe(400);
  });

  // The core quality fix: a two-word query whose tokens live in different
  // fields (first name + company) must find the record. The old whole-substring
  // scorer + single-field `contains` returned nothing here.
  skipIfNoDb('finds a record by multi-term query spanning two fields', async () => {
    if (!leadId) throw new Error('[skip] fixture lead not created');
    const res = await server.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`${FIRST} ${COMPANY}`)}&types=lead`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { id: string; score: number }[] };
    const hit = body.items.find((r) => r.id === leadId);
    expect(hit).toBeDefined();
    expect(hit!.score).toBeGreaterThan(0);
  });

  // Token-AND retrieval: a query with a token that matches NOTHING must exclude
  // the record even though its other token matches (old behavior would still
  // surface it on the single matching field).
  skipIfNoDb('excludes a record when one query token matches no field', async () => {
    if (!leadId) throw new Error('[skip] fixture lead not created');
    const res = await server.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`${COMPANY} zzznomatch`)}&types=lead`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { id: string }[] };
    expect(body.items.some((r) => r.id === leadId)).toBe(false);
  });
});
