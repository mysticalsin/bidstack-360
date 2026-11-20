/**
 * company_tech_stack (slice 16): the technology stack of one account, read
 * only, shared by the MCP server and Jarvis.
 *
 * Open data lanes (DNS, Cert, Website, Jobs, GitHub) come first, then Apollo
 * organization technologies and the manual stack. Every technology names its
 * source and evidence; the coverage block lists the lanes that found nothing,
 * so an answer can state gaps plainly. Organization-level data only.
 */
import { z } from 'zod';

import {
  coverageFromSnapshot,
  openTechStackCategories,
  OPEN_TECH_LANE_LABELS,
  parseOpenTechSnapshot,
  techSourceLabel,
  TechnicalStackCategory,
} from '@bidstack/shared';

import { prisma } from '../index.js';
import { normalizeEnrichmentName } from '../open-tech-refresh.js';

import type { AgentCitation, AgentTool } from './types.js';

const MAX_ITEMS = 60;
const NOTE =
  'Public sources only: DNS records, certificate transparency, the public homepage, public job postings and public GitHub repositories, with Apollo organization data as a fallback. Internal systems without a public footprint will not appear.';

const Input = z
  .object({
    companyId: z.string().uuid().optional(),
    companyName: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(MAX_ITEMS).default(30),
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

export interface TechOut {
  name: string;
  category: string;
  source: string;
  confidence: number;
  evidence: string | null;
  evidenceUrl: string | null;
  observedAt: string | null;
  sample: boolean;
}

function plain(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]*>?/g, '')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .trim();
  return text || null;
}

function categoriesFrom(value: unknown): TechnicalStackCategory[] {
  const parsed = z.array(TechnicalStackCategory).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export const companyTechStack = {
  description:
    'Technology stack of an account from public sources (DNS, certificates, homepage, job postings, GitHub) with Apollo as a fallback: each technology with source, confidence and evidence, plus the lanes that found nothing.',
  input: Input,
  inputJsonSchema,
  kind: 'read',
  permission: 'companies:read',
  async handler(args, ctx) {
    const company = await prisma.company.findFirst({
      where: {
        orgId: ctx.orgId,
        deletedAt: null,
        ...(args.companyId ? { id: args.companyId } : { name: { equals: args.companyName ?? '', mode: 'insensitive' as const } }),
      },
      select: { id: true, name: true },
    });
    if (!company) throw new Error('Account not found');
    const normalizedName = normalizeEnrichmentName(company.name);
    const [enrichment, override] = await Promise.all([
      prisma.companyEnrichment.findFirst({
        where: { orgId: ctx.orgId, normalizedName, deletedAt: null },
        select: { providerMetadata: true },
      }),
      prisma.companyFieldOverride.findUnique({
        where: { orgId_companyKey_fieldKey: { orgId: ctx.orgId, companyKey: normalizedName, fieldKey: 'technicalStack' } },
        select: { value: true },
      }),
    ]);
    const metadata = (enrichment?.providerMetadata ?? {}) as Record<string, unknown>;
    const snapshot = parseOpenTechSnapshot(metadata.openTechStack);
    const overrideValue = override?.value as { stack?: unknown } | unknown[] | null | undefined;
    const manual = categoriesFrom(Array.isArray(overrideValue) ? overrideValue : overrideValue?.stack);

    const byName = new Map<string, TechOut>();
    const add = (categories: TechnicalStackCategory[], fallbackCategory?: string) => {
      for (const category of categories) {
        for (const item of category.items) {
          const key = item.name.trim().toLowerCase();
          const prev = byName.get(key);
          if (prev && prev.confidence >= item.confidence) continue;
          byName.set(key, {
            name: plain(item.name) ?? item.name,
            category: fallbackCategory && /apollo|technologies/i.test(category.label) ? fallbackCategory : category.label,
            source: techSourceLabel(item.source),
            confidence: item.confidence,
            evidence: plain(item.evidence?.record),
            evidenceUrl: item.evidence?.url ?? null,
            observedAt: item.evidence?.observedAt ?? null,
            sample: Boolean(item.sample),
          });
        }
      }
    };
    add(openTechStackCategories(snapshot));
    add(categoriesFrom(metadata.meetingTechStack), 'Other');
    add(manual);

    const technologies = [...byName.values()].sort((a, b) => b.confidence - a.confidence).slice(0, args.limit ?? 30);
    const coverage = coverageFromSnapshot(snapshot);
    const lanes = (status: string) =>
      (coverage?.lanes ?? []).filter((l) => l.status === status).map((l) => OPEN_TECH_LANE_LABELS[l.lane]);
    const citations: AgentCitation[] = [{ kind: 'account', label: company.name, href: `/accounts/${company.id}` }];
    return {
      company: company.name,
      checkedAt: coverage?.checkedAt ?? null,
      sample: coverage?.sample ?? false,
      technologies,
      coverage: coverage
        ? {
            found: (coverage.lanes ?? []).filter((l) => l.status === 'found').map((l) => `${OPEN_TECH_LANE_LABELS[l.lane]} ${l.count}`),
            nothingFound: lanes('empty'),
            notChecked: lanes('skipped'),
            couldNotReach: lanes('failed'),
          }
        : null,
      apolloFallback: coverage?.apolloFallback ?? null,
      note: NOTE,
      citations,
    };
  },
} satisfies AgentTool<typeof Input>;
