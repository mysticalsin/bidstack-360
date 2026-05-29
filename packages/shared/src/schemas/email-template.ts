import { z } from 'zod';

/**
 * Sprint 1 — Krayin import.
 * Email templates with mustache-style placeholders. The placeholder catalog
 * is closed and lives below; this means the editor can show the available
 * tokens AND server-side rendering can validate references before sending.
 *
 * Adding a new placeholder = add to PLACEHOLDER_CATALOG + ensure the
 * resolver in apps/api/src/lib/email-template-render.ts can fill it.
 */

export const PLACEHOLDER_CATALOG = [
  // Lead context
  { token: 'lead.firstName', label: 'Lead — first name', sample: 'Aisha' },
  { token: 'lead.lastName', label: 'Lead — last name', sample: 'Khan' },
  { token: 'lead.fullName', label: 'Lead — full name', sample: 'Aisha Khan' },
  { token: 'lead.email', label: 'Lead — email', sample: 'aisha@example.com' },
  { token: 'lead.companyName', label: 'Lead — company', sample: 'Acme Corp' },
  { token: 'lead.title', label: 'Lead — job title', sample: 'Head of Procurement' },
  // Account / company context
  { token: 'account.name', label: 'Account — name', sample: 'Acme Corp' },
  { token: 'account.industry', label: 'Account — industry', sample: 'Manufacturing' },
  // Opportunity context
  { token: 'opportunity.name', label: 'Opportunity — name', sample: 'Q3 platform rollout' },
  { token: 'opportunity.amount', label: 'Opportunity — amount', sample: '€120,000' },
  // Authoring user context
  { token: 'user.firstName', label: 'You — first name', sample: 'Tony' },
  { token: 'user.fullName', label: 'You — full name', sample: 'Tony Walteur' },
  { token: 'user.email', label: 'You — email', sample: 'tony@bidstack.app' },
  // Tenant context
  { token: 'org.name', label: 'Your organisation', sample: 'Mantu' },
  // Generic
  { token: 'today', label: "Today's date (locale)", sample: '27 May 2026' },
] as const;

export type PlaceholderToken = (typeof PLACEHOLDER_CATALOG)[number]['token'];

export const PLACEHOLDER_TOKEN_SET: ReadonlySet<string> = new Set(
  PLACEHOLDER_CATALOG.map((p) => p.token),
);

export const EmailTemplateCategory = z.string().max(40).nullable().optional();

export const EmailTemplate = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(80),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().max(50_000).nullable(),
  category: z.string().nullable(),
  archived: z.boolean(),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().nullable(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmailTemplate = z.infer<typeof EmailTemplate>;

export const EmailTemplateCreate = z.object({
  name: z.string().trim().min(1).max(80),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().max(50_000).optional(),
  category: z.string().max(40).optional(),
});
export type EmailTemplateCreate = z.infer<typeof EmailTemplateCreate>;

export const EmailTemplatePatch = EmailTemplateCreate.partial().extend({
  archived: z.boolean().optional(),
});
export type EmailTemplatePatch = z.infer<typeof EmailTemplatePatch>;

export const EmailTemplateList = z.object({
  items: z.array(EmailTemplate),
});
export type EmailTemplateList = z.infer<typeof EmailTemplateList>;

/**
 * Preview-render request. The API resolves placeholders against the named
 * record + the calling user and returns the filled subject/body alongside
 * a list of placeholders that couldn't be resolved (so the UI can warn
 * before the rep clicks Send).
 */
export const EmailTemplateRenderRequest = z.object({
  templateId: z.string().uuid(),
  context: z.object({
    leadId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
  }),
});
export type EmailTemplateRenderRequest = z.infer<typeof EmailTemplateRenderRequest>;

export const EmailTemplateRenderResponse = z.object({
  subject: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  /** Tokens that the request didn't resolve. Always render as "[—]". */
  missingTokens: z.array(z.string()),
});
export type EmailTemplateRenderResponse = z.infer<typeof EmailTemplateRenderResponse>;
