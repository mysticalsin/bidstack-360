/**
 * Owner email already stored on the bid.
 *
 * The deal-board list payload carries an email, not a display name. A blank
 * value is no owner. The mailbox local-part is not a name to invent.
 */
export function pipelineCardOwnerEmail(owner: string | null | undefined): string | null {
  const email = owner?.trim() ?? '';
  return email.length > 0 ? email : null;
}
