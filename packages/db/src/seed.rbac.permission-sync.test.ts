// RBAC drift guard (B8.1): the permission key catalogue lives in THREE places
// that must stay in lockstep — PERMISSION_KEYS (@bidstack/shared, the TS type
// authority), PERMISSION_SEEDS (here, the DB/runtime authority), and the
// RBAC_MATRIX (matrix display + role grants). A key declared in one but missing
// from the seed catalogue compiles fine but 403s at runtime for every role.
// This test fails the moment a NEW permission (e.g. kam:read/kam:write) is
// added to PERMISSION_KEYS without being seeded.

import { describe, expect, it } from 'vitest';

import { PERMISSION_KEYS } from '@bidstack/shared';

import { ALL_PERMISSION_KEYS, ROLE_SEEDS } from './seed.rbac.js';

// Pre-existing drift NOT introduced or fixed by the KAM build (these resources
// are in PERMISSION_KEYS + the matrix but were never seeded — separate cleanup,
// some belong to the removed quote-to-cash vertical). Documented here so the
// sync test stays honest rather than silently passing on stale state.
const KNOWN_UNSEEDED = new Set<string>([
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

describe('integrations:write parity with contacts:write', () => {
  // WHY: POST /sms/send and POST /email/send (apps/api/src/routes/integrations/
  // {twilio,email}.ts) are gated by requirePermission('integrations:write'). A
  // seller who can already write a contact but lacks integrations:write would
  // 403 on send while every other CRM write on that same contact worked — a
  // confusing partial regression. This pins the exact seller-write role list
  // granted integrations:write alongside contacts:write in ROLE_SEEDS.
  const SELLER_WRITE_ROLES = [
    'Sales',
    'Sales Manager',
    'Account Executive',
    'SDR',
    'Customer Success',
  ];

  function permissionKeysFor(roleName: string): readonly string[] {
    const found = ROLE_SEEDS.find((r) => r.name === roleName);
    if (!found) throw new Error(`Role not seeded: ${roleName}`);
    return found.permissionKeys;
  }

  it.each(SELLER_WRITE_ROLES)('%s holds contacts:write and integrations:write', (roleName) => {
    const keys = permissionKeysFor(roleName);
    expect(keys).toContain('contacts:write');
    expect(keys).toContain('integrations:write');
  });

  it('a read-only role has neither contacts:write nor integrations:write', () => {
    // Precondition the case is honest: Read-only must actually hold no write keys.
    const keys = permissionKeysFor('Read-only');
    expect(keys).not.toContain('contacts:write');
    expect(keys).not.toContain('integrations:write');
  });

  it('Presales (a write role without contacts:write) is not granted integrations:write', () => {
    // Guards against over-granting: Presales writes bid-scores/documents/proposals
    // etc but never contacts, so it must not pick up integrations:write either.
    const keys = permissionKeysFor('Presales');
    expect(keys).not.toContain('contacts:write');
    expect(keys).not.toContain('integrations:write');
  });
});
