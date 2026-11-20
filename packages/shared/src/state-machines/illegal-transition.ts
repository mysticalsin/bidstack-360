/** A transition the table refuses. Callers do not write the row. */
export type IllegalTransition = { readonly legal: false };

export function illegalTransition(): IllegalTransition {
  return { legal: false };
}

export function isIllegalTransition(value: unknown): value is IllegalTransition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'legal' in value &&
    (value as { legal: unknown }).legal === false
  );
}
