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
]);

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

  if (Object.prototype.hasOwnProperty.call(where, 'orgId')) {
    return true;
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

export function makeTenantScopeGuardMiddleware(
  options: TenantScopeGuardOptions = {},
): Prisma.Middleware {
  const mode = options.mode ?? getTenantScopeGuardMode();

  return async (params, next) => {
    if (mode === 'off' || !params.model || !GUARDED_ACTIONS.has(params.action)) {
      return next(params);
    }

    if (!getTenantScopedModels().has(params.model)) {
      return next(params);
    }

    if (whereHasTenantScope(params.args?.where)) {
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
