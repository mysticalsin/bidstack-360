import { beforeEach, describe, expect, it } from 'vitest';

import { hashPiiField, isEncrypted } from '@bidstack/shared/crypto/pii-field-cipher';

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
    expect(rows[0].emailHash).toBe(hashPiiField('alice@example.com', ORG));
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

  it('rewrites encrypted email equality lookups to emailHash', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'findFirst',
      args: { where: { orgId: ORG, email: 'Alice@Example.com', deletedAt: null } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.where.email).toBeUndefined();
    expect(params.args.where.emailHash).toBe(hashPiiField('alice@example.com', ORG));
    expect(params.args.where.deletedAt).toBeNull();
  });

  it('rewrites encrypted email IN lookups to emailHash IN', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Lead',
      action: 'findMany',
      args: { where: { orgId: ORG, email: { in: ['A@Example.com', 'b@example.com'] } } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.where.email).toBeUndefined();
    expect(params.args.where.emailHash).toEqual({
      in: [hashPiiField('a@example.com', ORG), hashPiiField('b@example.com', ORG)],
    });
  });

  it('FAILS LOUD on encrypted email lookup without orgId', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'findFirst',
      args: { where: { email: 'missing-org@example.com' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(/orgId/i);
  });

  it('decrypts id-only reads when the returned row carries orgId', async () => {
    const middleware = makePiiMiddleware();
    const writeParams = {
      model: 'KamConsultant',
      action: 'create',
      args: { data: { orgId: ORG, email: 'consultant@example.com', name: 'Consultant' } },
    };
    await middleware(writeParams, async (rewritten) => rewritten);
    const envelope = writeParams.args.data.email;

    const readParams = {
      model: 'KamConsultant',
      action: 'findUnique',
      args: { where: { id: 'k1' } },
    };
    const result = (await middleware(readParams, async () => ({
      id: 'k1',
      orgId: ORG,
      email: envelope,
    }))) as { email: string };

    expect(result.email).toBe('consultant@example.com');
  });

  // WHY: an orgId inside a NOT clause names the org the results are NOT from.
  // The old code harvested it as decryption context and preferred it over the
  // row's own orgId — decrypting with the wrong org's key does not error, it
  // silently returns mask strings, corrupting every PII read on such queries.
  it('decrypts rows with their OWN orgId when the query orgId only appears in a NOT clause', async () => {
    const middleware = makePiiMiddleware();
    const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';

    const writeParams = {
      model: 'Contact',
      action: 'create',
      args: { data: { orgId: ORG, email: 'not-clause@example.com' } },
    };
    await middleware(writeParams, async (rewritten) => rewritten);
    const envelope = writeParams.args.data.email;
    expect(isEncrypted(envelope)).toBe(true);

    const readParams = {
      model: 'Contact',
      action: 'findMany',
      args: { where: { NOT: { orgId: OTHER_ORG } } },
    };
    const result = (await middleware(readParams, async () => [
      { orgId: ORG, email: envelope },
    ])) as Array<{ email: string }>;

    expect(result[0].email).toBe('not-clause@example.com');
  });

  it('FAILS LOUD (never wrong-key decrypts) when the only query orgId is in a NOT clause and the row has none', async () => {
    const middleware = makePiiMiddleware();
    const writeParams = {
      model: 'Contact',
      action: 'create',
      args: { data: { orgId: ORG, email: 'orphan-row@example.com' } },
    };
    await middleware(writeParams, async (rewritten) => rewritten);
    const envelope = writeParams.args.data.email;

    const readParams = {
      model: 'Contact',
      action: 'findMany',
      args: { where: { NOT: { orgId: ORG } } },
    };

    await expect(
      middleware(readParams, async () => [{ email: envelope }]),
    ).rejects.toThrow(/without orgId for decryption/);
  });

  it('does not encrypt User.email until a User.emailHash migration exists', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'User',
      action: 'create',
      args: { data: { orgId: ORG, email: 'auth-user@example.com' } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.data.email).toBe('auth-user@example.com');
  });
});

describe('pii-encryption middleware — find-then-update-by-id pattern', () => {
  // WHY this suite exists: the repo's sanctioned multi-tenancy pattern is an
  // org-scoped findFirst to verify ownership, then `update({ where: { id },
  // data })` with NO orgId anywhere in the update args (contacts PATCH, MCP
  // leads-update, and the migration worker all do this; tenant-scope-guard
  // classifies `update` as report-only for exactly this shape). Failing loud
  // on unresolvable orgId is right for createMany, but here it turned the
  // PRIMARY edit path for email/phone — the very fields this middleware
  // protects — into a hard 500 the moment PII_FIELD_ENCRYPTION was enabled.

  it('encrypts an update-by-bare-id by resolving the row’s own orgId instead of throwing', async () => {
    const probes: Array<{ model: string; where: unknown }> = [];
    const middleware = makePiiMiddleware(async (model, where) => {
      probes.push({ model, where });
      return ORG;
    });
    const params = {
      model: 'Contact',
      action: 'update',
      args: { where: { id: 'c1' }, data: { email: 'patched@example.com', phone: '+15551234567' } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(isEncrypted(params.args.data.email)).toBe(true);
    expect(isEncrypted(params.args.data.phone)).toBe(true);
    // The ROW's org key must seal the fields — hash equality proves which key was used.
    expect((params.args.data as { emailHash?: string }).emailHash).toBe(
      hashPiiField('patched@example.com', ORG),
    );
    expect(probes).toEqual([{ model: 'Contact', where: { id: 'c1' } }]);
  });

  it('still FAILS LOUD when the target row resolves no orgId (never silent plaintext)', async () => {
    const middleware = makePiiMiddleware(async () => null);
    const params = {
      model: 'Lead',
      action: 'update',
      args: { where: { id: 'missing-or-tombstoned' }, data: { email: 'leak@example.com' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(/orgId/i);
  });

  it('never probes the DB when the update has no plaintext PII or already carries orgId', async () => {
    // WHY: the row lookup is a last-resort fallback, not a per-update tax —
    // non-PII updates and already-scoped updates must stay probe-free.
    let probeCount = 0;
    const middleware = makePiiMiddleware(async () => {
      probeCount += 1;
      return ORG;
    });

    const nonPii = {
      model: 'Contact',
      action: 'update',
      args: { where: { id: 'c1' }, data: { firstName: 'NoPiiHere' } },
    };
    await middleware(nonPii, async (rewritten) => rewritten);

    const scoped = {
      model: 'Contact',
      action: 'update',
      args: { where: { id: 'c1', orgId: ORG }, data: { email: 'scoped@example.com' } },
    };
    await middleware(scoped, async (rewritten) => rewritten);

    expect(probeCount).toBe(0);
    expect(isEncrypted(scoped.args.data.email)).toBe(true);
  });
});

describe('pii-encryption middleware — write results return plaintext', () => {
  // WHY this suite exists: Prisma returns the written row for create/update/
  // upsert, and by then the write path has rewritten email/phone to enc:v1:…
  // envelopes. The API and MCP layers serialize that result straight into the
  // response (contacts POST/PATCH return serializeContact(created/updated)),
  // so without result decryption the caller that just supplied 'foo@bar.com'
  // renders ciphertext — breaking every save-then-show flow and the runbook's
  // promise that endpoints return plaintext (docs/security/pii-field-encryption.md).

  it('create: caller gets plaintext back while the DB payload stores ciphertext', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'create',
      args: { data: { orgId: ORG, email: 'fresh@example.com', phone: '+15550001111' } },
    };

    const result = (await middleware(params, async (rewritten) => ({
      id: 'c-new',
      ...(rewritten.args.data as Record<string, unknown>),
    }))) as { email: string; phone: string };

    // The DB-bound payload is sealed…
    expect(isEncrypted(params.args.data.email)).toBe(true);
    expect(isEncrypted(params.args.data.phone)).toBe(true);
    // …but the caller sees exactly what it sent.
    expect(result.email).toBe('fresh@example.com');
    expect(result.phone).toBe('+15550001111');
  });

  it('update-by-id: result decrypts with the ROW’s own orgId even though args carry none', async () => {
    const middleware = makePiiMiddleware(async () => ORG);
    const params = {
      model: 'Lead',
      action: 'update',
      args: { where: { id: 'l1' }, data: { email: 'renamed@example.com' } },
    };

    const result = (await middleware(params, async (rewritten) => ({
      id: 'l1',
      orgId: ORG,
      ...(rewritten.args.data as Record<string, unknown>),
    }))) as { email: string };

    expect(isEncrypted(params.args.data.email)).toBe(true);
    expect(result.email).toBe('renamed@example.com');
  });

  it('upsert: returned row decrypts', async () => {
    const middleware = makePiiMiddleware();
    const params = {
      model: 'Contact',
      action: 'upsert',
      args: {
        where: { id: 'c9', orgId: ORG },
        create: { orgId: ORG, email: 'upserted@example.com' },
        update: { email: 'upserted@example.com' },
      },
    };

    const result = (await middleware(params, async (rewritten) => ({
      id: 'c9',
      orgId: ORG,
      ...(rewritten.args.create as Record<string, unknown>),
    }))) as { email: string };

    expect(isEncrypted(params.args.create.email)).toBe(true);
    expect(result.email).toBe('upserted@example.com');
  });
});
