/**
 * Org chart auto-seed (2026-10-31). Runs only when an admin asks
 * (POST /companies/:id/org-chart/seed); there is no sweep.
 *
 * Candidates, in order of trust:
 *   1. CRM contacts of the account and its subsidiaries (source 'contacts').
 *   2. External meeting-intel attendees not linked to a contact, from ABC or
 *      Metis (source 'abc' / 'metis'), when includeMeetingAttendees.
 *   3. Apollo People API Search (source 'apollo'), when includeApollo. The
 *      search costs 0 credits; the run still refuses when the month's Apollo
 *      usage is at or over ENRICHMENT_MONTHLY_BUDGET_APOLLO, and writes a
 *      0-credit ledger row so usage reports show the call.
 *
 * Rules: the seed only ADDS nodes. Existing nodes are never changed or moved.
 * Re-running is idempotent (contactId, or source + externalRef, already on the
 * chart means skip). Root: an existing root stays; otherwise the best CEO
 * title among candidates, otherwise a "Chief Executive Officer" placeholder.
 * Parent: the accepted reports-to fact when its manager is on the chart
 * (placement 'reports_to'), else the closest more senior node in the same
 * function (placement 'inferred'), else the root. Facts are read, never
 * written: the chart does not touch ContactFact or Contact.reportsToContactId.
 */
import { randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@bidstack/db';
import {
  ORG_CHART_MAX_NODES,
  ceoScore,
  nodeSeniorityFromTitle,
  seniorityRank,
  wouldCreateCycle,
  type OrgChartSeedJob,
  type OrgChartSource,
  type SeniorityLevel,
} from '@bidstack/shared';

import { classifyTitle } from '../account-enrichment/hiring.js';
import { creditsUsedThisMonth, reserveCredits, type EnrichmentDeps } from '../account-enrichment/job.js';
import type { ProviderStatus } from '../account-enrichment/providers.js';

export interface SeedCandidate {
  key: string;
  contactId: string | null;
  externalRef: string | null;
  source: OrgChartSource;
  name: string;
  title: string | null;
  seniority: SeniorityLevel;
  function: string | null;
  businessUnit: string | null;
  region: string | null;
  reportsToContactId: string | null;
}

export interface SeedResult {
  status: 'ok' | 'not_found';
  created: number;
  skipped: number;
  root: 'existing' | 'candidate' | 'placeholder' | null;
  apollo: ProviderStatus | 'skipped';
  chartVersion: number | null;
}

const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);
const fnOf = (title: string | null) => {
  if (!title) return null;
  const f = classifyTitle(title).function;
  return f === 'other' ? null : f;
};

async function groupCompanyIds(orgId: string, rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const kids = await prisma.company.findMany({ where: { orgId, parentId: { in: frontier }, deletedAt: null }, select: { id: true }, take: 1000 });
    frontier = kids.map((k) => k.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

/** Pick the parent for `c` among placed nodes (pure, exported for tests). */
export function inferParent(
  c: Pick<SeedCandidate, 'seniority' | 'function'>,
  placed: Array<{ id: string; seniority: SeniorityLevel; function: string | null }>,
  rootId: string,
): string {
  const mine = seniorityRank(c.seniority);
  let best: { id: string; rank: number } | null = null;
  if (c.function) {
    for (const p of placed) {
      const r = seniorityRank(p.seniority);
      if (p.function === c.function && r < mine && p.seniority !== 'unknown' && (!best || r > best.rank)) best = { id: p.id, rank: r };
    }
  }
  return best?.id ?? rootId;
}

export async function runOrgChartSeed(job: OrgChartSeedJob, deps: Pick<EnrichmentDeps, 'providers' | 'config' | 'now'>): Promise<SeedResult> {
  const { orgId, companyId } = job;
  const now = deps.now();
  const company = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { id: true, domain: true } });
  if (!company) return { status: 'not_found', created: 0, skipped: 0, root: null, apollo: 'skipped', chartVersion: null };
  const groups = await groupCompanyIds(orgId, companyId);

  const candidates: SeedCandidate[] = [];
  const contacts = await prisma.contact.findMany({
    where: { orgId, deletedAt: null, companyId: { in: groups } },
    select: { id: true, name: true, role: true, email: true, reportsToContactId: true },
    orderBy: { createdAt: 'asc' },
    take: 1000,
  });
  const contactEmails = new Set(contacts.map((c) => lower(c.email)).filter(Boolean));
  for (const c of contacts) {
    candidates.push({
      key: `contact:${c.id}`,
      contactId: c.id,
      externalRef: null,
      source: 'contacts',
      name: c.name,
      title: c.role,
      seniority: nodeSeniorityFromTitle(c.role),
      function: fnOf(c.role),
      businessUnit: null,
      region: null,
      reportsToContactId: c.reportsToContactId,
    });
  }

  if (job.includeMeetingAttendees) {
    const attendees = await prisma.meetingIntelAttendee.findMany({
      where: { orgId, isInternal: false, contactId: null, meeting: { orgId, deletedAt: null, companyId: { in: groups } } },
      select: { name: true, email: true, title: true, seniority: true, region: true, businessUnit: true, meeting: { select: { sources: { select: { source: true }, take: 1 } } } },
      orderBy: { meeting: { heldAt: 'desc' } },
      take: 1000,
    });
    const seen = new Set<string>();
    for (const a of attendees) {
      const ref = lower(a.email) ?? `name:${lower(a.name)}`;
      if (!a.name?.trim() || seen.has(ref) || (a.email && contactEmails.has(lower(a.email)))) continue;
      seen.add(ref);
      const src = (a.meeting.sources[0]?.source as OrgChartSource | undefined) ?? 'abc';
      candidates.push({
        key: `${src}:${ref}`,
        contactId: null,
        externalRef: ref.slice(0, 160),
        source: src === 'metis' ? 'metis' : 'abc',
        name: a.name.trim().slice(0, 200),
        title: a.title,
        seniority: a.seniority !== 'unknown' ? a.seniority : nodeSeniorityFromTitle(a.title),
        function: fnOf(a.title),
        businessUnit: a.businessUnit,
        region: a.region,
        reportsToContactId: null,
      });
    }
  }

  let apollo: SeedResult['apollo'] = 'skipped';
  if (job.includeApollo) {
    const provider = deps.providers.find((p) => p.id === 'apollo' && p.searchPeople);
    if (!provider?.searchPeople || !provider.configured()) apollo = 'not_configured';
    else if ((await creditsUsedThisMonth(orgId, 'apollo', now)) >= deps.config.monthlyBudget.apollo) apollo = 'budget_exceeded';
    else {
      const firmo = await prisma.companyFirmographics.findFirst({ where: { orgId, companyId }, select: { providerIds: true } });
      const providerCompanyId = (firmo?.providerIds as Record<string, unknown> | undefined)?.apollo;
      const res = await provider.searchPeople(
        { domain: company.domain, providerCompanyId: typeof providerCompanyId === 'string' ? providerCompanyId : null },
        {
          reserve: (operation, credits) =>
            reserveCredits({ orgId, provider: 'apollo', operation, credits, companyId, budget: deps.config.monthlyBudget.apollo, now }),
        },
      );
      apollo = res.status;
      const titles = new Set(contacts.map((c) => `${lower(c.name)?.split(' ')[0]}|${lower(c.role)}`));
      for (const p of res.people) {
        if (titles.has(`${lower(p.name)?.split(' ')[0]}|${lower(p.title)}`)) continue; // already a CRM contact
        candidates.push({
          key: `apollo:${p.externalId}`,
          contactId: null,
          externalRef: p.externalId.slice(0, 160),
          source: 'apollo',
          name: p.name,
          title: p.title,
          seniority: nodeSeniorityFromTitle(p.title),
          function: fnOf(p.title),
          businessUnit: null,
          region: null,
          reportsToContactId: null,
        });
      }
    }
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orgchart:${companyId}`}))`;
      const chart =
        (await tx.orgChart.findFirst({ where: { orgId, companyId } })) ??
        (await tx.orgChart.create({ data: { orgId, companyId, createdById: job.requestedById ?? null } }));
      const existing = await tx.orgChartNode.findMany({
        where: { orgId, chartId: chart.id, deletedAt: null },
        select: { id: true, parentId: true, contactId: true, source: true, externalRef: true, seniority: true, function: true, title: true },
        take: ORG_CHART_MAX_NODES,
      });
      const haveContact = new Set(existing.map((e) => e.contactId).filter(Boolean));
      const haveRef = new Set(existing.filter((e) => e.externalRef).map((e) => `${e.source}:${e.externalRef}`));
      const fresh = candidates.filter((c) => (c.contactId ? !haveContact.has(c.contactId) : !haveRef.has(`${c.source}:${c.externalRef}`)));
      const room = Math.max(0, ORG_CHART_MAX_NODES - existing.length);
      const skipped = candidates.length - fresh.length;
      // Most senior first so managers exist before their reports.
      const ordered = fresh
        .map((c, i) => ({ c, i }))
        .sort((a, b) => seniorityRank(a.c.seniority) - seniorityRank(b.c.seniority) || a.i - b.i)
        .map((x) => x.c);

      const at = now.toISOString();
      const prov = (c: SeedCandidate, fields: string[]) => Object.fromEntries(fields.map((f) => [f, { source: c.source, at, byUserId: null }]));
      const rows: Prisma.OrgChartNodeCreateManyInput[] = [];
      let root: SeedResult['root'];
      let rootId = existing.find((e) => e.parentId === null)?.id ?? null;
      if (rootId) root = 'existing';
      else {
        const best = ordered.map((c) => ({ c, s: ceoScore(c.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
        rootId = randomUUID();
        if (best) {
          ordered.splice(ordered.indexOf(best.c), 1);
          rows.push(nodeRow(best.c, rootId, null, 'root'));
          root = 'candidate';
        } else {
          rows.push({
            id: rootId,
            orgId,
            chartId: chart.id,
            kind: 'placeholder',
            name: 'Chief Executive Officer',
            title: 'Chief Executive Officer',
            seniority: 'c_level',
            source: 'seed',
            placement: 'root',
            provenance: { name: { source: 'seed', at, byUserId: null } },
            createdById: job.requestedById ?? null,
          });
          root = 'placeholder';
        }
      }

      function nodeRow(c: SeedCandidate, id: string, parentId: string | null, placement: string): Prisma.OrgChartNodeCreateManyInput {
        return {
          id,
          orgId,
          chartId: chart.id,
          parentId,
          contactId: c.contactId,
          kind: c.contactId ? 'contact' : 'placeholder',
          name: c.name,
          title: c.title,
          seniority: c.seniority,
          function: c.function,
          businessUnit: c.businessUnit,
          region: c.region,
          source: c.source,
          externalRef: c.externalRef,
          placement,
          provenance: prov(c, ['name', 'title', 'seniority', 'parentId']),
          createdById: job.requestedById ?? null,
        };
      }

      const placed = [
        ...existing.map((e) => ({ id: e.id, seniority: e.seniority, function: e.function })),
        ...rows.map((r) => ({ id: r.id!, seniority: r.seniority as SeniorityLevel, function: (r.function as string | null) ?? null })),
      ];
      const nodeByContact = new Map<string, string>(existing.filter((e) => e.contactId).map((e) => [e.contactId!, e.id]));
      for (const r of rows) if (r.contactId) nodeByContact.set(r.contactId, r.id!);
      const ids = new Map<SeedCandidate, string>(ordered.map((c) => [c, randomUUID()]));
      for (const c of ordered) if (c.contactId) nodeByContact.set(c.contactId, ids.get(c)!);
      const parentOf = new Map<string, string | null>([...existing.map((e) => [e.id, e.parentId] as const), ...rows.map((r) => [r.id!, r.parentId ?? null] as const)]);

      const toPlace = ordered.slice(0, Math.max(0, room - rows.length));
      // Provisional parent: the root, so reports-to links can point at later rows.
      for (const c of toPlace) parentOf.set(ids.get(c)!, rootId);
      const placements = new Map<SeedCandidate, { parentId: string; placement: string }>();
      for (const c of toPlace) {
        const id = ids.get(c)!;
        const mgr = c.reportsToContactId ? nodeByContact.get(c.reportsToContactId) : undefined;
        if (mgr && parentOf.has(mgr) && mgr !== id && !wouldCreateCycle(parentOf, id, mgr)) {
          parentOf.set(id, mgr);
          placements.set(c, { parentId: mgr, placement: 'reports_to' });
        } else {
          const p = inferParent(c, placed, rootId);
          placements.set(c, { parentId: p, placement: 'inferred' });
          parentOf.set(id, p);
        }
        placed.push({ id, seniority: c.seniority, function: c.function });
      }
      for (const c of toPlace) {
        const pl = placements.get(c)!;
        rows.push(nodeRow(c, ids.get(c)!, pl.parentId, pl.placement));
      }
      // Insert parents before children (FK on parent_id).
      const pending = [...rows];
      const inserted = new Set(existing.map((e) => e.id));
      const batches: Prisma.OrgChartNodeCreateManyInput[][] = [];
      while (pending.length) {
        const ready = pending.filter((r) => !r.parentId || inserted.has(r.parentId));
        if (!ready.length) throw new Error('org chart seed: unresolved parent');
        for (const r of ready) {
          inserted.add(r.id!);
          pending.splice(pending.indexOf(r), 1);
        }
        batches.push(ready);
      }
      for (const b of batches) await tx.orgChartNode.createMany({ data: b });
      let chartVersion = chart.version;
      if (rows.length) chartVersion = (await tx.orgChart.update({ where: { id: chart.id }, data: { version: { increment: 1 } }, select: { version: true } })).version;
      const result: SeedResult = { status: 'ok', created: rows.length, skipped: skipped + (ordered.length - toPlace.length), root, apollo, chartVersion };
      await tx.auditLog.create({
        data: {
          orgId,
          userId: job.requestedById ?? null,
          action: 'orgchart.seed',
          targetType: 'company',
          targetId: companyId,
          diff: { ...result, includeApollo: job.includeApollo, includeMeetingAttendees: job.includeMeetingAttendees, candidates: candidates.length },
        },
      });
      return result;
    },
    { timeout: 30_000 },
  );
}
