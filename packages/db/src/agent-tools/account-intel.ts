/**
 * Account intelligence tools (slice 12), read only, shared by the MCP server
 * and Jarvis.
 *
 * Every answer comes from stored facts with their evidence (source URL, fetch
 * date, excerpt). Derived lines carry basis 'inferred' and cite their inputs.
 * Record text is stripped of markup before it reaches the model.
 */
import { z } from 'zod';

import { composeAccountIntel } from '@bidstack/shared';

import { loadCompanyIntel } from '../company-intel-read.js';
import { prisma } from '../index.js';

import type { AgentCitation, AgentTool, AgentToolCtx } from './types.js';

const MAX_ITEMS = 50;
const NOTE =
  'Facts cite stored evidence. Lines marked inferred are derived from the cited facts, not stated by the company.';

const AccountInput = z
  .object({
    companyId: z.string().uuid().optional(),
    companyName: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(MAX_ITEMS).default(20),
  })
  .refine((v) => Boolean(v.companyId || v.companyName), {
    message: 'companyId or companyName is required',
  });

const inputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    companyId: { type: 'string', format: 'uuid' },
    companyName: { type: 'string', minLength: 1, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS },
  },
  additionalProperties: false,
};

type AccountArgs = z.infer<typeof AccountInput>;

function stripMarkup(value: string): string {
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 || c === 9 || c === 10 || c === 13;
    })
    .join('')
    .trim();
}

function clean<T>(value: T): T {
  if (typeof value === 'string') return stripMarkup(value) as T;
  if (Array.isArray(value)) return value.map((v) => clean(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) as T;
  }
  return value;
}

function cap(args: AccountArgs): number {
  const n = Number(args.limit ?? 20);
  return Math.max(1, Math.min(MAX_ITEMS, Number.isFinite(n) ? Math.floor(n) : 20));
}

async function composeFor(args: AccountArgs, ctx: AgentToolCtx) {
  const company = await prisma.company.findFirst({
    where: {
      orgId: ctx.orgId,
      deletedAt: null,
      ...(args.companyId
        ? { id: args.companyId }
        : { name: { equals: args.companyName ?? '', mode: 'insensitive' as const } }),
    },
    select: { id: true, name: true },
  });
  if (!company) throw new Error('Account not found');
  const snapshot = await loadCompanyIntel(prisma, ctx.orgId, company.id, new Date());
  if (!snapshot) throw new Error('Account not found');
  const citations: AgentCitation[] = [
    { kind: 'account', label: company.name, href: `/accounts/${company.id}` },
  ];
  return { intel: composeAccountIntel(snapshot), citations };
}

function tool(description: string, handler: AgentTool<typeof AccountInput>['handler']) {
  return {
    description,
    input: AccountInput,
    inputJsonSchema,
    kind: 'read',
    permission: 'account-intel:read',
    handler,
  } satisfies AgentTool<typeof AccountInput>;
}

/** account_direction: where the company is heading, every claim cited. */
export const accountDirection = tool(
  'Where an account is heading: cited claims, investing, cutting, next 12 months (inferred) and bid relevance to Mantu offerings.',
  async (args, ctx) => {
    const { intel, citations } = await composeFor(args, ctx);
    const { direction } = intel;
    return clean({ ...direction, claims: direction.claims.slice(0, cap(args)), note: NOTE, citations });
  },
);

/** account_hiring: open roles, 30 and 90 day trend, function mix and skills. */
export const accountHiring = tool(
  'Hiring at an account from public job boards: open roles, 30 and 90 day trend, function mix, skills and recent postings.',
  async (args, ctx) => {
    const { intel, citations } = await composeFor(args, ctx);
    const { hiring } = intel;
    return clean({ ...hiring, postings: hiring.postings.slice(0, cap(args)), note: NOTE, citations });
  },
);

/** account_financials_summary: revenue and investment lines by fiscal year with source. */
export const accountFinancialsSummary = tool(
  'Financials for an account by fiscal year with source and year, registry facts and the labelled revenue fallback.',
  async (args, ctx) => {
    const { intel, citations } = await composeFor(args, ctx);
    const { financials } = intel;
    return clean({ ...financials, years: financials.years.slice(-cap(args)), note: NOTE, citations });
  },
);

/** account_news: company posts and major news, classified by kind. */
export const accountNews = tool(
  'Company posts and major news for an account, classified as product, partnership, acquisition, leadership, results, layoffs or expansion.',
  async (args, ctx) => {
    const { intel, citations } = await composeFor(args, ctx);
    const { news } = intel;
    return clean({ ...news, items: news.items.slice(0, cap(args)), note: NOTE, citations });
  },
);
