import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AccountCockpitSnapshot,
  CompanyAutopopulateResponse,
  CrmCompany,
  TechnicalStackCategory,
  TechnicalStackRefreshResponse,
  TechnicalStackState,
  type TechnicalStackCategory as TechnicalStackCategoryType,
  type TechnicalStackRefreshProvider as TechnicalStackRefreshProviderType,
} from '@bidstack/shared';

import {
  buildCompanyCockpit,
  normalizeDomain,
  normalizeRegistryValue,
  domainFor,
  getCompaniesOnly,
} from '../../services/crm/dashboard.service.js';
import { resolveCockpitCompany } from '../../services/crm/dashboard.queries.js';
import { normalizeName } from '../../services/crm/dashboard.utils.js';
import { invalidateDashboardSnapshotCache } from './dashboard.js';
import { getAccessScope } from '../../lib/access-scope.js';
import { canReadAccount } from '../../lib/account-access.js';
import { resolveDataProviderApiKey } from '../../lib/data-provider-credentials.js';
import {
  queueApolloEnrichment,
  upsertVerifiedCompanyEnrichment,
  type RouteLog,
} from '../../services/crm/enrichment.service.js';
import { techStackMcpSourceConfigsFromEnv } from '../../providers/company-tech-stack-mcp.js';
import { autopopulateCompanies } from '../../services/crm/company.service.js';
import {
  TECHNICAL_STACK_FIELD_KEY,
  acceptTechnicalStackSuggestion,
  buildTechnicalStackState,
  parseTechnicalStackOverride,
  technicalStackOverrideValue,
} from '../../services/crm/technical-stack.service.js';

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
  name: z.string().min(1).max(255),
  domain: z.string().trim().max(255).optional(),
  website: z.string().url().max(500).optional(),
});

const AutopopulateSalesCompaniesBody = z
  .object({
    limit: z.coerce.number().int().min(1).max(12).default(8),
    source: z.enum(['all', 'sales_orders', 'opportunities']).default('all'),
  })
  .default({});

export const crmCompanyRoutes: FastifyPluginAsyncZod = async (server) => {
  const TechnicalStackBody = z.object({
    stack: z.array(TechnicalStackCategory).max(16),
  });
  const TechnicalStackRefreshBody = z.object({}).nullish().default({});
  const TechnicalStackParams = z.object({ companyKey: z.string().min(1).max(255) });
  const TechnicalStackSuggestionParams = TechnicalStackParams.extend({
    suggestionId: z.string().min(1).max(180),
  });

  async function loadTechnicalStackContext(orgId: string, userId: string, rawCompanyKey: string) {
    const scope = await getAccessScope(orgId, userId);
    const rawKey = normalizeName(rawCompanyKey);
    const company = await resolveCockpitCompany(orgId, rawKey, prisma);
    if (!company) throw server.httpErrors.notFound('Company not found');
    const access = await canReadAccount({
      orgId,
      userId,
      accountId: rawCompanyKey,
      accountName: company.name,
      scope,
      prismaClient: prisma,
    });
    if (!access.allowed) throw server.httpErrors.notFound('Company not found');
    const companyKey = normalizeName(company.name);
    const override = await prisma.companyFieldOverride.findUnique({
      where: {
        orgId_companyKey_fieldKey: {
          orgId,
          companyKey,
          fieldKey: TECHNICAL_STACK_FIELD_KEY,
        },
      },
      select: { value: true, updatedAt: true },
    });
    const state = buildTechnicalStackState({
      companyKey,
      providerStack: company.technicalStack ?? [],
      overrideValue: override?.value,
      overrideUpdatedAt: override?.updatedAt ?? null,
      providerUpdatedAt: company.updatedAt,
    });
    return {
      company,
      companyKey,
      state,
      overrideValue: override?.value,
      overrideUpdatedAt: override?.updatedAt ?? null,
    };
  }

  async function saveTechnicalStackOverride({
    orgId,
    userId,
    companyKey,
    stack,
    dismissedSuggestionIds,
    action,
  }: {
    orgId: string;
    userId: string;
    companyKey: string;
    stack: TechnicalStackCategoryType[];
    dismissedSuggestionIds: string[];
    action: string;
  }) {
    const value = technicalStackOverrideValue(stack, dismissedSuggestionIds);
    const saved = await prisma.$transaction(async (tx) => {
      const row = await tx.companyFieldOverride.upsert({
        where: {
          orgId_companyKey_fieldKey: {
            orgId,
            companyKey,
            fieldKey: TECHNICAL_STACK_FIELD_KEY,
          },
        },
        create: {
          orgId,
          companyKey,
          fieldKey: TECHNICAL_STACK_FIELD_KEY,
          value,
          overriddenById: userId,
        },
        update: { value, overriddenById: userId },
      });
      await tx.auditLog.create({
        data: {
          orgId,
          userId,
          action,
          targetType: 'company',
          targetId: companyKey,
          diff: value,
        },
      });
      return row;
    });
    invalidateDashboardSnapshotCache(orgId);
    return saved;
  }

  server.get(
    '/crm/companies/search',
    {
      schema: {
        querystring: CompanySearchQuery,
        response: { 200: CompanySearchResponse },
      },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const companies = await getCompaniesOnly(req.auth.orgId, prisma, scope);
      const q = req.query.q?.toLowerCase();
      const items = companies
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
    '/crm/companies/:companyKey/technical-stack',
    {
      schema: {
        params: TechnicalStackParams,
        response: { 200: TechnicalStackState },
      },
    },
    async (req) => {
      const { state } = await loadTechnicalStackContext(
        req.auth.orgId,
        req.auth.userId,
        req.params.companyKey,
      );
      return state;
    },
  );

  server.post(
    '/crm/companies/:companyKey/technical-stack/refresh',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: TechnicalStackParams,
        body: TechnicalStackRefreshBody,
        response: { 200: TechnicalStackRefreshResponse },
      },
    },
    async (req) => {
      const { company, companyKey, state, overrideValue, overrideUpdatedAt } =
        await loadTechnicalStackContext(req.auth.orgId, req.auth.userId, req.params.companyKey);
      const refreshed = await upsertVerifiedCompanyEnrichment({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        name: company.name,
        domain: company.domain,
        website: company.website,
        requestedBy: 'technical_stack_refresh',
        auditAction: 'crm.company.technical_stack_refresh',
        log: req.log,
        prisma,
      });
      const apolloJobId = await queueApolloEnrichment({
        orgId: req.auth.orgId,
        companyName: company.name,
        ...(refreshed.domain ?? company.domain
          ? { domain: refreshed.domain ?? company.domain ?? undefined }
          : {}),
        log: req.log,
      });
      const refreshedState = buildTechnicalStackState({
        companyKey,
        providerStack: refreshed.company.technicalStack ?? state.providerStack,
        overrideValue,
        overrideUpdatedAt,
        providerUpdatedAt: refreshed.company.updatedAt,
      });
      const nowIso = new Date().toISOString();
      return {
        state: refreshedState,
        providers: await buildTechnicalStackRefreshProviders({
          orgId: req.auth.orgId,
          apolloJobId,
          refreshedStack: refreshed.company.technicalStack ?? [],
          refreshedSources: refreshed.company.sourceAttribution,
          log: req.log,
          nowIso,
        }),
      };
    },
  );

  server.put(
    '/crm/companies/:companyKey/technical-stack',
    {
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: TechnicalStackParams,
        body: TechnicalStackBody,
        response: { 200: TechnicalStackState },
      },
    },
    async (req) => {
      const { companyKey, state, overrideValue } = await loadTechnicalStackContext(
        req.auth.orgId,
        req.auth.userId,
        req.params.companyKey,
      );
      const dismissedSuggestionIds =
        parseTechnicalStackOverride(overrideValue)?.dismissedSuggestionIds ?? [];
      const saved = await saveTechnicalStackOverride({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        companyKey,
        stack: req.body.stack,
        dismissedSuggestionIds,
        action: 'company.technical_stack_override',
      });
      return buildTechnicalStackState({
        companyKey,
        providerStack: state.providerStack,
        overrideValue: saved.value,
        overrideUpdatedAt: saved.updatedAt,
      });
    },
  );

  server.post(
    '/crm/companies/:companyKey/technical-stack/suggestions/:suggestionId/accept',
    {
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: TechnicalStackSuggestionParams,
        response: { 200: TechnicalStackState },
      },
    },
    async (req) => {
      const { companyKey, state, overrideValue } = await loadTechnicalStackContext(
        req.auth.orgId,
        req.auth.userId,
        req.params.companyKey,
      );
      const nextStack = acceptTechnicalStackSuggestion(state, req.params.suggestionId);
      if (!nextStack) throw server.httpErrors.notFound('Provider suggestion not found');
      const dismissedSuggestionIds = (
        parseTechnicalStackOverride(overrideValue)?.dismissedSuggestionIds ?? []
      ).filter((id) => id !== req.params.suggestionId);
      const saved = await saveTechnicalStackOverride({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        companyKey,
        stack: nextStack,
        dismissedSuggestionIds,
        action: 'company.technical_stack_suggestion_accept',
      });
      return buildTechnicalStackState({
        companyKey,
        providerStack: state.providerStack,
        overrideValue: saved.value,
        overrideUpdatedAt: saved.updatedAt,
      });
    },
  );

  server.post(
    '/crm/companies/:companyKey/technical-stack/suggestions/:suggestionId/dismiss',
    {
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: TechnicalStackSuggestionParams,
        response: { 200: TechnicalStackState },
      },
    },
    async (req) => {
      const { companyKey, state, overrideValue } = await loadTechnicalStackContext(
        req.auth.orgId,
        req.auth.userId,
        req.params.companyKey,
      );
      const existing = parseTechnicalStackOverride(overrideValue);
      const saved = await saveTechnicalStackOverride({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        companyKey,
        stack: existing?.stack ?? state.manualStack,
        dismissedSuggestionIds: [
          ...(existing?.dismissedSuggestionIds ?? []),
          req.params.suggestionId,
        ],
        action: 'company.technical_stack_suggestion_dismiss',
      });
      return buildTechnicalStackState({
        companyKey,
        providerStack: state.providerStack,
        overrideValue: saved.value,
        overrideUpdatedAt: saved.updatedAt,
      });
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
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const companies = await getCompaniesOnly(req.auth.orgId, prisma, scope);
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
        const company = companies.find((item) => normalizeDomain(item.domain) === domain);
        if (company) return { match: 'exact_domain' as const, company, alternatives: [] };
      }

      if (registryNeedles.length) {
        const company = companies.find((item) =>
          Object.values(item.registryIds).some((value) =>
            registryNeedles.includes(normalizeRegistryValue(value)),
          ),
        );
        if (company) return { match: 'registry_id' as const, company, alternatives: [] };
      }

      if (name) {
        const exact = companies.find(
          (item) =>
            item.name.toLowerCase() === name ||
            (item.legalName !== null && item.legalName.toLowerCase() === name),
        );
        if (exact) return { match: 'exact_name' as const, company: exact, alternatives: [] };

        const alternatives = companies
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
        params: z.object({ id: z.string().min(1).max(255) }),
        response: { 200: AccountCockpitSnapshot },
      },
    },
    async (req) => {
      // WHY: buildCompanyCockpit runs 7 targeted queries vs buildDashboardSnapshot's 12
      // full-table scans. Widgets, bid opportunities, insights, providers, queues, and
      // release score are irrelevant to a single-company cockpit view.
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const cockpit = await buildCompanyCockpit(req.auth.orgId, req.params.id, prisma, scope);
      if (!cockpit) throw server.httpErrors.notFound('Company not found');
      return cockpit;
    },
  );

  server.post(
    '/crm/companies/:id/enrich',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: z.object({ id: z.string().min(1).max(255) }),
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

      await queueApolloEnrichment({
        orgId: req.auth.orgId,
        companyName: req.body.name,
        ...(result.domain ? { domain: result.domain } : {}),
        log: req.log,
      });

      return result.company;
    },
  );

  server.post(
    '/crm/companies/autopopulate-from-sales',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      preHandler: server.requirePermission('companies:write'),
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

  // ─── Field overrides (M1) ───────────────────────────────────────────────────
  // Manual correction of an Apollo-sourced cockpit field. The enrichment
  // snapshot is never mutated — the override layers on top and the field moves
  // to the Internal Data block flagged "manually overridden".
  const FieldOverrideBody = z.discriminatedUnion('fieldKey', [
    z.object({ fieldKey: z.literal('industry'), value: z.string().trim().min(1).max(120) }),
    z.object({ fieldKey: z.literal('employeeCount'), value: z.number().int().positive().max(10_000_000) }),
    z.object({
      fieldKey: z.literal('annualRevenueMicros'),
      // Micros (int × 1e6); bounded to the same €9e15 float8-exact ceiling
      // the analytics engine documents.
      value: z.number().int().positive().max(9e15),
    }),
  ]);
  const FieldOverrideResponse = z.object({
    companyKey: z.string(),
    fieldKey: z.string(),
    value: z.unknown(),
    updatedAt: z.string().datetime(),
  });

  server.put(
    '/crm/companies/:companyKey/field-overrides',
    {
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: z.object({ companyKey: z.string().min(1).max(255) }),
        body: FieldOverrideBody,
        response: { 200: FieldOverrideResponse },
      },
    },
    async (req) => {
      const companyKey = normalizeName(req.params.companyKey);
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const access = await canReadAccount({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.params.companyKey,
        scope,
        prismaClient: prisma,
      });
      if (!access.allowed) throw server.httpErrors.notFound('Company not found');
      // Override + its audit row must land together or not at all.
      const saved = await prisma.$transaction(async (tx) => {
        const row = await tx.companyFieldOverride.upsert({
          where: {
            orgId_companyKey_fieldKey: {
              orgId: req.auth.orgId,
              companyKey,
              fieldKey: req.body.fieldKey,
            },
          },
          create: {
            orgId: req.auth.orgId,
            companyKey,
            fieldKey: req.body.fieldKey,
            value: req.body.value,
            overriddenById: req.auth.userId,
          },
          update: { value: req.body.value, overriddenById: req.auth.userId },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'company.field_override',
            targetType: 'company',
            targetId: companyKey,
            diff: { fieldKey: req.body.fieldKey, value: req.body.value },
          },
        });
        return row;
      });
      invalidateDashboardSnapshotCache(req.auth.orgId);
      return {
        companyKey,
        fieldKey: saved.fieldKey,
        value: saved.value,
        updatedAt: saved.updatedAt.toISOString(),
      };
    },
  );

  server.delete(
    '/crm/companies/:companyKey/field-overrides/:fieldKey',
    {
      preHandler: server.requirePermission('companies:write'),
      schema: {
        params: z.object({
          companyKey: z.string().min(1).max(255),
          fieldKey: z.enum(['industry', 'employeeCount', 'annualRevenueMicros']),
        }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const companyKey = normalizeName(req.params.companyKey);
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const access = await canReadAccount({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.params.companyKey,
        scope,
        prismaClient: prisma,
      });
      if (!access.allowed) throw server.httpErrors.notFound('Company not found');
      await prisma.companyFieldOverride.deleteMany({
        where: { orgId: req.auth.orgId, companyKey, fieldKey: req.params.fieldKey },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'company.field_override_revert',
          targetType: 'company',
          targetId: companyKey,
          diff: { fieldKey: req.params.fieldKey },
        },
      });
      invalidateDashboardSnapshotCache(req.auth.orgId);
      return reply.code(204).send(null);
    },
  );
};

async function buildTechnicalStackRefreshProviders({
  orgId,
  apolloJobId,
  refreshedStack,
  refreshedSources,
  log,
  nowIso,
}: {
  orgId: string;
  apolloJobId: string | null;
  refreshedStack: TechnicalStackCategoryType[];
  refreshedSources: Array<{ source: string }>;
  log: RouteLog;
  nowIso: string;
}): Promise<TechnicalStackRefreshProviderType[]> {
  const apolloMcpConfigured = Boolean(
    process.env.APOLLO_MCP_URL && process.env.APOLLO_MCP_BEARER_TOKEN,
  );
  const apolloMcpPartial = Boolean(
    (process.env.APOLLO_MCP_URL || process.env.APOLLO_MCP_BEARER_TOKEN) && !apolloMcpConfigured,
  );
  const apolloApiConfigured = Boolean(process.env.APOLLO_API_KEY);
  const apolloConfigured = apolloMcpConfigured || apolloApiConfigured;
  const apolloTransport = apolloMcpConfigured ? 'mcp' : 'api';
  const seamlessMcpConfigured = Boolean(process.env.SEAMLESS_MCP_URL);
  const seamlessApiConfigured = Boolean(
    (await resolveDataProviderApiKey(orgId, 'seamless').catch((err) => {
      log.warn({ err, orgId }, 'seamless api key resolution failed');
      return null;
    })) ?? process.env.SEAMLESS_API_KEY,
  );
  const seamlessConfigured = seamlessMcpConfigured || seamlessApiConfigured;
  const seamlessTransport = seamlessMcpConfigured ? 'mcp' : 'api';
  const seamlessSynced =
    refreshedSources.some((source) => source.source === 'seamless') ||
    refreshedStack.some((category) =>
      category.items.some((item) => item.source.toLowerCase().includes('seamless')),
    );
  const techIntelSources = techStackMcpSourceConfigsFromEnv();
  const techIntelConfigured = techIntelSources.length > 0;
  const techIntelSynced =
    refreshedSources.some((source) => source.source === 'tech_stack_mcp') ||
    refreshedStack.some((category) =>
      category.items.some((item) => item.source.toLowerCase().includes('tech_stack_mcp')),
    );
  const techIntelLabel = techIntelProviderLabel(techIntelSources);
  const openDataDisabled = process.env.BIDSTACK_OPEN_ENRICHMENT_DISABLED === '1';

  return [
    {
      id: 'apollo',
      label: 'Apollo',
      status: apolloConfigured
        ? apolloJobId
          ? 'queued'
          : 'unavailable'
        : apolloMcpPartial
          ? 'unavailable'
          : 'disabled',
      transport: apolloConfigured ? apolloTransport : null,
      message: apolloConfigured
        ? apolloJobId
          ? apolloMcpConfigured
            ? 'Apollo company intelligence queued through the configured MCP lane.'
            : 'Apollo company intelligence queued through the REST API lane.'
          : 'Apollo is configured but the enrichment queue did not accept the job.'
        : apolloMcpPartial
          ? 'Apollo MCP is partially configured; set both APOLLO_MCP_URL and APOLLO_MCP_BEARER_TOKEN, or set APOLLO_API_KEY.'
        : 'Apollo MCP/API credentials are not configured.',
      lastCheckedAt: nowIso,
    },
    {
      id: 'seamless',
      label: 'Seamless.AI',
      status: seamlessConfigured ? (seamlessSynced ? 'synced' : 'unavailable') : 'disabled',
      transport: seamlessConfigured ? seamlessTransport : null,
      message: seamlessConfigured
        ? seamlessSynced
          ? `Seamless.AI ${seamlessMcpConfigured ? 'MCP' : 'API'} returned company technology signals.`
          : `Seamless.AI ${seamlessMcpConfigured ? 'MCP' : 'API'} was checked but returned no technology signals for this account.`
        : 'Seamless.AI MCP/API credentials are not configured.',
      lastCheckedAt: nowIso,
    },
    {
      id: 'tech_intel',
      label: techIntelLabel,
      status: techIntelConfigured ? (techIntelSynced ? 'synced' : 'unavailable') : 'disabled',
      transport: techIntelConfigured ? 'mcp' : null,
      message: techIntelConfigured
        ? techIntelSynced
          ? `${techIntelLabel} returned company technology signals.`
          : `${techIntelLabel} was checked but returned no technology signals for this account.`
        : 'Technology intelligence MCP is not configured.',
      lastCheckedAt: nowIso,
    },
    {
      id: 'open_data',
      label: 'Open data',
      status: openDataDisabled ? 'disabled' : 'synced',
      transport: openDataDisabled ? null : 'open_data',
      message: openDataDisabled
        ? 'Open company verification is disabled for this environment.'
        : 'Open company verification checked domain, logo, and public profile sources.',
      lastCheckedAt: nowIso,
    },
  ];
}

function techIntelProviderLabel(
  sources: Array<{ label: string }>,
): string {
  const labels = [
    ...new Set(sources.map((source) => source.label.trim()).filter(Boolean)),
  ];
  if (labels.length === 0) return process.env.TECH_STACK_MCP_LABEL ?? 'Tech Intel MCP';
  if (labels.length <= 2) return labels.join(' + ');
  return `${labels.slice(0, 2).join(' + ')} + ${labels.length - 2} more`;
}
