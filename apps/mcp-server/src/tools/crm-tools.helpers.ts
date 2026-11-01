/**
 * crm-tools.helpers.ts — Pure helpers and the mintNextCode sequence generator.
 *
 * Extracted from crm-tools.ts (BS-R1 file-size refactor).
 * Import via crm-tools.ts (consumed internally, not re-exported to callers).
 */
import { prisma, type Prisma } from '@bidstack/db';
import { microsToUnits, unitsTextToMicros, unitsToMicros } from '@bidstack/shared';

export async function mintNextCode(orgId: string): Promise<string> {
  const last = await prisma.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

/**
 * The one live pipeline stage with this key. Zero means the deal keeps the
 * enum only. Two means the create must stop: picking the first would hide a
 * lost or won flag on the other row.
 */
export async function solePipelineStage(
  orgId: string,
  key: string,
): Promise<{ id: string; isWon: boolean; isLost: boolean; deletedAt: Date | null } | null> {
  const rows = await prisma.pipelineStage.findMany({
    where: { orgId, key, deletedAt: null },
    select: { id: true, isWon: true, isLost: true, deletedAt: true },
    take: 2,
  });
  if (rows.length > 1) {
    throw new Error(`stage "${key}" matches more than one pipeline stage`);
  }
  return rows[0] ?? null;
}

/**
 * A real stage change. One live row with the new key is the link. No row
 * clears the previous link so its lost or won flag does not stay on the deal.
 * The same stage again leaves the link alone. Two rows throw before any write.
 */
export async function pipelineStageIdForStageChange(
  orgId: string,
  beforeStage: string,
  nextStage: string | undefined,
): Promise<string | null | undefined> {
  if (!nextStage || nextStage === beforeStage) return undefined;
  const row = await solePipelineStage(orgId, nextStage);
  return row?.id ?? null;
}

/** Open, won, or lost. A deleted stage does not close the deal. Lost wins when both flags are set. */
export function outcomeWhere(outcome: 'open' | 'won' | 'lost'): Prisma.OpportunityWhereInput {
  if (outcome === 'lost') {
    return {
      OR: [{ stage: 'closed_lost' }, { pipelineStage: { is: { deletedAt: null, isLost: true } } }],
    };
  }
  if (outcome === 'won') {
    return {
      NOT: {
        OR: [
          { stage: 'closed_lost' },
          { pipelineStage: { is: { deletedAt: null, isLost: true } } },
        ],
      },
      OR: [
        { stage: 'closed_won' },
        { pipelineStage: { is: { deletedAt: null, isWon: true, isLost: false } } },
      ],
    };
  }
  return {
    stage: { notIn: ['closed_won', 'closed_lost'] },
    NOT: {
      pipelineStage: {
        is: { deletedAt: null, OR: [{ isLost: true }, { isWon: true }] },
      },
    },
  };
}

/** Lost wins when the enum and a live stage flag disagree, or both are set. */
export function dealOutcome(deal: {
  stage: string;
  pipelineStage: { isWon: boolean; isLost: boolean; deletedAt: Date | null } | null;
}): 'open' | 'won' | 'lost' {
  const stage = deal.pipelineStage?.deletedAt == null ? deal.pipelineStage : null;
  if (deal.stage === 'closed_lost' || stage?.isLost) return 'lost';
  if (deal.stage === 'closed_won' || stage?.isWon) return 'won';
  return 'open';
}

/** Integer micros to units. A float division moves a large amount by one cent. */
export function dealValueUnits(valueMicros: bigint | number | unknown): number {
  if (typeof valueMicros === 'bigint' || typeof valueMicros === 'number')
    return microsToUnits(valueMicros);
  return 0;
}

/** Unit amount to stored micros. A string keeps a large remainder. A JSON number is exact only while it is a safe integer of units. */
export function valueToMicros(value: number | string): bigint {
  if (typeof value === 'string') {
    const parsed = unitsTextToMicros(value);
    if (parsed == null) {
      throw new Error('value is not an amount with up to 6 decimal places');
    }
    return parsed;
  }
  const micros = unitsToMicros(value);
  if (micros == null)
    throw new Error('value is too large to store as a JSON number; send the amount as text');
  return micros;
}

/**
 * Micros already in integer units of 1e-6. A digit string is exact. A JSON
 * number is exact only while it is a safe integer.
 */
export function storedMicros(value: number | string | undefined): bigint {
  if (value == null || value === '') return 0n;
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) throw new Error('amount is not an integer number of micros');
    return BigInt(value);
  }
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
    throw new Error('amount is too large to store as a JSON number; send the micros as text');
  }
  return BigInt(value);
}

/** Integer micros for Dust. The unit number cannot keep a large cent. */
export function dealValueMicros(valueMicros: bigint | number | unknown): string {
  if (typeof valueMicros === 'bigint') return valueMicros.toString();
  if (typeof valueMicros === 'number' && Number.isFinite(valueMicros)) {
    return BigInt(Math.trunc(valueMicros)).toString();
  }
  return '0';
}

/** A blank probability is stored as 0. Dust should not read that as a measured chance. */
export function recordedProbability(probability: number): number | null {
  return probability === 0 ? null : probability;
}

/**
 * Page from a query that loaded `limit + 1` rows.
 * The extra row means `items` is not every match.
 */
export function capPage<T>(rows: T[], limit: number): {
  items: T[];
  limit: number;
  truncated: boolean;
} {
  const truncated = rows.length > limit;
  return { items: truncated ? rows.slice(0, limit) : rows, limit, truncated };
}

/** The live stage name. A deleted stage falls back to the stored key. */
export function liveStageName(
  stageKey: string,
  pipelineStage: { name: string; deletedAt: Date | null } | null,
): string {
  const live = pipelineStage && pipelineStage.deletedAt == null ? pipelineStage.name.trim() : '';
  if (live) return live;
  return stageKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function serializeDeal(deal: {
  id: string;
  code: string;
  customer: string;
  name: string;
  stage: string;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  updatedAt: Date;
}) {
  return {
    id: deal.id,
    code: deal.code,
    customer: deal.customer,
    name: deal.name,
    stage: deal.stage,
    value: dealValueUnits(deal.valueMicros),
    valueMicros: dealValueMicros(deal.valueMicros),
    probability: recordedProbability(deal.probability),
    dueDate: deal.dueDate?.toISOString().slice(0, 10) ?? null,
    industry: deal.industry,
    updatedAt: deal.updatedAt.toISOString(),
  };
}

const COMPANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCompanyUuid(value: string): boolean {
  return COMPANY_UUID.test(value);
}

/** One company, or a refusal. A name that matches none or several is not a link. */
export function uniqueCompanyLink(matches: readonly { id: string; name: string }[]): {
  id: string;
  name: string;
} {
  if (matches.length === 1 && matches[0]) return matches[0];
  throw new Error('Pass a company id. A name is not a company link unless it matches one company.');
}

export async function requireCompanyLink(
  orgId: string,
  input: { companyId?: string; name?: string },
): Promise<{ id: string; name: string }> {
  if (input.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId, orgId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!company) throw new Error('Company not found');
    return company;
  }
  const name = input.name?.trim();
  if (!name) throw new Error('Pass a company id.');
  const matches = await prisma.company.findMany({
    where: { orgId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
    take: 2,
  });
  return uniqueCompanyLink(matches);
}

/**
 * A renamed customer label. One exact company stores that id. None clears the
 * link. Several is a refusal so the previous id is left untouched by the caller.
 */
export async function companyIdForCustomerRename(
  orgId: string,
  customer: string,
): Promise<string | null> {
  const name = customer.trim();
  if (!name) return null;
  const matches = await prisma.company.findMany({
    where: { orgId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error('Company name matches more than one company');
  return matches[0]?.id ?? null;
}

/** A real stage change. The same stage again is not a lost or won event. */
export async function recordOpportunityStageMove(
  orgId: string,
  before: { id: string; stage: string },
  nextStage: string | undefined,
): Promise<void> {
  if (!nextStage || nextStage === before.stage) return;
  await prisma.auditLog.create({
    data: {
      orgId,
      action: 'opportunity.stage',
      targetType: 'opportunity',
      targetId: before.id,
      diff: { fromStage: before.stage, toStage: nextStage },
    },
  });
}

export function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export function logoUrl(_name: string, domain: string | null) {
  if (!domain) return null;
  return `https://${domain.replace(/^www\./, '')}/favicon.ico`;
}

export function source(name: string, sourceUrl: string | null, confidence: number | null) {
  return {
    source: sourceUrl?.includes('mantu.com') ? 'official_website' : 'mcp_enrichment',
    label: `${name} enrichment profile. Not a scored source.`,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    providerMetadata: confidence === null ? { confidenceBasis: 'not_scored' } : {},
  };
}
