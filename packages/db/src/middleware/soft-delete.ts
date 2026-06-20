import { Prisma } from '../../generated/client/index.js';

let softDeleteModelsCache: Set<string> | null = null;
let compoundUniqueSelectorsCache: Map<string, Map<string, string[]>> | null = null;

function getSoftDeleteModels(): Set<string> {
  if (!softDeleteModelsCache) {
    softDeleteModelsCache = new Set();
    for (const model of Prisma.dmmf.datamodel.models) {
      if (model.fields.some((f) => f.name === 'deletedAt')) {
        softDeleteModelsCache.add(model.name);
      }
    }
  }
  return softDeleteModelsCache;
}

function getCompoundUniqueSelectors(): Map<string, Map<string, string[]>> {
  if (!compoundUniqueSelectorsCache) {
    compoundUniqueSelectorsCache = new Map();
    for (const model of Prisma.dmmf.datamodel.models) {
      const selectors = new Map<string, string[]>();
      for (const fields of model.uniqueFields) {
        if (fields.length > 1) selectors.set(fields.join('_'), [...fields]);
      }
      for (const index of model.uniqueIndexes) {
        if (index.fields.length <= 1) continue;
        selectors.set(index.name ?? index.fields.join('_'), [...index.fields]);
      }
      if (selectors.size > 0) {
        compoundUniqueSelectorsCache.set(model.name, selectors);
      }
    }
  }
  return compoundUniqueSelectorsCache;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function expandCompoundUniqueWhere(model: string, where: unknown): unknown {
  if (!isPlainRecord(where)) return where;
  const selectors = getCompoundUniqueSelectors().get(model);
  if (!selectors) return where;

  const expanded = { ...where };
  for (const [selector, fields] of selectors) {
    const selectorValue = expanded[selector];
    if (!isPlainRecord(selectorValue)) continue;
    delete expanded[selector];
    for (const field of fields) {
      if (field in selectorValue) {
        expanded[field] = selectorValue[field];
      }
    }
  }
  return expanded;
}

// Inject `deletedAt: null` into args.where unless the caller already filtered on
// deletedAt (the explicit-bypass escape, e.g. a deliberate soft-delete assertion
// or a restore that scopes with `deletedAt: { not: null }`).
function scopeWhereToLiveRows(params: Prisma.MiddlewareParams): void {
  if (params.args?.where?.deletedAt !== undefined) return;
  if (!params.args) {
    params.args = { where: { deletedAt: null } };
  } else if (!params.args.where) {
    params.args.where = { deletedAt: null };
  } else {
    params.args.where.deletedAt = null;
  }
}

export function makeSoftDeleteMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    const models = getSoftDeleteModels();

    if (params.model && models.has(params.model)) {
        // Mutations: an already-soft-deleted row must not be editable or
        // resurrectable. Scope update/updateMany to live rows so a record that
        // was soft-deleted cannot be silently mutated through the back door.
        // (Prisma 5 extendedWhereUnique lets `update` carry a non-unique filter
        // alongside its unique selector, so this is valid for single update too.)
        //
        // delete/deleteMany are intentionally NOT scoped here: hard delete stays
        // the teardown/admin path, and scoping it would strand soft-deleted rows
        // that later collide on (orgId, name)-style unique constraints. Converting
        // hard delete into soft delete is a separate product decision, not a
        // silent middleware change.
        if (params.action === 'update' || params.action === 'updateMany') {
          scopeWhereToLiveRows(params);
        }

        if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
          params.args = {
            ...params.args,
            where: expandCompoundUniqueWhere(params.model, params.args?.where),
          };
          params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
        }

        if (
          params.action === 'findFirst' ||
          params.action === 'findFirstOrThrow' ||
          params.action === 'findMany' ||
          params.action === 'count' ||
          params.action === 'aggregate' ||
          params.action === 'groupBy'
        ) {
        // Allow explicit bypass using a custom parameter (not standard prisma, but useful)
        if (params.args?.where?.deletedAt !== undefined) {
          // If the caller explicitly filtered on deletedAt, respect it
        } else {
          // Otherwise, inject deletedAt: null
          if (!params.args) {
            params.args = { where: { deletedAt: null } };
          } else if (!params.args.where) {
            params.args.where = { deletedAt: null };
          } else {
            params.args.where.deletedAt = null;
          }
        }
      }
    }

    return next(params);
  };
}
