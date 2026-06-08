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

export function makeSoftDeleteMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    const models = getSoftDeleteModels();
    
    if (params.model && models.has(params.model)) {
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
