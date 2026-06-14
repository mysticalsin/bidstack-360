import { describe, expect, it } from 'vitest';

import { validateChannel } from './realtime.js';

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const ENTITY = '11111111-1111-4111-8111-111111111111';
const authA = { orgId: ORG_A, userId: 'user-a' };

describe('validateChannel — multi-tenant channel authorization', () => {
  it('allows an entity edit channel scoped to the caller’s own org', () => {
    expect(validateChannel(`entity:${ORG_A}:contact:${ENTITY}:edits`, authA)).toBe(true);
  });

  it('DENIES another org’s entity edit channel (cross-tenant leak regression)', () => {
    // Org A knows an org B entity UUID (UUIDs leak via URLs/exports) and tries to
    // subscribe to org B's live-edit channel. Must be rejected.
    expect(validateChannel(`entity:${ORG_B}:contact:${ENTITY}:edits`, authA)).toBe(false);
  });

  it('denies an unscoped legacy entity channel (no orgId segment)', () => {
    expect(validateChannel(`entity:contact:${ENTITY}:edits`, authA)).toBe(false);
  });

  it('enforces org match on presence channels', () => {
    expect(validateChannel(`presence:org:${ORG_A}`, authA)).toBe(true);
    expect(validateChannel(`presence:org:${ORG_B}`, authA)).toBe(false);
  });

  it('enforces user match on notification channels', () => {
    expect(validateChannel('notification:user:user-a', authA)).toBe(true);
    expect(validateChannel('notification:user:user-z', authA)).toBe(false);
  });

  it('rejects unknown channel shapes', () => {
    expect(validateChannel('arbitrary:channel', authA)).toBe(false);
  });
});
