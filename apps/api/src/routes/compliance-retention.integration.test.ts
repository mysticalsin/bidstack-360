// Integration tests for the retention sweep (GDPR Art. 5(1)(e) storage limitation).
//
// WHY: retention deletes data. The dry run must report exactly what an enforce
// run would remove and remove nothing; an enforce run must remove only rows
// past the period for that data class, and transcripts are scrubbed (columns
// nulled) rather than deleting the call or meeting record they belong to.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma, runRetentionSweep } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let userId: string | null = null;
let restoreAuth: (() => void) | null = null;

const YEAR = 365 * 24 * 3_600_000;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('retention');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  userId = (await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } }))!.id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

async function seedAged() {
  const o = orgId!;
  const u = userId!;
  const tag = randomUUID().slice(0, 8);
  const old = new Date(Date.now() - 5 * YEAR);
  const token = await prisma.integrationToken.upsert({
    where: { orgId_userId_provider: { orgId: o, userId: u, provider: 'gmail' } },
    create: {
      orgId: o,
      userId: u,
      provider: 'gmail',
      accessTokenEncrypted: 'placeholder-ciphertext',
    },
    update: {},
  });
  const oldMail = await prisma.emailMessage.create({
    data: {
      orgId: o,
      userId: u,
      integrationTokenId: token.id,
      provider: 'GMAIL',
      externalMessageId: `old-${tag}`,
      fromEmail: 'old@example.com',
      receivedAt: old,
    },
  });
  const freshMail = await prisma.emailMessage.create({
    data: {
      orgId: o,
      userId: u,
      integrationTokenId: token.id,
      provider: 'GMAIL',
      externalMessageId: `fresh-${tag}`,
      fromEmail: 'fresh@example.com',
      receivedAt: new Date(),
    },
  });
  const call = await prisma.callSession.create({
    data: {
      orgId: o,
      userId: u,
      entityType: 'contact',
      entityId: randomUUID(),
      provider: 'zoom',
      endedAt: old,
      transcriptText: 'old transcript',
    },
  });
  const note = await prisma.notification.create({
    data: { orgId: o, userId: u, type: 'system', title: 'old', createdAt: old },
  });
  return { oldMail: oldMail.id, freshMail: freshMail.id, call: call.id, note: note.id };
}

describe('retention sweep', () => {
  t('dry run counts expired rows per class and deletes nothing', async () => {
    const ids = await seedAged();
    const report = await runRetentionSweep(prisma, { dryRun: true, orgId: orgId!, env: {} });
    const byClass = Object.fromEntries(report.classes.map((c) => [c.dataClass, c]));
    expect(report.dryRun).toBe(true);
    expect(byClass.email_messages?.rows).toBeGreaterThanOrEqual(1);
    expect(byClass.call_transcripts?.rows).toBeGreaterThanOrEqual(1);
    expect(byClass.notifications?.rows).toBeGreaterThanOrEqual(1);
    expect(byClass.email_messages?.envVar).toBe('RETENTION_EMAIL_MESSAGES_DAYS');
    expect(await prisma.emailMessage.count({ where: { id: ids.oldMail } })).toBe(1);
  });

  t('enforce removes expired rows only and scrubs transcripts in place', async () => {
    const ids = await seedAged();
    const report = await runRetentionSweep(prisma, { dryRun: false, orgId: orgId!, env: {} });
    expect(report.dryRun).toBe(false);
    expect(
      await prisma.emailMessage.count({
        where: { id: ids.oldMail, deletedAt: { not: undefined } },
      }),
    ).toBe(0);
    expect(await prisma.emailMessage.count({ where: { id: ids.freshMail } })).toBe(1);
    expect(await prisma.notification.count({ where: { id: ids.note } })).toBe(0);
    const call = await prisma.callSession.findFirst({ where: { id: ids.call } });
    expect(call).not.toBeNull();
    expect(call?.transcriptText).toBeNull();
  });

  t('a configured period is honoured (env override)', async () => {
    const ids = await seedAged();
    const report = await runRetentionSweep(prisma, {
      dryRun: false,
      orgId: orgId!,
      env: { RETENTION_EMAIL_MESSAGES_DAYS: '36500' },
    });
    expect(report.classes.find((c) => c.dataClass === 'email_messages')?.days).toBe(36500);
    expect(await prisma.emailMessage.count({ where: { id: ids.oldMail } })).toBe(1);
  });

  t('admin API returns the policy table with env var names and a dry run report', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/compliance/retention' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      mode: string;
      dryRun: boolean;
      classes: Array<{ dataClass: string; envVar: string; days: number; rows: number }>;
    };
    expect(body.dryRun).toBe(true);
    expect(body.classes.map((c) => c.envVar)).toContain('RETENTION_INTEL_EVIDENCE_DAYS');
  });
});
