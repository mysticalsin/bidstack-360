/**
 * Who belongs on a company or opportunity people map.
 * The map is scoped by the query that loads people. It does not collapse
 * facts with a distinct key, and a fact's companyId is a link on that fact,
 * not a second copy of the person.
 */

export function contactsForCompanyWhere(orgId: string, companyId: string) {
  return { orgId, companyId, deletedAt: null };
}

export function contactsForOpportunityWhere(orgId: string, opportunityId: string) {
  return { orgId, opportunityId, deletedAt: null };
}

export function factsForContactsWhere(orgId: string, contactIds: readonly string[]) {
  return { orgId, contactId: { in: [...contactIds] }, deletedAt: null };
}

/** Facts whose subject is one of the people already chosen for this map. */
export function factsForListedPeople<T extends { contactId: string }>(
  peopleIds: readonly string[],
  facts: readonly T[],
): T[] {
  const ids = new Set(peopleIds);
  return facts.filter((fact) => ids.has(fact.contactId));
}
