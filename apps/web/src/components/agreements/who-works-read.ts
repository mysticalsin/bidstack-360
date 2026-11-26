export type WhoWorksReadKind = 'loading' | 'unread' | 'failed' | 'empty' | 'ready';

/**
 * What the whitespace "who works with them" panel should say.
 * A map that has not arrived is unread. It is not an empty group and not a zero.
 * A failed read is not an empty group. A settled map with no work rows is empty.
 */
export function whoWorksReadKind(input: {
  isLoading: boolean;
  isError: boolean;
  hasPayload: boolean;
  rowCount: number;
}): WhoWorksReadKind {
  if (input.isLoading && !input.hasPayload) return 'loading';
  if (input.isError) return 'failed';
  if (!input.hasPayload) return 'unread';
  if (input.rowCount === 0) return 'empty';
  return 'ready';
}
