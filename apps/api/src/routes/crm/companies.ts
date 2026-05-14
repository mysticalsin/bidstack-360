import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { AccountCockpitSnapshot, CompanyAutopopulateResponse, CrmCompany } from '@bidstack/shared';

import {
  buildDashboardSnapshot,
  buildCockpitFromCompany,
  normalizeName,
  normalizeDomain,
  normalizeRegistryValue,
  domainFor,
} from '../../services/crm/dashboard.service.js';
import { upsertVerifiedCompanyEnrichment } from '../../services/crm/enrichment.service.js';
import { enqueueApolloEnrich } from '../../queues/company-enrich-apollo.js';
import { autopopulateCompanies } from '../../services/crm/company.service.js';

const CompanySearchQuery = z.object({
  q: z.string().trim().optional(),
  country: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const CompanySearchResponse = z.object({
  items: z.array(CrmCompany),
});

const CompanyLookupQuery = z.object({
  name: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  vat: z.string().trim().optional(),
  duns: z.string().trim().optional(),
  uei: z.string().trim().optional(),
  lei: z.string().trim().optional(),
  registryId: z.string().trim().optional(),
});

const CompanyLookupResponse = z.object({
  match: z.enum(['exact_domain', 'registry_id', 'exact_name', 'fuzzy_name', 'none']),
  company: CrmCompany.nullable(),
  alternatives: z.array(CrmCompany),
});

const EnrichCompanyBody = z.object({
  name: z.string().min(1),
  domain: z.string().trim().optional(),
  website: z.string().url().optional(),
});

const AutopopulateSalesCompaniesBody = z
  .object({
    limit: z.coerce.number().int().min(1).max(12).default(8),
    source: z.enum(['all', 'sales_orders', 'opportunities']).default('all'),
  })
  .default({});

export const crmCompanyRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/crm/companies/search',
    {
      schema: {
        querystring: CompanySearchQuery,
        response: { 200: CompanySearchResponse },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
      const q = req.query.q?.toLowerCase();
      const items = snapshot.companies
        .filter((company) => {
          if (!q) return true;
          return [
            company.name,
            company.legalName ?? '',
            company.domain ?? '',
            company.website ?? '',
            ...Object.values(company.registryIds),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q);
        })
        .slice(0, req.query.limit);
      return { items };
    },
  );

  server.get(
    '/crm/companies/lookup',
    {
      schema: {
        querystring: CompanyLookupQuery,
        response: { 200: CompanyLookupResponse },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
      const domain = normalizeDomain(req.query.domain);
      const registryNeedles = [
        req.query.vat,
        req.query.duns,
        req.query.uei,
        req.query.lei,
        req.query.registryId,
      ]
        .filter((value): value is string => Boolean(value))
        .map(normalizeRegistryValue);
      const name = req.query.name?.trim().toLowerCase();

      if (domain) {
        const company = snapshot.companies.find((item) => normalizeDomain(item.domain) === domain);
        if (company) return { match: 'exact_domain' as const, company, alternatives: [] };
      }

      if (registryNeedles.length) {
        const company = snapshot.companies.find((item) =>
          Object.values(item.registryIds).some((value) =>
            registryNeedles.includes(normalizeRegistryValue(value)),
          ),
        );
        if (company) return { match: 'registry_id' as const, company, alternatives: [] };
      }

      if (name) {
        const exact = snapshot.companies.find(
          (item) =>
            item.name.toLowerCase() === name ||
            (item.legalName !== null && item.legalName.toLowerCase() === name),
        );
        if (exact) return { match: 'exact_name' as const, company: exact, alternatives: [] };

        const alternatives = snapshot.companies
          .filter((item) =>
            [item.name, item.legalName ?? '', item.domain ?? '']
              .join(' ')
              .toLowerCase()
              .includes(name),
          )
          .slice(0, 5);
        return {
          match: alternatives.length ? ('fuzzy_name' as const) : ('none' as const),
          company: alternatives[0] ?? null,
          alternatives: alternatives.slice(1),
        };
      }

      return { match: 'none' as const, company: null, alternatives: [] };
    },
  );

  server.get(
    '/crm/companies/:id',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        response: { 200: AccountCockpitSnapshot },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
      const company =
        snapshot.companies.find((item) => item.id === req.params.id) ??
        snapshot.companies.find((item) => normalizeName(item.name) === req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      return buildCockpitFromCompany(snapshot, company);
    },
  );

  server.post(
    '/crm/companies/:id/enrich',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: EnrichCompanyBody,
        response: { 200: CrmCompany },
      },
    },
    async (req) => {
      const result = await upsertVerifiedCompanyEnrichment({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        name: req.body.name,
        domain: req.body.domain ?? domainFor(req.body.name),
        website: req.body.website,
        requestedBy: 'crm_api',
        auditAction: 'crm.company.enrich',
        log: req.log,
        prisma,
      });

      const apolloJobId = await enqueueApolloEnrich({
        orgId: req.auth.orgId,
        companyName: req.body.name,
        ...(result.domain ? { domain: result.domain } : {}),
      });
      if (apolloJobId) {
        req.log.info({ apolloJobId, company: req.body.name }, 'queued apollo enrichment');
      } else {
        req.log.warn('apollo enrichment enqueue skipped (redis unreachable)');
      }

      return result.company;
    },
  );

  server.post(
    '/crm/companies/autopopulate-from-sales',
    {
      schema: {
        body: AutopopulateSalesCompaniesBody,
        response: { 200: CompanyAutopopulateResponse },
      },
    },
    async (req) => {
      return autopopulateCompanies({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        limit: req.body.limit,
        source: req.body.source,
        prisma,
        log: req.log,
      });
    },
  );
};
