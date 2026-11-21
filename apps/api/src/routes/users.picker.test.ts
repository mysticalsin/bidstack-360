// F-10: a signed-in user without users:read may load the assignee picker,
// but the payload is the directory. The picker shape is id, display name,
// and avatar. Email stays on the same route for users:read.

import sensible from '@fastify/sensible';
import { prisma } from '@bidstack/db';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    user: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/rbac-decision-cache.js', () => ({
  invalidateRbacDecisionCache: vi.fn(),
}));

vi.mock('../services/rbac.service.js', () => ({
  getUserPermissions: vi.fn(async () => []),
}));

import { usersRoutes } from './users.js';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ADA_ID = '00000000-0000-4000-8000-0000000000aa';

const findMany = vi.mocked(prisma.user.findMany);

async function build(canReadUsers: boolean) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('requirePermission', () => async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  app.decorate('hasPermission', async (_req, permission: string) =>
    permission === 'users:read' ? canReadUsers : false,
  );
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    req.auth = { orgId: ORG_ID, userId: USER_ID, scopes: ['read'], role: 'member' };
  });
  await app.register(usersRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([
    {
      id: ADA_ID,
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      role: 'member',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      deletedAt: null,
    },
  ] as never);
});

describe('GET /users picker shape', () => {
  it('omits email for a caller without users:read', async () => {
    const app = await build(false);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/users?limit=200' });
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as { items: Record<string, unknown>[] }).items;
      expect(items).toEqual([{ id: ADA_ID, name: 'Ada Lovelace', avatarUrl: null }]);
      expect(res.body).not.toContain('ada@example.test');
      expect(res.body).not.toContain('email');
    } finally {
      await app.close();
    }
  });

  it('keeps email for a caller with users:read', async () => {
    const app = await build(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/users?limit=200' });
      expect(res.statusCode, res.body).toBe(200);
      const item = (res.json() as { items: Array<{ email?: string; name: string | null }> }).items[0];
      expect(item?.email).toBe('ada@example.test');
      expect(item?.name).toBe('Ada Lovelace');
    } finally {
      await app.close();
    }
  });
});
