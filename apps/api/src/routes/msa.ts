// MSA library: master service agreements per account, with SOWs, amendments
// and addenda as children, versioned PDF/DOCX files, short-lived downloads, an
// audit timeline and a per-account summary. Contract: fleet/polo-msa-api.md.
//
// Security model
//  * RBAC: msa:read for every read, msa:write for create/edit/upload,
//    msa:admin to archive, or to edit an MSA someone else owns.
//  * Org isolation: every query carries orgId = req.auth.orgId.
//  * Scope isolation: an MSA is visible only when its company is in the
//    caller's access scope (applyCompanyScope). Out-of-scope rows answer 404,
//    exactly like a missing row, so existence never leaks. A parent outside
//    scope is redacted from a child's detail.
//  * Files: PDF/DOCX only, MSA_MAX_BYTES cap, size and type re-checked from
//    storage at finalize, magic bytes verified, SHA-256 computed server-side.
//  * Downloads: short-lived signed URL only (S3 presign or a sealed local
//    token), never a redirect or stream from an authenticated route.
//  * Audit: every view, download and change writes audit_log (targetType msa).
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';

type ContractKind = NonNullable<Prisma.ContractAgreementCreateInput['kind']>;
type ContractStatus = NonNullable<Prisma.ContractAgreementCreateInput['status']>;
import {
  MSA_ALLOWED_CONTENT_TYPES,
  MSA_CHILD_KINDS,
  MSA_MAX_BYTES,
  MsaAccountSummary,
  MsaCreate,
  MsaDetail,
  MsaDownloadUrlResponse,
  MsaListQuery,
  MsaListResponse,
  MsaPatch,
  MsaSearchQuery,
  MsaSearchResponse,
  MsaTimelineResponse,
  MsaUploadUrlRequest,
  MsaUploadUrlResponse,
  MsaVersionFinalize,
  type MsaFileVersion,
  type MsaSearchHit,
  type MsaSummaryRow,
  type MsaTimelineEvent,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope, type AccessScope } from '../lib/access-scope.js';
import { userHasPermission } from '../lib/rbac-decision-cache.js';
import { normalizeName } from '../services/crm/dashboard.utils.js';
import { getStorage, keyBelongsToOrg } from '../storage/index.js';
import { detectMsaContentType, sha256Hex } from '../msa/file-checks.js';
import { enqueueMsaTextExtract } from '../queues/msa-text-extract.js';
import { issueMsaDownloadToken, MSA_DOWNLOAD_TTL_SECONDS, openMsaDownloadToken } from '../msa/download-token.js';

const DAY_MS = 86_400_000;
const USER_SELECT = { id: true, email: true, name: true } as const;
const VERSION_SELECT = {
  id: true,
  versionNo: true,
  fileName: true,
  contentType: true,
  bytes: true,
  sha256: true,
  note: true,
  extractionStatus: true,
  createdAt: true,
  createdBy: { select: USER_SELECT },
} as const;
const ROW_SELECT = {
  id: true,
  companyId: true,
  parentId: true,
  kind: true,
  title: true,
  reference: true,
  counterparty: true,
  status: true,
  effectiveDate: true,
  expiryDate: true,
  autoRenew: true,
  noticePeriodDays: true,
  tags: true,
  updatedAt: true,
  ownerId: true,
  createdById: true,
  company: { select: { name: true } },
  owner: { select: USER_SELECT },
  _count: { select: { children: { where: { deletedAt: null } } } },
  fileVersions: {
    where: { deletedAt: null },
    orderBy: { versionNo: 'desc' as const },
    take: 1,
    select: VERSION_SELECT,
  },
} satisfies Prisma.ContractAgreementSelect;

type Row = Prisma.ContractAgreementGetPayload<{ select: typeof ROW_SELECT }>;
type VersionRow = Prisma.ContractFileVersionGetPayload<{ select: typeof VERSION_SELECT }>;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : new Date(v);
}

function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function noticeDeadline(expiry: Date | null, noticeDays: number | null): Date | null {
  if (!expiry || noticeDays == null) return null;
  return new Date(expiry.getTime() - noticeDays * DAY_MS);
}

function daysUntil(d: Date | null, now = new Date()): number | null {
  if (!d) return null;
  return Math.round((d.getTime() - startOfUtcDay(now)) / DAY_MS);
}

function serializeVersion(v: VersionRow): MsaFileVersion {
  return {
    id: v.id,
    versionNo: v.versionNo,
    fileName: v.fileName,
    contentType: v.contentType as MsaFileVersion['contentType'],
    bytes: v.bytes,
    sha256: v.sha256,
    note: v.note,
    extractionStatus: v.extractionStatus as MsaFileVersion['extractionStatus'],
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
  };
}

function serializeRow(r: Row): MsaSummaryRow {
  const deadline = noticeDeadline(r.expiryDate, r.noticePeriodDays);
  return {
    id: r.id,
    companyId: r.companyId,
    companyName: r.company?.name ?? null,
    parentId: r.parentId,
    kind: r.kind as MsaSummaryRow['kind'],
    title: r.title ?? r.reference,
    reference: r.reference,
    counterparty: r.counterparty,
    status: r.status as MsaSummaryRow['status'],
    effectiveDate: iso(r.effectiveDate),
    expiryDate: iso(r.expiryDate),
    autoRenew: r.autoRenew,
    noticePeriodDays: r.noticePeriodDays,
    noticeDeadline: iso(deadline),
    daysToExpiry: daysUntil(r.expiryDate),
    owner: r.owner,
    tags: r.tags,
    childCount: r._count.children,
    latestVersion: r.fileVersions[0] ? serializeVersion(r.fileVersions[0]) : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Scope predicate on contract_agreements: the linked company must be in scope. */
export function msaScopeWhere(orgId: string, scope: AccessScope): Prisma.ContractAgreementWhereInput {
  if (scope.unrestricted) return { orgId, deletedAt: null };
  return {
    orgId,
    deletedAt: null,
    company: { is: applyCompanyScope({ orgId, deletedAt: null }, scope) },
  };
}

async function audit(
  req: FastifyRequest,
  action: string,
  targetId: string | null,
  diff: Record<string, unknown> = {},
  targetType = 'msa',
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      orgId: req.auth.orgId,
      userId: req.auth.userId,
      action,
      targetType,
      targetId,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}

function safeContentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const sanitized = filename.replace(/[\x00-\x1f\x7f]/g, '');
  return `attachment; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
}

/** Storage keys for MSA files embed the contract id so finalize can bind them. */
function msaKeySegment(contractId: string): string {
  return `msa-${contractId}`;
}

function liabilityFields(cap: { amountMicros: number; currency: string } | null | undefined) {
  if (cap === undefined) return {};
  if (cap === null) return { liabilityCapMicros: null, liabilityCapCurrency: null };
  return { liabilityCapMicros: BigInt(cap.amountMicros), liabilityCapCurrency: cap.currency };
}

export const msaRoutes: FastifyPluginAsyncZod = async (server) => {
  async function scopeOf(req: FastifyRequest): Promise<AccessScope> {
    return getAccessScope(req.auth.orgId, req.auth.userId);
  }

  async function loadVisible(req: FastifyRequest, id: string, scope?: AccessScope) {
    const s = scope ?? (await scopeOf(req));
    const row = await prisma.contractAgreement.findFirst({
      where: { AND: [msaScopeWhere(req.auth.orgId, s), { id }] },
      select: ROW_SELECT,
    });
    if (!row) throw server.httpErrors.notFound('MSA not found');
    return { row, scope: s };
  }

  async function loadVisibleCompany(req: FastifyRequest, companyId: string, scope: AccessScope) {
    const company = await prisma.company.findFirst({
      where: applyCompanyScope({ id: companyId, orgId: req.auth.orgId, deletedAt: null }, scope),
      select: { id: true, name: true },
    });
    if (!company) throw server.httpErrors.notFound('Company not found');
    return company;
  }

  async function assertOrgUser(req: FastifyRequest, userId: string | null | undefined) {
    if (!userId) return;
    const u = await prisma.user.findFirst({
      where: { id: userId, orgId: req.auth.orgId },
      select: { id: true },
    });
    if (!u) throw server.httpErrors.badRequest('ownerId is not a user of this organization');
  }

  async function assertCanEdit(req: FastifyRequest, row: { ownerId: string | null; createdById: string }) {
    if (!row.ownerId || row.ownerId === req.auth.userId || row.createdById === req.auth.userId) return;
    if (await server.hasPermission(req, 'msa:admin')) return;
    throw server.httpErrors.forbidden('Only the owner or an MSA admin can change this agreement');
  }

  // ── List and filter ───────────────────────────────────────────────────────
  server.get(
    '/msa',
    {
      config: { permission: 'msa:read' },
      schema: { querystring: MsaListQuery, response: { 200: MsaListResponse } },
    },
    async (req) => {
      const q = req.query;
      const scope = await scopeOf(req);
      const and: Prisma.ContractAgreementWhereInput[] = [msaScopeWhere(req.auth.orgId, scope)];
      if (q.companyId) and.push({ companyId: q.companyId });
      if (q.status) and.push({ status: { in: q.status as ContractStatus[] } });
      if (q.kind) and.push({ kind: { in: q.kind as ContractKind[] } });
      if (q.ownerId) and.push({ ownerId: q.ownerId });
      if (q.tag) and.push({ tags: { has: q.tag } });
      if (q.parentId) and.push({ parentId: q.parentId });
      else if (q.topLevel === 'true') and.push({ parentId: null });
      if (q.expiringWithinDays) {
        const today = new Date(startOfUtcDay(new Date()));
        and.push({
          expiryDate: { gte: today, lte: new Date(today.getTime() + q.expiringWithinDays * DAY_MS) },
        });
      }
      if (q.q) {
        and.push({
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { reference: { contains: q.q, mode: 'insensitive' } },
            { counterparty: { contains: q.q, mode: 'insensitive' } },
          ],
        });
      }
      const where: Prisma.ContractAgreementWhereInput = { AND: and };
      const orderBy: Prisma.ContractAgreementOrderByWithRelationInput[] =
        q.sort === 'title'
          ? [{ title: 'asc' }, { id: 'asc' }]
          : q.sort === 'updated'
            ? [{ updatedAt: 'desc' }, { id: 'asc' }]
            : [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
      const [rows, total] = await Promise.all([
        prisma.contractAgreement.findMany({
          where,
          select: ROW_SELECT,
          orderBy,
          skip: q.cursor,
          take: q.limit,
        }),
        prisma.contractAgreement.count({ where }),
      ]);
      await audit(req, 'msa.list', null, {
        filters: { ...q, limit: undefined, cursor: undefined },
        returned: rows.length,
      });
      const next = q.cursor + rows.length;
      return { items: rows.map(serializeRow), nextCursor: next < total ? next : null, total };
    },
  );

  // ── Per-account summary (account page) ───────────────────────────────────
  server.get(
    '/msa/accounts/:companyId/summary',
    {
      config: { permission: 'msa:read' },
      schema: {
        params: z.object({ companyId: z.string().uuid() }),
        response: { 200: MsaAccountSummary },
      },
    },
    async (req) => {
      const scope = await scopeOf(req);
      await loadVisibleCompany(req, req.params.companyId, scope);
      const rows = await prisma.contractAgreement.findMany({
        where: { AND: [msaScopeWhere(req.auth.orgId, scope), { companyId: req.params.companyId }] },
        select: ROW_SELECT,
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 500,
      });
      const byStatus: Record<string, number> = {};
      const childCounts = { sow: 0, amendment: 0, addendum: 0 };
      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (r.kind in childCounts) childCounts[r.kind as keyof typeof childCounts] += 1;
      }
      const topLevel = rows.filter((r) => r.parentId === null);
      const primary =
        topLevel.find((r) => r.kind === 'msa' && r.status === 'active') ??
        topLevel.find((r) => r.kind === 'msa') ??
        topLevel[0] ??
        null;
      const now = new Date();
      const today = startOfUtcDay(now);
      const live = rows.filter((r) => r.status !== 'terminated' && r.status !== 'expired');
      const upcoming = (pick: (r: Row) => Date | null) =>
        live
          .map((r) => ({ r, d: pick(r) }))
          .filter((x): x is { r: Row; d: Date } => !!x.d && x.d.getTime() >= today)
          .sort((a, b) => a.d.getTime() - b.d.getTime())[0];
      const exp = upcoming((r) => r.expiryDate);
      const notice = upcoming((r) => noticeDeadline(r.expiryDate, r.noticePeriodDays));
      const toRef = (x: { r: Row; d: Date } | undefined) =>
        x
          ? { id: x.r.id, title: x.r.title ?? x.r.reference, date: x.d.toISOString(), days: daysUntil(x.d, now) ?? 0 }
          : null;
      await audit(req, 'msa.summary.view', req.params.companyId, {}, 'company');
      return {
        companyId: req.params.companyId,
        total: rows.length,
        byStatus,
        childCounts,
        primary: primary ? serializeRow(primary) : null,
        nextExpiry: toRef(exp),
        nextNoticeDeadline: toRef(notice),
        expiringWithin90Days: live.filter((r) => {
          const d = daysUntil(r.expiryDate, now);
          return d !== null && d >= 0 && d <= 90;
        }).length,
      };
    },
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  server.get(
    '/msa/:id',
    {
      config: { permission: 'msa:read' },
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: MsaDetail } },
    },
    async (req) => {
      const { row, scope } = await loadVisible(req, req.params.id);
      const [extra, children, versions, parent] = await Promise.all([
        prisma.contractAgreement.findFirstOrThrow({
          where: { id: row.id, orgId: req.auth.orgId },
          select: {
            governingLaw: true,
            liabilityCapMicros: true,
            liabilityCapCurrency: true,
            paymentTerms: true,
            notes: true,
            currency: true,
            countries: true,
            createdAt: true,
          },
        }),
        prisma.contractAgreement.findMany({
          where: { AND: [msaScopeWhere(req.auth.orgId, scope), { parentId: row.id }] },
          select: ROW_SELECT,
          orderBy: [{ effectiveDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          take: 200,
        }),
        prisma.contractFileVersion.findMany({
          where: { orgId: req.auth.orgId, contractId: row.id, deletedAt: null },
          select: VERSION_SELECT,
          orderBy: { versionNo: 'desc' },
          take: 200,
        }),
        row.parentId
          ? prisma.contractAgreement.findFirst({
              // Redaction: the parent is shown only when it is itself visible.
              where: { AND: [msaScopeWhere(req.auth.orgId, scope), { id: row.parentId }] },
              select: { id: true, title: true, reference: true, kind: true },
            })
          : Promise.resolve(null),
      ]);
      await audit(req, 'msa.view', row.id);
      return {
        ...serializeRow(row),
        governingLaw: extra.governingLaw,
        liabilityCap:
          extra.liabilityCapMicros !== null && extra.liabilityCapCurrency
            ? { amountMicros: Number(extra.liabilityCapMicros), currency: extra.liabilityCapCurrency }
            : null,
        paymentTerms: extra.paymentTerms,
        notes: extra.notes,
        currency: extra.currency,
        countries: extra.countries,
        parent: parent
          ? { id: parent.id, title: parent.title ?? parent.reference, kind: parent.kind as MsaSummaryRow['kind'] }
          : null,
        // A parent outside the caller's scope is redacted to null, and its id
        // is withheld too.
        parentId: parent ? row.parentId : null,
        children: children.map(serializeRow),
        versions: versions.map(serializeVersion),
        createdAt: extra.createdAt.toISOString(),
      };
    },
  );

  // ── Create ───────────────────────────────────────────────────────────────
  server.post(
    '/msa',
    {
      config: { permission: 'msa:write' },
      schema: { body: MsaCreate, response: { 201: z.object({ id: z.string().uuid() }) } },
    },
    async (req, reply) => {
      const b = req.body;
      const scope = await scopeOf(req);
      const company = await loadVisibleCompany(req, b.companyId, scope);
      const isChildKind = (MSA_CHILD_KINDS as readonly string[]).includes(b.kind);
      if (b.parentId) {
        if (!isChildKind) throw server.httpErrors.badRequest('Only sow, amendment or addendum can have a parent');
        const { row: parent } = await loadVisible(req, b.parentId, scope);
        if (parent.companyId !== b.companyId) {
          throw server.httpErrors.badRequest('A child agreement must belong to the same account as its parent');
        }
        if ((MSA_CHILD_KINDS as readonly string[]).includes(parent.kind) && b.kind !== 'amendment') {
          throw server.httpErrors.badRequest('Only an amendment can sit under a SOW, amendment or addendum');
        }
      } else if (isChildKind) {
        throw server.httpErrors.badRequest(`${b.kind} requires parentId`);
      }
      await assertOrgUser(req, b.ownerId);
      const id = randomUUID();
      await prisma.contractAgreement.create({
        data: {
          id,
          orgId: req.auth.orgId,
          accountKey: normalizeName(company.name),
          companyId: company.id,
          parentId: b.parentId ?? null,
          kind: b.kind as ContractKind,
          title: b.title,
          reference: b.reference ?? b.title,
          counterparty: b.counterparty ?? null,
          status: b.status as ContractStatus,
          effectiveDate: toDate(b.effectiveDate) ?? null,
          expiryDate: toDate(b.expiryDate) ?? null,
          autoRenew: b.autoRenew,
          noticePeriodDays: b.noticePeriodDays ?? null,
          governingLaw: b.governingLaw ?? null,
          ...liabilityFields(b.liabilityCap),
          paymentTerms: b.paymentTerms ?? null,
          ownerId: b.ownerId === undefined ? req.auth.userId : b.ownerId,
          tags: [...new Set(b.tags)],
          notes: b.notes ?? null,
          createdById: req.auth.userId,
        },
      });
      await audit(req, 'msa.create', id, {
        companyId: company.id,
        kind: b.kind,
        title: b.title,
        parentId: b.parentId ?? null,
        status: b.status,
      });
      return reply.code(201).send({ id });
    },
  );

  // ── Update ───────────────────────────────────────────────────────────────
  server.patch(
    '/msa/:id',
    {
      config: { permission: 'msa:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: MsaPatch,
        response: { 200: z.object({ id: z.string().uuid(), changed: z.array(z.string()) }) },
      },
    },
    async (req) => {
      const { row } = await loadVisible(req, req.params.id);
      await assertCanEdit(req, row);
      const b = req.body;
      if (b.ownerId !== undefined) await assertOrgUser(req, b.ownerId);
      const before = await prisma.contractAgreement.findFirstOrThrow({
        where: { id: row.id, orgId: req.auth.orgId },
      });
      const data: Prisma.ContractAgreementUncheckedUpdateInput = {
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.reference !== undefined ? { reference: b.reference } : {}),
        ...(b.counterparty !== undefined ? { counterparty: b.counterparty } : {}),
        ...(b.status !== undefined ? { status: b.status as ContractStatus } : {}),
        ...(b.effectiveDate !== undefined ? { effectiveDate: toDate(b.effectiveDate) } : {}),
        ...(b.expiryDate !== undefined ? { expiryDate: toDate(b.expiryDate) } : {}),
        ...(b.autoRenew !== undefined ? { autoRenew: b.autoRenew } : {}),
        ...(b.noticePeriodDays !== undefined ? { noticePeriodDays: b.noticePeriodDays } : {}),
        ...(b.governingLaw !== undefined ? { governingLaw: b.governingLaw } : {}),
        ...liabilityFields(b.liabilityCap),
        ...(b.paymentTerms !== undefined ? { paymentTerms: b.paymentTerms } : {}),
        ...(b.ownerId !== undefined ? { ownerId: b.ownerId } : {}),
        ...(b.tags !== undefined ? { tags: [...new Set(b.tags)] } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
      };
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      const plain = (v: unknown) =>
        v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? v.toString() : v;
      for (const [k, to] of Object.entries(data)) {
        const from = (before as Record<string, unknown>)[k];
        if (JSON.stringify(plain(from)) !== JSON.stringify(plain(to))) {
          changed[k] = { from: plain(from), to: plain(to) };
        }
      }
      if (Object.keys(changed).length > 0) {
        await prisma.contractAgreement.updateMany({
          where: { id: row.id, orgId: req.auth.orgId, deletedAt: null },
          data,
        });
        // Notes can hold sensitive text: record that they changed, not the text.
        if (changed.notes) changed.notes = { from: '[redacted]', to: '[redacted]' };
        await audit(req, 'msa.update', row.id, { changed });
      }
      return { id: row.id, changed: Object.keys(changed) };
    },
  );

  // ── Archive (soft delete) ─────────────────────────────────────────────────
  server.delete(
    '/msa/:id',
    {
      config: { permission: 'msa:admin' },
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const { row } = await loadVisible(req, req.params.id);
      if (row._count.children > 0) {
        throw server.httpErrors.conflict('Archive the SOWs, amendments and addenda under this MSA first');
      }
      await prisma.contractAgreement.updateMany({
        where: { id: row.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date() },
      });
      await audit(req, 'msa.archive', row.id, { title: row.title ?? row.reference });
      return reply.code(204).send(null);
    },
  );

  // ── Timeline ─────────────────────────────────────────────────────────────
  server.get(
    '/msa/:id/timeline',
    {
      config: { permission: 'msa:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          includeViews: z.enum(['true', 'false']).default('false'),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        }),
        response: { 200: MsaTimelineResponse },
      },
    },
    async (req) => {
      const { row } = await loadVisible(req, req.params.id);
      const logs = await prisma.auditLog.findMany({
        where: {
          orgId: req.auth.orgId,
          targetType: 'msa',
          targetId: row.id,
          ...(req.query.includeViews === 'true' ? {} : { action: { notIn: ['msa.view'] } }),
        },
        orderBy: { at: 'desc' },
        take: req.query.limit,
        select: { id: true, at: true, action: true, diff: true, user: { select: USER_SELECT } },
      });
      const items: MsaTimelineEvent[] = logs.map((l) => ({
        id: `audit:${l.id.toString()}`,
        at: l.at.toISOString(),
        kind: 'audit',
        action: l.action,
        actor: l.user,
        detail: (l.diff && typeof l.diff === 'object' && !Array.isArray(l.diff) ? l.diff : {}) as Record<
          string,
          unknown
        >,
      }));
      const milestone = (action: string, d: Date | null, detail: Record<string, unknown> = {}) => {
        if (d) items.push({ id: `milestone:${action}`, at: d.toISOString(), kind: 'milestone', action, actor: null, detail });
      };
      milestone('msa.effective', row.effectiveDate);
      milestone('msa.notice_deadline', noticeDeadline(row.expiryDate, row.noticePeriodDays), {
        noticePeriodDays: row.noticePeriodDays,
        autoRenew: row.autoRenew,
      });
      milestone(row.autoRenew ? 'msa.renewal' : 'msa.expiry', row.expiryDate, { autoRenew: row.autoRenew });
      items.sort((a, b) => b.at.localeCompare(a.at));
      return { items };
    },
  );

  // ── Upload URL for a new file version ─────────────────────────────────────
  server.post(
    '/msa/:id/versions/upload-url',
    {
      config: { permission: 'msa:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: MsaUploadUrlRequest,
        response: { 200: MsaUploadUrlResponse },
      },
    },
    async (req) => {
      const { row } = await loadVisible(req, req.params.id);
      await assertCanEdit(req, row);
      const storage = await getStorage();
      const key = storage.newKey(req.auth.orgId, msaKeySegment(row.id), req.body.fileName);
      // Signed-size presign: Content-Length is part of the S3 signature.
      const presigned = await storage.getUploadUrl({
        key,
        contentType: req.body.contentType,
        bytes: req.body.bytes,
      });
      return { uploadUrl: presigned.url, storageKey: key, headers: presigned.headers, maxBytes: MSA_MAX_BYTES };
    },
  );

  // ── Finalize a new file version ───────────────────────────────────────────
  server.post(
    '/msa/:id/versions',
    {
      config: { permission: 'msa:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: MsaVersionFinalize,
        response: { 201: z.object({ id: z.string().uuid(), versionNo: z.number().int(), sha256: z.string() }) },
      },
    },
    async (req, reply) => {
      const { row } = await loadVisible(req, req.params.id);
      await assertCanEdit(req, row);
      const b = req.body;
      if (!keyBelongsToOrg(b.storageKey, req.auth.orgId)) {
        throw server.httpErrors.forbidden('Storage key does not belong to your organization');
      }
      if (!b.storageKey.includes(`/${msaKeySegment(row.id)}/`)) {
        throw server.httpErrors.forbidden('Storage key was not issued for this MSA');
      }
      const storage = await getStorage();
      const reject = async (message: string) => {
        // Never keep a rejected object around in the bucket.
        await storage.delete(b.storageKey).catch(() => undefined);
        await audit(req, 'msa.version.rejected', row.id, { reason: message, fileName: b.fileName });
        throw server.httpErrors.badRequest(message);
      };
      let meta;
      try {
        meta = await storage.head(b.storageKey);
      } catch {
        throw server.httpErrors.notFound('Uploaded object not found');
      }
      if (meta.bytes !== b.bytes) return reject('Uploaded object size does not match');
      if (meta.bytes > MSA_MAX_BYTES) return reject('File is larger than the MSA size limit');
      if (meta.contentType && meta.contentType !== b.contentType) {
        return reject('Uploaded object content type does not match');
      }
      const buf = await storage.readBuffer(b.storageKey);
      if (buf.length !== meta.bytes) return reject('Uploaded object size does not match');
      const detected = detectMsaContentType(buf);
      if (!detected || !(MSA_ALLOWED_CONTENT_TYPES as readonly string[]).includes(detected)) {
        return reject('Only PDF and DOCX files are accepted');
      }
      if (detected !== b.contentType) return reject('File content does not match its declared type');
      const sha256 = sha256Hex(buf);
      const dup = await prisma.contractFileVersion.findFirst({
        where: { orgId: req.auth.orgId, contractId: row.id, sha256, deletedAt: null },
        select: { versionNo: true },
      });
      if (dup) {
        await storage.delete(b.storageKey).catch(() => undefined);
        throw server.httpErrors.conflict(`This file is identical to version ${dup.versionNo}`);
      }

      const fileId = randomUUID();
      const versionId = randomUUID();
      let versionNo = 0;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const max = await prisma.contractFileVersion.aggregate({
          where: { contractId: row.id, deletedAt: {} },
          _max: { versionNo: true },
        });
        versionNo = (max._max.versionNo ?? 0) + 1;
        try {
          await prisma.$transaction([
            prisma.fileAttachment.create({
              data: {
                id: fileId,
                orgId: req.auth.orgId,
                // Namespaced so the generic /files account list never matches it.
                accountId: msaKeySegment(row.id),
                companyId: row.companyId,
                name: b.fileName,
                contentType: detected,
                bytes: meta.bytes,
                storageKey: b.storageKey,
                uploadedByUserId: req.auth.userId,
              },
            }),
            prisma.contractFileVersion.create({
              data: {
                id: versionId,
                orgId: req.auth.orgId,
                contractId: row.id,
                versionNo,
                fileAttachmentId: fileId,
                fileName: b.fileName,
                contentType: detected,
                bytes: meta.bytes,
                sha256,
                note: b.note ?? null,
                createdById: req.auth.userId,
              },
            }),
            prisma.contractAgreement.updateMany({
              where: { id: row.id, orgId: req.auth.orgId },
              data: { updatedAt: new Date() },
            }),
          ]);
          break;
        } catch (err) {
          const retry =
            err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2;
          if (!retry) throw err;
        }
      }
      await audit(req, 'msa.version.upload', row.id, {
        versionId,
        versionNo,
        fileName: b.fileName,
        bytes: meta.bytes,
        sha256,
        contentType: detected,
      });
      await enqueueMsaTextExtract({ orgId: req.auth.orgId, contractId: row.id, versionId });
      return reply.code(201).send({ id: versionId, versionNo, sha256 });
    },
  );

  // ── Re-run text extraction (e.g. after a failure or a Redis outage) ──────
  server.post(
    '/msa/:id/versions/:versionId/reextract',
    {
      config: { permission: 'msa:write' },
      schema: {
        params: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
        response: { 202: z.object({ queued: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const { row } = await loadVisible(req, req.params.id);
      await assertCanEdit(req, row);
      const v = await prisma.contractFileVersion.findFirst({
        where: { id: req.params.versionId, contractId: row.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!v) throw server.httpErrors.notFound('Version not found');
      await prisma.contractFileVersion.updateMany({
        where: { id: v.id, orgId: req.auth.orgId },
        data: { extractionStatus: 'pending', extractionError: null },
      });
      const jobId = await enqueueMsaTextExtract({ orgId: req.auth.orgId, contractId: row.id, versionId: v.id });
      await audit(req, 'msa.version.reextract', row.id, { versionId: v.id });
      return reply.code(202).send({ queued: jobId !== null });
    },
  );

  // ── Full-text search over extracted text ──────────────────────────────────
  server.get(
    '/msa/search',
    {
      config: { permission: 'msa:read' },
      schema: { querystring: MsaSearchQuery, response: { 200: MsaSearchResponse } },
    },
    async (req) => {
      const { q, companyId, limit } = req.query;
      const orgId = req.auth.orgId;
      const scope = await scopeOf(req);
      // Rank inside the org with the GIN expression index, over-fetch, then
      // apply the (possibly restricted) company scope through Prisma so the
      // scope logic lives in one place.
      const candidates = await prisma.$queryRaw<Array<{ version_id: string; contract_id: string; rank: number }>>`
        SELECT v.id AS version_id, v.contract_id, ts_rank(to_tsvector('simple', coalesce(v.extracted_text, '')), query)::float8 AS rank
        FROM contract_file_versions v
        JOIN contract_agreements c ON c.id = v.contract_id AND c.org_id = v.org_id AND c.deleted_at IS NULL
        CROSS JOIN plainto_tsquery('simple', ${q}) AS query
        WHERE v.org_id = ${orgId}::uuid
          AND v.deleted_at IS NULL
          AND to_tsvector('simple', coalesce(v.extracted_text, '')) @@ query
          ${companyId ? Prisma.sql`AND c.company_id = ${companyId}::uuid` : Prisma.empty}
        ORDER BY rank DESC, v.created_at DESC
        LIMIT ${Math.min(limit * 5, 250)}`;
      const contractIds = [...new Set(candidates.map((c) => c.contract_id))];
      const visible = contractIds.length
        ? await prisma.contractAgreement.findMany({
            where: { AND: [msaScopeWhere(orgId, scope), { id: { in: contractIds } }] },
            select: { id: true, title: true, reference: true, companyId: true, kind: true, status: true },
            take: contractIds.length,
          })
        : [];
      const byId = new Map(visible.map((c) => [c.id, c]));
      const hits = candidates.filter((c) => byId.has(c.contract_id)).slice(0, limit);
      const snippets = hits.length
        ? await prisma.$queryRaw<Array<{ id: string; version_no: number; snippet: string }>>`
            SELECT v.id, v.version_no,
              ts_headline('simple', coalesce(v.extracted_text, ''), plainto_tsquery('simple', ${q}),
                'StartSel=[[, StopSel=]], MaxWords=30, MinWords=10, MaxFragments=2, FragmentDelimiter= ... ') AS snippet
            FROM contract_file_versions v
            WHERE v.org_id = ${orgId}::uuid AND v.id IN (${Prisma.join(hits.map((h) => Prisma.sql`${h.version_id}::uuid`))})`
        : [];
      const snip = new Map(snippets.map((s) => [s.id, s]));
      const items = hits.map((h) => {
        const c = byId.get(h.contract_id)!;
        const s = snip.get(h.version_id);
        return {
          contractId: c.id,
          versionId: h.version_id,
          versionNo: s?.version_no ?? 0,
          title: c.title ?? c.reference,
          companyId: c.companyId,
          kind: c.kind as MsaSearchHit['kind'],
          status: c.status as MsaSearchHit['status'],
          rank: Number(h.rank),
          snippet: s?.snippet ?? '',
        };
      });
      await audit(req, 'msa.search', null, { q: q.slice(0, 200), companyId: companyId ?? null, hits: items.length });
      return { items };
    },
  );

  // ── Archive a file version ────────────────────────────────────────────────
  server.delete(
    '/msa/:id/versions/:versionId',
    {
      config: { permission: 'msa:admin' },
      schema: {
        params: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { row } = await loadVisible(req, req.params.id);
      const v = await prisma.contractFileVersion.findFirst({
        where: { id: req.params.versionId, contractId: row.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, versionNo: true, fileName: true },
      });
      if (!v) throw server.httpErrors.notFound('Version not found');
      await prisma.contractFileVersion.updateMany({
        where: { id: v.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date() },
      });
      await audit(req, 'msa.version.archive', row.id, { versionId: v.id, versionNo: v.versionNo, fileName: v.fileName });
      return reply.code(204).send(null);
    },
  );

  // ── Short-lived download URL ──────────────────────────────────────────────
  server.get(
    '/msa/:id/versions/:versionId/download-url',
    {
      config: { permission: 'msa:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
        response: { 200: MsaDownloadUrlResponse },
      },
    },
    async (req) => {
      const { row } = await loadVisible(req, req.params.id);
      const v = await prisma.contractFileVersion.findFirst({
        where: { id: req.params.versionId, contractId: row.id, orgId: req.auth.orgId, deletedAt: null },
        select: {
          id: true,
          versionNo: true,
          fileName: true,
          contentType: true,
          sha256: true,
          fileAttachment: { select: { storageKey: true } },
        },
      });
      if (!v) throw server.httpErrors.notFound('Version not found');
      const storage = await getStorage();
      let url: string;
      let expiresAt: Date;
      if (storage.driver === 's3') {
        const dl = await storage.getDownload(v.fileAttachment.storageKey, {
          filename: v.fileName,
          contentType: v.contentType,
          expiresInSeconds: MSA_DOWNLOAD_TTL_SECONDS,
        });
        if (!dl.url) throw server.httpErrors.internalServerError('Storage returned no download URL');
        url = dl.url;
        expiresAt = new Date(Date.now() + MSA_DOWNLOAD_TTL_SECONDS * 1000);
      } else {
        const sealed = issueMsaDownloadToken({ orgId: req.auth.orgId, userId: req.auth.userId, versionId: v.id });
        const base = (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
        url = `${base}/api/v1/msa/download?t=${encodeURIComponent(sealed.token)}`;
        expiresAt = sealed.expiresAt;
      }
      await audit(req, 'msa.download', row.id, {
        versionId: v.id,
        versionNo: v.versionNo,
        fileName: v.fileName,
        sha256: v.sha256,
        expiresAt: expiresAt.toISOString(),
      });
      return { url, expiresAt: expiresAt.toISOString(), fileName: v.fileName, sha256: v.sha256 };
    },
  );

  // ── Local-driver token download (public: the sealed token is the auth) ────
  server.get(
    '/msa/download',
    {
      config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { querystring: z.object({ t: z.string().min(16).max(4096) }) },
    },
    async (req, reply) => {
      const opened = openMsaDownloadToken(req.query.t);
      if (!opened) throw server.httpErrors.notFound('Download link expired or invalid');
      const storage = await getStorage();
      if (storage.driver !== 'local') throw server.httpErrors.notFound('Download link expired or invalid');
      // Re-check at use time: the user must still exist in the org, still hold
      // msa:read, and the version must still be live and in scope.
      const user = await prisma.user.findFirst({
        where: { id: opened.userId, orgId: opened.orgId },
        select: { id: true },
      });
      if (!user || !(await userHasPermission(opened.orgId, opened.userId, 'msa:read'))) {
        throw server.httpErrors.notFound('Download link expired or invalid');
      }
      const scope = await getAccessScope(opened.orgId, opened.userId);
      const v = await prisma.contractFileVersion.findFirst({
        where: {
          id: opened.versionId,
          orgId: opened.orgId,
          deletedAt: null,
          contract: msaScopeWhere(opened.orgId, scope),
        },
        select: { fileName: true, contentType: true, fileAttachment: { select: { storageKey: true } } },
      });
      if (!v) throw server.httpErrors.notFound('Download link expired or invalid');
      const dl = await storage.getDownload(v.fileAttachment.storageKey, {
        filename: v.fileName,
        contentType: v.contentType,
      });
      if (dl.kind !== 'stream' || !dl.stream) throw server.httpErrors.notFound('Download link expired or invalid');
      // hijack() bypasses Fastify's header pipeline, so carry over the CORS
      // headers @fastify/cors already decided for this Origin. Without them
      // the web app's fetch() for the PDF preview is blocked cross-origin.
      const corsHeaders: Record<string, string> = {};
      for (const [k, val] of Object.entries(reply.getHeaders())) {
        if ((k.startsWith('access-control-') || k === 'vary') && val !== undefined) corsHeaders[k] = String(val);
      }
      if (corsHeaders['access-control-allow-origin']) {
        corsHeaders['access-control-expose-headers'] = 'Content-Disposition, Content-Length, Content-Type';
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        ...corsHeaders,
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Type': v.contentType,
        'Content-Disposition': safeContentDisposition(v.fileName),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'no-store',
        ...(dl.bytes != null ? { 'Content-Length': String(dl.bytes) } : {}),
      });
      await pipeline(dl.stream, reply.raw);
      return reply;
    },
  );
};
