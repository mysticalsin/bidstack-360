import { isMissingRoute } from '@/lib/msa/client';

export type WhitespaceReadKind =
  | 'loading'
  | 'sample-missing'
  | 'refresh-failed'
  | 'load-failed'
  | 'empty'
  | 'ready';

/**
 * What the ranked HEMA whitespace list should say.
 * A missing Agreements route is the Sample preview: Retry would call a route
 * the server does not have. A failed refresh still holds flags, so it is not
 * an empty book. A settled zero is empty and does not offer Retry.
 */
export function whitespaceReadKind(input: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasPayload: boolean;
  itemCount: number;
}): WhitespaceReadKind {
  if (input.isLoading && !input.hasPayload) return 'loading';
  if (input.isError && isMissingRoute(input.error)) return 'sample-missing';
  if (input.isError && input.hasPayload) return 'refresh-failed';
  if (input.isError) return 'load-failed';
  if (!input.hasPayload || input.itemCount === 0) return 'empty';
  return 'ready';
}
