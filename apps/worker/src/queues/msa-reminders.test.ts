import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { scanMsaReminders } from './msa-reminders.js';

const stamp = Date.now();
const NOW = new Date();
const day = (d: number) => new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()) + d * 86_400_000);
let orgId = '';
let ownerId = '';
let creatorId = '';
const ids: Record<string, string> = {};

beforeAll(async () => {
  const org = await prisma.org.create({ data: { name: 'MSA reminders', clerkOrg: `org_msa_rem_${stamp}` } });
  orgId = org.id;
  ownerId = (await prisma.user.create({ data: { orgId, clerkUser: `user_msa_rem_o_${stamp}`, email: `o.${stamp}@test.local`, name: 'O' } })).id;
  creatorId = (await prisma.user.create({ data: { orgId, clerkUser: `user_msa_rem_c_${stamp}`, email: `c.${stamp}@test.local`, name: 'C' } })).id;
  const mk = (key: string, data: Record<string, unknown>) =>
    prisma.contractAgreement
      .create({ data: { orgId, accountKey: 'acme', reference: key, title: `MSA ${key}`, createdById: creatorId, ...data } })
      .then((r) => (ids[key] = r.id));
  await mk('owned', { status: 'active', expiryDate: day(45), noticePeriodDays: 35, ownerId });
  await mk('unowned', { status: 'active', expiryDate: day(25) });
  await mk('draft', { status: 'draft', expiryDate: day(25), ownerId });
  await mk('far', { status: 'active', expiryDate: day(200), ownerId });
  await mk('archived', { status: 'active', expiryDate: day(25), ownerId, deletedAt: new Date() });
});

afterAll(async () => {
  if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
});

describe('scanMsaReminders', () => {
  it('notifies owner (or creator) once per reminder and term', async () => {
    await scanMsaReminders(NOW);
    const notes = await prisma.notification.findMany({ where: { orgId }, select: { userId: true, url: true, entityId: true }, take: 50 });
    const term = (d: number) => day(d).toISOString().slice(0, 10);
    expect(notes.map((n) => n.url).sort()).toEqual(
      [
        `/msa/${ids.owned}?reminder=expiry-60&term=${term(45)}`,
        `/msa/${ids.owned}?reminder=notice&term=${term(45)}`,
        `/msa/${ids.unowned}?reminder=expiry-30&term=${term(25)}`,
      ].sort(),
    );
    expect(notes.find((n) => n.entityId === ids.unowned)?.userId).toBe(creatorId);
    expect(notes.filter((n) => n.entityId === ids.owned).every((n) => n.userId === ownerId)).toBe(true);
    expect((await scanMsaReminders(NOW)).created).toBe(0);
  });

  it('a renewed term (new expiry) gets fresh reminders', async () => {
    await prisma.contractAgreement.update({ where: { id: ids.unowned! }, data: { expiryDate: day(28) } });
    expect((await scanMsaReminders(NOW)).created).toBe(1);
  });

  it('the unique index blocks a duplicate insert', async () => {
    const n = await prisma.notification.findFirstOrThrow({ where: { orgId, entityId: ids.owned } });
    await expect(
      prisma.notification.create({ data: { orgId, userId: n.userId, type: 'system', title: 'dup', url: n.url } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
