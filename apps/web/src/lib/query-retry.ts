import { ApiError } from '@/lib/api';

/**
 * A failed read is retried once, then the panel shows its error state.
 * `failureCount` is the number of failures already observed when React Query
 * asks whether to try again, starting at 0. 4xx is the caller's mistake and
 * is not retried. 5xx and network failures (status 0) get the single retry.
 */
export function retryQueryOnce(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return isTransient(error);
}

/** Mutations already retry once; kept beside the query policy so both match. */
export function retryMutationOnce(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return isTransient(error);
}

function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 0;
  }
  return true;
}
