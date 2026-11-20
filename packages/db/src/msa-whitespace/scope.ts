// Company and opportunity visibility for the whitespace and relationship-map
// agent tools (slice 13b). Mirrors apps/api access-scope: API keys see their
// company allowlist; users in country-scoped groups see accounts they own,
// accounts with an opportunity they own or in their countries, and accounts
// based in their countries, and only the opportunities they own or that sit in
// their countries. Users with no group, or a scope-all group, see the org.
import type { Prisma, PrismaClient } from '../../generated/client/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENY_ALL: Prisma.CompanyWhereInput = { id: { in: [] } };
const DENY_ALL_OPPS: Prisma.OpportunityWhereInput = { id: { in: [] } };

export interface ScopeActor {
  orgId: string;
  userId?: string | null;
  /** MCP passes its API-key id on the context object. */
  keyId?: string | null;
}

type ResolvedScope =
  | { kind: 'all' }
  | { kind: 'deny' }
  | { kind: 'companies'; companyIds: string[] }
  | { kind: 'countries'; userId: string; variants: string[] };

async function resolveScope(db: PrismaClient, actor: ScopeActor): Promise<ResolvedScope> {
  const keyId = actor.keyId ?? (actor.userId?.startsWith('apikey:') ? actor.userId.slice('apikey:'.length) : null);
  if (keyId) {
    const key = await db.apiKey.findFirst({
      where: { id: keyId, orgId: actor.orgId, revokedAt: null, deletedAt: null },
      select: { unrestrictedScope: true, companyIds: true },
    });
    if (!key) return { kind: 'deny' };
    return key.unrestrictedScope ? { kind: 'all' } : { kind: 'companies', companyIds: key.companyIds };
  }
  if (!actor.userId || !UUID_RE.test(actor.userId)) return { kind: 'deny' };
  const memberships = await db.userGroupMember.findMany({
    where: { orgId: actor.orgId, userId: actor.userId, group: { deletedAt: null } },
    select: { group: { select: { scopeAll: true, scopeCountries: true } } },
    take: 200,
  });
  if (memberships.length === 0 || memberships.some((m) => m.group.scopeAll)) return { kind: 'all' };
  const countries = [...new Set(memberships.flatMap((m) => m.group.scopeCountries))];
  const variants = [...new Set(countries.flatMap((c) => [c.toUpperCase(), c.toLowerCase()]))];
  return { kind: 'countries', userId: actor.userId, variants };
}

function visibleOpportunity(userId: string, variants: string[]): Prisma.OpportunityWhereInput {
  const clauses: Prisma.OpportunityWhereInput[] = [{ ownerId: userId }];
  if (variants.length) {
    clauses.unshift({ territory: { countryCodes: { hasSome: variants } } });
    clauses.unshift({ country: { in: variants } });
  }
  return { OR: clauses };
}

export async function companyScopeWhere(db: PrismaClient, actor: ScopeActor): Promise<Prisma.CompanyWhereInput> {
  const base: Prisma.CompanyWhereInput = { orgId: actor.orgId, deletedAt: null };
  const scope = await resolveScope(db, actor);
  if (scope.kind === 'all') return base;
  if (scope.kind === 'deny') return { AND: [base, DENY_ALL] };
  if (scope.kind === 'companies') return { AND: [base, { id: { in: scope.companyIds } }] };
  const clauses: Prisma.CompanyWhereInput[] = [
    { keyAccountOwnerId: scope.userId },
    { opportunities: { some: { deletedAt: null, ...visibleOpportunity(scope.userId, scope.variants) } } },
  ];
  if (scope.variants.length) clauses.unshift({ countryCode: { in: scope.variants } });
  return { AND: [base, { OR: clauses }] };
}

/** The opportunities the actor may see, same rule as apps/api applyOpportunityScope. */
export async function opportunityScopeWhere(db: PrismaClient, actor: ScopeActor): Promise<Prisma.OpportunityWhereInput> {
  const base: Prisma.OpportunityWhereInput = { orgId: actor.orgId };
  const scope = await resolveScope(db, actor);
  if (scope.kind === 'all') return base;
  if (scope.kind === 'deny') return { AND: [base, DENY_ALL_OPPS] };
  if (scope.kind === 'companies') return { AND: [base, { companyId: { in: scope.companyIds } }] };
  return { AND: [base, visibleOpportunity(scope.userId, scope.variants)] };
}
