export const VALUE_PANEL_CHECKING = 'Checking value opportunities. They have not arrived.';
export const VALUE_PANEL_FAILED = 'Could not load value opportunities.';
export const VALUE_PANEL_REFRESH_FAILED = 'Could not refresh value opportunities.';

export type ValuePanelPhase = 'checking' | 'failed' | 'refresh-failed' | 'empty' | 'ready';

/**
 * A value-panel payload that has not arrived is still in flight, including a
 * paused read. Rows already in hand stay when a later read fails.
 */
export function valuePanelRead(input: {
  isError: boolean;
  items: readonly unknown[] | null;
  badPayload?: boolean;
}): ValuePanelPhase {
  if (input.isError && input.items) return 'refresh-failed';
  if (input.isError || input.badPayload) return 'failed';
  if (!input.items) return 'checking';
  if (input.items.length === 0) return 'empty';
  return 'ready';
}
