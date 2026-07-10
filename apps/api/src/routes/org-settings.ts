// Org-level settings surfaces. First route: ABC opportunity filter rules (M6),
// adjustable in Settings without a code change. Read returns defaults when no
// OrgSettings row exists yet.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma } from '@bidstack/db';
import {
  AppModules,
  AppModulesUpdate,
  APP_MODULES_DEFAULT,
  ORG_LOCALE_DEFAULT,
  OrgLocaleSettings,
  OrgLocaleSettingsUpdate,
  OpportunityFilterRules,
  OpportunityFilterRulesUpdate,
} from '@bidstack/shared';

function parseAppModules(value: unknown): AppModules {
  const parsed = AppModules.safeParse(value ?? {});
  return parsed.success ? parsed.data : APP_MODULES_DEFAULT;
}

function parseRules(value: unknown): OpportunityFilterRules {
  const parsed = OpportunityFilterRules.safeParse(value ?? {});
  return parsed.success
    ? parsed.data
    : {
        includeExpertiseTypes: [],
        includeSolutionTypes: [],
        frameworkAgreementTypes: [],
        excludeNonFramework: false,
      };
}

function parseLocaleSettings(
  row:
    | {
        defaultCurrency: string;
        dateFormat: string;
        timezone: string;
      }
    | null
    | undefined,
): OrgLocaleSettings {
  const parsed = OrgLocaleSettings.safeParse({
    currency: row?.defaultCurrency ?? ORG_LOCALE_DEFAULT.currency,
    dateFormat: row?.dateFormat ?? ORG_LOCALE_DEFAULT.dateFormat,
    timezone: row?.timezone ?? ORG_LOCALE_DEFAULT.timezone,
  });
  return parsed.success ? parsed.data : ORG_LOCALE_DEFAULT;
}

export const orgSettingsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/org-settings/locale',
    {
      // Locale defaults (currency/dateFormat/timezone) are non-sensitive
      // workspace config, and the settings UI shows this section read-only to
      // every role — AE/SDR/CS hold no settings:read grant, so gating on it
      // 403'd a screen they're meant to see. Any authenticated, org-scoped
      // caller may read; only PUT stays behind settings:write + admin.
      schema: { response: { 200: OrgLocaleSettings } },
    },
    async (req) => {
      const row = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { defaultCurrency: true, dateFormat: true, timezone: true },
      });
      return parseLocaleSettings(row);
    },
  );

  server.put(
    '/org-settings/locale',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: { body: OrgLocaleSettingsUpdate, response: { 200: OrgLocaleSettings } },
    },
    async (req) => {
      const existing = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { defaultCurrency: true, dateFormat: true, timezone: true },
      });
      const locale = OrgLocaleSettings.parse({
        ...parseLocaleSettings(existing),
        ...req.body,
      });
      // Revive a tombstoned settings row first — the soft-delete middleware
      // scopes upsert to live rows, so upserting over a soft-deleted row
      // would take the create branch and P2002 on the orgId unique.
      await prisma.orgSettings.updateMany({
        where: { orgId: req.auth.orgId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      await prisma.orgSettings.upsert({
        where: { orgId: req.auth.orgId },
        create: {
          orgId: req.auth.orgId,
          defaultCurrency: locale.currency,
          dateFormat: locale.dateFormat,
          timezone: locale.timezone,
        },
        update: {
          defaultCurrency: locale.currency,
          dateFormat: locale.dateFormat,
          timezone: locale.timezone,
          deletedAt: null,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'org_settings.locale.update',
          targetType: 'org_settings',
          targetId: req.auth.orgId,
          diff: req.body as object,
        },
      });
      return locale;
    },
  );

  server.get(
    '/org-settings/opportunity-filters',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: { response: { 200: OpportunityFilterRules } },
    },
    async (req) => {
      const row = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { opportunityFilterRules: true },
      });
      return parseRules(row?.opportunityFilterRules);
    },
  );

  server.put(
    '/org-settings/opportunity-filters',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: { body: OpportunityFilterRulesUpdate, response: { 200: OpportunityFilterRules } },
    },
    async (req) => {
      const existing = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { opportunityFilterRules: true },
      });
      const merged = { ...parseRules(existing?.opportunityFilterRules), ...req.body };
      // Re-validate the merged result so partial updates can't produce an
      // invalid stored shape.
      const rules = OpportunityFilterRules.parse(merged);
      await prisma.orgSettings.upsert({
        where: { orgId: req.auth.orgId },
        create: { orgId: req.auth.orgId, opportunityFilterRules: rules },
        update: { opportunityFilterRules: rules },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'org_settings.opportunity_filters.update',
          targetType: 'org_settings',
          targetId: req.auth.orgId,
          diff: req.body as object,
        },
      });
      return rules;
    },
  );

  // ── App modules (agent-studio visibility, AppFlowy Workspace) ────────────
  server.get(
    '/org-settings/app-modules',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: { response: { 200: AppModules } },
    },
    async (req) => {
      const row = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { appModules: true },
      });
      return parseAppModules(row?.appModules);
    },
  );

  server.put(
    '/org-settings/app-modules',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: { body: AppModulesUpdate, response: { 200: AppModules } },
    },
    async (req) => {
      const existing = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { appModules: true },
      });
      const merged = AppModules.parse({ ...parseAppModules(existing?.appModules), ...req.body });
      await prisma.orgSettings.upsert({
        where: { orgId: req.auth.orgId },
        create: { orgId: req.auth.orgId, appModules: merged },
        update: { appModules: merged },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'org_settings.app_modules.update',
          targetType: 'org_settings',
          targetId: req.auth.orgId,
          diff: req.body as object,
        },
      });
      return merged;
    },
  );
};
