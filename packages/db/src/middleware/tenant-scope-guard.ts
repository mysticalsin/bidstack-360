import { Prisma } from '../../generated/client/index.js';

export type TenantScopeGuardMode = 'off' | 'warn' | 'enforce';

type TenantScopeGuardOptions = {
  mode?: TenantScopeGuardMode;
  onViolation?: (message: string, params: Prisma.MiddlewareParams) => void;
};

const GUARDED_ACTIONS = new Set([
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  // findFirst accepts an arbitrary `where` (same shape as findMany), so the
  // same full enforcement semantics apply unchanged — it can silently scan
  // every org's rows just like an unscoped findMany.
  'findFirst',
  // findFirstOrThrow takes the identical arbitrary `where` as findFirst —
  // throwing on a miss changes nothing about an unscoped HIT reading across
  // orgs, so it gets the same full enforcement.
  'findFirstOrThrow',
]);

// Prisma requires a unique `where` for these ops, and `orgId` is usually not
// part of the unique key (e.g. `findUnique({ where: { id } })`), so full
// enforcement would false-positive on the repo's legitimate pattern: fetch by
// unique key, then verify org ownership on the loaded row (see
// `tenantEntitiesBelongToOrg`). We never throw for these, even in enforce
// mode — only report, so decision D2 (DB-level RLS vs AsyncLocalStorage
// backstop) can be made from real data on how often this path is hit
// unscoped.
const REPORT_ONLY_ACTIONS = new Set([
  'findUnique',
  // findUniqueOrThrow takes the same unique-key `where` as findUnique, so the
  // same fetch-by-unique-key-then-verify-org pattern (and the same
  // false-positive risk under full enforcement) applies.
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

// createMany is a data-shape (row payload) concern, not a where-shape concern
// — there's no `where` to inspect, so it's out of scope for this guard.

let tenantScopedModelsCache: Set<string> | null = null;

export function getTenantScopeGuardMode(): TenantScopeGuardMode {
  const value = String(process.env.BIDSTACK_TENANT_SCOPE_GUARD ?? 'off')
    .trim()
    .toLowerCase();
  if (value === 'warn' || value === 'enforce') {
    return value;
  }
  return 'off';
}

function getTenantScopedModels(): Set<string> {
  if (!tenantScopedModelsCache) {
    tenantScopedModelsCache = new Set();
    for (const model of Prisma.dmmf.datamodel.models) {
      if (model.fields.some((field) => field.name === 'orgId')) {
        tenantScopedModelsCache.add(model.name);
      }
    }
  }
  return tenantScopedModelsCache;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function logicalValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

export function whereHasTenantScope(where: unknown): boolean {
  if (!isPlainRecord(where)) {
    return false;
  }

  // `orgId: undefined` must NOT count as scoped: Prisma silently strips keys
  // whose value is `undefined` before building the SQL WHERE clause, so
  // `{ orgId: undefined }` compiles to no orgId filter at all — the exact
  // all-tenants leak this guard exists to catch. Only a defined orgId counts.
  if (Object.prototype.hasOwnProperty.call(where, 'orgId') && where.orgId !== undefined) {
    return true;
  }

  // Composite-unique where clauses (findUnique/update/delete/upsert on a
  // `@@unique([orgId, ...])` key) nest orgId inside a synthetic key named
  // after the joined field names, e.g.
  // `where: { orgId_userId_provider: { orgId, userId, provider } }`. Prisma
  // client field names never contain `_` themselves, so splitting the key on
  // `_` reliably recovers the individual field names. Same undefined-orgId
  // rejection applies as above.
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR') {
      continue;
    }
    if (
      key.split('_').includes('orgId') &&
      isPlainRecord(value) &&
      Object.prototype.hasOwnProperty.call(value, 'orgId') &&
      value.orgId !== undefined
    ) {
      return true;
    }
  }

  const andValues = logicalValues(where.AND);
  if (andValues.some((item) => whereHasTenantScope(item))) {
    return true;
  }

  const orValues = logicalValues(where.OR);
  if (orValues.length > 0) {
    return orValues.every((item) => whereHasTenantScope(item));
  }

  return false;
}

function violationMessage(params: Prisma.MiddlewareParams): string {
  return `[tenant-scope-guard] ${params.model}.${params.action} must include orgId in where before querying tenant data.`;
}

// Distinct prefix/wording from violationMessage on purpose — this is a
// telemetry signal for D2, not an enforced rule, and must read as such in
// logs so it isn't mistaken for a blocked-enforce-mode violation.
function reportOnlyMessage(params: Prisma.MiddlewareParams): string {
  return `[tenant-scope-guard][report-only] ${params.model}.${params.action} queried tenant data by unique key without orgId — verify caller did an org-scoped fetch first.`;
}

export function makeTenantScopeGuardMiddleware(
  options: TenantScopeGuardOptions = {},
): Prisma.Middleware {
  const mode = options.mode ?? getTenantScopeGuardMode();

  return async (params, next) => {
    const isReportOnly = REPORT_ONLY_ACTIONS.has(params.action);
    const isGuarded = GUARDED_ACTIONS.has(params.action);
    if (mode === 'off' || !params.model || (!isGuarded && !isReportOnly)) {
      return next(params);
    }

    if (!getTenantScopedModels().has(params.model)) {
      return next(params);
    }

    if (whereHasTenantScope(params.args?.where)) {
      return next(params);
    }

    if (isReportOnly) {
      const reportMessage = reportOnlyMessage(params);
      if (options.onViolation) {
        options.onViolation(reportMessage, params);
      } else {
        process.emitWarning(reportMessage, { type: 'TenantScopeGuardReport' });
      }
      return next(params);
    }

    const message = violationMessage(params);
    if (mode === 'enforce') {
      throw new Error(message);
    }

    if (options.onViolation) {
      options.onViolation(message, params);
    } else {
      process.emitWarning(message, { type: 'TenantScopeGuardWarning' });
    }

    return next(params);
  };
}
