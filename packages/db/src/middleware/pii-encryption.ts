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
 *   Contact : email, phone, mobilePhone
 *   Lead    : email, phone
 *   User    : email — NOTE: auth lookup uses clerkUser (external ID), not email,
 *             so encrypting User.email does NOT break authentication.
 *
 * Hash columns (for equality search without decryption):
 *   Contact.emailHash, Lead.emailHash
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
      { name: 'mobilePhone', type: 'phone' },
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
  user: {
    fields: [{ name: 'email', type: 'email' }],
    // No hash column for User — auth lookup goes via clerkUser, not email
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
    if (typeof val === 'string' && val.length > 0 && !isEncrypted(val)) {
      result[name] = encryptPiiField(val, orgId);
    }
    // Track raw value for hashing before we overwrite
    if (config.hashField?.source === name && typeof val === 'string' && val.length > 0) {
      result[config.hashField.hashColumn] = hashPiiField(
        isEncrypted(val) ? val : val, // plaintext before encryption
        orgId,
      );
    }
  }

  // Re-compute hash AFTER we have the plaintext value (before encryption)
  if (config.hashField) {
    const { source, hashColumn } = config.hashField;
    const originalValue = data[source];
    if (typeof originalValue === 'string' && originalValue.length > 0) {
      const plain = isEncrypted(originalValue)
        ? originalValue // already encrypted — cannot re-hash; skip
        : originalValue;
      if (!isEncrypted(plain)) {
        result[hashColumn] = hashPiiField(plain, orgId);
      }
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
  orgId: string,
): Record<string, unknown> {
  const config = PII_MAP[model.toLowerCase()];
  if (!config) return record;

  const result = { ...record };

  for (const { name, type } of config.fields) {
    const val = result[name];
    if (typeof val === 'string' && isEncrypted(val)) {
      result[name] = decryptPiiField(val, orgId, type);
    }
  }

  return result;
}

function decryptResult(
  model: string,
  result: unknown,
  orgId: string,
): unknown {
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
    const readActions = ['findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow'];
    if (readActions.includes(params.action) && result) {
      const orgId = extractOrgId(params.args);
      if (orgId) {
        return decryptResult(model, result, orgId);
      }
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

  return null;
}
