/**
 * account-intel-tools.ts: read-only account intelligence for agents.
 *
 * Every answer comes from stored facts with their evidence (source URL, fetch
 * date, excerpt). Derived lines carry basis 'inferred' and cite their inputs.
 * Record text is stripped of markup before it reaches the model.
 */
import { z } from 'zod';

import { loadCompanyIntel, prisma } from '@bidstack/db';
import { composeAccountIntel } from '@bidstack/shared';

import type { McpAuthCtx } from '../auth.js';
import type { Tool } from './index.js';

const MAX_ITEMS = 50;
const NOTE = 'Facts cite stored evidence. Lines marked inferred are derived from the cited facts, not stated by the company.';

const AccountInput = z
  .object({
    companyId: z.string().uuid().optional(),
    companyName: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(MAX_ITEMS).default(20),
  })
  .refine((v) => Boolean(v.companyId || v.companyName), { message: 'companyId or companyName is required' });

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

async function composeFor(args: AccountArgs, ctx: McpAuthCtx) {
  const company = await prisma.company.findFirst({
    where: {
      orgId: ctx.orgId,
      deletedAt: null,
      ...(args.companyId ? { id: args.companyId } : { name: { equals: args.companyName ?? '', mode: 'insensitive' as const } }),
    },
    select: { id: true, name: true },
  });
  if (!company) throw new Error('Account not found');
  const snapshot = await loadCompanyIntel(prisma, ctx.orgId, company.id, new Date());
  if (!snapshot) throw new Error('Account not found');
  return composeAccountIntel(snapshot);
}

/** account_direction: where the company is heading, every claim cited. */
export const accountDirection: Tool<typeof AccountInput> = {
  description: 'Where an account is heading: cited claims, investing, cutting, next 12 months (inferred) and bid relevance to Mantu offerings.',
  input: AccountInput,
  inputJsonSchema,
  handler: async (args, ctx) => {
    const { direction } = await composeFor(args, ctx);
    const n = cap(args);
    return clean({ ...direction, claims: direction.claims.slice(0, n), note: NOTE });
  },
};

/** account_hiring: open roles, 30 and 90 day trend, function mix and skills. */
export const accountHiring: Tool<typeof AccountInput> = {
  description: 'Hiring at an account from public job boards: open roles, 30 and 90 day trend, function mix, skills and recent postings.',
  input: AccountInput,
  inputJsonSchema,
  handler: async (args, ctx) => {
    const { hiring } = await composeFor(args, ctx);
    return clean({ ...hiring, postings: hiring.postings.slice(0, cap(args)), note: NOTE });
  },
};

/** account_financials_summary: revenue and investment lines by fiscal year with source. */
export const accountFinancialsSummary: Tool<typeof AccountInput> = {
  description: 'Financials for an account by fiscal year with source and year, registry facts and the labelled revenue fallback.',
  input: AccountInput,
  inputJsonSchema,
  handler: async (args, ctx) => {
    const { financials } = await composeFor(args, ctx);
    return clean({ ...financials, years: financials.years.slice(-cap(args)), note: NOTE });
  },
};

/** account_news: company posts and major news, classified by kind. */
export const accountNews: Tool<typeof AccountInput> = {
  description: 'Company posts and major news for an account, classified as product, partnership, acquisition, leadership, results, layoffs or expansion.',
  input: AccountInput,
  inputJsonSchema,
  handler: async (args, ctx) => {
    const { news } = await composeFor(args, ctx);
    return clean({ ...news, items: news.items.slice(0, cap(args)), note: NOTE });
  },
};

/** The four account intelligence tools, keyed by registry name. */
export const accountIntelTools = {
  account_direction: accountDirection,
  account_hiring: accountHiring,
  account_financials_summary: accountFinancialsSummary,
  account_news: accountNews,
} as const;

/** Scopes for the account intelligence tools: all read. */
export const accountIntelToolScopes = {
  account_direction: 'read',
  account_hiring: 'read',
  account_financials_summary: 'read',
  account_news: 'read',
} as const;
