// WHY: a refresh that finishes after a revoke must not store the new access
// token, and the warning must name the state it refused to leave. A mock of
// updateMany cannot show that the real row stayed revoked.

import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';

import { GrantRevokedError, getWorkspaceAccessToken } from './workspace-token.js';

let dbReachable = false;

beforeAll(async () => {
  process.env.INTEGRATION_TOKEN_KEY = 'ab'.repeat(32);
  process.env.GMAIL_CLIENT_ID = 'test-google-client';
  process.env.GMAIL_CLIENT_SECRET = 'test-google-secret';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('workspace token refresh', () => {
  t('a revoke during refresh is kept and the warning names the from-state', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_tok_${ns}`, name: `token ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Token' },
    });
    const token = await prisma.integrationToken.create({
      data: {
        orgId: org.id,
        userId: user.id,
        provider: 'gmail',
        accessTokenEncrypted: encryptToken('old-access'),
        refreshTokenEncrypted: encryptToken('old-refresh'),
        expiresAt: new Date(Date.now() - 60_000),
        status: 'active',
        scope: [],
      },
    });
    const warn = vi.fn();
    const log = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as unknown as pino.Logger;
    const fetchImpl = vi.fn(async () => {
      await prisma.integrationToken.update({
        where: { id: token.id },
        data: { status: 'revoked' },
      });
      return new Response(JSON.stringify({ access_token: 'late-access', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      getWorkspaceAccessToken(
        {
          id: token.id,
          orgId: org.id,
          provider: 'gmail',
          accessTokenEncrypted: token.accessTokenEncrypted,
          refreshTokenEncrypted: token.refreshTokenEncrypted,
          expiresAt: token.expiresAt,
          scope: [],
        },
        log,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(GrantRevokedError);

    const stored = await prisma.integrationToken.findUnique({
      where: { id: token.id },
      select: { status: true, accessTokenEncrypted: true },
    });
    expect(stored?.status).toBe('revoked');
    expect(stored?.accessTokenEncrypted).toBe(token.accessTokenEncrypted);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: token.id, from: 'revoked', to: 'active' }),
      'illegal integration token transition',
    );
    await prisma.org.delete({ where: { id: org.id } });
  });
});
