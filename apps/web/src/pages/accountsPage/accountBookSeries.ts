import { titleCase } from './accountUtils';

/**
 * The accounts list reads /crm/dashboard deals (take 100). That array is a
 * page, not the org's book. The caption has to say so whenever the series
 * is drawn from it.
 */
export const ACCOUNT_BOOK_PAGE_CAPTION =
  'Open stages on the loaded deals in this view. Won and lost stay off these bars. This is a page of deals, not the full book.';

/** Same open set as the account list: won and lost are outcomes, other stages stay. */
const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

const STAGE_ORDER = ['new', 'screening', 'meeting', 'proposal', 'customer', 'unspecified'];

export interface AccountBookDeal {
  companyId: string | null;
  stage: string;
  stageName?: string | null;
  amountMicros: string;
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

function seriesLabel(deal: AccountBookDeal): string {
  const named = deal.stageName?.trim();
  return named && named.length > 0 ? named : titleCase(deal.stage);
}

/**
 * Open stages for the accounts currently in view.
 * A lost or won stage stays out even when its display name still looks open.
 * Deals for companies outside the view are not part of this page.
 */
export function openAccountBookStages(
  deals: readonly AccountBookDeal[],
  companyIds: ReadonlySet<string>,
): AccountBookStage[] {
  const grouped = new Map<string, { stage: string; label: string; count: number; amount: bigint }>();

  for (const deal of deals) {
    if (!deal.companyId || !companyIds.has(deal.companyId)) continue;
    if (CLOSED_STAGES.has(deal.stage)) continue;
    const label = seriesLabel(deal);
    const key = `${deal.stage}\u0000${label}`;
    const current = grouped.get(key) ?? { stage: deal.stage, label, count: 0, amount: 0n };
    current.count += 1;
    current.amount += microsOf(deal.amountMicros);
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
