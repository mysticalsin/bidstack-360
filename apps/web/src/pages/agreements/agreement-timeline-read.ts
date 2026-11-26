/**
 * The agreement audit trail is a separate read from the agreement itself.
 * A missing payload is not an empty trail: the page used to substitute []
 * and say "No activity yet."
 */
export type AgreementTimelineRead<T> =
  | { state: 'loading' }
  | { state: 'unread' }
  | { state: 'empty' }
  | { state: 'ready'; events: readonly T[] };

export function agreementTimelineRead<T>(input: {
  isLoading: boolean;
  isError: boolean;
  events: readonly T[] | undefined;
}): AgreementTimelineRead<T> {
  if (input.isLoading) return { state: 'loading' };
  if (input.isError || !input.events) return { state: 'unread' };
  if (input.events.length === 0) return { state: 'empty' };
  return { state: 'ready', events: input.events };
}
