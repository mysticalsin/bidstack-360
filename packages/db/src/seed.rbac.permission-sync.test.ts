// RBAC drift guard (B8.1): the permission key catalogue lives in THREE places
// that must stay in lockstep — PERMISSION_KEYS (@bidstack/shared, the TS type
// authority), PERMISSION_SEEDS (here, the DB/runtime authority), and the
// RBAC_MATRIX (matrix display + role grants). A key declared in one but missing
// from the seed catalogue compiles fine but 403s at runtime for every role.
// This test fails the moment a NEW permission (e.g. kam:read/kam:write) is
// added to PERMISSION_KEYS without being seeded.

import { describe, expect, it } from 'vitest';

import { PERMISSION_KEYS } from '@bidstack/shared';

import { ALL_PERMISSION_KEYS } from './seed.rbac.js';

// Pre-existing drift NOT introduced or fixed by the KAM build (these resources
// are in PERMISSION_KEYS + the matrix but were never seeded — separate cleanup,
// some belong to the removed quote-to-cash vertical). Documented here so the
// sync test stays honest rather than silently passing on stale state.
const KNOWN_UNSEEDED = new Set<string>([
  'agents:read',
  'agents:write',
  'invoices:read',
  'invoices:write',
  'products:read',
  'products:write',
  'sales-orders:read',
  'sales-orders:write',
]);

describe('permission key ↔ seed catalogue sync', () => {
  it('kam:read and kam:write exist in BOTH PERMISSION_KEYS and the seed catalogue', () => {
    for (const key of ['kam:read', 'kam:write'] as const) {
      expect(PERMISSION_KEYS as readonly string[]).toContain(key);
      expect(ALL_PERMISSION_KEYS).toContain(key);
    }
  });

  it('every seeded permission is a declared PERMISSION_KEY (no orphan seeds)', () => {
    const declared = new Set<string>(PERMISSION_KEYS);
    const orphans = ALL_PERMISSION_KEYS.filter((k) => !declared.has(k));
    expect(orphans).toEqual([]);
  });

  it('every PERMISSION_KEY is seeded, except the documented pre-existing drift', () => {
    const seeded = new Set<string>(ALL_PERMISSION_KEYS);
    const unseeded = (PERMISSION_KEYS as readonly string[]).filter(
      (k) => !seeded.has(k) && !KNOWN_UNSEEDED.has(k),
    );
    // A NEW unseeded key (e.g. a freshly added kam:* not wired into the seed)
    // shows up here and fails the build — exactly the drift we want to catch.
    expect(unseeded).toEqual([]);
  });
});
