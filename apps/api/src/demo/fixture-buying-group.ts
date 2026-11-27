const SENTIMENTS = new Set(['hot', 'warm', 'neutral', 'cold']);

export type FixtureBuyingGroupSentiment = 'hot' | 'warm' | 'neutral' | 'cold';

export interface FixtureBuyingGroupContact {
  id: string;
  customer: string;
  companyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  influence: number | null;
  sentiment: FixtureBuyingGroupSentiment | null;
  createdAt: Date;
}

export interface FixtureBuyingGroupOpportunity {
  id: string;
  orgId: string;
  customer: string;
  companyId: string | null;
}

export interface ProjectedBuyingGroupLink {
  id: string;
  orgId: string;
  opportunityId: string;
  contactId: string;
  role: string;
  isPrimary: boolean;
  influence: number | null;
  sentiment: FixtureBuyingGroupSentiment | null;
  notes: null;
  deletedAt: null;
  createdAt: Date;
  updatedAt: Date;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
  };
}

/** Exact `demo`, or unset. `real` and every other spelling stay off. */
export function fixtureBuyingGroupMode(value: string | undefined): 'demo' | 'off' {
  if (value == null || value === 'demo') return 'demo';
  return 'off';
}

function hex32(input: string): string {
  let state = 2166136261;
  let out = '';
  for (let block = 0; block < 4; block += 1) {
    let hash = state;
    const salted = `${block}:${input}`;
    for (let i = 0; i < salted.length; i += 1) {
      hash ^= salted.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    state = hash >>> 0;
    out += state.toString(16).padStart(8, '0');
  }
  return out;
}

/** Stable link id for one demo person on one deal. Not written until a person edits the group. */
export function fixtureBuyingGroupLinkId(opportunityId: string, contactId: string): string {
  const chars = hex32(`${opportunityId}\n${contactId}`).split('');
  chars[12] = '5';
  chars[16] = 'a';
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sameAccount(opportunity: FixtureBuyingGroupOpportunity, contact: FixtureBuyingGroupContact): boolean {
  const customer = opportunity.customer.trim();
  if (!customer || contact.customer.trim() !== customer) return false;
  if (opportunity.companyId && contact.companyId && opportunity.companyId !== contact.companyId) return false;
  return true;
}

function wireInfluence(value: number | null): number | null {
  if (value == null || !Number.isInteger(value) || value < 1 || value > 5) return null;
  return value;
}

function roleFor(influence: number | null): string {
  const score = wireInfluence(influence);
  if (score != null && score >= 5) return 'decision_maker';
  if (score === 4) return 'champion';
  if (score === 3) return 'influencer';
  return 'stakeholder';
}

function sentimentFor(value: FixtureBuyingGroupSentiment | null): FixtureBuyingGroupSentiment | null {
  return value && SENTIMENTS.has(value) ? value : null;
}

/**
 * Demo deals ship with people on the customer and no link rows. Project those
 * people as the buying group. `null` means the mode is off. An empty list means
 * demo, and nobody on that customer. The rows are not written here.
 */
export function projectFixtureBuyingGroup(
  opportunity: FixtureBuyingGroupOpportunity,
  contacts: readonly FixtureBuyingGroupContact[],
  mode: string | undefined,
): readonly ProjectedBuyingGroupLink[] | null {
  if (fixtureBuyingGroupMode(mode) !== 'demo') return null;
  const matched = contacts.filter((contact) => sameAccount(opportunity, contact));
  matched.sort((a, b) => {
    const byInfluence = (wireInfluence(b.influence) ?? -1) - (wireInfluence(a.influence) ?? -1);
    if (byInfluence !== 0) return byInfluence;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
  const primaryId = matched[0]?.id ?? null;
  const links = matched.map((contact) => ({
    id: fixtureBuyingGroupLinkId(opportunity.id, contact.id),
    orgId: opportunity.orgId,
    opportunityId: opportunity.id,
    contactId: contact.id,
    role: roleFor(contact.influence),
    isPrimary: contact.id === primaryId,
    influence: wireInfluence(contact.influence),
    sentiment: sentimentFor(contact.sentiment),
    notes: null as null,
    deletedAt: null as null,
    createdAt: contact.createdAt,
    updatedAt: contact.createdAt,
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      role: contact.role,
    },
  }));
  links.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.contactId.localeCompare(b.contactId));
  return links;
}

/** Stored rows win, including a tombstone the caller already noticed. A null projection is real mode. */
export function selectBuyingGroup<T>(anyStored: boolean, stored: readonly T[], projected: readonly T[] | null): readonly T[] {
  if (anyStored || projected == null) return stored;
  return projected;
}

/**
 * Rows to insert before a write. `null` means this write is not about the
 * projected group, so nothing is inserted. The contact a create is about to
 * store is left out. Nothing is inserted when the list is empty.
 */
export function linksToMaterialize(
  projected: readonly ProjectedBuyingGroupLink[],
  opts: { omitContactId?: string; requireContactId?: string } = {},
): readonly ProjectedBuyingGroupLink[] | null {
  if (opts.requireContactId && !projected.some((link) => link.contactId === opts.requireContactId)) return null;
  if (!opts.omitContactId) return projected;
  return projected.filter((link) => link.contactId !== opts.omitContactId);
}
