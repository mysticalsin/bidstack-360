export type IntelStripRead = 'loading' | 'error' | 'ready';

/**
 * The company header intel strip has its own request. A missing body is not
 * the same as a company that was never refreshed: that sentence is only true
 * after a successful read whose summary is null. A later failure that still
 * has a body keeps the last figures.
 */
export function intelStripRead(query: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
}): IntelStripRead {
  if (query.data !== undefined) return 'ready';
  if (query.isError) return 'error';
  if (query.isPending) return 'loading';
  return 'ready';
}
