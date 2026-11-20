import { createHash, createHmac } from 'node:crypto';

import { parseRut } from './rut.js';

/** Lowercase hex SHA-256 of bytes or a UTF-8 string. */
export function sha256Hex(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON: recursively sorted keys, explicit nulls, UTC ISO instants,
 * integer micros as decimal strings (spec 3.4).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** `recordHash` of one projected record: SHA-256 of its canonical JSON. */
export function recordHash(projection: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(projection));
}

/** Natural key for idempotent upserts. */
export function psIdempotencyKey(sourceKey: string, kind: string, externalId: string): string {
  return `${sourceKey}:${kind}:${externalId}`;
}

/**
 * Keyed hash for natural-person tax ids (spec 6.3).
 *
 * A plain SHA-256 of a RUT is reversible by enumeration (there are only about
 * 30 million person RUTs), so the hash is an HMAC with a server-held key
 * resolved by NAME by the caller. The same RUT always maps to the same hash
 * under one key, so suppliers still join across sources.
 */
export function createTaxIdHasher(key: string): (taxId: string) => string {
  if (key.length < 32) throw new Error('Tax id HMAC key must be at least 32 characters');
  return (taxId: string) => {
    const rut = parseRut(taxId);
    const canonical = rut ? `${rut.body}-${rut.dv}` : taxId.trim().toUpperCase();
    return createHmac('sha256', key).update(canonical).digest('hex');
  };
}
