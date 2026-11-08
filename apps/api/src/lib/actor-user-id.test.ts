import { describe, expect, it } from 'vitest';

import { actorUserId } from './actor-user-id.js';

describe('actor user id', () => {
  it('leaves the uuid column empty for an API key so the insert is not a uuid cast', () => {
    expect(actorUserId('apikey:00000000-0000-4000-8000-000000000099')).toBeNull();
    expect(actorUserId('apikey:key-1')).toBeNull();
  });

  it('keeps a human user id', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(actorUserId(id)).toBe(id);
  });
});
