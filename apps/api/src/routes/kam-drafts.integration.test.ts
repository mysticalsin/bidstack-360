// Integration tests for the KAM human-gate against the live dev DB. This is the
// brief's central invariant: AI output lands in a pending draft; ONLY a human
// approve commits Initiatives/Tasks/note; api-role callers cannot approve
// (B8.1); approve is idempotent; reject commits nothing.

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let companyId = '';
const API_KEY_RAW = `kam-test-${randomUUID()}`;
let apiKeyId = '';
const createdSessionIds: string[] = [];
const createdInitiativeIds: string[] = [];

const sampleContent = {
  noteDraft: {
    summary: 'Workshop with Acme on data platform modernization.',
    keyPoints: ['Legacy ETL is brittle', 'Exec sponsor engaged'],
    decisions: ['Pilot a lakehouse'],
    attendees: ['A. Manager', 'C. Consultant'],
  },
  initiativeDrafts: [
    { title: 'Lakehouse pilot', priority: 'high' as const },
    { title: 'ETL assessment', priority: 'medium' as const },
  ],
  taskDrafts: [
    { title: 'Draft pilot scope', type: 'proposal_prep' as const, initiativeIndex: 0 },
    { title: 'Book follow-up', type: 'follow_up' as const, initiativeIndex: 0 },
    { title: 'Map current ETL', type: 'internal' as const, initiativeIndex: 1 },
  ],
  lowConfidence: [{ term: 'Akme?', context: 'garbled company name in transcript' }],
};

async function newSession(): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/v1/kam/sessions',
    payload: {
      companyId,
      heldAt: new Date('2026-06-20T10:00:00Z').toISOString(),
      sourceType: 'manual_paste',
      transcriptText: 'manager: ... consultant: ...',
    },
  });
  const id = res.json().id as string;
  createdSessionIds.push(id);
  return id;
}

async function newDraft(sessionId: string, content: unknown = sampleContent): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: `/api/v1/kam/sessions/${sessionId}/drafts`,
    payload: { source: 'manual', content },
  });
  return res.json().id as string;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const seedOrg = await prisma.org.findFirst({ where: { clerkOrg: 'org_seed_mantu' } });
  if (!seedOrg) {
    dbReachable = false;
    return;
  }
  orgId = seedOrg.id;
  const company = await prisma.company.create({
    data: { orgId, name: `KAMDraft-${randomUUID().slice(0, 8)}`, source: 'manual' },
  });
  companyId = company.id;
  // An API key (role='api') with write scope — passes requirePermission('kam:write')
  // via the scope shortcut, so it exercises the actor-role gate on approve.
  const apiKey = await prisma.apiKey.create({
    data: {
      orgId,
      name: 'kam-test-key',
      prefix: API_KEY_RAW.slice(0, 8),
      hashedKey: createHash('sha256').update(API_KEY_RAW).digest('hex'),
      scopes: ['read', 'write'],
    },
  });
  apiKeyId = apiKey.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  try {
    if (createdInitiativeIds.length) {
      await prisma.kamInitiative.deleteMany({ where: { id: { in: createdInitiativeIds } } });
    }
    // Remaining initiatives created on this company (defensive), then sessions.
    await prisma.kamInitiative.deleteMany({ where: { companyId } });
    if (createdSessionIds.length) {
      await prisma.kamSession.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (apiKeyId) await prisma.apiKey.deleteMany({ where: { id: apiKeyId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — dev DB / seed org not reachable`);
    await fn();
  });

describe('KAM human-gate (transcript → draft → approve)', () => {
  t('creates a session and a pending draft (nothing committed yet)', async () => {
    const sessionId = await newSession();
    const draftId = await newDraft(sessionId);
    const draft = await server.inject({ method: 'GET', url: `/api/v1/kam/drafts/${draftId}` });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().status).toBe('pending');
    // No initiatives exist for this session before approval.
    const before = await prisma.kamInitiative.count({ where: { sessionId } });
    expect(before).toBe(0);
  });

  t('human approve commits initiatives + tasks + the session note, linked correctly', async () => {
    const sessionId = await newSession();
    const draftId = await newDraft(sessionId);
    const res = await server.inject({ method: 'POST', url: `/api/v1/kam/drafts/${draftId}/approve` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    createdInitiativeIds.push(...body.createdInitiativeIds);
    expect(body.createdInitiativeIds).toHaveLength(2);
    expect(body.createdTaskIds).toHaveLength(3);

    // Tasks linked to the right initiatives (2 → init0, 1 → init1).
    const [init0, init1] = body.createdInitiativeIds as [string, string];
    const tasks = await prisma.task.findMany({ where: { id: { in: body.createdTaskIds }, deletedAt: null } });
    expect(tasks.filter((x) => x.initiativeId === init0)).toHaveLength(2);
    expect(tasks.filter((x) => x.initiativeId === init1)).toHaveLength(1);
    expect(tasks.every((x) => x.accountId === companyId)).toBe(true);

    // Session note committed + approved.
    const session = await prisma.kamSession.findUnique({ where: { id: sessionId } });
    expect(session?.aiNoteStatus).toBe('approved');
    expect(session?.committedAt).toBeTruthy();
  });

  t('a second approve is rejected 409 and creates no duplicate rows', async () => {
    const sessionId = await newSession();
    const draftId = await newDraft(sessionId);
    const first = await server.inject({ method: 'POST', url: `/api/v1/kam/drafts/${draftId}/approve` });
    expect(first.statusCode).toBe(200);
    createdInitiativeIds.push(...first.json().createdInitiativeIds);
    const second = await server.inject({ method: 'POST', url: `/api/v1/kam/drafts/${draftId}/approve` });
    expect(second.statusCode).toBe(409);
    expect(await prisma.kamInitiative.count({ where: { sessionId } })).toBe(2); // not 4
  });

  t('an api-role caller CANNOT approve (B8.1) — 403 even with write scope', async () => {
    const sessionId = await newSession();
    const draftId = await newDraft(sessionId);
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/kam/drafts/${draftId}/approve`,
      headers: { 'x-api-key': API_KEY_RAW },
    });
    expect(res.statusCode).toBe(403);
    // Draft stays pending; nothing committed.
    expect((await server.inject({ method: 'GET', url: `/api/v1/kam/drafts/${draftId}` })).json().status).toBe(
      'pending',
    );
    expect(await prisma.kamInitiative.count({ where: { sessionId } })).toBe(0);
  });

  t('reject commits nothing', async () => {
    const sessionId = await newSession();
    const draftId = await newDraft(sessionId);
    const res = await server.inject({ method: 'POST', url: `/api/v1/kam/drafts/${draftId}/reject` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('rejected');
    expect(await prisma.kamInitiative.count({ where: { sessionId } })).toBe(0);
  });

  t('rejects a draft whose task references an out-of-range initiative (400, nothing committed)', async () => {
    const sessionId = await newSession();
    const badContent = {
      ...sampleContent,
      initiativeDrafts: [{ title: 'only one', priority: 'low' as const }],
      taskDrafts: [{ title: 'orphan', initiativeIndex: 5 }],
    };
    const draftId = await newDraft(sessionId, badContent);
    const res = await server.inject({ method: 'POST', url: `/api/v1/kam/drafts/${draftId}/approve` });
    expect(res.statusCode).toBe(400);
    expect(await prisma.kamInitiative.count({ where: { sessionId } })).toBe(0);
  });
});
