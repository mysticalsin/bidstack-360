// The account cockpit "open opportunities" card must read THIS company's bids.
// The five newest rows in the whole book are a different set: on the demo seed
// they are closed deals, so Logistec, MAPFRE, MAHLE and DNB render as empty
// while their open bids sit further down the book.

const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One account page. Large enough for the demo book (CI Financial has seven bids). */
export const ACCOUNT_BIDS_LIMIT = 50;

export interface AccountBidsQuery {
  companyId?: string;
  search?: string;
  limit: number;
}

export function accountBidsQuery(
  company: { id?: string | null; name?: string | null } | null | undefined,
): AccountBidsQuery | null {
  if (!company) return null;
  const id = company.id?.trim() ?? '';
  if (COMPANY_ID_RE.test(id)) return { companyId: id, limit: ACCOUNT_BIDS_LIMIT };
  // Name-keyed cockpits have no company uuid. The list filter rejects a
  // non-uuid companyId, so search the account name and let the caller keep
  // rows whose customer matches exactly.
  const name = company.name?.trim() ?? '';
  if (!name) return null;
  return { search: name, limit: ACCOUNT_BIDS_LIMIT };
}

export interface AccountBid {
  customer?: string | null;
  stage?: string | null;
  pipelineStage?: { isWon?: boolean; isLost?: boolean } | null;
}

function sameAccount(bid: AccountBid, accountName: string): boolean {
  return (bid.customer ?? '').trim().toLowerCase() === accountName.trim().toLowerCase();
}

/** Won or lost on the pipeline record, else the legacy stage string. */
export function isDecidedBid(bid: AccountBid): boolean {
  if (bid.pipelineStage?.isWon || bid.pipelineStage?.isLost) return true;
  return bid.stage === 'closed_won' || bid.stage === 'closed_lost';
}

/** Open bids for the card. A newer closed deal must not crowd the open one out. */
export function openBidsForAccount<T extends AccountBid>(items: readonly T[], accountName: string): T[] {
  return items.filter(
    (bid) => sameAccount(bid, accountName) && !isDecidedBid(bid) && bid.stage !== 'customer',
  );
}

/** Decided bids on this account, for win/loss reasons. Not the open-card list. */
export function decidedBidsForAccount<T extends AccountBid>(items: readonly T[], accountName: string): T[] {
  return items.filter((bid) => sameAccount(bid, accountName) && isDecidedBid(bid));
}
