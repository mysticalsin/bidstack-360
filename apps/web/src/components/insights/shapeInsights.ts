import {
  getOpportunityStageBusinessKey,
  getPipelineStageBusinessKey,
  getPipelineStages,
} from '@/lib/pipeline-stages';

import type { Opportunity } from '@bidstack/shared';

/** Shown whenever a money figure has no ISO currency on the record. */
export const UNSPECIFIED_CURRENCY_LABEL = 'unspecified';

export function insightErrorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The request failed.';
}

export interface CurrencyBearing {
  currency?: string | null;
}

export interface PipelineStageRow {
  id: string;
  label: string;
  count: number;
  /** Sum of opportunity `value` (major units). Not a currency conversion. */
  amount: number;
  color: string | null;
}

export interface PipelineVisual {
  stages: PipelineStageRow[];
  /** Shared ISO code, or null when the API omitted currency or rows disagree. */
  currency: string | null;
  opportunityCount: number;
}

export interface AccountSlice {
  key: string;
  label: string;
  count: number;
}

export interface RelationshipContact {
  id: string;
  name: string;
  role: string | null;
}

export interface RelationshipLink {
  source: number;
  target: number;
  /** Always 1: one person linked to the company. Not revenue. */
  value: 1;
  contactId: string;
}

export interface RelationshipDiagram {
  companyName: string;
  nodes: Array<{ name: string; category: 'source' | 'outcome' }>;
  links: RelationshipLink[];
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

export function normalizeCurrencyCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return ISO_CURRENCY.test(code) ? code : null;
}

/**
 * One currency label for a summed total. A missing code, an invalid code, or
 * mixed codes stay unspecified — summing those into EUR would be invented.
 */
export function resolveSharedCurrency(
  records: ReadonlyArray<CurrencyBearing>,
): string | null {
  if (records.length === 0) return null;
  const codes = records.map((record) => normalizeCurrencyCode(record.currency));
  const first = codes[0];
  if (!first) return null;
  return codes.every((code) => code === first) ? first : null;
}

export function formatInsightAmount(
  amount: number,
  currency: string | null | undefined,
  locale = 'en',
): string {
  const code = normalizeCurrencyCode(currency);
  const digits = Number.isInteger(amount) ? 0 : 2;
  if (!code) {
    const plain = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
    return `${plain} ${UNSPECIFIED_CURRENCY_LABEL}`;
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

type PipelineInput = Opportunity & CurrencyBearing;

/** Stages with at least one opportunity. Width should follow `count`, amount is separate. */
export function shapePipelineByStage(opportunities: readonly PipelineInput[]): PipelineVisual {
  const stages = getPipelineStages([...opportunities]);
  const rows: PipelineStageRow[] = [];
  for (const stage of stages) {
    const id = getPipelineStageBusinessKey(stage);
    const matched = opportunities.filter((opp) => getOpportunityStageBusinessKey(opp) === id);
    if (matched.length === 0) continue;
    rows.push({
      id,
      label: stage.name,
      count: matched.length,
      amount: matched.reduce((sum, opp) => sum + (Number.isFinite(opp.value) ? opp.value : 0), 0),
      color: stage.color,
    });
  }
  return {
    stages: rows,
    currency: resolveSharedCurrency(opportunities),
    opportunityCount: opportunities.length,
  };
}

export function pipelineIsEmpty(visual: PipelineVisual): boolean {
  return visual.opportunityCount === 0 || visual.stages.length === 0;
}

/** Index of the series that should carry the single accent. Ties keep the earlier row. */
export function leadStageIndex(stages: ReadonlyArray<{ count: number }>): number {
  return stages.reduce(
    (best, stage, index, all) => (stage.count > (all[best]?.count ?? -1) ? index : best),
    0,
  );
}

/**
 * One accent on the leading series. Other series are neutral steps so a chart
 * does not become a hue gradient.
 */
export function insightSeriesColor(index: number, leadIndex: number): string {
  if (index === leadIndex) return 'var(--chart-1)';
  const steps = [62, 46, 34, 24, 16];
  const mix = steps[Math.min(Math.abs(index - leadIndex) - 1, steps.length - 1)] ?? 16;
  return `color-mix(in srgb, var(--fg-primary) ${mix}%, var(--surface-card))`;
}

const UNSPECIFIED_INDUSTRY = 'Unspecified';

export function shapeAccountDistribution(
  companies: ReadonlyArray<{ industry: string | null | undefined }>,
): AccountSlice[] {
  const counts = new Map<string, number>();
  for (const company of companies) {
    const label = company.industry?.trim() || UNSPECIFIED_INDUSTRY;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function accountDistributionIsEmpty(slices: readonly AccountSlice[]): boolean {
  return slices.length === 0;
}

/**
 * One node per contact actually linked to the company. Link value is 1
 * (the relationship exists) and is never treated as money.
 */
export function shapeCompanyRelationships(
  companyName: string,
  contacts: readonly RelationshipContact[],
): RelationshipDiagram | null {
  if (contacts.length === 0) return null;
  return {
    companyName,
    nodes: [
      { name: companyName, category: 'source' },
      ...contacts.map((contact) => ({
        name: contact.name,
        category: 'outcome' as const,
      })),
    ],
    links: contacts.map((contact, index) => ({
      source: 0,
      target: index + 1,
      value: 1 as const,
      contactId: contact.id,
    })),
  };
}
