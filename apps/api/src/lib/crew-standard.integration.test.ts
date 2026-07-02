// Integration tests — seedStandardCrew (RFP-CREW-001 + RFP-CREW-002)
//
// Verified invariants (require a live DATABASE_URL + crew tables):
//   - Seeds one standard crew carrying the stable standard_key.
//   - Reseeding PRUNES stale (non-standard) tasks and keeps the standard set.
//   - Concurrent seeds are idempotent — the per-org advisory lock + partial
//     unique index yield exactly one crew, no duplicate tasks.
//   - A user crew named "RFP Response Crew" (standard_key NULL) is NOT adopted
//     by the seed — the seed matches by key, not name (RFP-CREW-002).

import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { seedStandardCrew, STANDARD_CREW, STANDARD_CREW_KEY } from './crew-standard.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let dbReady = false;
const createdOrgIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const check = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.crews') IS NOT NULL AS "exists"
    `;
    dbReady = check[0]?.exists ?? false;
  } catch {
    dbReady = false;
  }
});

afterEach(async () => {
  if (!dbReady) return;
  for (const orgId of createdOrgIds.splice(0)) {
    await prisma.$executeRaw`DELETE FROM crew_tasks WHERE org_id = ${orgId}::uuid`;
    await prisma.$executeRaw`DELETE FROM crews WHERE org_id = ${orgId}::uuid`;
    await prisma.$executeRaw`DELETE FROM crew_agents WHERE org_id = ${orgId}::uuid`;
    await prisma.org.deleteMany({ where: { id: orgId } });
  }
});

async function freshOrg(): Promise<string> {
  const org = await prisma.org.create({
    data: { clerkOrg: `org_crew_test_${randomUUID()}`, name: 'Crew Seed Test' },
  });
  createdOrgIds.push(org.id);
  return org.id;
}

const countTasks = (crewId: string) =>
  prisma.$queryRaw<Array<{ task_key: string }>>`
    SELECT task_key FROM crew_tasks WHERE crew_id = ${crewId}::uuid
  `;

const skipIfNoDb = makeSkipIfNoDb(() => dbReady);

describe('seedStandardCrew', () => {
  skipIfNoDb('seeds one standard crew with the stable standard_key', async () => {
    const orgId = await freshOrg();
    const crewId = await seedStandardCrew(orgId, null);

    const crews = await prisma.$queryRaw<Array<{ id: string; standard_key: string | null }>>`
      SELECT id, standard_key FROM crews WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
    `;
    expect(crews).toHaveLength(1);
    expect(crews[0]?.standard_key).toBe(STANDARD_CREW_KEY);
    expect(await countTasks(crewId)).toHaveLength(STANDARD_CREW.tasks.length);
  });

  skipIfNoDb('prunes stale tasks on reseed and keeps the standard set', async () => {
    const orgId = await freshOrg();
    const crewId = await seedStandardCrew(orgId, null);

    // A retired/non-standard task key lingering on the crew.
    await prisma.$executeRaw`
      INSERT INTO crew_tasks
        (id, org_id, crew_id, task_key, description, expected_output, agent_key, context_keys, sort_order, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${orgId}::uuid, ${crewId}::uuid, 'stale_task', 'x', 'y', 'analyst', '[]'::jsonb, 99, now(), now())
    `;

    await seedStandardCrew(orgId, null);

    const tasks = await countTasks(crewId);
    expect(tasks.map((t) => t.task_key)).not.toContain('stale_task');
    expect(tasks).toHaveLength(STANDARD_CREW.tasks.length);
  });

  skipIfNoDb('is idempotent under concurrent seeds (advisory lock + unique index)', async () => {
    const orgId = await freshOrg();
    const [a, b, c] = await Promise.all([
      seedStandardCrew(orgId, null),
      seedStandardCrew(orgId, null),
      seedStandardCrew(orgId, null),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);

    const crews = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM crews WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
    `;
    expect(crews).toHaveLength(1);
    expect(await countTasks(a)).toHaveLength(STANDARD_CREW.tasks.length);
  });

  skipIfNoDb('does NOT adopt a user crew that merely shares the standard name', async () => {
    const orgId = await freshOrg();
    const custom = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO crews (id, org_id, name, standard_key, created_at, updated_at)
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${STANDARD_CREW.name}, NULL, now(), now())
      RETURNING id
    `;
    const customId = custom[0]!.id;

    const seededId = await seedStandardCrew(orgId, null);
    expect(seededId).not.toBe(customId);

    const customAfter = await prisma.$queryRaw<Array<{ standard_key: string | null }>>`
      SELECT standard_key FROM crews WHERE id = ${customId}::uuid
    `;
    expect(customAfter[0]?.standard_key).toBeNull();

    const seededAfter = await prisma.$queryRaw<Array<{ standard_key: string | null }>>`
      SELECT standard_key FROM crews WHERE id = ${seededId}::uuid
    `;
    expect(seededAfter[0]?.standard_key).toBe(STANDARD_CREW_KEY);
  });
});
