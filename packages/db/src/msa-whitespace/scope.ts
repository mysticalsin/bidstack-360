// Company visibility for the whitespace and relationship-map agent tools
// (slice 13b). Mirrors apps/api access-scope: API keys see their company
// allowlist; users in country-scoped groups see accounts they own, accounts
// with an opportunity they own or in their countries, and accounts based in
// their countries. Users with no group, or a scope-all group, see the org.
import type { Prisma, PrismaClient } from '../../generated/client/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENY_ALL: Prisma.CompanyWhereInput = { id: { in: [] } };

export interface ScopeActor {
  orgId: string;
  userId?: string | null;
  /** MCP passes its API-key id on the context object. */
  keyId?: string | null;
}

export async function companyScopeWhere(db: PrismaClient, actor: ScopeActor): Promise<Prisma.CompanyWhereInput> {
  const base: Prisma.CompanyWhereInput = { orgId: actor.orgId, deletedAt: null };
  const keyId = actor.keyId ?? (actor.userId?.startsWith('apikey:') ? actor.userId.slice('apikey:'.length) : null);
  if (keyId) {
    const key = await db.apiKey.findFirst({
      where: { id: keyId, orgId: actor.orgId, revokedAt: null, deletedAt: null },
      select: { unrestrictedScope: true, companyIds: true },
    });
    if (!key) return { AND: [base, DENY_ALL] };
    return key.unrestrictedScope ? base : { AND: [base, { id: { in: key.companyIds } }] };
  }
  if (!actor.userId || !UUID_RE.test(actor.userId)) return { AND: [base, DENY_ALL] };
  const memberships = await db.userGroupMember.findMany({
    where: { orgId: actor.orgId, userId: actor.userId, group: { deletedAt: null } },
    select: { group: { select: { scopeAll: true, scopeCountries: true } } },
    take: 200,
  });
  if (memberships.length === 0 || memberships.some((m) => m.group.scopeAll)) return base;
  const countries = [...new Set(memberships.flatMap((m) => m.group.scopeCountries))];
  const variants = [...new Set(countries.flatMap((c) => [c.toUpperCase(), c.toLowerCase()]))];
  const oppClauses: Prisma.OpportunityWhereInput[] = [{ ownerId: actor.userId }];
  if (variants.length) {
    oppClauses.unshift({ territory: { countryCodes: { hasSome: variants } } });
    oppClauses.unshift({ country: { in: variants } });
  }
  const clauses: Prisma.CompanyWhereInput[] = [
    { keyAccountOwnerId: actor.userId },
    { opportunities: { some: { deletedAt: null, OR: oppClauses } } },
  ];
  if (variants.length) clauses.unshift({ countryCode: { in: variants } });
  return { AND: [base, { OR: clauses }] };
}
