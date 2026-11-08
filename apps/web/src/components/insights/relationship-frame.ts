export type RelationshipFrameStatus = 'loading' | 'error' | 'empty' | 'ready';

/**
 * The company list decides the frame before the "first company with contacts"
 * query. That query is disabled when the list is empty or still loading, and
 * a disabled React Query stays pending. Counting it as loading hides the
 * empty list and a failed company request.
 */
export function relationshipFrameStatus(input: {
  companiesPending: boolean;
  companiesError: boolean;
  companyCount: number;
  manualCompany: boolean;
  /** True only before the follow-up has ever resolved. A refetch is not pending. */
  startPending: boolean;
  /** True while a background refetch is in flight. It must not hide a resolved frame. */
  startFetching: boolean;
  startError: boolean;
  /** The follow-up already has a company id, including during a refetch. */
  startHasData: boolean;
}): RelationshipFrameStatus {
  if (input.companiesPending) return 'loading';
  if (input.companiesError) return 'error';
  if (input.companyCount === 0) return 'empty';
  if (!input.manualCompany && input.startPending && !input.startHasData) return 'loading';
  if (!input.manualCompany && input.startError && !input.startHasData) return 'error';
  void input.startFetching;
  return 'ready';
}
