import { createSign, generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  CF_ACCESS_EMAIL_HEADER,
  CF_ACCESS_JWT_HEADER,
  CF_ACCESS_NOT_ALLOWLISTED,
  __clearCfAccessJwksCacheForTests,
  __setCfAccessVerifierForTests,
  verifyCfAccessAuth,
  verifyCfAccessJwt,
} from './cf-access-auth.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    org: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    role: { findFirst: vi.fn() },
    userRole: { updateMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('./auth-audit.js', () => ({
  writeAuthAudit: vi.fn(),
}));

vi.mock('../lib/rbac-decision-cache.js', () => ({
  invalidateRbacDecisionCache: vi.fn(),
}));

const orgFind = vi.mocked(prisma.org.findUnique);
const userFind = vi.mocked(prisma.user.findUnique);
const userUpsert = vi.mocked(prisma.user.upsert);
const roleFind = vi.mocked(prisma.role.findFirst);
const grantUpsert = vi.mocked(prisma.userRole.upsert);

function fakeReq(headers: Record<string, string>, ip = '127.0.0.1') {
  return {
    ip,
    headers,
    log: { warn: vi.fn() },
    server: {
      httpErrors: {
        unauthorized: (message: string) => Object.assign(new Error(message), { statusCode: 401 }),
        forbidden: (message: string) => Object.assign(new Error(message), { statusCode: 403 }),
        serviceUnavailable: (message: string) =>
          Object.assign(new Error(message), { statusCode: 503 }),
      },
    },
  } as never;
}

describe('Cloudflare Access identity mapping', () => {
  beforeEach(() => {
    process.env.POLO_ALLOWED_USERS = 'ada@mantu.com:Admin';
    process.env.POLO_REAL_ORG_CLERK = 'org_polo_real';
    process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL = 'true';
    orgFind.mockResolvedValue({ id: 'org-1' } as never);
    userFind.mockResolvedValue(null);
    userUpsert.mockResolvedValue({
      id: 'user-1',
      role: 'admin',
      email: 'ada@mantu.com',
    } as never);
    roleFind.mockResolvedValue({ id: 'role-admin' } as never);
    vi.mocked(prisma.userRole.updateMany).mockResolvedValue({ count: 0 } as never);
    grantUpsert.mockResolvedValue({} as never);
  });

  afterEach(() => {
    __setCfAccessVerifierForTests(null);
    delete process.env.POLO_ALLOWED_USERS;
    delete process.env.POLO_REAL_ORG_CLERK;
    delete process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL;
    vi.clearAllMocks();
  });

  it('provisions an allowlisted loopback Access email as its own Polo user', async () => {
    const auth = await verifyCfAccessAuth(
      fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'Ada@Mantu.com' }),
    );
    expect(auth.userId).toBe('user-1');
    expect(auth.email).toBe('ada@mantu.com');
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clerkUser: 'cfaccess:ada@mantu.com',
          email: 'ada@mantu.com',
          role: 'admin',
        }),
      }),
    );
  });

  it('links a seeded or imported user with the same email instead of inserting a duplicate', async () => {
    userFind.mockImplementation((async (args: { where: { email?: string } }) =>
      args.where.email ? { id: 'seeded-ada', orgId: 'org-1' } : null) as never);
    await verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' }));
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'seeded-ada' },
        update: expect.objectContaining({ clerkUser: 'cfaccess:ada@mantu.com' }),
      }),
    );
  });

  it('refuses an Access email whose user row belongs to another organization', async () => {
    userFind.mockImplementation((async (args: { where: { email?: string } }) =>
      args.where.email ? { id: 'other-ada', orgId: 'org-2' } : null) as never);
    await expect(
      verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(userUpsert).not.toHaveBeenCalled();
  });

  it('refuses an Access email that is not on the Polo allowlist', async () => {
    await expect(
      verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'stranger@mantu.com' })),
    ).rejects.toMatchObject({ statusCode: 403, message: CF_ACCESS_NOT_ALLOWLISTED });
    expect(userUpsert).not.toHaveBeenCalled();
  });

  it('does not trust the Access email header from a non-loopback client', async () => {
    await expect(
      verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' }, '203.0.113.9')),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refuses the loopback email in production even when the flag is set', async () => {
    // WHY: a production process that can be reached on 127.0.0.1 (a sidecar,
    // a mis-set proxy, a container health probe) must not treat the email
    // header as identity. The flag cannot turn that back on.
    process.env.NODE_ENV = 'production';
    process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL = 'true';
    await expect(
      verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' })),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(userUpsert).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'test';
  });

  it('refuses the loopback email when NODE_ENV is missing', async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL = 'true';
    await expect(
      verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' })),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(userUpsert).not.toHaveBeenCalled();
    process.env.NODE_ENV = previous;
  });

  it('refuses the loopback email when the trust flag is missing', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL;
    await expect(
      verifyCfAccessAuth(fakeReq({ [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' })),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(userUpsert).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'test';
    process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL = 'true';
  });

  it('does not fall back to the email header when the Access JWT cannot be verified', async () => {
    // WHY: aud and issuer are checked inside JWT verification. A client that
    // also sends the email header must not be admitted when that check fails
    // or the team and audience are unset.
    process.env.CF_ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
    process.env.CF_ACCESS_AUD = 'aud-1';
    __setCfAccessVerifierForTests(async () => {
      throw new Error('cf_access_aud_mismatch');
    });
    await expect(
      verifyCfAccessAuth(
        fakeReq({
          [CF_ACCESS_JWT_HEADER]: 'header.payload.sig',
          [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(userUpsert).not.toHaveBeenCalled();
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    delete process.env.CF_ACCESS_AUD;
  });

  it('rejects an Access JWT that is not valid yet', async () => {
    // WHY: exp is checked, and nbf was not. A token whose not-before is in
    // the future would be accepted and become the request identity.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { kid?: string };
    jwk.kid = 'nbf-key';
    jwk.alg = 'RS256';
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'nbf-key' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        email: 'ada@mantu.com',
        aud: 'aud-1',
        iss: 'https://team.cloudflareaccess.com',
        exp: now + 600,
        nbf: now + 600,
      }),
    ).toString('base64url');
    const sign = createSign('RSA-SHA256');
    sign.update(`${header}.${body}`);
    sign.end();
    const token = `${header}.${body}.${sign.sign(privateKey).toString('base64url')}`;
    __clearCfAccessJwksCacheForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })),
    );
    try {
      await expect(
        verifyCfAccessJwt(token, { teamDomain: 'team.cloudflareaccess.com', audience: 'aud-1' }),
      ).rejects.toThrow(/cf_access_nbf/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
