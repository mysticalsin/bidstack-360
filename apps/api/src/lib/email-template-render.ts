// Mustache-style placeholder renderer for the EmailTemplate feature.
// All placeholder names come from packages/shared PLACEHOLDER_CATALOG so the
// editor's available-token palette stays in lock-step with what the server
// can fill in. Tokens that the context can't resolve render as `[—]` and are
// returned in the response's `missingTokens` list so the UI can warn before
// the rep clicks Send.

import { prisma } from '@bidstack/db';
import {
  PLACEHOLDER_TOKEN_SET,
  type EmailTemplateRenderRequest,
  type EmailTemplateRenderResponse,
} from '@bidstack/shared';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;
const MISSING_SENTINEL = '[—]';

interface RenderContext {
  lead?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  opportunity?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  user: { firstName: string; lastName: string; fullName: string; email: string };
  org: { name: string };
  today: string;
}

export async function renderEmailTemplate(args: {
  orgId: string;
  userId: string;
  templateId: string;
  context: EmailTemplateRenderRequest['context'];
}): Promise<EmailTemplateRenderResponse> {
  const template = await prisma.emailTemplate.findFirst({
    where: { id: args.templateId, orgId: args.orgId, deletedAt: null },
  });
  if (!template) {
    throw new Error('Email template not found');
  }

  const ctx = await buildRenderContext({
    orgId: args.orgId,
    userId: args.userId,
    leadId: args.context.leadId,
    accountId: args.context.accountId,
    opportunityId: args.context.opportunityId,
    contactId: args.context.contactId,
  });

  const missingTokens = new Set<string>();
  const fillBody = (input: string): string =>
    input.replace(PLACEHOLDER_RE, (_, token: string) => {
      if (!PLACEHOLDER_TOKEN_SET.has(token)) {
        missingTokens.add(token);
        return MISSING_SENTINEL;
      }
      const value = resolveToken(token, ctx);
      if (value === null || value === undefined || value === '') {
        missingTokens.add(token);
        return MISSING_SENTINEL;
      }
      return String(value);
    });

  const subject = fillBody(template.subject);
  const bodyHtml = fillBody(template.bodyHtml);
  const bodyText = fillBody(template.bodyText ?? stripHtml(template.bodyHtml));

  return {
    subject,
    bodyHtml,
    bodyText,
    missingTokens: [...missingTokens].sort(),
  };
}

async function buildRenderContext(args: {
  orgId: string;
  userId: string;
  leadId?: string;
  accountId?: string;
  opportunityId?: string;
  contactId?: string;
}): Promise<RenderContext> {
  const [user, org, lead, account, opportunity, contact] = await Promise.all([
    prisma.user.findFirst({
      where: { id: args.userId, orgId: args.orgId },
      select: { name: true, email: true },
    }),
    prisma.org.findFirst({ where: { id: args.orgId }, select: { name: true } }),
    args.leadId
      ? prisma.lead.findFirst({
          where: { id: args.leadId, orgId: args.orgId, deletedAt: null },
        })
      : null,
    args.accountId
      ? prisma.company.findFirst({
          where: { id: args.accountId, orgId: args.orgId, deletedAt: null },
          select: { name: true, industry: true },
        })
      : null,
    args.opportunityId
      ? prisma.opportunity.findFirst({
          where: { id: args.opportunityId, orgId: args.orgId, deletedAt: null },
          select: { name: true, valueMicros: true, country: true },
        })
      : null,
    args.contactId
      ? prisma.contact.findFirst({
          where: { id: args.contactId, orgId: args.orgId, deletedAt: null },
          select: { name: true, email: true, role: true },
        })
      : null,
  ]);

  const [firstName, ...rest] = (user?.name ?? '').split(' ');
  const fullName = user?.name ?? '';

  return {
    lead: lead
      ? {
          firstName: lead.firstName,
          lastName: lead.lastName,
          fullName: `${lead.firstName} ${lead.lastName}`,
          email: lead.email ?? '',
          companyName: lead.companyName,
          title: lead.title ?? '',
        }
      : null,
    account: account
      ? {
          name: account.name,
          industry: account.industry ?? '',
        }
      : null,
    opportunity: opportunity
      ? {
          name: opportunity.name,
          // BidStack stores values as micros (millionths) to avoid float math.
          // Render in the opportunity's country-implied currency (EUR fallback).
          amount: formatAmount(
            Number(opportunity.valueMicros) / 1_000_000,
            inferCurrencyFromCountry(opportunity.country),
          ),
        }
      : null,
    contact: contact
      ? {
          name: contact.name,
          fullName: contact.name,
          firstName: contact.name.split(' ')[0] ?? '',
          lastName: contact.name.split(' ').slice(1).join(' '),
          email: contact.email ?? '',
          title: contact.role ?? '',
        }
      : null,
    user: {
      firstName: firstName ?? '',
      lastName: rest.join(' '),
      fullName,
      email: user?.email ?? '',
    },
    org: { name: org?.name ?? '' },
    today: formatToday(),
  };
}

function resolveToken(token: string, ctx: RenderContext): unknown {
  if (token === 'today') return ctx.today;
  const [scope, field] = token.split('.');
  if (!field) return null;
  if (scope === 'user') return ctx.user[field as keyof RenderContext['user']];
  if (scope === 'org') return ctx.org[field as keyof RenderContext['org']];
  if (scope === 'lead') return ctx.lead?.[field];
  if (scope === 'account') return ctx.account?.[field];
  if (scope === 'opportunity') return ctx.opportunity?.[field];
  if (scope === 'contact') return ctx.contact?.[field];
  return null;
}

function formatAmount(num: number, currency: string): string {
  if (!Number.isFinite(num) || num === 0) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `${currency} ${num}`;
  }
}

/**
 * Best-effort currency inference from country code so the email-template
 * preview renders something reasonable without forcing a per-Opportunity
 * currency column. A future Sprint can swap to a real per-record currency.
 */
function inferCurrencyFromCountry(country: string | null | undefined): string {
  if (!country) return 'EUR';
  const c = country.toUpperCase();
  if (['US'].includes(c)) return 'USD';
  if (['GB'].includes(c)) return 'GBP';
  if (['CH'].includes(c)) return 'CHF';
  if (['JP'].includes(c)) return 'JPY';
  if (['AU'].includes(c)) return 'AUD';
  if (['CA'].includes(c)) return 'CAD';
  return 'EUR';
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
