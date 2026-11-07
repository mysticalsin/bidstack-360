import { prisma as defaultPrisma, Prisma, type PrismaClient } from '@bidstack/db';

import {
  accountOpportunityScopePredicate,
  applyCompanyScope,
  countryVariantsForScope,
  getAccessScope,
  type AccessScope,
} from './access-scope.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AccountAccessInput {
  orgId: string;
  userId: string;
  accountId?: string | null;
  companyId?: string | null;
  accountName?: string | null;
  scope?: AccessScope;
  prismaClient?: PrismaClient;
}

export interface AccountAccessResult {
  allowed: boolean;
  scope: AccessScope;
}

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function normalizeLegacyAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeAccountSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

async function resolveLegacyCompanyIds(
  orgId: string,
  accountKeys: string[],
  prismaClient: PrismaClient,
): Promise<string[]> {
  const slugs = [...new Set(accountKeys.map(normalizeAccountSlug).filter(Boolean))];
  if (slugs.length === 0) return [];

  const rows = await prismaClient.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c.id
    FROM companies c
    WHERE c.org_id = ${orgId}::uuid
      AND c.deleted_at IS NULL
      AND btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'), '-') IN (${Prisma.join(slugs)})
    LIMIT 25
  `);
  return rows.map((row) => row.id);
}

async function hasVisibleLegacyOpportunity(
  orgId: string,
  userId: string,
  accountKeys: string[],
  scope: AccessScope,
  prismaClient: PrismaClient,
): Promise<boolean> {
  const slugs = [...new Set(accountKeys.map(normalizeAccountSlug).filter(Boolean))];
  if (slugs.length === 0) return false;
  const variants = countryVariantsForScope(scope);
  const countryScopeSql =
    variants.length > 0
      ? Prisma.sql`
          o.country = ANY(ARRAY[${Prisma.join(variants)}]::text[])
          OR t.country_codes && ARRAY[${Prisma.join(variants)}]::text[]
          OR`
      : Prisma.empty;

  const rows = await prismaClient.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o.id
    FROM opportunities o
    LEFT JOIN territories t ON t.id = o.territory_id
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND btrim(regexp_replace(lower(o.customer), '[^a-z0-9]+', '-', 'g'), '-') IN (${Prisma.join(slugs)})
      AND (
        ${countryScopeSql}
        o.owner_id = ${userId}::uuid
      )
    LIMIT 1
  `);
  return rows.length > 0;
}

export async function canReadAccount(input: AccountAccessInput): Promise<AccountAccessResult> {
  const prismaClient = input.prismaClient ?? defaultPrisma;
  const scope = input.scope ?? (await getAccessScope(input.orgId, input.userId));
  if (scope.unrestricted) return { allowed: true, scope };

  const accountKeys = uniqueValues([input.accountName, input.accountId]);
  const explicitCompanyId = input.companyId ?? (isUuid(input.accountId) ? input.accountId : null);
  const companyOr: Prisma.CompanyWhereInput[] = [];
  if (explicitCompanyId) companyOr.push({ id: explicitCompanyId });
  for (const value of accountKeys) {
    companyOr.push({ name: { equals: value, mode: 'insensitive' } });
  }

  const legacyCompanyIds = await resolveLegacyCompanyIds(input.orgId, accountKeys, prismaClient);
  if (legacyCompanyIds.length > 0) companyOr.push({ id: { in: legacyCompanyIds } });

  if (companyOr.length > 0) {
    const company = await prismaClient.company.findFirst({
      where: applyCompanyScope(
        {
          orgId: input.orgId,
          deletedAt: null,
          OR: companyOr,
        },
        scope,
      ),
      select: { id: true },
    });
    if (company) return { allowed: true, scope };
  }

  const opportunityOr: Prisma.OpportunityWhereInput[] = [];
  if (explicitCompanyId) opportunityOr.push({ companyId: explicitCompanyId });
  for (const value of accountKeys) {
    opportunityOr.push({ customer: { equals: value, mode: 'insensitive' } });
  }
  const opportunityPredicate = accountOpportunityScopePredicate(scope);
  if (opportunityOr.length > 0 && opportunityPredicate) {
    const opportunity = await prismaClient.opportunity.findFirst({
      where: {
        AND: [
          { orgId: input.orgId, deletedAt: null, OR: opportunityOr },
          opportunityPredicate,
        ],
      },
      select: { id: true },
    });
    if (opportunity) return { allowed: true, scope };
  }
  if (await hasVisibleLegacyOpportunity(input.orgId, input.userId, accountKeys, scope, prismaClient)) {
    return { allowed: true, scope };
  }

  return { allowed: false, scope };
}
