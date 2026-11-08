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
  startFetching: boolean;
  startError: boolean;
}): RelationshipFrameStatus {
  if (input.companiesPending) return 'loading';
  if (input.companiesError) return 'error';
  if (input.companyCount === 0) return 'empty';
  if (!input.manualCompany && input.startFetching) return 'loading';
  if (!input.manualCompany && input.startError) return 'error';
  return 'ready';
}
