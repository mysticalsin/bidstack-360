import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma, seedPfizerWhitespaceFixture, seedSigningEntities } from '@bidstack/db';

import { runWhitespaceDigest } from './msa-whitespace-digest.js';

const stamp = Date.now();
const NOW = new Date('2026-11-09T12:00:00Z');
let orgId = '';
let ownerId = '';

beforeAll(async () => {
  const org = await prisma.org.create({ data: { name: 'Whitespace digest', clerkOrg: `org_ws_dig_${stamp}` } });
  orgId = org.id;
  ownerId = (await prisma.user.create({ data: { orgId, clerkUser: `user_ws_dig_${stamp}`, email: `ws.${stamp}@test.local`, name: 'Owner' } })).id;
  await seedSigningEntities(prisma, orgId);
  expect(await seedPfizerWhitespaceFixture(prisma, orgId, ownerId)).not.toBeNull();
});

afterAll(async () => {
  if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
});

describe('runWhitespaceDigest', () => {
  it('sends each owner one in-app digest per week with their top new flags', async () => {
    await runWhitespaceDigest(NOW);
    const notes = await prisma.notification.findMany({ where: { orgId }, take: 10 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      userId: ownerId,
      type: 'system',
      entityType: 'msa_whitespace',
      url: '/agreements/whitespace?digest=2026-W46',
      title: '1 whitespace flag this week',
    });
    expect(notes[0]!.body).toContain('Global MSA via HEMA, no IT or Engineering business yet');
    expect((await runWhitespaceDigest(NOW)).created).toBe(0);
  });

  it('the unique index blocks a duplicate digest', async () => {
    await expect(
      prisma.notification.create({ data: { orgId, userId: ownerId, type: 'system', title: 'dup', url: '/agreements/whitespace?digest=2026-W46' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
