// Org chart bulk import (CSV) and node photos (presigned upload, finalize
// with size and magic-byte checks, served from the API). Admin-only writes
// via orgchart:write; photo reads via orgchart:read.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  ORG_CHART_PHOTO_MAX_BYTES,
  OrgChartConflict,
  ORG_CHART_HTML_MAX_BYTES,
  OrgChartHtmlImportBody,
  OrgChartImportBody,
  OrgChartImportResult,
  OrgChartMutationResponse,
  OrgChartPhotoFinalize,
  OrgChartPhotoUploadRequest,
  OrgChartPhotoUploadResponse,
  nodeSeniorityFromTitle,
  parseOrgChartCsv,
  type OrgChartPhotoType,
} from '@bidstack/shared';

import { getAccessScope } from '../lib/access-scope.js';
import {
  NODE_INCLUDE,
  OrgChartConflictError,
  accountInScope,
  liveNodes,
  nodeMeetingStats,
  provenanceFor,
  redactedContactIds,
  toNode,
  walkTree,
} from '../org-chart/access.js';
import { type StaffContext, parseOrgChartHtml } from '../org-chart/html-import.js';
import { type ImportRow, runPeopleImport } from '../org-chart/import.js';
import { getStorage, keyBelongsToOrg } from '../storage/index.js';
import { auditOrgChart, sendConflict } from './org-chart.js';

/** Our own firm, never client staff. ORG_CHART_OWN_FIRM_NAMES (comma list) overrides the default. */
const OWN_FIRM_DEFAULT = ['Amaris', 'Mantu'];
const ownFirmNames = () => {
  const env = (process.env.ORG_CHART_OWN_FIRM_NAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return env.length ? env : OWN_FIRM_DEFAULT;
};

/** The account's names (name, legal name, domain, parent) and our firm's, for the HTML import staff rule. */
async function staffContext(orgId: string, companyId: string): Promise<StaffContext> {
  const [c, org] = await Promise.all([
    prisma.company.findFirst({ where: { id: companyId, orgId }, select: { name: true, legalName: true, domain: true, parent: { select: { name: true } } } }),
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
  ]);
  const accountNames = [c?.name, c?.legalName, c?.domain, c?.parent?.name].filter((x): x is string => !!x);
  const orgName = org?.name.replace(/\(.*?\)/g, '').trim();
  const firms = [...ownFirmNames(), ...(orgName ? [orgName] : [])];
  return { accountNames, ownFirmNames: [...new Set(firms)] };
}

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

const IMPORT_HELPERS = { audit: auditOrgChart, sendConflict };

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
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const company = await accountInScope(req.auth.orgId, scope, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const parsed = parseOrgChartCsv(req.body.csv);
      // Unknown columns are a warning (reported back), not a blocking error.
      const warnings = parsed.errors.filter((e) => e.message.startsWith('Ignored unknown columns'));
      const errors = parsed.errors.filter((e) => !warnings.includes(e));
      return runPeopleImport(req, reply, company, scope, { source: 'csv', rows: parsed.rows, errors, warnings, dryRun: req.body.dryRun, chartVersion: req.body.chartVersion }, IMPORT_HELPERS);
    },
  );

  // ── HTML import (all or nothing; parsed server-side, nothing executed) ────
  server.post(
    '/companies/:id/org-chart/import-html',
    {
      config: { permission: 'orgchart:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      bodyLimit: ORG_CHART_HTML_MAX_BYTES + 200_000,
      schema: { params: IdParams, body: OrgChartHtmlImportBody, response: { 200: OrgChartImportResult, 409: OrgChartConflict, 422: OrgChartImportResult } },
    },
    async (req, reply) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const company = await accountInScope(req.auth.orgId, scope, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const parsed = parseOrgChartHtml(req.body.html, await staffContext(req.auth.orgId, company.id));
      const rows: ImportRow[] = parsed.people.map((p) => ({
        line: p.line,
        name: p.name,
        title: p.title,
        email: p.email,
        phone: p.phone,
        linkedinUrl: p.linkedinUrl,
        ref: p.ref,
        managerRef: p.managerRef,
        managerEmail: p.managerEmail,
        managerName: p.managerName,
        seniority: nodeSeniorityFromTitle(p.title),
        function: p.function,
        businessUnit: p.businessUnit,
        region: p.region,
        photoUrl: null,
        photo: p.photo,
        profile: p.profile,
      }));
      return runPeopleImport(
        req,
        reply,
        company,
        scope,
        {
          source: 'html',
          rows,
          errors: parsed.errors,
          warnings: parsed.warnings,
          dryRun: req.body.dryRun,
          chartVersion: req.body.chartVersion,
          autoRoot: true,
          nameMatchAny: true,
          sprite: parsed.sprite,
          extra: { format: parsed.format, found: parsed.found, skipped: parsed.skipped, skippedBy: parsed.skippedBy },
        },
        IMPORT_HELPERS,
      );
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
      const stats = await nodeMeetingStats(req.auth.orgId, scope, node.chart.companyId, [fresh]);
      const pii = await server.hasPermission(req, 'contacts:read');
      return { node: toNode(fresh, { redacted: new Set(), stats, depth: walk.depth, childCount: walk.childCount, pii }), chartVersion: node.chart.version };
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
