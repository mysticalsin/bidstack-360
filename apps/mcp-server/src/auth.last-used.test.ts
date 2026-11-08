// Every MCP call used to write apiKey.lastUsedAt, so one busy agent key
// turned each read-only tool call into a row write on a single hot row.
// The timestamp only needs minute resolution.
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { __setApikeyUsedSampleForTest, LAST_USED_RESOLUTION_MS, mcpAuth } from './auth.js';

const token = 'bs_test_last_used_token';

function request() {
  return {
    headers: { authorization: `Bearer ${token}` },
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

function fakePrisma(lastUsedAt: Date | null) {
  const update = vi.fn(async () => ({}));
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    apiKey: {
      findFirst: vi.fn(async () => ({
        id: 'key-1',
        orgId: 'org-1',
        prefix: 'bs_test_',
        scopes: ['mcp', 'read'],
        hashedKey: createHash('sha256').update(token).digest('hex'),
        expiresAt: null,
        lastUsedAt,
      })),
      update,
      updateMany,
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { prisma: prisma as unknown as Parameters<typeof mcpAuth>[1], writes: () => update.mock.calls.length + updateMany.mock.calls.length };
}

describe('mcpAuth lastUsedAt', () => {
  it('skips the write when the key was used within the resolution window', async () => {
    __setApikeyUsedSampleForTest(false);
    const { prisma, writes } = fakePrisma(new Date(Date.now() - 5_000));
    await mcpAuth(request(), prisma);
    expect(writes()).toBe(0);
  });

  it('writes when the key is stale or never used', async () => {
    __setApikeyUsedSampleForTest(false);
    const stale = fakePrisma(new Date(Date.now() - LAST_USED_RESOLUTION_MS - 1_000));
    await mcpAuth(request(), stale.prisma);
    expect(stale.writes()).toBe(1);

    const never = fakePrisma(null);
    await mcpAuth(request(), never.prisma);
    expect(never.writes()).toBe(1);
    __setApikeyUsedSampleForTest(null);
  });
});
