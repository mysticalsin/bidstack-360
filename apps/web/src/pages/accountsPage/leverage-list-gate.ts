export type LeverageListGate = 'settled' | 'loading' | 'failed';

/**
 * The HEMA filter needs the MSA leverage list. No payload yet is not an empty
 * book. A payload, including a successful empty list or a later failure that
 * still has the previous list, is settled and may be filtered.
 */
export function leverageListGate(input: {
  active: boolean;
  isLoading: boolean;
  isError: boolean;
  hasPayload: boolean;
}): LeverageListGate {
  if (!input.active || input.hasPayload) return 'settled';
  if (input.isError) return 'failed';
  if (input.isLoading) return 'loading';
  return 'settled';
}
