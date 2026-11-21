import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { logActivity } from './activity.service.js';

let dbReachable = false;
let orgId = '';
let otherOrgId = '';
let userId = '';
let otherUserId = '';

describe('activity user id on write', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await prisma.org.create({
      data: { clerkOrg: `org_act_${randomUUID()}`, name: 'Harbor Synthetic Co' },
    });
    const other = await prisma.org.create({
      data: { clerkOrg: `org_act_b_${randomUUID()}`, name: 'Quay Synthetic Ltd' },
    });
    orgId = org.id;
    otherOrgId = other.id;
    userId = (
      await prisma.user.create({
        data: {
          orgId: org.id,
          clerkUser: `user_act_${org.id}`,
          email: `act.${org.id}@harbor-synthetic.test`,
          name: 'Harbor User',
        },
        select: { id: true },
      })
    ).id;
    otherUserId = (
      await prisma.user.create({
        data: {
          orgId: other.id,
          clerkUser: `user_act_${other.id}`,
          email: `act.${other.id}@quay-synthetic.test`,
          name: 'Quay User',
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
    if (otherOrgId) await prisma.org.delete({ where: { id: otherOrgId } }).catch(() => undefined);
  });

  it('does not keep a user id from outside the org', async () => {
    if (!dbReachable) throw new Error('[skip] activity user id — DATABASE_URL not reachable');
    const created = await logActivity({
      orgId,
      entityType: 'company',
      entityId: randomUUID(),
      type: 'note',
      actorId: otherUserId,
      actorType: 'user',
      subject: 'Unchecked user',
    });
    const row = await prisma.activity.findFirst({
      where: { id: created.id },
      select: { actorId: true, ownerId: true },
    });
    expect(row).toMatchObject({ actorId: null, ownerId: null });
  });

  it('keeps a user id from the same org', async () => {
    if (!dbReachable) throw new Error('[skip] activity user id — DATABASE_URL not reachable');
    const created = await logActivity({
      orgId,
      entityType: 'company',
      entityId: randomUUID(),
      type: 'note',
      actorId: userId,
      actorType: 'user',
      subject: 'Same org user',
    });
    const row = await prisma.activity.findFirst({
      where: { id: created.id },
      select: { actorId: true, ownerId: true },
    });
    expect(row).toMatchObject({ actorId: userId, ownerId: userId });
  });
});
