// Account org charts (organigram): one curated tree per account, rooted at
// the CEO. Read with orgchart:read; edit with orgchart:write (Admin only by
// default). The chart is a curated view next to the people map: it reads
// contacts, accepted reports-to facts and meeting intel, and never writes
// ContactFact rows or Contact.reportsToContactId.
//
// Concurrency: every node carries `version`, every chart carries
// `chartVersion`. Edits send the version they read; a stale one answers 409
// with the current versions. Structural edits (create, move, delete, set
// root, import, seed) take a per-account advisory lock and bump chartVersion.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma, prisma } from '@bidstack/db';
import {
  ORG_CHART_MAX_NODES,
  OrgChartConflict,
  OrgChartCoverage,
  OrgChartMutationResponse,
  OrgChartNodeCreate,
  OrgChartNodeDeleteQuery,
  OrgChartNodeDetail,
  OrgChartNodeMove,
  OrgChartNodePatch,
  OrgChartSetRoot,
  OrgChartTreeQuery,
  OrgChartTreeResponse,
  SENIORITY_ORDER,
  nodeSeniorityFromTitle,
  wouldCreateCycle,
  type OrgChartNode,
  type SeniorityLevel,
} from '@bidstack/shared';

import { type AccessScope, getAccessScope } from '../lib/access-scope.js';
import { getStorage } from '../storage/index.js';
import { userHasAnyRole } from '../lib/rbac-decision-cache.js';
import { groupCompanyIds, companiesInScope, scopedMeetingWhere, visibleMeetingWhere } from '../meeting-intel/access.js';
import {
  NODE_INCLUDE,
  type NodeRow,
  OrgChartConflictError,
  accountInScope,
  conflictBody,
  isRedacted,
  liveNodes,
  lockChart,
  meetingStats,
  provenanceFor,
  redactedContactIds,
  toNode,
  walkTree,
} from '../org-chart/access.js';

const IdParams = z.object({ id: z.string().uuid() });
const NodeParams = z.object({ nodeId: z.string().uuid() });
const Problem = z.object({ statusCode: z.number(), error: z.string(), message: z.string() }).passthrough();

type Tx = Prisma.TransactionClient;
const EDITABLE = [
  'name',
  'title',
  'seniority',
  'function',
  'businessUnit',
  'region',
  'photoUrl',
  'relationshipStrength',
  'sentiment',
  'ownerUserId',
  'sortOrder',
] as const;
type Editable = (typeof EDITABLE)[number];

export async function auditOrgChart(
  req: FastifyRequest,
  action: string,
  targetType: 'company' | 'org_chart_node',
  targetId: string,
  diff: Record<string, unknown>,
  db: Tx | typeof prisma = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: { orgId: req.auth.orgId, userId: req.auth.userId, action, targetType, targetId, diff: diff as Prisma.InputJsonValue },
  });
}

export function sendConflict(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof OrgChartConflictError) return reply.code(409).send(conflictBody(err));
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return reply.code(409).send({ error: 'version_conflict', message: 'That contact is already on this chart, or another edit added the same node', currentVersion: null, chartVersion: null });
  }
  throw err;
}

/** Chart, its nodes and the caller's view, for serialization. */
async function viewOf(orgId: string, scope: AccessScope, chartId: string, since?: Date) {
  const nodes = await liveNodes(prisma, orgId, chartId);
  const redacted = await redactedContactIds(orgId, scope, nodes);
  const contactIds = nodes.filter((n) => n.contactId && !redacted.has(n.contactId)).map((n) => n.contactId!);
  const stats = await meetingStats(orgId, scope, contactIds, since);
  const walk = walkTree(nodes);
  return { nodes, redacted, stats, walk };
}

const orgChartRoutes: FastifyPluginAsyncZod = async (server) => {
  const notFound = (what = 'Org chart node') => server.httpErrors.notFound(`${what} not found`);

  async function account(req: FastifyRequest, companyId: string) {
    const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
    const company = await accountInScope(req.auth.orgId, scope, companyId);
    if (!company) throw notFound('Company');
    return { scope, company };
  }

  /** A live node the caller may see in full; 404 for other orgs, out-of-scope accounts and redacted nodes. */
  async function visibleNode(req: FastifyRequest, nodeId: string) {
    const node = await prisma.orgChartNode.findFirst({
      where: { id: nodeId, orgId: req.auth.orgId, deletedAt: null },
      include: { ...NODE_INCLUDE, chart: { select: { id: true, companyId: true, version: true } } },
    });
    if (!node) throw notFound();
    const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
    if (!(await accountInScope(req.auth.orgId, scope, node.chart.companyId))) throw notFound();
    if ((await redactedContactIds(req.auth.orgId, scope, [node])).size) throw notFound();
    return { node, scope };
  }

  async function assertContact(req: FastifyRequest, scope: AccessScope, companyId: string, contactId: string) {
    const groups = await groupCompanyIds(req.auth.orgId, companyId);
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, orgId: req.auth.orgId, deletedAt: null, companyId: { in: groups } },
      select: { id: true, name: true, role: true, companyId: true },
    });
    if (!contact || !contact.companyId) throw server.httpErrors.badRequest('contactId must be a contact of this account or its subsidiaries');
    const visible = await companiesInScope(req.auth.orgId, scope, [contact.companyId]);
    if (!visible.has(contact.companyId)) throw server.httpErrors.badRequest('contactId must be a contact of this account or its subsidiaries');
    return contact;
  }

  async function assertOwner(req: FastifyRequest, ownerUserId: string | null | undefined) {
    if (!ownerUserId) return;
    const u = await prisma.user.findFirst({ where: { id: ownerUserId, orgId: req.auth.orgId }, select: { id: true } });
    if (!u) throw server.httpErrors.badRequest('ownerUserId must be a user of your organization');
  }

  /** Live node on `chartId` the caller can see; used for parents and set-root targets. */
  async function nodeOnChart(tx: Tx, req: FastifyRequest, scope: AccessScope, chartId: string, nodeId: string) {
    const n = await tx.orgChartNode.findFirst({ where: { id: nodeId, orgId: req.auth.orgId, chartId, deletedAt: null }, include: NODE_INCLUDE });
    if (!n || (await redactedContactIds(req.auth.orgId, scope, [n])).size) throw notFound('Parent node');
    return n;
  }

  async function serializeOne(req: FastifyRequest, scope: AccessScope, nodeId: string): Promise<OrgChartNode | null> {
    const n = await prisma.orgChartNode.findFirst({ where: { id: nodeId, orgId: req.auth.orgId, deletedAt: null }, include: NODE_INCLUDE });
    if (!n) return null;
    const { redacted, stats, walk } = await viewOf(req.auth.orgId, scope, n.chartId);
    return toNode(n, { redacted, stats, depth: walk.depth, childCount: walk.childCount });
  }

  function checkChartVersion(chart: { version: number }, expected: number | undefined) {
    if (expected !== undefined && expected !== chart.version) {
      throw new OrgChartConflictError('The org chart changed since you loaded it', null, chart.version);
    }
  }

  async function bumpNode(tx: Tx, nodeId: string, version: number, data: Prisma.OrgChartNodeUncheckedUpdateManyInput, chartVersion: number) {
    const r = await tx.orgChartNode.updateMany({ where: { id: nodeId, version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) {
      const cur = await tx.orgChartNode.findFirst({ where: { id: nodeId }, select: { version: true } });
      throw new OrgChartConflictError('Someone else edited this node; reload and try again', cur?.version ?? null, chartVersion);
    }
  }

  async function bumpChart(tx: Tx, chartId: string): Promise<number> {
    const c = await tx.orgChart.update({ where: { id: chartId }, data: { version: { increment: 1 } }, select: { version: true } });
    return c.version;
  }

  // ── Tree ──────────────────────────────────────────────────────────────────
  server.get(
    '/companies/:id/org-chart',
    {
      config: { permission: 'orgchart:read' },
      schema: { params: IdParams, querystring: OrgChartTreeQuery, response: { 200: OrgChartTreeResponse } },
    },
    async (req) => {
      const { scope, company } = await account(req, req.params.id);
      const chart = await prisma.orgChart.findFirst({ where: { orgId: req.auth.orgId, companyId: company.id } });
      if (!chart) return { companyId: company.id, chart: null, nodes: [], truncated: false };
      const { nodes, redacted, stats } = await viewOf(req.auth.orgId, scope, chart.id);
      const full = walkTree(nodes);
      if (req.query.fromNodeId) {
        const from = nodes.find((n) => n.id === req.query.fromNodeId);
        if (!from || isRedacted(from, redacted)) throw notFound();
      }
      const sub = req.query.fromNodeId ? walkTree(nodes, req.query.fromNodeId) : full;
      const maxDepth = req.query.depth;
      const picked = maxDepth === undefined ? sub.order : sub.order.filter((n) => (sub.depth.get(n.id) ?? 0) <= maxDepth);
      const ctx = { redacted, stats, depth: full.depth, childCount: full.childCount };
      return {
        companyId: company.id,
        chart: {
          id: chart.id,
          companyId: company.id,
          version: chart.version,
          rootNodeId: full.root?.id ?? null,
          nodeCount: nodes.length,
          updatedAt: chart.updatedAt.toISOString(),
        },
        nodes: picked.map((n) => toNode(n, ctx)),
        truncated: picked.length < sub.order.length,
      };
    },
  );

  // ── Coverage overlay ──────────────────────────────────────────────────────
  server.get(
    '/companies/:id/org-chart/coverage',
    {
      config: { permission: 'orgchart:read' },
      schema: {
        params: IdParams,
        querystring: z.object({ windowDays: z.coerce.number().int().min(1).max(3650).default(365) }),
        response: { 200: OrgChartCoverage },
      },
    },
    async (req) => {
      const { scope, company } = await account(req, req.params.id);
      const windowDays = req.query.windowDays;
      const chart = await prisma.orgChart.findFirst({ where: { orgId: req.auth.orgId, companyId: company.id }, select: { id: true } });
      const empty = { companyId: company.id, windowDays, total: 0, met: 0, nodes: [], bySeniority: [], unmetSenior: [] };
      if (!chart) return empty;
      const since = new Date(Date.now() - windowDays * 86_400_000);
      const { walk, redacted, stats } = await viewOf(req.auth.orgId, scope, chart.id, since);
      const rows = walk.order.map((n) => {
        const s = n.contactId && !isRedacted(n, redacted) ? stats.get(n.contactId) : undefined;
        return { nodeId: n.id, seniority: n.seniority, met: !!s, meetingCount: s?.count ?? 0, lastMetAt: s?.last?.toISOString() ?? null };
      });
      const bySeniority = SENIORITY_ORDER.map((seniority: SeniorityLevel) => {
        const list = rows.filter((r) => r.seniority === seniority);
        return { seniority, total: list.length, met: list.filter((r) => r.met).length };
      }).filter((b) => b.total > 0);
      return {
        companyId: company.id,
        windowDays,
        total: rows.length,
        met: rows.filter((r) => r.met).length,
        nodes: rows.map(({ seniority: _s, ...r }) => r),
        bySeniority,
        unmetSenior: rows.filter((r) => !r.met && (r.seniority === 'c_level' || r.seniority === 'vp')).map((r) => r.nodeId),
      };
    },
  );

  // ── Node detail ───────────────────────────────────────────────────────────
  server.get(
    '/org-chart/nodes/:nodeId',
    {
      config: { permission: 'orgchart:read' },
      schema: { params: NodeParams, response: { 200: OrgChartNodeDetail } },
    },
    async (req) => {
      const { node, scope } = await visibleNode(req, req.params.nodeId);
      const { nodes, redacted, stats, walk } = await viewOf(req.auth.orgId, scope, node.chartId);
      const ctx = { redacted, stats, depth: walk.depth, childCount: walk.childCount };
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const ref = (n: NodeRow) => {
        const hidden = isRedacted(n, redacted);
        return { id: n.id, name: hidden ? 'Restricted' : n.name, title: hidden ? null : n.title, redacted: hidden };
      };
      const path: NodeRow[] = [];
      for (let cur: NodeRow | undefined = byId.get(node.id), i = 0; cur && i <= nodes.length; cur = cur.parentId ? byId.get(cur.parentId) : undefined, i++) path.unshift(cur);

      const admin = await userHasAnyRole(req.auth.orgId, req.auth.userId, ['Admin']);
      const base = admin ? scopedMeetingWhere(req.auth.orgId, scope) : visibleMeetingWhere(req.auth.orgId, scope);
      const email = node.contact?.email ?? (node.externalRef?.includes('@') ? node.externalRef : null);
      const who: Prisma.MeetingIntelAttendeeWhereInput[] = [];
      if (node.contactId) who.push({ contactId: node.contactId });
      if (email) who.push({ email: { equals: email, mode: 'insensitive' } });
      const meetings = who.length
        ? await prisma.meetingIntel.findMany({
            where: { AND: [base, { attendees: { some: { isInternal: false, OR: who } } }] },
            select: { id: true, title: true, heldAt: true, companyId: true, challenges: true, nextSteps: true, sources: { select: { source: true } } },
            orderBy: { heldAt: 'desc' },
            take: 20,
          })
        : [];
      const challenges = new Map<string, { text: string; count: number; lastAt: Date }>();
      for (const m of meetings) {
        for (const text of new Set(m.challenges)) {
          const key = text.trim().toLowerCase();
          const c = challenges.get(key) ?? { text: text.trim(), count: 0, lastAt: m.heldAt };
          c.count++;
          if (m.heldAt > c.lastAt) c.lastAt = m.heldAt;
          challenges.set(key, c);
        }
      }
      let reportsToFact: OrgChartNodeDetail['reportsToFact'] = null;
      const rt = node.contact?.reportsToContactId;
      if (rt) {
        const mgr = await prisma.contact.findFirst({ where: { id: rt, orgId: req.auth.orgId, deletedAt: null }, select: { id: true, name: true, companyId: true } });
        const ok = mgr && (!mgr.companyId || (await companiesInScope(req.auth.orgId, scope, [mgr.companyId])).has(mgr.companyId));
        if (mgr && ok) {
          const parent = node.parentId ? byId.get(node.parentId) : undefined;
          reportsToFact = { contactId: mgr.id, name: mgr.name, matchesChart: parent?.contactId === mgr.id };
        }
      }
      await auditOrgChart(req, 'orgchart.node.view', 'org_chart_node', node.id, { meetings: meetings.length, adminOverride: admin });
      return {
        node: toNode(byId.get(node.id) ?? node, ctx),
        manager: node.parentId && byId.get(node.parentId) ? ref(byId.get(node.parentId)!) : null,
        directReports: walk.order.filter((n) => n.parentId === node.id).map(ref),
        path: path.map(ref),
        meetings: meetings.map((m) => ({
          id: m.id,
          title: m.title,
          heldAt: m.heldAt.toISOString(),
          companyId: m.companyId,
          challenges: m.challenges,
          nextSteps: m.nextSteps,
          sources: [...new Set(m.sources.map((s) => s.source as string))],
        })),
        challenges: [...challenges.values()]
          .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime())
          .slice(0, 20)
          .map((c) => ({ text: c.text, count: c.count, lastAt: c.lastAt.toISOString() })),
        reportsToFact,
      };
    },
  );

  // ── Create ────────────────────────────────────────────────────────────────
  server.post(
    '/companies/:id/org-chart/nodes',
    {
      config: { permission: 'orgchart:write' },
      schema: { params: IdParams, body: OrgChartNodeCreate, response: { 201: OrgChartMutationResponse, 409: OrgChartConflict } },
    },
    async (req, reply) => {
      const { scope, company } = await account(req, req.params.id);
      const b = req.body;
      const contact = b.contactId ? await assertContact(req, scope, company.id, b.contactId) : null;
      await assertOwner(req, b.ownerUserId);
      const now = new Date();
      try {
        const out = await prisma.$transaction(async (tx) => {
          await lockChart(tx, company.id);
          const chart =
            (await tx.orgChart.findFirst({ where: { orgId: req.auth.orgId, companyId: company.id } })) ??
            (await tx.orgChart.create({ data: { orgId: req.auth.orgId, companyId: company.id, createdById: req.auth.userId } }));
          checkChartVersion(chart, b.chartVersion);
          const count = await tx.orgChartNode.count({ where: { orgId: req.auth.orgId, chartId: chart.id, deletedAt: null } });
          if (count >= ORG_CHART_MAX_NODES) throw server.httpErrors.badRequest(`An org chart holds at most ${ORG_CHART_MAX_NODES} nodes`);
          let parentId: string | null = null;
          if (count === 0) {
            if (b.parentId) throw server.httpErrors.badRequest('The first node of a chart is its root (the CEO); omit parentId');
          } else {
            if (!b.parentId) throw server.httpErrors.badRequest('parentId is required; use POST /companies/:id/org-chart/root to change the root');
            parentId = (await nodeOnChart(tx, req, scope, chart.id, b.parentId)).id;
          }
          const title = b.title !== undefined ? b.title : (contact?.role ?? null);
          const manual = EDITABLE.filter((k) => b[k] !== undefined);
          const fromContact = contact ? (['name', 'title'] as const).filter((k) => b[k] === undefined) : [];
          const created = await tx.orgChartNode.create({
            data: {
              orgId: req.auth.orgId,
              chartId: chart.id,
              parentId,
              contactId: contact?.id ?? null,
              kind: contact ? 'contact' : 'placeholder',
              name: b.name ?? contact?.name ?? 'Unknown',
              title,
              seniority: b.seniority ?? nodeSeniorityFromTitle(title),
              function: b.function ?? null,
              businessUnit: b.businessUnit ?? null,
              region: b.region ?? null,
              photoUrl: b.photoUrl ?? null,
              relationshipStrength: b.relationshipStrength ?? null,
              sentiment: b.sentiment ?? null,
              ownerUserId: b.ownerUserId ?? null,
              sortOrder: b.sortOrder ?? 0,
              source: 'manual',
              placement: parentId ? 'manual' : 'root',
              provenance: {
                ...provenanceFor([...fromContact], 'contacts', now, req.auth.userId),
                ...provenanceFor([...manual, 'parentId'], 'manual', now, req.auth.userId),
              },
              createdById: req.auth.userId,
              updatedById: req.auth.userId,
            },
          });
          const chartVersion = await bumpChart(tx, chart.id);
          await auditOrgChart(req, 'orgchart.node.create', 'org_chart_node', created.id, { companyId: company.id, parentId, contactId: created.contactId, fields: manual }, tx);
          return { id: created.id, chartVersion };
        });
        return reply.code(201).send({ node: await serializeOne(req, scope, out.id), chartVersion: out.chartVersion });
      } catch (err) {
        return sendConflict(reply, err);
      }
    },
  );

  // ── Edit fields ───────────────────────────────────────────────────────────
  server.patch(
    '/org-chart/nodes/:nodeId',
    {
      config: { permission: 'orgchart:write' },
      schema: { params: NodeParams, body: OrgChartNodePatch, response: { 200: OrgChartMutationResponse, 409: OrgChartConflict } },
    },
    async (req, reply) => {
      const { node, scope } = await visibleNode(req, req.params.nodeId);
      const b = req.body;
      await assertOwner(req, b.ownerUserId);
      const changed = EDITABLE.filter((k) => b[k] !== undefined && (b[k] as unknown) !== (node[k as keyof typeof node] as unknown));
      const data: Prisma.OrgChartNodeUncheckedUpdateManyInput = { updatedById: req.auth.userId };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const k of changed) {
        (data as Record<Editable, unknown>)[k] = b[k];
        before[k] = node[k as keyof typeof node];
        after[k] = b[k];
      }
      if (changed.includes('title') && b.seniority === undefined && !(node.provenance as Record<string, unknown>)['seniority']) {
        data.seniority = nodeSeniorityFromTitle(b.title);
      }
      const dropPhoto = b.photoUrl !== undefined && node.photoStorageKey;
      if (dropPhoto) {
        data.photoStorageKey = null;
        data.photoContentType = null;
      }
      data.provenance = { ...(node.provenance as object), ...provenanceFor(changed, 'manual', new Date(), req.auth.userId) };
      try {
        await prisma.$transaction(async (tx) => {
          await bumpNode(tx, node.id, b.version, data, node.chart.version);
          await auditOrgChart(req, 'orgchart.node.update', 'org_chart_node', node.id, { before, after }, tx);
        });
      } catch (err) {
        return sendConflict(reply, err);
      }
      if (dropPhoto) {
        await (await getStorage()).delete(node.photoStorageKey!).catch(() => undefined);
      }
      return { node: await serializeOne(req, scope, node.id), chartVersion: node.chart.version };
    },
  );

  // ── Move (re-parent, drag and drop) ───────────────────────────────────────
  server.post(
    '/org-chart/nodes/:nodeId/move',
    {
      config: { permission: 'orgchart:write' },
      schema: { params: NodeParams, body: OrgChartNodeMove, response: { 200: OrgChartMutationResponse, 409: OrgChartConflict, 422: Problem } },
    },
    async (req, reply) => {
      const { node, scope } = await visibleNode(req, req.params.nodeId);
      const b = req.body;
      if (node.parentId === null) throw server.httpErrors.badRequest('The root cannot be moved; set another node as root instead');
      try {
        const out = await prisma.$transaction(async (tx) => {
          await lockChart(tx, node.chart.companyId);
          const parent = await nodeOnChart(tx, req, scope, node.chartId, b.parentId);
          const all = await tx.orgChartNode.findMany({ where: { orgId: req.auth.orgId, chartId: node.chartId, deletedAt: null }, select: { id: true, parentId: true }, take: ORG_CHART_MAX_NODES });
          const parentOf = new Map(all.map((n) => [n.id, n.parentId]));
          if (wouldCreateCycle(parentOf, node.id, parent.id)) {
            throw server.httpErrors.unprocessableEntity('A node cannot report to itself or to someone in its own reporting line');
          }
          const chart = await tx.orgChart.findUniqueOrThrow({ where: { id: node.chartId }, select: { version: true } });
          await bumpNode(
            tx,
            node.id,
            b.version,
            {
              parentId: parent.id,
              placement: 'manual',
              updatedById: req.auth.userId,
              ...(b.sortOrder !== undefined ? { sortOrder: b.sortOrder } : {}),
              provenance: { ...(node.provenance as object), ...provenanceFor(['parentId'], 'manual', new Date(), req.auth.userId) },
            },
            chart.version,
          );
          const chartVersion = await bumpChart(tx, node.chartId);
          await auditOrgChart(req, 'orgchart.node.move', 'org_chart_node', node.id, { from: node.parentId, to: parent.id }, tx);
          return chartVersion;
        });
        return { node: await serializeOne(req, scope, node.id), chartVersion: out };
      } catch (err) {
        return sendConflict(reply, err);
      }
    },
  );

  // ── Soft delete (children move up to the deleted node's manager) ──────────
  server.delete(
    '/org-chart/nodes/:nodeId',
    {
      config: { permission: 'orgchart:write' },
      schema: { params: NodeParams, querystring: OrgChartNodeDeleteQuery, response: { 200: OrgChartMutationResponse, 409: OrgChartConflict } },
    },
    async (req, reply) => {
      const { node } = await visibleNode(req, req.params.nodeId);
      try {
        const chartVersion = await prisma.$transaction(async (tx) => {
          await lockChart(tx, node.chart.companyId);
          const children = await tx.orgChartNode.findMany({
            where: { orgId: req.auth.orgId, chartId: node.chartId, parentId: node.id, deletedAt: null },
            select: { id: true },
            take: ORG_CHART_MAX_NODES,
          });
          if (node.parentId === null && children.length) {
            throw new OrgChartConflictError('Set another node as root before removing the CEO', node.version, node.chart.version);
          }
          const chart = await tx.orgChart.findUniqueOrThrow({ where: { id: node.chartId }, select: { version: true } });
          await bumpNode(tx, node.id, req.query.version, { deletedAt: new Date(), updatedById: req.auth.userId }, chart.version);
          if (children.length) {
            await tx.orgChartNode.updateMany({
              where: { id: { in: children.map((c) => c.id) } },
              data: { parentId: node.parentId, version: { increment: 1 }, updatedById: req.auth.userId },
            });
          }
          const v = await bumpChart(tx, node.chartId);
          await auditOrgChart(req, 'orgchart.node.delete', 'org_chart_node', node.id, { name: node.name, reparentedTo: node.parentId, reparented: children.map((c) => c.id) }, tx);
          return v;
        });
        return { node: null, chartVersion };
      } catch (err) {
        return sendConflict(reply, err);
      }
    },
  );

  // ── Set root (the CEO) ────────────────────────────────────────────────────
  server.post(
    '/companies/:id/org-chart/root',
    {
      config: { permission: 'orgchart:write' },
      schema: { params: IdParams, body: OrgChartSetRoot, response: { 200: OrgChartMutationResponse, 409: OrgChartConflict } },
    },
    async (req, reply) => {
      const { scope, company } = await account(req, req.params.id);
      const chartRow = await prisma.orgChart.findFirst({ where: { orgId: req.auth.orgId, companyId: company.id }, select: { id: true } });
      if (!chartRow) throw notFound('Org chart');
      try {
        const chartVersion = await prisma.$transaction(async (tx) => {
          await lockChart(tx, company.id);
          const chart = await tx.orgChart.findUniqueOrThrow({ where: { id: chartRow.id } });
          checkChartVersion(chart, req.body.chartVersion);
          const target = await nodeOnChart(tx, req, scope, chart.id, req.body.nodeId).catch(() => {
            throw notFound();
          });
          const oldRoot = await tx.orgChartNode.findFirst({ where: { orgId: req.auth.orgId, chartId: chart.id, parentId: null, deletedAt: null }, select: { id: true, provenance: true } });
          if (oldRoot?.id === target.id) return chart.version;
          const now = new Date();
          // Old root first (zero live roots for a moment), then the new one:
          // the partial unique index allows at most one live root at a time.
          if (oldRoot) {
            await tx.orgChartNode.update({
              where: { id: oldRoot.id },
              data: { parentId: target.id, placement: 'manual', version: { increment: 1 }, updatedById: req.auth.userId, provenance: { ...(oldRoot.provenance as object), ...provenanceFor(['parentId'], 'manual', now, req.auth.userId) } },
            });
          }
          await tx.orgChartNode.update({
            where: { id: target.id },
            data: { parentId: null, placement: 'root', version: { increment: 1 }, updatedById: req.auth.userId, provenance: { ...(target.provenance as object), ...provenanceFor(['parentId'], 'manual', now, req.auth.userId) } },
          });
          const v = await bumpChart(tx, chart.id);
          await auditOrgChart(req, 'orgchart.root.set', 'company', company.id, { from: oldRoot?.id ?? null, to: target.id, formerParent: target.parentId }, tx);
          return v;
        });
        return { node: await serializeOne(req, scope, req.body.nodeId), chartVersion };
      } catch (err) {
        return sendConflict(reply, err);
      }
    },
  );
};

export default orgChartRoutes;
