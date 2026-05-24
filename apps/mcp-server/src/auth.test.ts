import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@bidstack/db';
import { createHash, randomBytes } from 'node:crypto';
import { __setApikeyUsedSampleForTest, mcpAuth, requireMcpScope } from './auth.js';

// Tests need a live Postgres. CI without docker stays green via skipIfNoDb.
const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();

function mockRequest(token?: string) {
  return {
    headers: token
      ? { authorization: `Bearer ${token}`, 'user-agent': 'vitest/1' }
      : { 'user-agent': 'vitest/1' },
    ip: '127.0.0.1',
    method: 'POST',
    url: '/mcp',
    log: { warn: () => {} },
    server: {
      httpErrors: {
        unauthorized: (msg: string) => new Error(msg),
        forbidden: (msg: string) => new Error(msg),
      },
    },
  } as unknown as Parameters<typeof mcpAuth>[0];
}

afterEach(() => {
  // Always clear the sampling override so one test can't bleed into the next.
  __setApikeyUsedSampleForTest(null);
});

describe('requireMcpScope', () => {
  it('allows keys with the requested read/write scope', () => {
    expect(() =>
      requireMcpScope({ orgId: 'org', keyId: 'key', scopes: ['mcp', 'read'] }, 'read'),
    ).not.toThrow();
  });

  it('rejects read-only keys for write-scoped tools', () => {
    expect(() =>
      requireMcpScope({ orgId: 'org', keyId: 'key', scopes: ['mcp', 'read'] }, 'write'),
    ).toThrow('lacks `write` scope');
  });
});

describeDb('mcpAuth', () => {
  let orgId: string;
  let validToken: string;
  let revokedToken: string;
  let noScopeToken: string;

  beforeAll(async () => {
    // Ensure seed org exists
    const org = await prisma.org.upsert({
      where: { clerkOrg: 'org_test_mcp' },
      update: {},
      create: { clerkOrg: 'org_test_mcp', name: 'Test MCP Org' },
    });
    orgId = org.id;

    validToken = `bidstack_${randomBytes(28).toString('hex')}`;
    revokedToken = `bidstack_${randomBytes(28).toString('hex')}`;
    noScopeToken = `bidstack_${randomBytes(28).toString('hex')}`;

    await prisma.apiKey.createMany({
      data: [
        {
          orgId,
          name: 'Valid MCP Key',
          hashedKey: createHash('sha256').update(validToken).digest('hex'),
          prefix: validToken.slice(0, 12),
          scopes: ['mcp', 'read'],
        },
        {
          orgId,
          name: 'Revoked Key',
          hashedKey: createHash('sha256').update(revokedToken).digest('hex'),
          prefix: revokedToken.slice(0, 12),
          scopes: ['mcp'],
          revokedAt: new Date(),
        },
        {
          orgId,
          name: 'No MCP Scope',
          hashedKey: createHash('sha256').update(noScopeToken).digest('hex'),
          prefix: noScopeToken.slice(0, 12),
          scopes: ['read'],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { orgId } });
    await prisma.org.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('accepts a valid key with mcp scope', async () => {
    const ctx = await mcpAuth(mockRequest(validToken), prisma);
    expect(ctx.orgId).toBe(orgId);
    expect(ctx.scopes).toContain('mcp');
  });

  it('rejects missing authorization header', async () => {
    await expect(mcpAuth(mockRequest(), prisma)).rejects.toThrow('Bearer token required');
  });

  it('rejects an invalid key', async () => {
    await expect(mcpAuth(mockRequest('invalid_key_12345'), prisma)).rejects.toThrow(
      'Invalid API key',
    );
  });

  it('rejects a revoked key', async () => {
    await expect(mcpAuth(mockRequest(revokedToken), prisma)).rejects.toThrow('Invalid API key');
  });

  it('rejects a key without mcp scope', async () => {
    await expect(mcpAuth(mockRequest(noScopeToken), prisma)).rejects.toThrow('lacks `mcp` scope');
  });

  it('emits an apikey.used audit-log row when the sampling roll selects', async () => {
    // Force sampling on so the assertion is deterministic. Without the
    // override the test would either be flaky (1% chance of producing a
    // row) or have to run hundreds of iterations to be statistically
    // meaningful.
    __setApikeyUsedSampleForTest(true);
    const before = await prisma.auditLog.count({
      where: { orgId, action: 'apikey.used' },
    });
    await mcpAuth(mockRequest(validToken), prisma);

    // Fire-and-forget audit write — give it a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await prisma.auditLog.count({
      where: { orgId, action: 'apikey.used' },
    });
    expect(after).toBeGreaterThan(before);

    // The most recent row should carry the keyPrefix in its diff and have
    // a null userId (the key is the actor — no human user attached).
    const latest = await prisma.auditLog.findFirst({
      where: { orgId, action: 'apikey.used' },
      orderBy: { id: 'desc' },
    });
    expect(latest).not.toBeNull();
    expect(latest?.userId).toBeNull();
    expect(latest?.targetType).toBe('api_key');
    const diff = latest?.diff as Record<string, unknown> | null;
    expect(diff?.keyPrefix).toBe(validToken.slice(0, 12));

    // Cleanup so we don't pollute later test runs.
    if (latest) {
      await prisma.auditLog.deleteMany({ where: { id: latest.id } });
    }
  });

  it('skips the apikey.used audit-log row when the sampling roll excludes', async () => {
    __setApikeyUsedSampleForTest(false);
    const before = await prisma.auditLog.count({
      where: { orgId, action: 'apikey.used' },
    });
    await mcpAuth(mockRequest(validToken), prisma);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = await prisma.auditLog.count({
      where: { orgId, action: 'apikey.used' },
    });
    expect(after).toBe(before);
  });
});
