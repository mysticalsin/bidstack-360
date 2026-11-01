import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import {
  applyFactDecision,
  connectionStanding,
  factIsStale,
  intakeCommitment,
  intakePersonFact,
  PEOPLE_MAP_PAGE,
  resolvedReportsToId,
  type DealEvidence,
  type FactKind,
  type FactStatus,
  type PersonFactView,
} from '@bidstack/shared';

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

export function assemblePeopleMap(input: {
  companyId: string | null;
  opportunityId: string | null;
  people: PersonRow[];
  facts: FactRow[];
  deals: DealRow[];
  names: Map<string, string>;
  now: Date;
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
    people: input.people.map((person) => {
      const rows = factsByContact.get(person.id) ?? [];
      const views = rows.map(toView);
      const reportsToContactId = resolvedReportsToId(views, input.now);
      return {
        id: person.id,
        name: person.name,
        title: person.role,
        standing: connectionStanding(views, input.now),
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

async function loadNames(orgId: string, ids: string[]): Promise<{ names: Map<string, string>; capped: boolean }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { names: new Map(), capped: false };
  const page = unique.slice(0, PEOPLE_MAP_PAGE);
  const rows = await prisma.contact.findMany({
    where: { orgId, id: { in: page }, deletedAt: null },
    select: { id: true, name: true },
    take: PEOPLE_MAP_PAGE,
  });
  return { names: new Map(rows.map((row) => [row.id, row.name])), capped: unique.length > PEOPLE_MAP_PAGE };
}

export async function peopleMapForCompany(orgId: string, companyId: string, now = new Date()) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!company) return null;
  const where = { orgId, companyId, deletedAt: null };
  const people = await prisma.contact.findMany({
    where,
    select: { id: true, name: true, role: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: PEOPLE_MAP_PAGE,
  });
  const peopleCapped = people.length === PEOPLE_MAP_PAGE && (await prisma.contact.count({ where })) > PEOPLE_MAP_PAGE;
  const map = await finishMap(orgId, people, companyId, null, now);
  return { ...map, peopleCapped };
}

export async function peopleMapForOpportunity(orgId: string, opportunityId: string, now = new Date()) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, orgId, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!opportunity) return null;
  const where = { orgId, opportunityId, deletedAt: null };
  const links = await prisma.opportunityContact.findMany({
    where,
    select: {
      contact: { select: { id: true, name: true, role: true } },
    },
    orderBy: [{ contact: { name: 'asc' } }, { id: 'asc' }],
    take: PEOPLE_MAP_PAGE,
  });
  const peopleCapped = links.length === PEOPLE_MAP_PAGE && (await prisma.opportunityContact.count({ where })) > PEOPLE_MAP_PAGE;
  const people = links.map((link) => link.contact);
  const map = await finishMap(orgId, people, opportunity.companyId, opportunityId, now);
  return { ...map, peopleCapped };
}

async function finishMap(
  orgId: string,
  people: PersonRow[],
  companyId: string | null,
  opportunityId: string | null,
  now: Date,
) {
  const ids = people.map((person) => person.id);
  const factWhere = { orgId, contactId: { in: ids }, deletedAt: null };
  const dealWhere = { orgId, contactId: { in: ids }, deletedAt: null };
  const [facts, deals] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as FactRow[])
      : prisma.contactFact.findMany({
          where: factWhere,
          select: FACT_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: PEOPLE_MAP_PAGE,
        }),
    ids.length === 0
      ? Promise.resolve([] as DealRow[])
      : prisma.opportunityContact.findMany({
          where: dealWhere,
          select: {
            contactId: true,
            role: true,
            opportunityId: true,
            opportunity: { select: { id: true, name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: PEOPLE_MAP_PAGE,
        }),
  ]);
  const factsCapped = ids.length > 0 && facts.length === PEOPLE_MAP_PAGE && (await prisma.contactFact.count({ where: factWhere })) > PEOPLE_MAP_PAGE;
  const dealsCapped = ids.length > 0 && deals.length === PEOPLE_MAP_PAGE && (await prisma.opportunityContact.count({ where: dealWhere })) > PEOPLE_MAP_PAGE;
  const reportIds = facts
    .map((fact) => fact.reportsToContactId)
    .filter((id): id is string => Boolean(id));
  const loadedNames = await loadNames(orgId, reportIds);
  for (const person of people) loadedNames.names.set(person.id, person.name);
  return {
    ...assemblePeopleMap({ companyId, opportunityId, people, facts, deals, names: loadedNames.names, now }),
    factsCapped,
    dealsCapped,
    namesCapped: loadedNames.capped,
  };
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
