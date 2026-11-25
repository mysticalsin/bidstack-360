// A missing card is not an empty account. Empty copy is only legal after the
// enrichment read succeeds. A later failure that still has a payload stays ready.
export type EnrichmentGate = 'ready' | 'loading' | 'error' | 'idle';

export function enrichmentGate(q: {
  data?: unknown;
  isError: boolean;
  isLoading: boolean;
}): EnrichmentGate {
  if (q.data != null) return 'ready';
  if (q.isError) return 'error';
  if (q.isLoading) return 'loading';
  return 'idle';
}
