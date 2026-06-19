import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '@bidstack/db';
import { mutationAuditPlugin } from './mutation-audit.js';

const createMock = vi.mocked(prisma.auditLog.create);

function withAuth(
  server: ReturnType<typeof Fastify>,
  auth: { orgId?: string; userId?: string; scopes?: string[] } = {},
) {
  server.addHook('preHandler', async (req) => {
    req.auth = {
      orgId: auth.orgId ?? '11111111-1111-4111-8111-111111111111',
      userId: auth.userId ?? '22222222-2222-4222-8222-222222222222',
      scopes: auth.scopes ?? ['read', 'write'],
      role: 'admin',
    };
  });
}

afterEach(() => {
  createMock.mockReset();
});

describe('mutationAuditPlugin', () => {
  it.each([
    ['/api/v1/comments', 'POST'],
    ['/api/v1/calls/quick-start', 'POST'],
    ['/api/v1/signatures/requests/11111111-1111-4111-8111-111111111111/void', 'POST'],
    ['/api/v1/forecasts', 'POST'],
    ['/api/v1/lead-routing-rules/11111111-1111-4111-8111-111111111111', 'PATCH'],
    ['/api/v1/migrations/mappings', 'POST'],
    ['/api/v1/entities/opportunity/11111111-1111-4111-8111-111111111111/lock', 'DELETE'],
    ['/api/v1/email/send', 'POST'],
    ['/api/v1/booking-pages', 'POST'],
    ['/api/v1/admin/predictive/retrain', 'POST'],
  ])('covers unaudited enterprise mutation family %s', async (path, method) => {
    createMock.mockResolvedValueOnce({} as never);
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.route({
      method: method as 'POST' | 'PATCH' | 'DELETE',
      url: path,
      handler: async () => ({ ok: true }),
    });

    const res = await server.inject({ method, url: path, payload: { sensitive: 'redacted' } });

    expect(res.statusCode).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.action).toBe('http.mutation.success');
    expect(call.data.diff).toMatchObject({ method, path, statusCode: 200 });
    expect(JSON.stringify(call.data.diff)).not.toContain('redacted');

    await server.close();
  });

  it('skips rich-audited account tier updates to avoid duplicate audit rows', async () => {
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.patch('/api/v1/companies/:id/tier', async () => ({ ok: true }));

    const res = await server.inject({
      method: 'PATCH',
      url: '/api/v1/companies/11111111-1111-4111-8111-111111111111/tier',
      payload: { tier: 'key' },
    });

    expect(res.statusCode).toBe(200);
    expect(createMock).not.toHaveBeenCalled();

    await server.close();
  });

  it.each([
    ['POST', '/api/v1/companies'],
    ['PATCH', '/api/v1/companies/11111111-1111-4111-8111-111111111111'],
    ['DELETE', '/api/v1/companies/11111111-1111-4111-8111-111111111111'],
    ['POST', '/api/v1/roles'],
    ['PATCH', '/api/v1/roles/11111111-1111-4111-8111-111111111111'],
    ['DELETE', '/api/v1/roles/11111111-1111-4111-8111-111111111111'],
  ])('skips rich-audited CRUD %s %s to avoid duplicate request rows', async (method, path) => {
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.route({
      method: method as 'POST' | 'PATCH' | 'DELETE',
      url: path,
      handler: async () => ({ ok: true }),
    });

    const res = await server.inject({ method, url: path, payload: { name: 'Acme' } });

    expect(res.statusCode).toBe(200);
    expect(createMock).not.toHaveBeenCalled();

    await server.close();
  });

  it('writes a request-level audit event for authenticated successful mutations without storing body data', async () => {
    createMock.mockResolvedValueOnce({} as never);
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.post('/api/v1/webhook-subscriptions', async () => ({ ok: true }));

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhook-subscriptions?debug=1',
      headers: { 'user-agent': 'Mutation Audit Test' },
      payload: { secret: 'do-not-store' },
    });

    expect(res.statusCode).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      orgId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      action: 'http.mutation.success',
      targetType: 'http_request',
    });
    expect(call.data.targetId).toEqual(expect.any(String));
    expect(call.data.diff).toMatchObject({
      method: 'POST',
      path: '/api/v1/webhook-subscriptions',
      statusCode: 200,
      actorKind: 'user',
      ip: expect.any(String),
      userAgent: 'Mutation Audit Test',
      scopes: ['read', 'write'],
    });
    expect(JSON.stringify(call.data.diff)).not.toContain('do-not-store');

    await server.close();
  });

  it('records denied authenticated write attempts for security review', async () => {
    createMock.mockResolvedValueOnce({} as never);
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.delete('/api/v1/users/:id', async (_req, reply) => {
      return reply.code(403).send({ message: 'forbidden' });
    });

    const res = await server.inject({ method: 'DELETE', url: '/api/v1/users/u-1' });

    expect(res.statusCode).toBe(403);
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.action).toBe('http.mutation.denied');
    expect(call.data.diff).toMatchObject({
      method: 'DELETE',
      path: '/api/v1/users/u-1',
      statusCode: 403,
    });

    await server.close();
  });

  it('records denied admin credential-surface mutations for security review', async () => {
    createMock.mockResolvedValueOnce({} as never);
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.put('/api/v1/integrations/agent-providers/credentials/:provider', async (_req, reply) => {
      return reply.code(403).send({ message: 'forbidden' });
    });

    const res = await server.inject({
      method: 'PUT',
      url: '/api/v1/integrations/agent-providers/credentials/claude',
    });

    expect(res.statusCode).toBe(403);
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.action).toBe('http.mutation.denied');
    expect(call.data.diff).toMatchObject({
      method: 'PUT',
      path: '/api/v1/integrations/agent-providers/credentials/claude',
      statusCode: 403,
    });

    await server.close();
  });

  it('does not throw if authenticated context is missing a user id', async () => {
    createMock.mockResolvedValueOnce({} as never);
    const server = Fastify({ logger: false });
    server.addHook('preHandler', async (req) => {
      req.auth = {
        orgId: '11111111-1111-4111-8111-111111111111',
        scopes: ['write'],
        role: 'admin',
      } as typeof req.auth;
    });
    await server.register(mutationAuditPlugin);
    server.patch('/api/v1/users/:id', async () => ({ ok: true }));

    const res = await server.inject({ method: 'PATCH', url: '/api/v1/users/u-1' });

    expect(res.statusCode).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.userId).toBeNull();
    expect(call.data.diff).toMatchObject({
      actorId: null,
      actorKind: 'unknown',
    });

    await server.close();
  });

  it('skips reads, public routes, and API-key pseudo users that cannot satisfy the audit_log user FK', async () => {
    createMock.mockResolvedValueOnce({} as never);
    const server = Fastify({ logger: false });
    withAuth(server, { userId: 'apikey:key-123', scopes: ['read', 'write'] });
    await server.register(mutationAuditPlugin);
    server.get('/api/v1/accounts', async () => ({ ok: true }));
    server.post('/webhooks/dust', { config: { public: true } }, async () => ({ ok: true }));
    server.post('/api/v1/contacts', async () => ({ ok: true }));
    server.patch('/api/v1/users/:id', async () => ({ ok: true }));

    await server.inject({ method: 'GET', url: '/api/v1/accounts' });
    await server.inject({ method: 'POST', url: '/webhooks/dust' });
    await server.inject({ method: 'POST', url: '/api/v1/contacts' });
    await server.inject({ method: 'PATCH', url: '/api/v1/users/u-1' });

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.userId).toBeNull();
    expect(call.data.diff).toMatchObject({
      actorId: 'apikey:key-123',
      actorKind: 'api_key',
    });

    await server.close();
  });

  it('does not audit high-volume presence heartbeats', async () => {
    const server = Fastify({ logger: false });
    withAuth(server);
    await server.register(mutationAuditPlugin);
    server.post('/api/v1/presence', async () => ({ ok: true }));

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/presence',
      payload: { status: 'online' },
    });

    expect(res.statusCode).toBe(200);
    expect(createMock).not.toHaveBeenCalled();

    await server.close();
  });
});
