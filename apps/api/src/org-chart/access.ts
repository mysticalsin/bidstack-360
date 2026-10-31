// Org chart access, serialization and meeting stats (API side).
//
// Security model
//  * orgchart:read for reads, orgchart:write (Admin-only by default) for edits.
//  * The account (company) must be in the caller's org and access scope
//    (applyCompanyScope); otherwise 404, like a missing row.
//  * Hierarchy redaction: a node whose linked contact sits on a company
//    outside the caller's scope keeps its place in the tree (id, parent,
//    seniority) but hides identity (name, title, photo, owner, sentiment,
//    contact id, meetings). Writes on a redacted node answer 404.
//  * Meeting counts and "last met" are aggregates over every in-scope meeting
//    (any visibility), like the meeting-intel coverage map. Meeting titles and
//    challenges in node detail follow meeting-intel visibility.
import { type Prisma, prisma } from '@bidstack/db';
import { type OrgChartNode, type OrgChartSource, ORG_CHART_MAX_NODES } from '@bidstack/shared';

import { type AccessScope, applyCompanyScope } from '../lib/access-scope.js';
import { companiesInScope, scopedMeetingWhere } from '../meeting-intel/access.js';

export const NODE_INCLUDE = {
  contact: { select: { id: true, companyId: true, name: true, email: true, reportsToContactId: true } },
  owner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.OrgChartNodeInclude;
export type NodeRow = Prisma.OrgChartNodeGetPayload<{ include: typeof NODE_INCLUDE }>;

export class OrgChartConflictError extends Error {
  constructor(
    message: string,
    readonly currentVersion: number | null,
    readonly chartVersion: number | null,
  ) {
    super(message);
  }
}

export function conflictBody(err: OrgChartConflictError) {
  return {
    error: 'version_conflict' as const,
    message: err.message,
    currentVersion: err.currentVersion,
    chartVersion: err.chartVersion,
  };
}

export async function accountInScope(orgId: string, scope: AccessScope, companyId: string) {
  return prisma.company.findFirst({
    where: applyCompanyScope({ id: companyId, orgId, deletedAt: null }, scope),
    select: { id: true, name: true },
  });
}

export async function liveNodes(db: Prisma.TransactionClient | typeof prisma, orgId: string, chartId: string): Promise<NodeRow[]> {
  return db.orgChartNode.findMany({
    where: { orgId, chartId, deletedAt: null },
    include: NODE_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: ORG_CHART_MAX_NODES,
  });
}

/** Contact ids whose company is outside the caller's scope. */
export async function redactedContactIds(orgId: string, scope: AccessScope, nodes: NodeRow[]): Promise<Set<string>> {
  const companyIds = [...new Set(nodes.map((n) => n.contact?.companyId).filter((c): c is string => !!c))];
  const visible = await companiesInScope(orgId, scope, companyIds);
  return new Set(nodes.filter((n) => n.contact?.companyId && !visible.has(n.contact.companyId)).map((n) => n.contact!.id));
}

export function isRedacted(node: NodeRow, redacted: Set<string>): boolean {
  return !!node.contactId && redacted.has(node.contactId);
}

export interface MeetingStats {
  count: number;
  last: Date | null;
}

/** Meetings attended per contact on in-scope companies (any visibility), paged. */
export async function meetingStats(orgId: string, scope: AccessScope, contactIds: string[], since?: Date): Promise<Map<string, MeetingStats>> {
  const out = new Map<string, MeetingStats>();
  if (!contactIds.length) return out;
  const where: Prisma.MeetingIntelWhereInput = {
    AND: [
      scopedMeetingWhere(orgId, scope),
      { attendees: { some: { contactId: { in: contactIds }, isInternal: false } } },
      ...(since ? [{ heldAt: { gte: since } }] : []),
    ],
  };
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const rows = await prisma.meetingIntel.findMany({
      where,
      select: { id: true, heldAt: true, attendees: { where: { contactId: { in: contactIds }, isInternal: false }, select: { contactId: true } } },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const m of rows) {
      for (const cid of new Set(m.attendees.map((a) => a.contactId).filter((c): c is string => !!c))) {
        const s = out.get(cid) ?? { count: 0, last: null };
        s.count++;
        if (!s.last || m.heldAt > s.last) s.last = m.heldAt;
        out.set(cid, s);
      }
    }
    if (rows.length < 1000) break;
    cursor = rows[rows.length - 1]!.id;
  }
  return out;
}

export function photoPath(nodeId: string): string {
  return `/api/v1/org-chart/nodes/${nodeId}/photo`;
}

export interface SerializeCtx {
  redacted: Set<string>;
  stats: Map<string, MeetingStats>;
  depth: Map<string, number>;
  childCount: Map<string, number>;
}

export function toNode(n: NodeRow, ctx: SerializeCtx): OrgChartNode {
  const hidden = isRedacted(n, ctx.redacted);
  const stats = n.contactId && !hidden ? ctx.stats.get(n.contactId) : undefined;
  return {
    id: n.id,
    chartId: n.chartId,
    parentId: n.parentId,
    contactId: hidden ? null : n.contactId,
    kind: n.kind as OrgChartNode['kind'],
    name: hidden ? 'Restricted' : n.name,
    title: hidden ? null : n.title,
    seniority: n.seniority,
    function: n.function,
    businessUnit: hidden ? null : n.businessUnit,
    region: n.region,
    photoUrl: hidden ? null : n.photoStorageKey ? photoPath(n.id) : n.photoUrl,
    relationshipStrength: hidden ? null : n.relationshipStrength,
    sentiment: hidden ? null : n.sentiment,
    owner: hidden || !n.owner ? null : { id: n.owner.id, name: n.owner.name ?? n.owner.email },
    sortOrder: n.sortOrder,
    source: n.source as OrgChartSource,
    placement: n.placement as OrgChartNode['placement'],
    provenance: hidden ? {} : (n.provenance as OrgChartNode['provenance']),
    version: n.version,
    depth: ctx.depth.get(n.id) ?? 0,
    childCount: ctx.childCount.get(n.id) ?? 0,
    meetingCount: stats?.count ?? 0,
    lastMetAt: stats?.last?.toISOString() ?? null,
    redacted: hidden,
    updatedAt: n.updatedAt.toISOString(),
  };
}

/** Depth-first order from `startId` (root when omitted), parent before child. */
export function walkTree(nodes: NodeRow[], startId?: string | null) {
  const kids = new Map<string | null, NodeRow[]>();
  for (const n of nodes) {
    const list = kids.get(n.parentId) ?? [];
    list.push(n);
    kids.set(n.parentId, list);
  }
  const childCount = new Map<string, number>();
  for (const n of nodes) childCount.set(n.id, kids.get(n.id)?.length ?? 0);
  const root = nodes.find((n) => n.parentId === null) ?? null;
  const start = startId ? nodes.find((n) => n.id === startId) ?? null : root;
  const order: NodeRow[] = [];
  const depth = new Map<string, number>();
  if (start) {
    const stack: Array<[NodeRow, number]> = [[start, 0]];
    const seen = new Set<string>();
    while (stack.length) {
      const [n, d] = stack.pop()!;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      order.push(n);
      depth.set(n.id, d);
      const children = kids.get(n.id) ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i]!, d + 1]);
    }
  }
  return { order, depth, childCount, root };
}

export function provenanceFor(fields: string[], source: OrgChartSource, at: Date, byUserId: string | null) {
  return Object.fromEntries(fields.map((f) => [f, { source, at: at.toISOString(), byUserId }]));
}

/** Serialize the lock for one account's chart (structural edits, import, seed). */
export async function lockChart(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orgchart:${companyId}`}))`;
}
