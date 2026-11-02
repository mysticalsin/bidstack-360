import { OPPORTUNITY_CONTACTS_DRAWN, opportunityContactPage } from '@bidstack/shared';

export { OPPORTUNITY_CONTACTS_DRAWN, opportunityContactPage };

/**
 * Linked contacts the deal list draws. The API drops the probe and sets
 * `contactsContinue`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownOpportunityContacts<T>(
  items: readonly T[],
  contactsContinue: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > OPPORTUNITY_CONTACTS_DRAWN) return opportunityContactPage(items);
  return { items: [...items], pageContinues: Boolean(contactsContinue) };
}

/**
 * Deal linked-contact caption. A longer loaded list is the latest contacts,
 * not every contact on the deal. A shorter list keeps "N contacts" (one
 * contact stays singular). No contact total is invented.
 */
export function opportunityContactCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every contact`;
  }
  return count === 1 ? '1 contact' : `${count} contacts`;
}
