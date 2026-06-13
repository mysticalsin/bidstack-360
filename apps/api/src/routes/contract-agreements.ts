// Contractual management per account — MSAs / framework agreements, countries
// covered, global rebate (bps), rate re-evaluation schedule. Pre-sales-owned,
// org-scoped, audited. Mirrors the cross-sell action log route pattern.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  ContractAgreement,
  ContractAgreementCreate,
  ContractAgreementFilter,
  ContractAgreementPage,
  ContractAgreementPatch,
  RateCardLine,
} from '@bidstack/shared';
import { z as zod } from 'zod';

import { normalizeName } from '../services/crm/dashboard.utils.js';

interface DbRow {
  id: string;
  accountKey: string;
  kind: string;
  reference: string;
  countries: string[];
  globalRebateBps: number | null;
  currency: string;
  rateCard: unknown;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  rateReviewSchedule: string;
  nextRateReviewAt: Date | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = {
  id: true,
  accountKey: true,
  kind: true,
  reference: true,
  countries: true,
  globalRebateBps: true,
  currency: true,
  rateCard: true,
  effectiveDate: true,
  expiryDate: true,
  rateReviewSchedule: true,
  nextRateReviewAt: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

function serialize(row: DbRow): z.infer<typeof ContractAgreement> {
  return {
    id: row.id,
    accountKey: row.accountKey,
    kind: row.kind as z.infer<typeof ContractAgreement>['kind'],
    reference: row.reference,
    countries: row.countries,
    globalRebateBps: row.globalRebateBps,
    currency: row.currency,
    // The Json column is validated back into RateCardLine[]; a malformed legacy
    // value degrades to an empty card rather than failing the read.
    rateCard: zod.array(RateCardLine).safeParse(row.rateCard).data ?? [],
    effectiveDate: row.effectiveDate?.toISOString() ?? null,
    expiryDate: row.expiryDate?.toISOString() ?? null,
    rateReviewSchedule: row.rateReviewSchedule as z.infer<
      typeof ContractAgreement
    >['rateReviewSchedule'],
    nextRateReviewAt: row.nextRateReviewAt?.toISOString() ?? null,
    status: row.status as z.infer<typeof ContractAgreement>['status'],
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const IdParam = z.object({ id: z.string().uuid() });
const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

export const contractAgreementRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/contract-agreements',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: { querystring: ContractAgreementFilter, response: { 200: ContractAgreementPage } },
    },
    async (req) => {
      const rows = await prisma.contractAgreement.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.accountKey ? { accountKey: normalizeName(req.query.accountKey) } : {}),
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        select: SELECT,
        orderBy: [{ status: 'asc' }, { effectiveDate: 'desc' }],
        take: 200,
      });
      return { items: rows.map(serialize) };
    },
  );

  server.post(
    '/contract-agreements',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { body: ContractAgreementCreate, response: { 201: ContractAgreement } },
    },
    async (req, reply) => {
      const created = await prisma.contractAgreement.create({
        data: {
          orgId: req.auth.orgId,
          accountKey: normalizeName(req.body.accountKey),
          kind: req.body.kind,
          reference: req.body.reference,
          countries: req.body.countries,
          globalRebateBps: req.body.globalRebateBps ?? null,
          currency: req.body.currency,
          rateCard: req.body.rateCard,
          effectiveDate: toDate(req.body.effectiveDate) ?? null,
          expiryDate: toDate(req.body.expiryDate) ?? null,
          rateReviewSchedule: req.body.rateReviewSchedule,
          nextRateReviewAt: toDate(req.body.nextRateReviewAt) ?? null,
          status: req.body.status,
          notes: req.body.notes ?? null,
          createdById: req.auth.userId,
        },
        select: SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contract_agreement.create',
          targetType: 'contract_agreement',
          targetId: created.id,
          diff: { accountKey: created.accountKey, kind: created.kind, reference: created.reference },
        },
      });
      return reply.code(201).send(serialize(created));
    },
  );

  server.patch(
    '/contract-agreements/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, body: ContractAgreementPatch, response: { 200: ContractAgreement } },
    },
    async (req) => {
      const existing = await prisma.contractAgreement.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contract agreement not found');
      const b = req.body;
      await prisma.contractAgreement.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(b.kind !== undefined ? { kind: b.kind } : {}),
          ...(b.reference !== undefined ? { reference: b.reference } : {}),
          ...(b.countries !== undefined ? { countries: b.countries } : {}),
          ...(b.globalRebateBps !== undefined ? { globalRebateBps: b.globalRebateBps } : {}),
          ...(b.currency !== undefined ? { currency: b.currency } : {}),
          ...(b.rateCard !== undefined ? { rateCard: b.rateCard } : {}),
          ...(b.effectiveDate !== undefined ? { effectiveDate: toDate(b.effectiveDate) } : {}),
          ...(b.expiryDate !== undefined ? { expiryDate: toDate(b.expiryDate) } : {}),
          ...(b.rateReviewSchedule !== undefined
            ? { rateReviewSchedule: b.rateReviewSchedule }
            : {}),
          ...(b.nextRateReviewAt !== undefined
            ? { nextRateReviewAt: toDate(b.nextRateReviewAt) }
            : {}),
          ...(b.status !== undefined ? { status: b.status } : {}),
          ...(b.notes !== undefined ? { notes: b.notes } : {}),
        },
      });
      const updated = await prisma.contractAgreement.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
        select: SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contract_agreement.update',
          targetType: 'contract_agreement',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      return serialize(updated);
    },
  );

  server.delete(
    '/contract-agreements/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.contractAgreement.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contract agreement not found');
      await prisma.$transaction([
        prisma.contractAgreement.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'contract_agreement.delete',
            targetType: 'contract_agreement',
            targetId: existing.id,
            diff: {},
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );
};
