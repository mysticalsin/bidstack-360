// The strategic-account page sums the current page. A read that has not
// returned is not an empty page, and a later failure is not a new empty page.

export type KeyAccountReadPhase = 'loading' | 'error' | 'ready' | 'stale';

export function keyAccountReadPhase(input: {
  hasPayload: boolean;
  isLoading: boolean;
  isError: boolean;
}): KeyAccountReadPhase {
  if (!input.hasPayload) {
    return input.isError && !input.isLoading ? 'error' : 'loading';
  }
  if (input.isError) return 'stale';
  return 'ready';
}
