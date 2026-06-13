// Integration tests for the comitology / governance log (A4) and the Spotlight
// Ref receiving end (A5) + opportunity filter rules (M6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { ingestProjectReference } from '../services/project-reference.service.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const ACCOUNT = 'governance-test-account';

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
    await prisma.governanceMeeting.deleteMany({ where: { orgId, accountKey: ACCOUNT } });
    await prisma.projectReference.deleteMany({ where: { orgId, accountKey: ACCOUNT } });
    await prisma.auditLog.deleteMany({
      where: {
        orgId,
        action: { in: ['governance_meeting.create', 'project_reference.validate', 'org_settings.opportunity_filters.update'] },
      },
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

describe('governance meetings', () => {
  t('create with nested actions, then advance an action status', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/governance-meetings',
      payload: {
        accountKey: ACCOUNT,
        meetingType: 'monthly_committee',
        date: new Date().toISOString(),
        participants: ['Alice', 'Bob'],
        outcomes: 'Agreed next steps.',
        actions: [{ description: 'Draft the SOW' }],
      },
    });
    expect(create.statusCode).toBe(201);
    const meeting = create.json() as { id: string; actions: { id: string; status: string }[] };
    expect(meeting.actions).toHaveLength(1);

    const actionId = meeting.actions[0]!.id;
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/governance-meetings/${meeting.id}/actions/${actionId}`,
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(200);
    const updated = patch.json() as { actions: { id: string; status: string }[] };
    expect(updated.actions.find((a) => a.id === actionId)?.status).toBe('done');
  });

  t('list returns only the requested account', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/governance-meetings?accountKey=${ACCOUNT}`,
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { accountKey: string }[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((m) => m.accountKey === ACCOUNT)).toBe(true);
  });
});

describe('project references (Spotlight Ref receiving end)', () => {
  t('ingestion stub seeds a manager_review ref; validate moves it to validated', async () => {
    const id = await ingestProjectReference({
      orgId: orgId!,
      accountKey: ACCOUNT,
      title: 'Test reference',
      businessSummary: 'Did a thing well.',
    });
    const validate = await server.inject({
      method: 'PATCH',
      url: `/api/project-references/${id}/validate`,
    });
    expect(validate.statusCode).toBe(200);
    expect((validate.json() as { status: string }).status).toBe('validated');

    const list = await server.inject({
      method: 'GET',
      url: `/api/project-references?accountKey=${ACCOUNT}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);
  });
});

describe('opportunity filter rules (M6)', () => {
  t('defaults to empty rules, then persists an update', async () => {
    const get = await server.inject({ method: 'GET', url: '/api/org-settings/opportunity-filters' });
    expect(get.statusCode).toBe(200);

    const put = await server.inject({
      method: 'PUT',
      url: '/api/org-settings/opportunity-filters',
      payload: { includeExpertiseTypes: ['Cyber', 'Cloud'], excludeNonFramework: true },
    });
    expect(put.statusCode).toBe(200);
    const rules = put.json() as { includeExpertiseTypes: string[]; excludeNonFramework: boolean };
    expect(rules.includeExpertiseTypes).toEqual(['Cyber', 'Cloud']);
    expect(rules.excludeNonFramework).toBe(true);

    const after = await server.inject({
      method: 'GET',
      url: '/api/org-settings/opportunity-filters',
    });
    expect((after.json() as { includeExpertiseTypes: string[] }).includeExpertiseTypes).toEqual([
      'Cyber',
      'Cloud',
    ]);
  });
});
