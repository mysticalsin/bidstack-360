/**
 * Prisma middleware — auto-encrypt / auto-decrypt PII fields.
 *
 * WHY: Centralising encryption in the DB layer means every caller (API routes,
 * workers, scripts) gets PII protection without changes to business logic.
 *
 * Activation: set PII_FIELD_ENCRYPTION=true in the environment.
 * Default is false for backward compatibility with existing plaintext data.
 * Run `scripts/encrypt-existing-pii.ts` BEFORE flipping the flag.
 *
 * PII field map (write-side fields encrypted; read-side fields decrypted):
 *   Contact       : email, phone
 *   Lead          : email, phone
 *   KamConsultant : email
 *
 * Hash columns (for equality search without decryption):
 *   Contact.emailHash, Lead.emailHash, KamConsultant.emailHash
 *
 * User.email is intentionally excluded until the schema has a generated
 * User.emailHash migration and every auth/assignment lookup is hash-aware.
 */

import {
  decryptPiiField,
  encryptPiiField,
  hashPiiField,
  isEncrypted,
  type PiiFieldType,
} from '@bidstack/shared/crypto/pii-field-cipher';
import type { Prisma } from '../../generated/client/index.js';

// ----- Config ---------------------------------------------------------------

/**
 * Returns `true` when PII field encryption is active.
 *
 * Controlled by the `PII_FIELD_ENCRYPTION=true` environment variable.
 * Default is `false` for backward compatibility with existing plaintext data.
 * Run `scripts/encrypt-existing-pii.ts` before enabling in production.
 *
 * @returns `true` if `PII_FIELD_ENCRYPTION=true`, `false` otherwise.
 */
export function isPiiEncryptionEnabled(): boolean {
  return process.env.PII_FIELD_ENCRYPTION === 'true';
}

// ----- Field map ------------------------------------------------------------

type ModelPiiConfig = {
  fields: Array<{ name: string; type: PiiFieldType }>;
  /** Which field drives the emailHash column, if any */
  hashField?: { source: string; hashColumn: string };
};

const PII_MAP: Record<string, ModelPiiConfig> = {
  contact: {
    fields: [
      { name: 'email', type: 'email' },
      { name: 'phone', type: 'phone' },
    ],
    hashField: { source: 'email', hashColumn: 'emailHash' },
  },
  lead: {
    fields: [
      { name: 'email', type: 'email' },
      { name: 'phone', type: 'phone' },
    ],
    hashField: { source: 'email', hashColumn: 'emailHash' },
  },
  // KAM consultant email is encrypted + hashed like Contact/Lead. NOTE:
  // KamSession.transcriptText and KamSession.attendees[] are intentionally NOT
  // encrypted here (free text / string[] are outside this middleware's scalar
  // scope); they are plaintext PII at rest, access-scoped + audited, and the
  // transcript is the AI input by design. See docs/solutions/kam-pii.md.
  kamconsultant: {
    fields: [{ name: 'email', type: 'email' }],
    hashField: { source: 'email', hashColumn: 'emailHash' },
  },
};

// ----- Write-side helpers ---------------------------------------------------

/**
 * Encrypt PII fields in a data payload.
 * The `orgId` MUST be present in the payload for new records.
 * For updates we accept it via a separate `orgIdOverride` parameter extracted
 * from the WHERE clause by the middleware below.
 */
function encryptPayload(
  model: string,
  data: Record<string, unknown>,
  orgId: string,
): Record<string, unknown> {
  const config = PII_MAP[model.toLowerCase()];
  if (!config) return data;

  const result = { ...data };

  for (const { name } of config.fields) {
    const val = result[name];
    if (config.hashField?.source === name && (val === null || val === '')) {
      result[config.hashField.hashColumn] = null;
    }
    if (typeof val === 'string' && val.length > 0 && !isEncrypted(val)) {
      if (config.hashField?.source === name) {
        result[config.hashField.hashColumn] = hashPiiField(val, orgId);
      }
      result[name] = encryptPiiField(val, orgId);
    }
  }

  return result;
}

/**
 * Returns true when `data` carries at least one non-empty, not-yet-encrypted PII
 * value for `model`. Used to decide whether an unresolved orgId is fatal
 * (would persist plaintext) or harmless (a non-PII write).
 */
function hasPlaintextPii(model: string, data: Record<string, unknown>): boolean {
  const config = PII_MAP[model.toLowerCase()];
  if (!config) return false;
  return config.fields.some(({ name }) => {
    const val = data[name];
    return typeof val === 'string' && val.length > 0 && !isEncrypted(val);
  });
}

/**
 * Encrypt one write payload, failing LOUD when orgId cannot be resolved AND the
 * payload actually contains plaintext PII.
 *
 * WHY: the prior code silently skipped encryption whenever orgId was absent — so
 * a bulk `createMany` (whose `data` is an array, defeating the single-object
 * orgId extraction) wrote email/phone in cleartext with no error. Skipping a PII
 * write must never be silent; throw so the offending call site is fixed instead.
 */
function encryptWritePayload(
  model: string,
  data: Record<string, unknown>,
  orgId: string | null,
  ctx: string,
): Record<string, unknown> {
  if (orgId) return encryptPayload(model, data, orgId);
  if (hasPlaintextPii(model, data)) {
    throw new Error(
      `[pii-encryption] Refusing to write ${model} (${ctx}) with plaintext PII but no resolvable orgId — ` +
        'this would persist cleartext. Include orgId in the data/where clause.',
    );
  }
  return data;
}

// ----- Read-side helpers ----------------------------------------------------

function decryptRecord(
  model: string,
  record: Record<string, unknown>,
  orgId: string | null,
): Record<string, unknown> {
  const config = PII_MAP[model.toLowerCase()];
  if (!config) return record;

  const result = { ...record };
  // Prefer the row's OWN orgId over the query-extracted one: the query value
  // can name a different org than the row (e.g. harvested from an unrelated
  // where branch), and decrypting with the wrong org's key does not fail — it
  // silently returns mask strings. The row itself is the authoritative record
  // of which org's key sealed its fields.
  const rowOrgId = typeof result.orgId === 'string' ? result.orgId : null;
  const recordOrgId = rowOrgId ?? orgId;

  for (const { name, type } of config.fields) {
    const val = result[name];
    if (typeof val === 'string' && isEncrypted(val)) {
      if (!recordOrgId) {
        throw new Error(
          `[pii-encryption] Refusing to return encrypted ${model}.${name} without orgId for decryption. ` +
            'Include orgId in the where clause or selected row.',
        );
      }
      result[name] = decryptPiiField(val, recordOrgId, type);
    }
  }

  return result;
}

function decryptResult(model: string, result: unknown, orgId: string | null): unknown {
  if (!result) return result;

  if (Array.isArray(result)) {
    return result.map((item) =>
      typeof item === 'object' && item !== null
        ? decryptRecord(model, item as Record<string, unknown>, orgId)
        : item,
    );
  }

  if (typeof result === 'object') {
    return decryptRecord(model, result as Record<string, unknown>, orgId);
  }

  return result;
}

// ----- Search-side helpers --------------------------------------------------

function rewriteEmailFiltersForHash(
  model: string,
  args: Record<string, unknown> | undefined,
): void {
  const config = PII_MAP[model.toLowerCase()];
  if (!config?.hashField || !args) return;

  const where = args.where;
  if (!where || typeof where !== 'object' || Array.isArray(where)) return;

  args.where = rewriteWhereObject(
    model,
    where as Record<string, unknown>,
    extractOrgId(args),
    config.hashField,
  );
}

function rewriteWhereObject(
  model: string,
  where: Record<string, unknown>,
  inheritedOrgId: string | null,
  hashField: { source: string; hashColumn: string },
): Record<string, unknown> {
  const result = { ...where };
  const orgId = typeof result.orgId === 'string' ? result.orgId : inheritedOrgId;

  for (const key of ['AND', 'OR', 'NOT']) {
    if (key in result) {
      result[key] = rewriteLogicalFilter(model, result[key], orgId, hashField);
    }
  }

  if (Object.prototype.hasOwnProperty.call(result, hashField.source)) {
    if (Object.prototype.hasOwnProperty.call(result, hashField.hashColumn)) {
      throw new Error(
        `[pii-encryption] Refusing to query ${model} with both ${hashField.source} and ${hashField.hashColumn}.`,
      );
    }
    if (!orgId) {
      throw new Error(
        `[pii-encryption] Refusing to query encrypted ${model}.${hashField.source} without orgId. ` +
          `Query by ${hashField.hashColumn} directly or include orgId.`,
      );
    }
    result[hashField.hashColumn] = rewriteEmailFilterValue(model, result[hashField.source], orgId);
    delete result[hashField.source];
  }

  return result;
}

function rewriteLogicalFilter(
  model: string,
  value: unknown,
  inheritedOrgId: string | null,
  hashField: { source: string; hashColumn: string },
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? rewriteWhereObject(model, item as Record<string, unknown>, inheritedOrgId, hashField)
        : item,
    );
  }

  if (value && typeof value === 'object') {
    return rewriteWhereObject(model, value as Record<string, unknown>, inheritedOrgId, hashField);
  }

  return value;
}

function rewriteEmailFilterValue(model: string, value: unknown, orgId: string): unknown {
  if (typeof value === 'string') return hashPiiField(value, orgId);
  if (value === null) return null;

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[pii-encryption] Unsupported ${model}.email filter for encrypted lookup.`);
  }

  const filter = value as Record<string, unknown>;
  const supported = new Set(['equals', 'in', 'not', 'notIn', 'mode']);
  const unsupported = Object.keys(filter).filter((key) => !supported.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      `[pii-encryption] Unsupported ${model}.email encrypted lookup operator(s): ${unsupported.join(
        ', ',
      )}. Use equality/in filters so the emailHash index can be used.`,
    );
  }

  const result: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(filter, 'equals')) {
    result.equals = rewriteEmailFilterScalar(model, filter.equals, orgId);
  }
  if (Object.prototype.hasOwnProperty.call(filter, 'in')) {
    result.in = rewriteEmailFilterArray(model, filter.in, orgId);
  }
  if (Object.prototype.hasOwnProperty.call(filter, 'notIn')) {
    result.notIn = rewriteEmailFilterArray(model, filter.notIn, orgId);
  }
  if (Object.prototype.hasOwnProperty.call(filter, 'not')) {
    result.not = rewriteEmailFilterScalar(model, filter.not, orgId);
  }

  return result;
}

function rewriteEmailFilterScalar(model: string, value: unknown, orgId: string): string | null {
  if (typeof value === 'string') return hashPiiField(value, orgId);
  if (value === null) return null;
  throw new Error(`[pii-encryption] Unsupported ${model}.email encrypted lookup scalar.`);
}

function rewriteEmailFilterArray(
  model: string,
  value: unknown,
  orgId: string,
): Array<string | null> {
  if (!Array.isArray(value)) {
    throw new Error(`[pii-encryption] Unsupported ${model}.email encrypted lookup array.`);
  }
  return value.map((item) => rewriteEmailFilterScalar(model, item, orgId));
}

// ----- Middleware factory ----------------------------------------------------

/**
 * Returns a Prisma middleware function that auto-encrypts on write
 * and auto-decrypts on read, gated by PII_FIELD_ENCRYPTION=true.
 *
 * Usage:
 *   prisma.$use(makePiiMiddleware());
 *
 * NOTE: Prisma $use() middleware is deprecated in Prisma 5 in favour of
 * $extends(). This module exports both patterns:
 * - makePiiMiddleware() for legacy $use()
 * - makePiiExtension() for the modern $extends() query extension
 */
export function makePiiMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    if (!isPiiEncryptionEnabled()) return next(params);
    if (!params.model) return next(params);

    const model = params.model.toLowerCase();
    if (!PII_MAP[model]) return next(params);

    rewriteEmailFiltersForHash(model, params.args as Record<string, unknown> | undefined);

    // ----- Write path -------------------------------------------------------
    const writeMutations = ['create', 'update', 'upsert', 'createMany', 'updateMany'];
    if (writeMutations.includes(params.action)) {
      if (params.action === 'upsert') {
        const whereOrg = extractOrgId(params.args);
        const create = params.args?.create as Record<string, unknown> | undefined;
        const update = params.args?.update as Record<string, unknown> | undefined;
        if (create) {
          const orgId = typeof create.orgId === 'string' ? create.orgId : whereOrg;
          params.args.create = encryptWritePayload(model, create, orgId, 'upsert.create');
        }
        if (update) {
          params.args.update = encryptWritePayload(model, update, whereOrg, 'upsert.update');
        }
      } else if (params.action === 'createMany') {
        // createMany passes `data` as an ARRAY (or, rarely, a single object).
        // Each row carries its own orgId — the WHERE-clause fallback used by
        // single-row writes does not exist here. Reading `data` as one object
        // (the prior bug) made extractOrgId return null and silently SKIPPED
        // encryption, persisting PII in plaintext on the highest-volume path.
        const rows = params.args?.data;
        if (Array.isArray(rows)) {
          params.args.data = rows.map((row, i) => {
            const record = row as Record<string, unknown>;
            const orgId = typeof record.orgId === 'string' ? record.orgId : null;
            return encryptWritePayload(model, record, orgId, `createMany[${i}]`);
          });
        } else if (rows && typeof rows === 'object') {
          const record = rows as Record<string, unknown>;
          const orgId = typeof record.orgId === 'string' ? record.orgId : extractOrgId(params.args);
          params.args.data = encryptWritePayload(model, record, orgId, 'createMany');
        }
      } else if (params.args?.data) {
        const orgId = extractOrgId(params.args);
        params.args.data = encryptWritePayload(
          model,
          params.args.data as Record<string, unknown>,
          orgId,
          params.action,
        );
      }
    }

    const result = await next(params);

    // ----- Read path --------------------------------------------------------
    const readActions = [
      'findUnique',
      'findFirst',
      'findMany',
      'findUniqueOrThrow',
      'findFirstOrThrow',
    ];
    if (readActions.includes(params.action) && result) {
      const orgId = extractOrgId(params.args);
      return decryptResult(model, result, orgId);
    }

    return result;
  };
}

// ----- Org ID extraction ---------------------------------------------------

/**
 * Pull orgId from various positions Prisma can place it.
 * Callers that pass orgId in WHERE (standard in this codebase) will always
 * yield a value. Edge cases (raw queries, nested creates) do not go through
 * this middleware at all.
 */
function extractOrgId(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;

  // Direct data.orgId (create)
  const data = args.data as Record<string, unknown> | undefined;
  if (typeof data?.orgId === 'string') return data.orgId;

  // WHERE clause (update / findMany)
  const where = args.where as Record<string, unknown> | undefined;
  if (typeof where?.orgId === 'string') return where.orgId;

  const nestedOrgIds = new Set<string>();
  collectOrgIds(where, nestedOrgIds);
  if (nestedOrgIds.size === 1) return [...nestedOrgIds][0]!;

  return null;
}

function collectOrgIds(value: unknown, orgIds: Set<string>): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectOrgIds(item, orgIds);
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.orgId === 'string') orgIds.add(record.orgId);

  // NOT is deliberately excluded: an orgId inside a NOT branch names the org
  // the results are NOT from, so using it as decryption context would apply
  // the wrong org's key (which silently yields mask strings, not an error).
  for (const key of ['AND', 'OR']) {
    collectOrgIds(record[key], orgIds);
  }
}
