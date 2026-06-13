// Integration tests for contractual management (MSAs/framework agreements).
// Pattern: cross-sell.integration.test.ts — buildServer + inject against the
// seed org; fixtures cleaned up in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const ACCOUNT = 'contract-test-account';

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
  if (!orgId) return;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.contractAgreement.deleteMany({ where: { orgId, accountKey: ACCOUNT } });
    await prisma.auditLog.deleteMany({
      where: { orgId, action: { startsWith: 'contract_agreement.' } },
    });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name} — DB/seed org unavailable`);
    await fn();
  });

describe('contract agreement routes', () => {
  t('create (MSA with countries + rebate) → list → patch status → delete', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/contract-agreements',
      payload: {
        accountKey: ACCOUNT,
        kind: 'msa',
        reference: 'MSA-2026-001',
        countries: ['FR', 'de', 'es'],
        globalRebateBps: 750,
        currency: 'EUR',
        rateReviewSchedule: 'annual',
        rateCard: [
          { role: 'Senior Consultant', rateMicros: 800_000_000, unit: 'day' },
          { role: 'Architect', rateMicros: 1_100_000_000, unit: 'day' },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as {
      id: string;
      kind: string;
      countries: string[];
      globalRebateBps: number;
      status: string;
      rateCard: { role: string; rateMicros: number; unit: string }[];
    };
    expect(body.kind).toBe('msa');
    // Country codes are normalized to uppercase ISO-2 by the schema.
    expect(body.countries).toEqual(['FR', 'DE', 'ES']);
    expect(body.globalRebateBps).toBe(750);
    expect(body.status).toBe('active');
    // Rate card round-trips (different MSAs carry different negotiated rates).
    expect(body.rateCard).toHaveLength(2);
    expect(body.rateCard[0]).toEqual({
      role: 'Senior Consultant',
      rateMicros: 800_000_000,
      unit: 'day',
    });
    const id = body.id;

    const list = await server.inject({
      method: 'GET',
      url: `/api/contract-agreements?accountKey=${ACCOUNT}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/contract-agreements/${id}`,
      payload: { status: 'expired', globalRebateBps: 1000 },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as { status: string; globalRebateBps: number };
    expect(patched.status).toBe('expired');
    expect(patched.globalRebateBps).toBe(1000);

    const del = await server.inject({ method: 'DELETE', url: `/api/contract-agreements/${id}` });
    expect(del.statusCode).toBe(204);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'contract_agreement.create', targetId: id },
    });
    expect(audit).not.toBeNull();
  });

  t('another org’s contract id 404s on patch and delete (tenant isolation)', async () => {
    const foreignOrg = await prisma.org.create({
      data: { name: 'Contract Foreign', clerkOrg: `org_ctr_${Date.now()}` },
    });
    const foreign = await prisma.contractAgreement.create({
      data: {
        orgId: foreignOrg.id,
        accountKey: 'foreign',
        kind: 'framework',
        reference: 'X',
        countries: [],
        currency: 'EUR',
        rateReviewSchedule: 'annual',
        status: 'active',
        createdById: foreignOrg.id, // any uuid; FK is org-scoped on read
      },
    });
    try {
      const patch = await server.inject({
        method: 'PATCH',
        url: `/api/contract-agreements/${foreign.id}`,
        payload: { status: 'expired' },
      });
      expect(patch.statusCode).toBe(404);
      const del = await server.inject({
        method: 'DELETE',
        url: `/api/contract-agreements/${foreign.id}`,
      });
      expect(del.statusCode).toBe(404);
    } finally {
      await prisma.contractAgreement.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });
});
