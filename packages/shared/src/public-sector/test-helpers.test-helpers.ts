import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, vi } from 'vitest';

import { createTaxIdHasher } from './hash.js';
import type { FetchLike, PsNormalized, PsRecordBase } from './types.js';

export const FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__/cl/', import.meta.url));

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

export const TEST_TAX_ID_HASHER = createTaxIdHasher('test-only-hmac-key-0123456789abcdef');

export const FIXED_NOW = new Date('2026-11-06T19:35:00.000Z');

/** A fetch that serves one canned response and records the URL it was given. */
export function cannedFetch(body: string, status = 200, headers: Record<string, string> = {}) {
  return vi.fn<FetchLike>(async () => new Response(body, { status, headers }));
}

/** Tests are offline: any real network call fails the test. */
export function forbidNetwork(): void {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is not allowed in tests');
  });
}

export function allRecords(n: PsNormalized): PsRecordBase[] {
  return [...n.entities, ...n.opportunities, ...n.suppliers, ...n.offers, ...n.purchaseOrders];
}

/** Every normalized record must carry the spec 3.5 traceability fields. */
export function expectTraceable(rec: PsRecordBase): void {
  expect(rec.idempotencyKey).toBe(`${rec.sourceKey}:${rec.kind}:${rec.externalId}`);
  expect(rec.sourceUrl).toMatch(/^https:\/\//);
  expect(rec.apiUrl).not.toMatch(/ticket=(?!REDACTED)/i);
  expect(rec.retrievedAt).toBeInstanceOf(Date);
  expect(rec.sourceUpdatedAt === null || rec.sourceUpdatedAt instanceof Date).toBe(true);
  expect(rec.publishedAt === null || rec.publishedAt instanceof Date).toBe(true);
  expect(rec.licence.length).toBeGreaterThan(0);
  expect(rec.attribution).toMatch(/ChileCompra/);
  expect(rec.recordHash).toMatch(/^[a-f0-9]{64}$/);
  expect(rec.confidenceBps).toBeGreaterThanOrEqual(0);
  expect(rec.confidenceBps).toBeLessThanOrEqual(10_000);
  expect(rec.raw).toBeDefined();
}
