// Handler-level integration tests for the KAM MCP tools against the live dev DB.
// Proves the staging-only invariant: kam_propose_session_draft writes a PENDING
// draft and commits NO canonical initiatives/tasks; cross-tenant ids are rejected.
// (Scope + SERUM enforcement live in server.ts/serum-policy.ts — operator-gated.)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  kamIngestTranscript,
  kamListAccounts,
  kamListInitiatives,
  kamProposeSessionDraft,
  kamUpdateTaskStatus,
} from './kam-tools.js';
import type { McpAuthCtx } from '../auth.js';

let dbReachable = false;
let orgId = '';
let primaryOrgId = '';
let companyId = '';
let otherCompanyId = '';
let otherOrgId = '';
const sessionIds: string[] = [];
const initiativeIds: string[] = [];

function ctxFor(oid: string): McpAuthCtx {
  return { orgId: oid, scopes: ['read', 'kam'] } as unknown as McpAuthCtx;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // Hermetic: create a dedicated throwaway org instead of anchoring to the
  // shared org_seed_mantu fixture. Depending on shared seed data made these
  // tests fail the moment the seed org was purged (they are supposed to prove
  // org-binding, so they must own their tenants).
  const primary = await prisma.org.create({
    data: { clerkOrg: `org_kamtool_primary_${Math.random().toString(36).slice(2, 10)}`, name: 'KAMTool Primary' },
  });
  primaryOrgId = primary.id;
  orgId = primary.id;
  const company = await prisma.company.create({
    data: { orgId, name: `KAMTool-${Math.random().toString(36).slice(2, 10)}`, source: 'manual', kamStatus: 'active' },
  });
  companyId = company.id;
  const other = await prisma.org.create({
    data: { clerkOrg: `org_kamtool_${Math.random().toString(36).slice(2, 10)}`, name: 'KAMTool Other' },
  });
  otherOrgId = other.id;
  const oc = await prisma.company.create({ data: { orgId: other.id, name: 'oc', source: 'manual' } });
  otherCompanyId = oc.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (initiativeIds.length) await prisma.kamInitiative.deleteMany({ where: { id: { in: initiativeIds } } });
    await prisma.kamInitiative.deleteMany({ where: { companyId } });
    if (sessionIds.length) await prisma.kamSession.deleteMany({ where: { id: { in: sessionIds } } });
    if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    // Cascade-cleans the primary org's company/sessions/initiatives too.
    if (primaryOrgId) await prisma.org.deleteMany({ where: { id: primaryOrgId } });
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

describe('KAM MCP tools (handlers)', () => {
  t('kam_ingest_transcript creates a staging session', async () => {
    const res = (await kamIngestTranscript.handler(
      { companyId, transcriptText: 'manager: ... consultant: ...', sourceType: 'dust_push' },
      ctxFor(orgId),
    )) as { sessionId: string; status: string };
    expect(res.status).toBe('staged');
    sessionIds.push(res.sessionId);
  });

  t('kam_propose_session_draft writes a PENDING draft and commits NO canonical rows', async () => {
    const ingest = (await kamIngestTranscript.handler(
      { companyId, transcriptText: 't', sourceType: 'dust_push' },
      ctxFor(orgId),
    )) as { sessionId: string };
    sessionIds.push(ingest.sessionId);
    const res = (await kamProposeSessionDraft.handler(
      {
        sessionId: ingest.sessionId,
        noteDraft: { summary: 's', keyPoints: [], decisions: [], attendees: [] },
        initiativeDrafts: [{ title: 'proposed init' }],
        taskDrafts: [{ title: 'proposed task', initiativeIndex: 0 }],
        lowConfidence: [],
      },
      ctxFor(orgId),
    )) as { draftId: string; status: string };
    expect(res.status).toBe('pending');

    const draft = await prisma.kamSessionDraft.findUnique({ where: { id: res.draftId } });
    expect(draft?.status).toBe('pending');
    expect(draft?.source).toBe('dust_mcp');
    // The agent committed NOTHING canonical — the human gate is intact.
    expect(await prisma.kamInitiative.count({ where: { sessionId: ingest.sessionId } })).toBe(0);
  });

  t('kam_list_accounts and kam_list_initiatives are read-scoped and org-bound', async () => {
    const accounts = (await kamListAccounts.handler({ limit: 50 }, ctxFor(orgId))) as {
      accounts: Array<{ id: string }>;
    };
    expect(accounts.accounts.some((a) => a.id === companyId)).toBe(true);
    const inits = (await kamListInitiatives.handler({ companyId, limit: 50 }, ctxFor(orgId))) as {
      initiatives: unknown[];
    };
    expect(Array.isArray(inits.initiatives)).toBe(true);
  });

  t('kam_update_task_status updates an existing KAM task', async () => {
    const init = await prisma.kamInitiative.create({
      data: { orgId, companyId, title: 'for task' },
      select: { id: true },
    });
    initiativeIds.push(init.id);
    const task = await prisma.task.create({
      data: { orgId, initiativeId: init.id, accountId: companyId, title: 'todo', status: 'open' },
      select: { id: true },
    });
    const res = (await kamUpdateTaskStatus.handler({ taskId: task.id, status: 'done' }, ctxFor(orgId))) as {
      status: string;
    };
    expect(res.status).toBe('done');
  });

  t('rejects a cross-tenant company id (B3)', async () => {
    await expect(
      kamIngestTranscript.handler(
        { companyId: otherCompanyId, transcriptText: 't', sourceType: 'dust_push' },
        ctxFor(orgId),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
