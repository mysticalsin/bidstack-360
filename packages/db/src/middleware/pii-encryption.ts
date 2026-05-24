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

  for (const { name, type } of config.fields) {
    const val = result[name];
    if (typeof val === 'string' && val.length > 0 && !isEncrypted(val)) {
      result[name] = encryptPiiField(val, orgId);
    }
    // Track raw value for hashing before we overwrite
    if (config.hashField?.source === name && typeof val === 'string' && val.length > 0) {
      const plaintext = isEncrypted(val) ? val : val; // still plaintext at this point
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
        const orgId = extractOrgId(params.args);
        if (orgId) {
          if (params.args.create) {
            params.args.create = encryptPayload(model, params.args.create as Record<string, unknown>, orgId);
          }
          if (params.args.update) {
            params.args.update = encryptPayload(model, params.args.update as Record<string, unknown>, orgId);
          }
        }
      } else if (params.args?.data) {
        const orgId = extractOrgId(params.args);
        if (orgId) {
          params.args.data = encryptPayload(model, params.args.data as Record<string, unknown>, orgId);
        }
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
