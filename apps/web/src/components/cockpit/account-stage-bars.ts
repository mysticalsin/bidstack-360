/** Page size for one account's stage bars. The list route caps a page at 200. */
export const ACCOUNT_STAGE_PAGE = 200;

const COMPANY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAGE_ORDER = [
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
] as const;

export interface AccountStageBar {
  stage: string;
  count: number;
  valueSum: number;
}

/**
 * A company id may become the opportunities query. A name, a path, or a script
 * stays out so the card cannot search the whole book.
 */
export function accountCompanyId(id: string | null | undefined): string | null {
  if (!id || !COMPANY_ID.test(id)) return null;
  return id;
}

function stageRank(stage: string): number {
  const index = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return index === -1 ? STAGE_ORDER.length : index;
}

/** Stage totals for the rows this account read returned. Other accounts are not in the input. */
export function accountStageBars(
  items: Array<{ stage: string | null; value: number }>,
): AccountStageBar[] {
  const totals = new Map<string, AccountStageBar>();
  for (const item of items) {
    const stage = item.stage && item.stage.trim() ? item.stage : 'unknown';
    const current = totals.get(stage) ?? { stage, count: 0, valueSum: 0 };
    current.count += 1;
    current.valueSum += item.value;
    totals.set(stage, current);
  }
  return [...totals.values()].sort(
    (a, b) => stageRank(a.stage) - stageRank(b.stage) || a.stage.localeCompare(b.stage),
  );
}
