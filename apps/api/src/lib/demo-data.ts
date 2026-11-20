/**
 * Org-level Demo data switch and the sample-number gate.
 *
 * The process default is real. Fixture numbers for one org appear only when
 * an owner or a system Admin turns this on. The Admin check is the same role
 * query the analytics dashboard uses for "owner or an admin".
 */
import type { FastifyRequest } from 'fastify';

import { prisma, type PrismaClient } from '@bidstack/db';
import type { AccountKeyNumbers, AccountPositioning, ReleaseScore } from '@bidstack/shared';

import { canOverrideOwnership } from './org-admin.js';

type Db = PrismaClient | typeof prisma;

export async function isSystemAdmin(orgId: string, userId: string, db: Db = prisma): Promise<boolean> {
  const adminRoleCount = await db.userRole.count({
    where: {
      userId,
      deletedAt: null,
      user: { orgId, deletedAt: null },
      role: { orgId, name: 'Admin', deletedAt: null },
    },
  });
  return adminRoleCount > 0;
}

/** Owner override (settings:write) or the system Admin role. API keys never pass. */
export async function canEditDemoData(req: FastifyRequest): Promise<boolean> {
  if (req.auth.role === 'api') return false;
  if (await isSystemAdmin(req.auth.orgId, req.auth.userId)) return true;
  return canOverrideOwnership(req);
}

/** Missing row and a false column both mean off. */
export async function orgDemoDataEnabled(orgId: string, db: Db = prisma): Promise<boolean> {
  const row = await db.orgSettings.findFirst({
    where: { orgId, deletedAt: null },
    select: { demoData: true },
  });
  return row?.demoData === true;
}

const NOT_CONNECTED = 'Not connected';

export function presentFinancials<
  T extends {
    sample?: boolean;
    periods?: unknown[];
    signals?: unknown[];
    periodsContinue?: boolean;
    statusCopy?: string | null;
  },
>(body: T, demo: boolean): T {
  if (demo || body.sample !== true) return body;
  return {
    ...body,
    sample: false,
    periods: [],
    signals: [],
    periodsContinue: false,
    statusCopy: NOT_CONNECTED,
  };
}

export function presentKeyNumbers(body: AccountKeyNumbers, demo: boolean): AccountKeyNumbers {
  if (demo) return body;
  return {
    ...body,
    items: body.items.map((item) =>
      item.sample
        ? {
            ...item,
            value: null,
            delta: null,
            series: [],
            sample: false,
            sub: null,
            missing: NOT_CONNECTED,
          }
        : item,
    ),
  };
}

function sampleSource(source: string | null | undefined): boolean {
  return /sample|fixture/i.test(source ?? '');
}

export function presentPositioning(body: AccountPositioning, demo: boolean): AccountPositioning {
  if (demo) return body;
  const plays = body.plays.filter((play) => !play.sample);
  const gaps = body.gaps.flatMap((gap) => {
    const evidence = gap.evidence.filter((chip) => !chip.sample);
    if (gap.evidence.length > 0 && evidence.length === 0) return [];
    return [{ ...gap, evidence }];
  });
  const financials =
    body.brief.financials && sampleSource(body.brief.financials.source) ? null : body.brief.financials;
  const employees =
    body.brief.employees && sampleSource(body.brief.employees.source) ? null : body.brief.employees;
  return {
    ...body,
    plays,
    gaps,
    sample: false,
    brief: {
      ...body.brief,
      financials,
      employees,
      momentum: body.brief.momentum?.sample ? null : body.brief.momentum,
      topSignal: body.brief.topSignal?.sample ? null : body.brief.topSignal,
    },
  };
}

/** A release score that has not been recorded. Zeros are not shown. */
export function unrecordedReleaseScore(now = new Date()): ReleaseScore {
  return {
    functional: 0,
    code: 0,
    design: 0,
    infra: 0,
    total: 0,
    passed: false,
    scoredAt: now.toISOString(),
    recorded: false,
  };
}
