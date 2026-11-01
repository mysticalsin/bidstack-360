import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  buildValuePanel,
  MsaLeverageFlag,
  MsaLeverageListResponse,
  MsaLeverageSummary,
  MsaValuePanel,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { listLeverageFlags, leverageSummary } from '../services/msa-leverage.js';
import { msaScopeWhere, noticeDeadline } from './msa.js';

export const msaLeverageRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/msa/leverage',
    {
      config: { permission: 'msa:read' },
      schema: {
        querystring: z.object({ companyId: z.string().uuid().optional() }),
        response: { 200: MsaLeverageListResponse },
      },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const items = await listLeverageFlags(req.auth.orgId, scope, req.query.companyId);
      const hemaPharmaCount = new Set(
        items
          .filter((i) => i.signingEntity.slug === 'hema' || i.signingEntity.businessLines.some((l) => ['pharma', 'health_economics', 'market_access'].includes(l)))
          .map((i) => i.companyId),
      ).size;
      return { items, hemaPharmaCount };
    },
  );

  server.get(
    '/msa/leverage/summary',
    { config: { permission: 'msa:read' }, schema: { response: { 200: MsaLeverageSummary } } },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      return leverageSummary(req.auth.orgId, scope);
    },
  );

  server.get(
    '/msa/:id/leverage',
    {
      config: { permission: 'msa:read' },
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: z.object({ flag: MsaLeverageFlag.nullable() }) } },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const row = await prisma.contractAgreement.findFirst({
        where: { AND: [msaScopeWhere(req.auth.orgId, scope), { id: req.params.id }] },
        select: { companyId: true },
      });
      if (!row) throw server.httpErrors.notFound('MSA not found');
      if (!row.companyId) return { flag: null };
      const items = await listLeverageFlags(req.auth.orgId, scope, row.companyId);
      return { flag: items.find((i) => i.msaId === req.params.id) ?? items[0] ?? null };
    },
  );

  server.get(
    '/msa/:id/value-panel',
    {
      config: { permission: 'msa:read' },
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: MsaValuePanel } },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const row = await prisma.contractAgreement.findFirst({
        where: { AND: [msaScopeWhere(req.auth.orgId, scope), { id: req.params.id }] },
        select: {
          id: true,
          companyId: true,
          expiryDate: true,
          noticePeriodDays: true,
          autoRenew: true,
          liabilityCapMicros: true,
          liabilityCapCurrency: true,
          paymentTerms: true,
          indexation: true,
          exclusivity: true,
          nonSolicit: true,
          scopeOfServices: true,
          fieldCitations: true,
        },
      });
      if (!row) throw server.httpErrors.notFound('MSA not found');
      const entities = await prisma.signingEntity.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { name: true, businessLines: true },
        take: 200,
      });
      const offered = entities.flatMap((e) => e.businessLines.map((line) => ({ line, brandName: e.name })));
      let approach = null;
      if (row.companyId) {
        const visible = await prisma.company.findFirst({
          where: applyCompanyScope({ id: row.companyId, orgId: req.auth.orgId, deletedAt: null }, scope),
          select: { id: true, name: true },
        });
        if (visible) {
          const contact = await prisma.contact.findFirst({
            where: {
              orgId: req.auth.orgId,
              deletedAt: null,
              OR: [{ companyId: visible.id }, { customer: visible.name }],
            },
            orderBy: { influence: 'desc' },
            select: { name: true, role: true, email: true },
          });
          if (contact) approach = { name: contact.name, title: contact.role, email: contact.email };
        }
      }
      const citations = (row.fieldCitations ?? {}) as Record<string, { page: number | null; clause: string | null; excerpt: string }>;
      return buildValuePanel(
        {
          msaId: row.id,
          expiryDate: row.expiryDate ? row.expiryDate.toISOString() : null,
          noticeDeadline: noticeDeadline(row.expiryDate, row.noticePeriodDays)?.toISOString() ?? null,
          autoRenew: row.autoRenew,
          liabilityCapMicros: row.liabilityCapMicros != null ? Number(row.liabilityCapMicros) : null,
          liabilityCapCurrency: row.liabilityCapCurrency,
          paymentTerms: row.paymentTerms,
          indexation: row.indexation,
          exclusivity: row.exclusivity,
          nonSolicit: row.nonSolicit,
          scopeOfServices: row.scopeOfServices,
          citations,
        },
        offered,
        approach,
      );
    },
  );
};
