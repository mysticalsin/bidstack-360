import { beforeEach, describe, expect, it } from 'vitest';

import { isEncrypted } from '@bidstack/shared/crypto/pii-field-cipher';

import { makePiiMiddleware } from './pii-encryption.js';

// 32-byte master key as 64 hex chars (deriveOrgKey requires exactly this length).
const MASTER_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';
const ORG = '00000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  process.env.PII_FIELD_ENCRYPTION = 'true';
  process.env.PII_ENCRYPTION_MASTER_KEY = MASTER_KEY;
});

describe('pii-encryption middleware — bulk createMany path', () => {
  // WHY this suite exists: the highest-volume ingest path (createMany from
  // AI-extracted contacts and onboarding imports) passes `data` as an ARRAY.
  // The prior middleware read `data` as a single object, so orgId extraction
  // returned null and encryption was SILENTLY SKIPPED — email/phone landed in
  // the DB as plaintext the moment PII_FIELD_ENCRYPTION was enabled.

  it('encrypts every element of a contact createMany array and sets emailHash', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'createMany',
      args: {
        data: [
          { orgId: ORG, email: 'alice@example.com', phone: '+15551112222', firstName: 'Alice' },
          { orgId: ORG, email: 'bob@example.com', firstName: 'Bob' },
        ],
      },
    };

    await middleware(params, async (rewritten) => rewritten);

    const rows = params.args.data;
    expect(isEncrypted(rows[0].email)).toBe(true);
    expect(isEncrypted(rows[0].phone)).toBe(true);
    // emailHash drives equality search without decryption — HMAC-SHA256 hex = 64 chars.
    expect(typeof rows[0].emailHash).toBe('string');
    expect((rows[0] as { emailHash: string }).emailHash).toHaveLength(64);
    expect(isEncrypted(rows[1].email)).toBe(true);
    // Non-PII fields are left untouched.
    expect(rows[0].firstName).toBe('Alice');
  });

  it('FAILS LOUD when a createMany element carries PII but no orgId (never silent plaintext)', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Lead',
      action: 'createMany',
      args: { data: [{ email: 'leak@example.com' }] }, // missing orgId
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(/orgId/i);
  });

  it('passes a non-PII createMany through even without orgId (no false positive)', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'createMany',
      args: { data: [{ firstName: 'NoPiiHere' }] },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBeDefined();
    expect(params.args.data[0].firstName).toBe('NoPiiHere');
  });

  it('still encrypts a single-object create (regression guard for the object path)', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'create',
      args: { data: { orgId: ORG, email: 'single@example.com' } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(isEncrypted(params.args.data.email)).toBe(true);
  });

  it('round-trips: a value encrypted on createMany decrypts on findMany', async () => {
    const middleware = makePiiMiddleware();
    const writeParams = {
      model: 'Contact',
      action: 'createMany',
      args: { data: [{ orgId: ORG, email: 'roundtrip@example.com' }] },
    };
    await middleware(writeParams, async (rewritten) => rewritten);
    const envelope = writeParams.args.data[0].email;
    expect(isEncrypted(envelope)).toBe(true);

    const readParams = { model: 'Contact', action: 'findMany', args: { where: { orgId: ORG } } };
    const result = (await middleware(readParams, async () => [{ email: envelope }])) as Array<{
      email: string;
    }>;

    expect(result[0].email).toBe('roundtrip@example.com');
  });
});
