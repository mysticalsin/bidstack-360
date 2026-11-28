/**
 * Bid name safe to put on a follow-up payload.
 *
 * The name is a label, not a write. It is included only when the bid belongs
 * to the caller's org. A blank name is null so the client does not render an
 * empty link. Another org's bid is null so its name does not leave that org.
 */
export function taskOpportunityName(
  opportunity: { name: string; orgId: string } | null | undefined,
  orgId: string,
): string | null {
  if (!opportunity || opportunity.orgId !== orgId) return null;
  const name = opportunity.name.trim();
  return name.length > 0 ? name : null;
}
