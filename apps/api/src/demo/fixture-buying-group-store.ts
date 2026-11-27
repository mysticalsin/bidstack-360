import { prisma, type Sentiment } from '@bidstack/db';

import {
  fixtureBuyingGroupMode,
  linksToMaterialize,
  projectFixtureBuyingGroup,
  type ProjectedBuyingGroupLink,
} from './fixture-buying-group.js';

const CONTACT_TAKE = 1000;

/** True when this deal has any link row, including one a person removed. */
export async function dealHasContactLink(orgId: string, opportunityId: string): Promise<boolean> {
  const row = await prisma.opportunityContact.findFirst({
    where: { orgId, opportunityId },
    select: { id: true },
  });
  return row != null;
}

/** Projected buying group for a demo deal. `null` when the mode is off. */
export async function loadProjectedBuyingGroup(
  orgId: string,
  opportunityId: string,
  mode: string | undefined,
): Promise<readonly ProjectedBuyingGroupLink[] | null> {
  if (fixtureBuyingGroupMode(mode) !== 'demo') return null;
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, orgId, deletedAt: null },
    select: { id: true, orgId: true, customer: true, companyId: true },
  });
  if (!opportunity) return [];
  const customer = opportunity.customer.trim();
  if (!customer) return [];
  const contacts = await prisma.contact.findMany({
    where: { orgId, deletedAt: null, customer },
    select: {
      id: true,
      customer: true,
      companyId: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      influence: true,
      sentiment: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
    take: CONTACT_TAKE,
  });
  return projectFixtureBuyingGroup(opportunity, contacts, mode);
}

/**
 * Persist the projected group the first time someone edits it, so a later
 * read does not put a removed person back. No-op when a row already exists,
 * the mode is off, or this write is not about someone in the group.
 */
export async function materializeFixtureBuyingGroup(
  orgId: string,
  opportunityId: string,
  mode: string | undefined,
  opts: { omitContactId?: string; requireContactId?: string } = {},
): Promise<void> {
  if (fixtureBuyingGroupMode(mode) !== 'demo') return;
  if (await dealHasContactLink(orgId, opportunityId)) return;
  const projected = await loadProjectedBuyingGroup(orgId, opportunityId, mode);
  if (!projected) return;
  const rows = linksToMaterialize(projected, opts);
  if (!rows?.length) return;
  await prisma.opportunityContact.createMany({
    data: rows.map((link) => ({
      orgId: link.orgId,
      opportunityId: link.opportunityId,
      contactId: link.contactId,
      role: link.role,
      isPrimary: link.isPrimary,
      influence: link.influence,
      sentiment: link.sentiment as Sentiment | null,
    })),
    skipDuplicates: true,
  });
}
