export type WatchdogPanel = 'loading' | 'error' | 'ready';

/**
 * A payload already on screen stays. Otherwise a pending read is loading,
 * a failed read is an error, and a settled read is ready — including an
 * empty book. "No closed projects" is only true in the ready state.
 */
export function watchdogPanelState(input: {
  hasPayload: boolean;
  isLoading: boolean;
  isError: boolean;
}): WatchdogPanel {
  if (input.hasPayload) return 'ready';
  if (input.isLoading) return 'loading';
  if (input.isError) return 'error';
  return 'ready';
}
