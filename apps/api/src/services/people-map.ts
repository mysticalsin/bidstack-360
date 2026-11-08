import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import {
  applyFactDecision,
  connectionStanding,
  factsForOpportunityStanding,
  factIsStale,
  intakeCommitment,
  intakePersonFact,
  resolvedReportsToId,
  type DealEvidence,
  type FactKind,
  type FactStatus,
  type PersonFactView,
} from '@bidstack/shared';

export const PEOPLE_MAP_FACT_TAKE = 1000;

/**
 * Scope before the take. A deal map keeps that deal's facts and the
 * account's non-deal evidence (a reporting line or company link with no
 * opportunity). Other deals' facts are not eligible, so a thousand older
 * unrelated rows cannot push a newer relevant fact past the limit. An
 * account map has no opportunity id and still reads the contact's facts.
 * Newest first, so a full in-scope set keeps the latest row.
 */
export function contactFactListArgs(
  orgId: string,
  contactIds: string[],
  opportunityId: string | null,
  companyId: string | null,
) {
  const accountEvidence = companyId
    ? { opportunityId: null, OR: [{ companyId: null }, { companyId }] }
    : { opportunityId: null };
  return {
    where: {
      orgId,
      contactId: { in: contactIds },
      deletedAt: null,
      ...(opportunityId ? { OR: [{ opportunityId }, accountEvidence] } : {}),
    },
    select: FACT_SELECT,
    orderBy: { createdAt: 'desc' as const },
    take: PEOPLE_MAP_FACT_TAKE,
  };
}

/** Buying-role facts for the exact contact/deal pairs this map will label. */
export function linkedDealFactListArgs(
  orgId: string,
  pairs: readonly { contactId: string; opportunityId: string }[],
) {
  const unique = new Map<string, { contactId: string; opportunityId: string }>();
  for (const pair of pairs) {
    if (!pair.contactId || !pair.opportunityId) continue;
    unique.set(`${pair.contactId}:${pair.opportunityId}`, pair);
  }
  return {
    where: {
      orgId,
      deletedAt: null,
      kind: 'buying_role' as const,
      OR: [...unique.values()].map((pair) => ({
        contactId: pair.contactId,
        opportunityId: pair.opportunityId,
      })),
    },
    select: FACT_SELECT,
    orderBy: { createdAt: 'desc' as const },
    take: PEOPLE_MAP_FACT_TAKE,
  };
}

/**
 * Classification rows for the loaded pairs. No take: a newer history page for
 * one pair must not hide an accepted or review fact for another pair.
 */
export function evidenceFactListArgs(
  orgId: string,
  contactIds: readonly string[],
  opportunityId: string | null,
  pairs: readonly { contactId: string; opportunityId: string }[],
) {
  const unique = new Map<string, { contactId: string; opportunityId: string }>();
  if (opportunityId) {
    for (const contactId of contactIds) {
      if (!contactId) continue;
      unique.set(`${contactId}:${opportunityId}`, { contactId, opportunityId });
    }
  }
  for (const pair of pairs) {
    if (!pair.contactId || !pair.opportunityId) continue;
    unique.set(`${pair.contactId}:${pair.opportunityId}`, pair);
  }
  return {
    where: {
      orgId,
      deletedAt: null,
      kind: 'buying_role' as const,
      status: { in: ['accepted', 'needs_review'] as const },
      OR: [...unique.values()].map((pair) => ({
        contactId: pair.contactId,
        opportunityId: pair.opportunityId,
      })),
    },
    distinct: ['contactId', 'opportunityId', 'status', 'linkLabel', 'observedAt'] as const,
    select: FACT_SELECT,
  };
}

/**
 * Accepted and review facts that account standing and reporting lines use.
 * Buying-role history is not in this query, so a full page of proposals cannot
 * hide a company link or a reporting line. `observedAt` stays in the distinct
 * key so a fresh fact is not collapsed into a stale one.
 */
export function accountClassificationFactListArgs(orgId: string, contactIds: readonly string[]) {
  return {
    where: {
      orgId,
      contactId: { in: [...contactIds] },
      deletedAt: null,
      status: { in: ['accepted', 'needs_review'] as const },
      OR: [{ kind: 'reports_to' as const }, { kind: 'company_link' as const }],
    },
    distinct: ['contactId', 'kind', 'status', 'companyId', 'linkLabel', 'reportsToContactId', 'observedAt'] as const,
    select: FACT_SELECT,
  };
}

const FACT_SELECT = {
  id: true,
  contactId: true,
  kind: true,
  status: true,
  claim: true,
  reportsToContactId: true,
  opportunityId: true,
  companyId: true,
  linkLabel: true,
  evidenceDetail: true,
  observedAt: true,
} as const;

type FactRow = {
  id: string;
  contactId: string;
  kind: FactKind;
  status: FactStatus;
  claim: string;
  reportsToContactId: string | null;
  opportunityId: string | null;
  companyId: string | null;
  linkLabel: string | null;
  evidenceDetail: string | null;
  observedAt: Date | null;
};

type DealRow = {
  contactId: string;
  role: string;
  opportunityId: string;
  opportunity: { id: string; name: string };
};

type PersonRow = {
  id: string;
  name: string;
  role: string | null;
};

function toView(row: FactRow): PersonFactView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    reportsToContactId: row.reportsToContactId,
    opportunityId: row.opportunityId,
    companyId: row.companyId,
    linkLabel: row.linkLabel,
    observedAt: row.observedAt ? row.observedAt.toISOString() : null,
  };
}

function dealEvidence(facts: PersonFactView[], opportunityId: string, label: string): DealEvidence {
  const accepted = facts.some(
    (fact) =>
      fact.status === 'accepted' &&
      fact.kind === 'buying_role' &&
      fact.opportunityId === opportunityId &&
      fact.linkLabel === label,
  );
  if (accepted) return 'accepted';
  const review = facts.some(
    (fact) =>
      fact.status === 'needs_review' && fact.kind === 'buying_role' && fact.opportunityId === opportunityId,
  );
  if (review) return 'needs_review';
  return 'label_on_file';
}

export function mergeMapFacts(
  primary: FactRow[],
  supplemental: FactRow[],
  evidence: FactRow[],
): { facts: FactRow[]; factsTruncated: boolean } {
  const seen = new Set<string>();
  const facts: FactRow[] = [];
  for (const fact of [...evidence, ...primary, ...supplemental]) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    facts.push(fact);
  }
  return {
    facts,
    factsTruncated: primary.length >= PEOPLE_MAP_FACT_TAKE || supplemental.length >= PEOPLE_MAP_FACT_TAKE,
  };
}

export function assemblePeopleMap(input: {
  companyId: string | null;
  opportunityId: string | null;
  people: PersonRow[];
  facts: FactRow[];
  deals: DealRow[];
  names: Map<string, string>;
  now: Date;
  factsTruncated?: boolean;
}) {
  const factsByContact = new Map<string, FactRow[]>();
  for (const fact of input.facts) {
    const list = factsByContact.get(fact.contactId) ?? [];
    list.push(fact);
    factsByContact.set(fact.contactId, list);
  }
  const dealsByContact = new Map<string, DealRow[]>();
  for (const deal of input.deals) {
    const list = dealsByContact.get(deal.contactId) ?? [];
    list.push(deal);
    dealsByContact.set(deal.contactId, list);
  }

  return {
    companyId: input.companyId,
    opportunityId: input.opportunityId,
    factsTruncated: input.factsTruncated === true,
    people: input.people.map((person) => {
      const rows = factsByContact.get(person.id) ?? [];
      const views = rows.map(toView);
      const reportsToContactId = resolvedReportsToId(views, input.now);
      return {
        id: person.id,
        name: person.name,
        title: person.role,
        standing: connectionStanding(factsForOpportunityStanding(views, input.opportunityId), input.now),
        reportsToContactId,
        reportsToName: reportsToContactId ? (input.names.get(reportsToContactId) ?? null) : null,
        dealLinks: (dealsByContact.get(person.id) ?? []).map((deal) => ({
          opportunityId: deal.opportunityId,
          opportunityName: deal.opportunity.name,
          label: deal.role,
          evidence: dealEvidence(views, deal.opportunityId, deal.role),
        })),
        facts: rows.map((row) => {
          const view = toView(row);
          return {
            id: row.id,
            kind: row.kind,
            status: row.status,
            claim: row.claim,
            reportsToContactId: row.reportsToContactId,
            opportunityId: row.opportunityId,
            companyId: row.companyId,
            linkLabel: row.linkLabel,
            evidenceDetail: row.evidenceDetail,
            observedAt: view.observedAt,
            stale: factIsStale(view, input.now),
          };
        }),
      };
    }),
  };
}

async function loadNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.contact.findMany({
    where: { orgId, id: { in: ids }, deletedAt: null },
    select: { id: true, name: true },
    take: 200,
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function peopleMapForCompany(orgId: string, companyId: string, now = new Date()) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!company) return null;
  const people = await prisma.contact.findMany({
    where: { orgId, companyId, deletedAt: null },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return finishMap(orgId, people, companyId, null, now);
}

export async function peopleMapForOpportunity(orgId: string, opportunityId: string, now = new Date()) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, orgId, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!opportunity) return null;
  const links = await prisma.opportunityContact.findMany({
    where: { orgId, opportunityId, deletedAt: null },
    select: {
      contact: { select: { id: true, name: true, role: true } },
    },
    take: 200,
  });
  const people = links.map((link) => link.contact);
  return finishMap(orgId, people, opportunity.companyId, opportunityId, now);
}

async function finishMap(
  orgId: string,
  people: PersonRow[],
  companyId: string | null,
  opportunityId: string | null,
  now: Date,
) {
  const ids = people.map((person) => person.id);
  const deals =
    ids.length === 0
      ? ([] as DealRow[])
      : await prisma.opportunityContact.findMany({
          where: { orgId, contactId: { in: ids }, deletedAt: null },
          select: {
            contactId: true,
            role: true,
            opportunityId: true,
            opportunity: { select: { id: true, name: true } },
          },
          take: 1000,
        });
  const primary =
    ids.length === 0
      ? ([] as FactRow[])
      : await prisma.contactFact.findMany(contactFactListArgs(orgId, ids, opportunityId, companyId));
  const supplementalPairs = deals
    .filter((deal) => deal.contactId && deal.opportunityId && deal.opportunityId !== opportunityId)
    .map((deal) => ({ contactId: deal.contactId, opportunityId: deal.opportunityId }));
  const supplemental =
    supplementalPairs.length === 0
      ? ([] as FactRow[])
      : await prisma.contactFact.findMany(linkedDealFactListArgs(orgId, supplementalPairs));
  const evidenceArgs = evidenceFactListArgs(orgId, ids, opportunityId, supplementalPairs);
  const evidence =
    ids.length === 0 || evidenceArgs.where.OR.length === 0
      ? ([] as FactRow[])
      : await prisma.contactFact.findMany(evidenceArgs);
  const accountClassification =
    ids.length === 0
      ? ([] as FactRow[])
      : await prisma.contactFact.findMany(accountClassificationFactListArgs(orgId, ids));
  const merged = mergeMapFacts(primary, supplemental, [...evidence, ...accountClassification]);
  const facts = merged.facts;
  const reportIds = facts
    .map((fact) => fact.reportsToContactId)
    .filter((id): id is string => Boolean(id));
  const names = await loadNames(orgId, reportIds);
  for (const person of people) names.set(person.id, person.name);
  return assemblePeopleMap({
    companyId,
    opportunityId,
    people,
    facts,
    deals,
    names,
    now,
    factsTruncated: merged.factsTruncated || deals.length >= 1000,
  });
}

export async function assertContactInOrg(orgId: string, contactId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, orgId, deletedAt: null },
    select: { id: true, companyId: true },
  });
}

export async function reportingLineLoops(
  orgId: string,
  contactId: string,
  reportsToContactId: string,
): Promise<boolean> {
  if (reportsToContactId === contactId) return true;
  let current: string | null = reportsToContactId;
  const seen = new Set<string>([contactId]);
  for (let depth = 0; depth < 25 && current; depth += 1) {
    if (seen.has(current)) return true;
    seen.add(current);
    const row: { reportsToContactId: string | null } | null = await prisma.contact.findFirst({
      where: { id: current, orgId, deletedAt: null },
      select: { reportsToContactId: true },
    });
    if (!row) return true;
    current = row.reportsToContactId;
  }
  return current !== null;
}

export async function syncReportsTo(orgId: string, contactId: string, now = new Date()): Promise<void> {
  const facts = await prisma.contactFact.findMany({
    where: { orgId, contactId, deletedAt: null },
    select: FACT_SELECT,
    take: 200,
  });
  const next = resolvedReportsToId(facts.map(toView), now);
  if (next && (await reportingLineLoops(orgId, contactId, next))) {
    await prisma.contact.updateMany({
      where: { id: contactId, orgId },
      data: { reportsToContactId: null },
    });
    return;
  }
  await prisma.contact.updateMany({
    where: { id: contactId, orgId },
    data: { reportsToContactId: next },
  });
}

export function notFound(server: FastifyInstance, message: string): never {
  throw server.httpErrors.notFound(message);
}

export function badRequest(server: FastifyInstance, message: string): never {
  throw server.httpErrors.badRequest(message);
}

export async function linkedFactTargets(
  orgId: string,
  link: {
    reportsToContactId: string | null;
    opportunityId: string | null;
    companyId: string | null;
  },
): Promise<void> {
  if (link.reportsToContactId) {
    const target = await prisma.contact.findFirst({
      where: { id: link.reportsToContactId, orgId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw new Error('TARGET_NOT_IN_ORG');
  }
  if (link.opportunityId) {
    const deal = await prisma.opportunity.findFirst({
      where: { id: link.opportunityId, orgId, deletedAt: null },
      select: { id: true },
    });
    if (!deal) throw new Error('TARGET_NOT_IN_ORG');
  }
  if (link.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: link.companyId, orgId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new Error('TARGET_NOT_IN_ORG');
  }
}

export { applyFactDecision, intakePersonFact, intakeCommitment };
