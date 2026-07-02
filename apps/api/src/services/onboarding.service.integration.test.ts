// Integration tests for the onboarding service. Runs against a THROWAWAY org
// (created + cascade-deleted here) — never the shared seed org — so installing
// sample data can't pollute other suites' baselines.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  installTemplate,
  deleteSampleData,
  hasSampleData,
  listTemplates,
} from './onboarding.service.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let dbReachable = false;
let orgId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.create({
    data: { name: 'Onboarding Test Org', clerkOrg: `org_onb_${Date.now()}` },
  });
  orgId = org.id;
  await prisma.user.create({
    data: {
      orgId: org.id,
      clerkUser: `u_onb_${Date.now()}`,
      email: `onb-${Date.now()}@t.local`,
      name: 'Onboarding Owner',
    },
  });
});

afterAll(async () => {
  if (orgId) {
    // Drop the whole throwaway org — DB cascade removes the installed pipeline,
    // opportunities, leads, tasks, notes and users in FK order (sample data is
    // soft-deleted, so the rows physically remain and must be cascaded, not
    // left to a manual user delete that would hit notes.author_user_id FK).
    await prisma.org.delete({ where: { id: orgId } }).catch(() => {});
  }
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('onboarding service', () => {
  it('lists the four starter templates with stage counts', () => {
    const templates = listTemplates();
    expect(templates.length).toBe(4);
    expect(templates.map((x) => x.key).sort()).toEqual([
      'AGENCY_CONSULTING',
      'B2B_SAAS',
      'ENTERPRISE_SALES',
      'INSIDE_SALES',
    ]);
    expect(templates.every((x) => x.stageCount > 0)).toBe(true);
  });

  t('install seeds a pipeline + sample records, then reports hasSampleData', async () => {
    expect(await hasSampleData(orgId!)).toBe(false);

    const result = await installTemplate(orgId!, 'B2B_SAAS');
    expect(result.stagesCreated).toBeGreaterThan(0);
    expect(result.dealsCreated).toBeGreaterThan(0);
    expect(result.pipelineId).toMatch(/^[0-9a-f-]{36}$/);

    expect(await hasSampleData(orgId!)).toBe(true);
  });

  t('installing the same template twice is rejected', async () => {
    await expect(installTemplate(orgId!, 'B2B_SAAS')).rejects.toThrow(/already installed/i);
  });

  t('delete removes the sample data and clears hasSampleData', async () => {
    const removed = await deleteSampleData(orgId!);
    expect(removed.dealsDeleted).toBeGreaterThan(0);
    expect(removed.pipelinesDeleted).toBeGreaterThan(0);
    expect(await hasSampleData(orgId!)).toBe(false);
  });
});
