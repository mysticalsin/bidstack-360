// Integration: custom-object RBAC (admin can manage) + server-side field-type
// validation (Sprint 1 blockers). Pattern: contract-agreements.integration.test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const OBJ_KEY = 'qavalidate';

async function cleanup(id: string): Promise<void> {
  // Deleting the def cascades its records/fields/relations.
  await prisma.customObjectDef.deleteMany({ where: { orgId: id, key: OBJ_KEY } });
}

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
  await cleanup(orgId);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) await cleanup(orgId);
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name} — DB/seed org unavailable`);
    await fn();
  });

describe('custom objects — RBAC + value validation', () => {
  t('admin defines an object + typed fields; records reject bad types, accept good ones', async () => {
    // Admin (stub auth) passes the customObjects:write + admin gate.
    const obj = await server.inject({
      method: 'POST',
      url: '/api/v1/custom-objects',
      payload: { key: OBJ_KEY, labelSingular: 'QA Item', labelPlural: 'QA Items' },
    });
    expect(obj.statusCode).toBe(201);
    const objId = (obj.json() as { id: string }).id;

    const amount = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${objId}/fields`,
      payload: { fieldKey: 'amount', label: 'Amount', fieldType: 'number' },
    });
    expect(amount.statusCode).toBe(201);

    const stage = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${objId}/fields`,
      payload: { fieldKey: 'stage', label: 'Stage', fieldType: 'select', options: ['open', 'won'] },
    });
    expect(stage.statusCode).toBe(201);

    // name is a bootstrapped required field — include it so the 400s below
    // isolate to the type/select validation, not the required check.
    // A string in a number field is rejected (the integrity blocker).
    const badNumber = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${objId}/records`,
      payload: { values: { name: 'r1', amount: 'not-a-number' } },
    });
    expect(badNumber.statusCode).toBe(400);

    // An off-list select value is rejected.
    const badSelect = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${objId}/records`,
      payload: { values: { name: 'r2', amount: 10, stage: 'pending' } },
    });
    expect(badSelect.statusCode).toBe(400);

    // Valid values are accepted and stored (numeric string coerced to a number).
    const good = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${objId}/records`,
      payload: { values: { name: 'r3', amount: '42', stage: 'won' } },
    });
    expect(good.statusCode).toBe(201);
    const record = good.json() as { valuesJson: { amount: unknown; stage: unknown } };
    expect(record.valuesJson.amount).toBe(42);
    expect(record.valuesJson.stage).toBe('won');

    // A malformed filter JSON is a 400, not a silent unfiltered list.
    const badFilter = await server.inject({
      method: 'GET',
      url: `/api/v1/custom-objects/${objId}/records?filter=${encodeURIComponent('{not json')}`,
    });
    expect(badFilter.statusCode).toBe(400);
  });
});
