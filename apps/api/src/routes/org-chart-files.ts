// Org chart bulk import (CSV) and node photos (presigned upload, finalize
// with size and magic-byte checks, served from the API). Admin-only writes
// via orgchart:write; photo reads via orgchart:read.
import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { type Prisma, prisma } from '@bidstack/db';
import {
  ORG_CHART_MAX_NODES,
  ORG_CHART_PHOTO_MAX_BYTES,
  OrgChartConflict,
  OrgChartImportBody,
  OrgChartImportResult,
  OrgChartMutationResponse,
  OrgChartPhotoFinalize,
  OrgChartPhotoUploadRequest,
  OrgChartPhotoUploadResponse,
  nodeSeniorityFromTitle,
  parseOrgChartCsv,
  type OrgChartCsvRow,
  type OrgChartPhotoType,
} from '@bidstack/shared';

import { getAccessScope } from '../lib/access-scope.js';
import { companiesInScope, groupCompanyIds } from '../meeting-intel/access.js';
import {
  NODE_INCLUDE,
  OrgChartConflictError,
  accountInScope,
  liveNodes,
  lockChart,
  meetingStats,
  provenanceFor,
  redactedContactIds,
  toNode,
  walkTree,
} from '../org-chart/access.js';
import { getStorage, keyBelongsToOrg } from '../storage/index.js';
import { auditOrgChart, sendConflict } from './org-chart.js';

const IdParams = z.object({ id: z.string().uuid() });
const NodeParams = z.object({ nodeId: z.string().uuid() });
const PHOTO_EXT: Record<OrgChartPhotoType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Real image type from the first bytes; null for anything else (SVG, HTML, ...). */
export function detectPhotoType(buf: Buffer): OrgChartPhotoType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const photoSegment = (nodeId: string) => `orgchart-${nodeId}`;
const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);

interface Planned {
  row: OrgChartCsvRow;
  id: string;
  isNew: boolean;
  contactId: string | null;
  parentId: string | null | undefined; // undefined: keep current
}

const orgChartFileRoutes: FastifyPluginAsyncZod = async (server) => {
  async function visibleNode(req: FastifyRequest, nodeId: string) {
    const node = await prisma.orgChartNode.findFirst({
      where: { id: nodeId, orgId: req.auth.orgId, deletedAt: null },
      include: { ...NODE_INCLUDE, chart: { select: { id: true, companyId: true, version: true } } },
    });
    if (!node) throw server.httpErrors.notFound('Org chart node not found');
    const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
    if (!(await accountInScope(req.auth.orgId, scope, node.chart.companyId))) throw server.httpErrors.notFound('Org chart node not found');
    if ((await redactedContactIds(req.auth.orgId, scope, [node])).size) throw server.httpErrors.notFound('Org chart node not found');
    return { node, scope };
  }

  // ── CSV import (all or nothing) ───────────────────────────────────────────
  server.post(
    '/companies/:id/org-chart/import',
    {
      config: { permission: 'orgchart:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      bodyLimit: 1_200_000,
      schema: { params: IdParams, body: OrgChartImportBody, response: { 200: OrgChartImportResult, 409: OrgChartConflict, 422: OrgChartImportResult } },
    },
    async (req, reply) => {
      const orgId = req.auth.orgId;
      const scope = await getAccessScope(orgId, req.auth.userId);
      const company = await accountInScope(orgId, scope, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const parsed = parseOrgChartCsv(req.body.csv);
      const rows = parsed.rows;
      // Unknown columns are a warning (reported back), not a blocking error.
      const warnings = parsed.errors.filter((e) => e.message.startsWith('Ignored unknown columns'));
      const errors = parsed.errors.filter((e) => !warnings.includes(e));
      const fail = (chartVersion: number | null) =>
        reply.code(422).send({ dryRun: req.body.dryRun, created: 0, updated: 0, errors: [...warnings, ...errors], chartVersion });
      if (errors.length || !rows.length) {
        if (!rows.length && !errors.length) errors.push({ line: 1, message: 'No rows to import' });
        return fail(null);
      }

      // Lookups (outside the transaction; ids are re-checked by FKs).
      const groups = await groupCompanyIds(orgId, company.id);
      const emails = [...new Set(rows.flatMap((r) => [lower(r.email)]).filter((e): e is string => !!e))];
      const contacts = emails.length
        ? await prisma.contact.findMany({ where: { orgId, deletedAt: null, companyId: { in: groups }, email: { in: emails } }, select: { id: true, email: true, companyId: true }, take: 1000 })
        : [];
      const visible = await companiesInScope(orgId, scope, [...new Set(contacts.map((x) => x.companyId!).filter(Boolean))]);
      const contactByEmail = new Map(contacts.filter((x) => x.companyId && visible.has(x.companyId)).map((x) => [lower(x.email)!, x.id]));
      const ownerEmails = [...new Set(rows.map((r) => lower(r.ownerEmail)).filter((e): e is string => !!e))];
      const owners = ownerEmails.length
        ? await prisma.user.findMany({ where: { orgId, OR: ownerEmails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) }, select: { id: true, email: true }, take: 1000 })
        : [];
      const ownerByEmail = new Map(owners.map((u) => [lower(u.email)!, u.id]));

      try {
        const result = await prisma.$transaction(async (tx) => {
          await lockChart(tx, company.id);
          const chart = await tx.orgChart.findFirst({ where: { orgId, companyId: company.id } });
          if (req.body.chartVersion !== undefined && req.body.chartVersion !== (chart?.version ?? 0)) {
            throw new OrgChartConflictError('The org chart changed since you loaded it', null, chart?.version ?? null);
          }
          const existing = chart ? await liveNodes(tx, orgId, chart.id) : [];
          const redacted = await redactedContactIds(orgId, scope, existing);
          const exByEmail = new Map<string, (typeof existing)[number]>();
          const exByName = new Map<string, Array<(typeof existing)[number]>>();
          for (const e of existing) {
            const em = lower(e.contact?.email) ?? (e.externalRef?.includes('@') ? lower(e.externalRef) : null);
            if (em) exByEmail.set(em, e);
            const nm = lower(e.name)!;
            exByName.set(nm, [...(exByName.get(nm) ?? []), e]);
          }
          const exByContact = new Map(existing.filter((e) => e.contactId).map((e) => [e.contactId!, e]));
          const root = existing.find((e) => e.parentId === null) ?? null;

          // 1. Match each row to an existing node or a new one.
          const plan: Planned[] = [];
          const seen = new Set<string>();
          for (const row of rows) {
            const key = lower(row.email) ?? `name:${lower(row.name)}`;
            if (seen.has(key)) {
              errors.push({ line: row.line, message: 'Duplicate person in the file' });
              continue;
            }
            seen.add(key);
            const contactId = row.email ? (contactByEmail.get(lower(row.email)!) ?? null) : null;
            const byName = !row.email ? (exByName.get(lower(row.name)!) ?? []).filter((e) => !e.contactId) : [];
            const match = (row.email ? exByEmail.get(lower(row.email)!) : undefined) ?? (contactId ? exByContact.get(contactId) : undefined) ?? (byName.length === 1 ? byName[0] : undefined);
            if (match && redacted.has(match.contactId ?? '')) {
              errors.push({ line: row.line, message: 'This person is outside your access scope' });
              continue;
            }
            if (row.ownerEmail && !ownerByEmail.has(lower(row.ownerEmail)!)) {
              errors.push({ line: row.line, message: `Unknown owner_email ${row.ownerEmail}` });
            }
            plan.push({ row, id: match?.id ?? randomUUID(), isNew: !match, contactId: match ? match.contactId : contactId, parentId: undefined });
          }

          // 2. Resolve managers against the file first, then the chart.
          const planByEmail = new Map(plan.filter((x) => x.row.email).map((x) => [lower(x.row.email)!, x]));
          const planByName = new Map<string, Planned[]>();
          for (const x of plan) planByName.set(lower(x.row.name)!, [...(planByName.get(lower(x.row.name)!) ?? []), x]);
          let newRoot: Planned | null = null;
          for (const x of plan) {
            const { managerEmail, managerName, line } = x.row;
            let parent: string | null = null;
            if (managerEmail) {
              parent = planByEmail.get(lower(managerEmail)!)?.id ?? exByEmail.get(lower(managerEmail)!)?.id ?? null;
              if (!parent) errors.push({ line, message: `Manager ${managerEmail} is not in the file or on the chart` });
            } else if (managerName) {
              const inFile = planByName.get(lower(managerName)!) ?? [];
              const onChart = (exByName.get(lower(managerName)!) ?? []).filter((e) => !plan.some((p) => p.id === e.id));
              const all = [...inFile.map((p) => p.id), ...onChart.map((e) => e.id)];
              if (all.length === 1) parent = all[0]!;
              else errors.push({ line, message: all.length ? `Manager name ${managerName} is ambiguous; use manager_email` : `Manager ${managerName} is not in the file or on the chart` });
            }
            if (parent && parent === x.id) errors.push({ line, message: 'A person cannot be their own manager' });
            if (parent) {
              if (!x.isNew && root?.id === x.id) errors.push({ line, message: 'The root cannot be moved by import; set another root first' });
              else if (redacted.size && existing.some((e) => e.id === parent && redacted.has(e.contactId ?? ''))) errors.push({ line, message: 'Manager is outside your access scope' });
              else x.parentId = parent;
            } else if (!managerEmail && !managerName) {
              if (!x.isNew) continue; // keep where it is
              if (root) x.parentId = root.id;
              else if (!newRoot) {
                newRoot = x;
                x.parentId = null;
              } else errors.push({ line, message: 'The chart is empty, so exactly one row may have no manager (the CEO)' });
            }
          }

          // 3. Cycles over the final structure.
          const parentOf = new Map<string, string | null>(existing.map((e) => [e.id, e.parentId]));
          for (const x of plan) if (x.parentId !== undefined) parentOf.set(x.id, x.parentId);
          for (const x of plan) {
            const walked = new Set<string>();
            for (let cur: string | null | undefined = x.id; cur; cur = parentOf.get(cur)) {
              if (walked.has(cur)) {
                errors.push({ line: x.row.line, message: 'This reporting line loops back on itself' });
                break;
              }
              walked.add(cur);
            }
          }
          const created = plan.filter((x) => x.isNew).length;
          if (existing.length + created > ORG_CHART_MAX_NODES) errors.push({ line: 1, message: `An org chart holds at most ${ORG_CHART_MAX_NODES} nodes` });
          if (errors.length) return { ok: false as const, chartVersion: chart?.version ?? null };
          const updated = plan.length - created;
          if (req.body.dryRun) return { ok: true as const, created, updated, chartVersion: chart?.version ?? null };

          // 4. Write: existing nodes, then new nodes parents first.
          const c = chart ?? (await tx.orgChart.create({ data: { orgId, companyId: company.id, createdById: req.auth.userId } }));
          const now = new Date();
          const fieldsOf = (r: OrgChartCsvRow) => {
            const d: Record<string, unknown> = { name: r.name };
            if (r.title) d.title = r.title;
            if (r.title || r.seniority !== 'unknown') d.seniority = r.seniority !== 'unknown' ? r.seniority : nodeSeniorityFromTitle(r.title);
            if (r.function) d.function = r.function;
            if (r.businessUnit) d.businessUnit = r.businessUnit;
            if (r.region) d.region = r.region;
            if (r.photoUrl) d.photoUrl = r.photoUrl;
            if (r.relationshipStrength) d.relationshipStrength = r.relationshipStrength;
            if (r.sentiment) d.sentiment = r.sentiment;
            if (r.ownerEmail) d.ownerUserId = ownerByEmail.get(lower(r.ownerEmail)!);
            return d;
          };
          const byId = new Map(existing.map((e) => [e.id, e]));
          for (const x of plan.filter((p) => !p.isNew)) {
            const e = byId.get(x.id)!;
            const d = fieldsOf(x.row);
            const moved = x.parentId !== undefined && x.parentId !== e.parentId;
            await tx.orgChartNode.update({
              where: { id: x.id },
              data: {
                ...d,
                ...(moved ? { parentId: x.parentId, placement: 'manual' } : {}),
                version: { increment: 1 },
                updatedById: req.auth.userId,
                provenance: { ...(e.provenance as object), ...provenanceFor([...Object.keys(d), ...(moved ? ['parentId'] : [])], 'csv', now, req.auth.userId) },
              } as Prisma.OrgChartNodeUncheckedUpdateInput,
            });
          }
          const pending = plan.filter((p) => p.isNew);
          const placed = new Set<string>(existing.map((e) => e.id));
          while (pending.length) {
            const i = pending.findIndex((p) => p.parentId === null || placed.has(p.parentId!));
            const x = pending.splice(i, 1)[0]!;
            const d = fieldsOf(x.row);
            await tx.orgChartNode.create({
              data: {
                ...(d as object),
                id: x.id,
                orgId,
                chartId: c.id,
                name: x.row.name,
                parentId: x.parentId ?? null,
                contactId: x.contactId,
                kind: x.contactId ? 'contact' : 'placeholder',
                seniority: (d.seniority as never) ?? nodeSeniorityFromTitle(x.row.title),
                source: 'csv',
                externalRef: !x.contactId && x.row.email ? lower(x.row.email) : null,
                placement: x.parentId === null ? 'root' : x.row.managerEmail || x.row.managerName ? 'manual' : 'inferred',
                provenance: provenanceFor([...Object.keys(d), 'parentId'], 'csv', now, req.auth.userId),
                createdById: req.auth.userId,
                updatedById: req.auth.userId,
              } as Prisma.OrgChartNodeUncheckedCreateInput,
            });
            placed.add(x.id);
          }
          const v = await tx.orgChart.update({ where: { id: c.id }, data: { version: { increment: 1 } }, select: { version: true } });
          await auditOrgChart(req, 'orgchart.import', 'company', company.id, { created, updated, rows: rows.length }, tx);
          return { ok: true as const, created, updated, chartVersion: v.version };
        });
        if (!result.ok) return fail(result.chartVersion);
        return { dryRun: req.body.dryRun, created: result.created, updated: result.updated, errors: warnings, chartVersion: result.chartVersion };
      } catch (err) {
        return sendConflict(reply, err);
      }
    },
  );

  // ── Photo: presigned upload ───────────────────────────────────────────────
  server.post(
    '/org-chart/nodes/:nodeId/photo/upload-url',
    {
      config: { permission: 'orgchart:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: NodeParams, body: OrgChartPhotoUploadRequest, response: { 200: OrgChartPhotoUploadResponse } },
    },
    async (req) => {
      const { node } = await visibleNode(req, req.params.nodeId);
      const storage = await getStorage();
      const key = storage.newKey(req.auth.orgId, photoSegment(node.id), `photo.${PHOTO_EXT[req.body.contentType]}`);
      const presigned = await storage.getUploadUrl({ key, contentType: req.body.contentType, bytes: req.body.bytes });
      return { uploadUrl: presigned.url, storageKey: key, headers: presigned.headers, maxBytes: ORG_CHART_PHOTO_MAX_BYTES };
    },
  );

  // ── Photo: finalize ───────────────────────────────────────────────────────
  server.post(
    '/org-chart/nodes/:nodeId/photo',
    {
      config: { permission: 'orgchart:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: NodeParams, body: OrgChartPhotoFinalize, response: { 200: OrgChartMutationResponse, 409: OrgChartConflict } },
    },
    async (req, reply) => {
      const { node, scope } = await visibleNode(req, req.params.nodeId);
      const b = req.body;
      if (!keyBelongsToOrg(b.storageKey, req.auth.orgId) || !b.storageKey.includes(`/${photoSegment(node.id)}/`)) {
        throw server.httpErrors.forbidden('Storage key was not issued for this node');
      }
      const storage = await getStorage();
      const reject = async (message: string): Promise<never> => {
        await storage.delete(b.storageKey).catch(() => undefined);
        throw server.httpErrors.badRequest(message);
      };
      let meta;
      try {
        meta = await storage.head(b.storageKey);
      } catch {
        throw server.httpErrors.notFound('Uploaded object not found');
      }
      if (meta.bytes !== b.bytes || meta.bytes > ORG_CHART_PHOTO_MAX_BYTES) await reject('Photo size does not match or exceeds 2 MB');
      if (meta.contentType && meta.contentType !== b.contentType) await reject('Photo content type does not match');
      const buf = await storage.readBuffer(b.storageKey);
      if (buf.length !== meta.bytes) await reject('Photo size does not match or exceeds 2 MB');
      const detected = detectPhotoType(buf);
      if (!detected || detected !== b.contentType) await reject('Only PNG, JPEG and WebP images are accepted');
      try {
        await prisma.$transaction(async (tx) => {
          const r = await tx.orgChartNode.updateMany({
            where: { id: node.id, version: b.version, deletedAt: null },
            data: {
              photoStorageKey: b.storageKey,
              photoContentType: b.contentType,
              photoUrl: null,
              version: { increment: 1 },
              updatedById: req.auth.userId,
              provenance: { ...(node.provenance as object), ...provenanceFor(['photoUrl'], 'manual', new Date(), req.auth.userId) },
            },
          });
          if (r.count === 0) throw new OrgChartConflictError('Someone else edited this node; reload and try again', (await tx.orgChartNode.findFirst({ where: { id: node.id }, select: { version: true } }))?.version ?? null, node.chart.version);
          await auditOrgChart(req, 'orgchart.node.photo', 'org_chart_node', node.id, { bytes: meta.bytes, contentType: b.contentType }, tx);
        });
      } catch (err) {
        await storage.delete(b.storageKey).catch(() => undefined);
        return sendConflict(reply, err);
      }
      if (node.photoStorageKey && node.photoStorageKey !== b.storageKey) await storage.delete(node.photoStorageKey).catch(() => undefined);
      const nodes = await liveNodes(prisma, req.auth.orgId, node.chartId);
      const fresh = nodes.find((x) => x.id === node.id)!;
      const walk = walkTree(nodes);
      const stats = fresh.contactId ? await meetingStats(req.auth.orgId, scope, [fresh.contactId]) : new Map();
      return { node: toNode(fresh, { redacted: new Set(), stats, depth: walk.depth, childCount: walk.childCount }), chartVersion: node.chart.version };
    },
  );

  // ── Photo: serve ──────────────────────────────────────────────────────────
  server.get(
    '/org-chart/nodes/:nodeId/photo',
    { config: { permission: 'orgchart:read' }, schema: { params: NodeParams } },
    async (req, reply) => {
      const { node } = await visibleNode(req, req.params.nodeId);
      if (!node.photoStorageKey || !node.photoContentType) throw server.httpErrors.notFound('No uploaded photo');
      const storage = await getStorage();
      const dl = await storage.getDownload(node.photoStorageKey, { filename: `photo.${PHOTO_EXT[node.photoContentType as OrgChartPhotoType] ?? 'img'}`, contentType: node.photoContentType, expiresInSeconds: 300 });
      if (dl.kind === 'redirect' && dl.url) return reply.header('Cache-Control', 'private, max-age=60').redirect(dl.url, 302);
      if (!dl.stream) throw server.httpErrors.notFound('No uploaded photo');
      reply
        .header('Content-Type', node.photoContentType)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cache-Control', 'private, max-age=300');
      if (dl.bytes != null) reply.header('Content-Length', String(dl.bytes));
      return reply.send(dl.stream);
    },
  );
};

export default orgChartFileRoutes;
