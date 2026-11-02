import { titleCase } from './accountUtils';

/**
 * Stage totals from the scoped open-book query. That query is the recorded
 * book for the accounts in this view, not the dashboard deal page.
 */
export const ACCOUNT_BOOK_CAPTION =
  'Open stages in the recorded open book for accounts in this view. Won and lost stay off these bars.';

/** Same open set as the account list: won and lost are outcomes, other stages stay. */
const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

const STAGE_ORDER = ['new', 'screening', 'meeting', 'proposal', 'customer', 'unspecified'];

export interface AccountBookStageInput {
  stage: string;
  stageName?: string | null;
  count: number;
  valueSumMicros: string;
}

export interface AccountBookStage {
  stage: string;
  label: string;
  count: number;
  valueSum: number;
  valueSumMicros: string;
}

function microsOf(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function countOf(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function seriesLabel(stage: string, stageName: string | null | undefined): string {
  const named = stageName?.trim();
  return named && named.length > 0 ? named : titleCase(stage);
}

/**
 * Open stages for the accounts currently in view.
 * Amounts are integer micros. A lost or won stage stays out even when its
 * display name still looks open.
 */
export function openAccountBookStages(rows: readonly AccountBookStageInput[]): AccountBookStage[] {
  const grouped = new Map<string, { stage: string; label: string; count: number; amount: bigint }>();

  for (const row of rows) {
    if (CLOSED_STAGES.has(row.stage)) continue;
    const label = seriesLabel(row.stage, row.stageName);
    const key = `${row.stage}\u0000${label}`;
    const current = grouped.get(key) ?? { stage: row.stage, label, count: 0, amount: 0n };
    current.count += countOf(row.count);
    current.amount += microsOf(row.valueSumMicros);
    grouped.set(key, current);
  }

  const labelCount = new Map<string, number>();
  for (const row of grouped.values()) {
    labelCount.set(row.label, (labelCount.get(row.label) ?? 0) + 1);
  }

  return [...grouped.values()]
    .map((row) => {
      const label = (labelCount.get(row.label) ?? 0) > 1 ? `${row.label} (${titleCase(row.stage)})` : row.label;
      return {
        stage: row.stage,
        label,
        count: row.count,
        valueSum: 0,
        valueSumMicros: row.amount.toString(),
      };
    })
    .sort((a, b) => {
      const ao = STAGE_ORDER.indexOf(a.stage);
      const bo = STAGE_ORDER.indexOf(b.stage);
      const aRank = ao === -1 ? STAGE_ORDER.length : ao;
      const bRank = bo === -1 ? STAGE_ORDER.length : bo;
      return aRank - bRank || a.label.localeCompare(b.label);
    });
}
