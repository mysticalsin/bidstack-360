/**
 * An account with a live open deal cannot be deleted. Closed deals stay as
 * history. "Open" here is the enum terminal pair the pipeline KPI already
 * uses. A custom lost stage is `stageOutcome` in #381, not a second predicate.
 */
export function openDealsBlockAccountDelete(openDeals: number): boolean {
  return openDeals > 0;
}

export function openDealsForAccountWhere(orgId: string, companyId: string): {
  orgId: string;
  companyId: string;
  deletedAt: null;
  stage: { notIn: ['closed_won', 'closed_lost'] };
} {
  return {
    orgId,
    companyId,
    deletedAt: null,
    stage: { notIn: ['closed_won', 'closed_lost'] },
  };
}
