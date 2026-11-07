/**
 * Impact preview for an access policy draft (factory slice 5).
 *
 * Replays the last 7 days of audit events through the evaluator twice, once
 * with the published rules and once with the draft, and reports who would
 * gain or lose access. Each event's record is loaded, so country conditions
 * apply here even though route enforcement cannot see them.
 */
import { prisma } from '@bidstack/db';
import {
  evaluateAccessPolicy,
  type AccessPolicyResource,
  type AccessPolicyRule,
  type PermissionKey,
} from '@bidstack/shared';

import { loadPolicySubjects } from './access-policy-enforcement.js';
import { userHasPermission } from './rbac-decision-cache.js';

export const SIMULATION_WINDOW_DAYS = 7;
export const SIMULATION_EVENT_CAP = 5_000;
const AUDIT_PAGE = 1_000;
const LOOKUP_PAGE = 200;
const DAY_MS = 86_400_000;
const EXAMPLE_CAP = 5;
const USER_CAP = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuditTarget {
  permission: PermissionKey;
  resource: AccessPolicyResource;
}

/** Which permission and policy resource an audited action exercised. */
export function auditEventTarget(action: string): AuditTarget | null {
  if (action.includes('export')) {
    if (action.startsWith('tenant')) return { permission: 'settings:write', resource: 'exports' };
    if (action.startsWith('report')) return { permission: 'reports:read', resource: 'exports' };
    return { permission: 'opportunities:read', resource: 'exports' };
  }
  const read = /\.(read|view|viewed)$/.test(action);
  if (action.startsWith('company.')) return { permission: read ? 'companies:read' : 'companies:write', resource: 'companies' };
  if (action.startsWith('opportunity.')) {
    return { permission: read ? 'opportunities:read' : 'opportunities:write', resource: 'opportunities' };
  }
  if (/^(contract_agreement|contract_extraction|msa)\./.test(action)) {
    return { permission: read ? 'msa:read' : 'msa:write', resource: 'msa' };
  }
  return null;
}

export interface SimulationExample {
  at: string;
  userId: string;
  userName: string;
  action: PermissionKey;
  resource: AccessPolicyResource;
  targetId: string | null;
  ruleId: string | null;
}

export interface SimulationSide {
  count: number;
  users: Array<{ userId: string; name: string; count: number }>;
  examples: SimulationExample[];
}

export interface SimulationResult {
  window: { from: string; to: string };
  evaluated: number;
  baselineVersion: number | null;
  gained: SimulationSide;
  lost: SimulationSide;
  byDay: Array<{ day: string; gained: number; lost: number }>;
}

/** Runs an id IN (...) lookup in pages the query guard accepts. */
async function inPages<T>(ids: readonly string[], load: (page: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_PAGE) out.push(...(await load(ids.slice(i, i + LOOKUP_PAGE))));
  return out;
}

async function recordCountries(orgId: string, ids: Record<AccessPolicyResource, Set<string>>) {
  const pick = (s: Set<string>) => [...s].filter((id) => UUID.test(id));
  const [companies, opportunities, agreements] = await Promise.all([
    inPages(pick(ids.companies), (page) =>
      prisma.company.findMany({ where: { orgId, id: { in: page } }, select: { id: true, countryCode: true }, take: page.length }),
    ),
    inPages(pick(ids.opportunities), (page) =>
      prisma.opportunity.findMany({ where: { orgId, id: { in: page } }, select: { id: true, country: true }, take: page.length }),
    ),
    inPages(pick(ids.msa), (page) =>
      prisma.contractAgreement.findMany({ where: { orgId, id: { in: page } }, select: { id: true, countries: true }, take: page.length }),
    ),
  ]);
  const out = new Map<string, string | null>();
  for (const c of companies) out.set(c.id, c.countryCode?.toUpperCase() ?? null);
  for (const o of opportunities) out.set(o.id, o.country?.toUpperCase() ?? null);
  for (const a of agreements) out.set(a.id, a.countries[0]?.toUpperCase() ?? null);
  return out;
}

function side(): SimulationSide & { byUser: Map<string, number> } {
  return { count: 0, users: [], examples: [], byUser: new Map() };
}

export async function simulateAccessPolicy(args: {
  orgId: string;
  draft: readonly AccessPolicyRule[];
  baseline: readonly AccessPolicyRule[];
  baselineVersion: number | null;
  now?: Date;
}): Promise<SimulationResult> {
  const to = args.now ?? new Date();
  const from = new Date(to.getTime() - SIMULATION_WINDOW_DAYS * DAY_MS);
  const rows: Array<{ id: bigint; userId: string | null; action: string; targetId: string | null; at: Date }> = [];
  let before: bigint | null = null;
  while (rows.length < SIMULATION_EVENT_CAP) {
    const page: typeof rows = await prisma.auditLog.findMany({
      where: {
        orgId: args.orgId,
        deletedAt: null,
        userId: { not: null },
        at: { gte: from, lte: to },
        ...(before !== null ? { id: { lt: before } } : {}),
        OR: [
          { action: { startsWith: 'company.' } },
          { action: { startsWith: 'opportunity.' } },
          { action: { startsWith: 'contract_agreement.' } },
          { action: { startsWith: 'contract_extraction.' } },
          { action: { startsWith: 'msa.' } },
          { action: { contains: 'export' } },
        ],
      },
      orderBy: { id: 'desc' },
      take: AUDIT_PAGE,
      select: { id: true, userId: true, action: true, targetId: true, at: true },
    });
    rows.push(...page);
    if (page.length < AUDIT_PAGE) break;
    before = page.at(-1)!.id;
  }

  const events = rows.flatMap((r) => {
    const target = auditEventTarget(r.action);
    return target && r.userId ? [{ ...r, userId: r.userId, ...target }] : [];
  });
  const ids: Record<AccessPolicyResource, Set<string>> = {
    companies: new Set(),
    msa: new Set(),
    opportunities: new Set(),
    exports: new Set(),
  };
  for (const e of events) if (e.targetId) ids[e.resource].add(e.targetId);
  const userIds = [...new Set(events.map((e) => e.userId))];
  const [countries, subjectPages, users] = await Promise.all([
    recordCountries(args.orgId, ids),
    inPages(userIds, async (page) => [...(await loadPolicySubjects(args.orgId, page)).entries()]),
    inPages(userIds, (page) =>
      prisma.user.findMany({
        where: { orgId: args.orgId, id: { in: page } },
        select: { id: true, name: true, email: true },
        take: page.length,
      }),
    ),
  ]);
  const subjects = new Map(subjectPages);
  const names = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const matrix = new Map<string, boolean>();

  const gained = side();
  const lost = side();
  const byDay = Array.from({ length: SIMULATION_WINDOW_DAYS }, (_, i) => ({
    day: new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10),
    gained: 0,
    lost: 0,
  }));

  for (const e of events) {
    const key = `${e.userId}|${e.permission}`;
    let allowed = matrix.get(key);
    if (allowed === undefined) {
      allowed = await userHasPermission(args.orgId, e.userId, e.permission);
      matrix.set(key, allowed);
    }
    const input = {
      matrixAllows: allowed,
      subject: subjects.get(e.userId) ?? { roles: [], teams: [], countries: [] },
      action: e.permission,
      resource: { type: e.resource, country: e.targetId ? (countries.get(e.targetId) ?? null) : null },
      at: e.at,
    };
    const before = evaluateAccessPolicy({ ...input, rules: args.baseline });
    const after = evaluateAccessPolicy({ ...input, rules: args.draft });
    if (before.allowed === after.allowed) continue;
    const bucket = after.allowed ? gained : lost;
    const dayIndex = Math.min(SIMULATION_WINDOW_DAYS - 1, Math.floor((e.at.getTime() - from.getTime()) / DAY_MS));
    byDay[dayIndex]![after.allowed ? 'gained' : 'lost'] += 1;
    bucket.count += 1;
    bucket.byUser.set(e.userId, (bucket.byUser.get(e.userId) ?? 0) + 1);
    if (bucket.examples.length < EXAMPLE_CAP) {
      bucket.examples.push({
        at: e.at.toISOString(),
        userId: e.userId,
        userName: names.get(e.userId) ?? 'Unknown user',
        action: e.permission,
        resource: e.resource,
        targetId: e.targetId,
        ruleId: after.ruleId ?? before.ruleId,
      });
    }
  }

  const finish = ({ byUser, ...s }: ReturnType<typeof side>): SimulationSide => ({
    ...s,
    users: [...byUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, USER_CAP)
      .map(([userId, count]) => ({ userId, name: names.get(userId) ?? 'Unknown user', count })),
  });

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    evaluated: events.length,
    baselineVersion: args.baselineVersion,
    gained: finish(gained),
    lost: finish(lost),
    byDay,
  };
}
