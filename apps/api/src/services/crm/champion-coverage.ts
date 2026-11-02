// How many accounts in the current view have no accepted champion.
// A champion is an accepted buying-role fact on a deal whose company id is
// that account, held by a contact whose company id is the same account.
// A matching customer string is not a link. A contact with no company id
// does not fill the role. Proposed and dismissed facts do not either.
import { Prisma, type PrismaClient } from '@bidstack/db';

import type { AccessScope } from '../../lib/access-scope.js';
import { opportunityVisibilitySql } from './dashboard.queries.js';
import { isCompanyUuid } from './dashboard.utils.js';

export interface ChampionCoverageFact {
  status: string;
  kind: string;
  linkLabel: string | null;
  opportunityCompanyId: string | null;
  contactCompanyId: string | null;
  /** Ignored. A customer name must not decide the company. */
  customer?: string | null;
}

export interface ChampionCoverage {
  accounts: number;
  missing: number;
}

interface ChampionFactRow {
  status: unknown;
  kind: unknown;
  linkLabel: unknown;
  opportunityCompanyId: unknown;
  contactCompanyId: unknown;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Company id an accepted champion covers. Anything else covers nobody. */
export function acceptedChampionAccountId(fact: ChampionCoverageFact): string | null {
  if (fact.kind !== 'buying_role' || fact.status !== 'accepted') return null;
  if ((fact.linkLabel ?? '').trim().toLowerCase() !== 'champion') return null;
  const dealCompany = fact.opportunityCompanyId?.trim() ?? '';
  const contactCompany = fact.contactCompanyId?.trim() ?? '';
  if (!isCompanyUuid(dealCompany) || !isCompanyUuid(contactCompany)) return null;
  if (dealCompany.toLowerCase() !== contactCompany.toLowerCase()) return null;
  return dealCompany.toLowerCase();
}

function uniqueAccountIds(accountIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of accountIds) {
    const id = raw.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

/**
 * Accounts in the set with no accepted champion.
 * Covered ids come only from acceptedChampionAccountId.
 */
export function accountsMissingAcceptedChampion(
  accountIds: readonly string[],
  facts: readonly ChampionCoverageFact[],
): number {
  const covered = new Set(
    facts
      .map((fact) => acceptedChampionAccountId(fact))
      .filter((id): id is string => id !== null),
  );
  let missing = 0;
  for (const id of uniqueAccountIds(accountIds)) {
    if (!covered.has(id.toLowerCase())) missing += 1;
  }
  return missing;
}

/** Buying-role facts on deals linked to the view's companies. No customer match. */
export function championFactQuery(
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Prisma.Sql | null {
  const uuids = uniqueAccountIds(companyIds).filter((id) => isCompanyUuid(id));
  if (uuids.length === 0) return null;
  const visibility = opportunityVisibilitySql(scope);
  return Prisma.sql`
    SELECT
      f.status::text AS "status",
      f.kind::text AS "kind",
      f.link_label AS "linkLabel",
      o.company_id::text AS "opportunityCompanyId",
      c.company_id::text AS "contactCompanyId"
    FROM contact_facts f
    INNER JOIN opportunities o
      ON o.id = f.opportunity_id
     AND o.org_id = f.org_id
     AND o.deleted_at IS NULL
    INNER JOIN contacts c
      ON c.id = f.contact_id
     AND c.org_id = f.org_id
     AND c.deleted_at IS NULL
    ${visibility.join}
    WHERE f.org_id = ${orgId}::uuid
      AND f.deleted_at IS NULL
      AND f.kind::text = 'buying_role'
      AND o.company_id IN (${Prisma.join(uuids.map((id) => Prisma.sql`${id}::uuid`))})
      ${visibility.where}
  `;
}

function factFromRow(row: ChampionFactRow): ChampionCoverageFact {
  return {
    status: textOrNull(row.status) ?? '',
    kind: textOrNull(row.kind) ?? '',
    linkLabel: textOrNull(row.linkLabel),
    opportunityCompanyId: textOrNull(row.opportunityCompanyId),
    contactCompanyId: textOrNull(row.contactCompanyId),
  };
}

export async function fetchChampionCoverage(
  db: Pick<PrismaClient, '$queryRaw'>,
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Promise<ChampionCoverage> {
  const ids = uniqueAccountIds(companyIds);
  const query = championFactQuery(orgId, ids, scope);
  const rows = query ? await db.$queryRaw<ChampionFactRow[]>(query) : [];
  return {
    accounts: ids.length,
    missing: accountsMissingAcceptedChampion(ids, rows.map(factFromRow)),
  };
}
