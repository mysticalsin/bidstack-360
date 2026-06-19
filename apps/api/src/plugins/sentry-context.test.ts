import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
}));

const Sentry = await import('@sentry/node');
const { SENTRY_UNAUTHENTICATED_ORG_TAG, applySentryAuthScope, clearSentryAuthScope, sentryPlugin } =
  await import('./sentry.js');
const { errorHandlerPlugin } = await import('./error-handler.js');

describe('Sentry request context', () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/1';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
  });

  it('sets a non-PII user identity for authenticated requests', () => {
    applySentryAuthScope({
      orgId: 'org-123',
      userId: 'user-456',
    });

    expect(Sentry.setTag).toHaveBeenCalledWith('orgId', 'org-123');
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-456' });
    expect(JSON.stringify(vi.mocked(Sentry.setUser).mock.calls)).not.toContain('email');
    expect(JSON.stringify(vi.mocked(Sentry.setUser).mock.calls)).not.toContain('@');
  });

  it('clears stale tenant tags when auth context is absent or finished', () => {
    applySentryAuthScope({
      orgId: 'org-previous',
      userId: 'user-previous',
    });
    applySentryAuthScope({});

    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
    expect(Sentry.setTag).toHaveBeenLastCalledWith('orgId', SENTRY_UNAUTHENTICATED_ORG_TAG);

    clearSentryAuthScope();

    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
    expect(Sentry.setTag).toHaveBeenLastCalledWith('orgId', SENTRY_UNAUTHENTICATED_ORG_TAG);
  });

  it('clears request user and tenant context after each response', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://examplePublicKey@o0.ingest.sentry.io/1');
    const app = Fastify();
    await app.register(sentryPlugin);
    app.addHook('preHandler', async (req) => {
      (req as unknown as { auth: { orgId: string; userId: string } }).auth = {
        orgId: 'org-request',
        userId: 'user-request',
      };
    });
    app.get('/ok', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ok' });

    expect(response.statusCode).toBe(200);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
    expect(Sentry.setTag).toHaveBeenLastCalledWith('orgId', SENTRY_UNAUTHENTICATED_ORG_TAG);
    await app.close();
  });

  it('captures handled Fastify 5xx errors for operational alerting', async () => {
    const app = Fastify();
    await app.register(sentryPlugin);
    await app.register(errorHandlerPlugin);
    app.get('/boom', async () => {
      throw new Error('sentry proof failure');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    await app.close();
  });

  it('does not capture expected client-abort errors as server incidents', async () => {
    const app = Fastify();
    await app.register(sentryPlugin);
    await app.register(errorHandlerPlugin);
    app.get('/client-abort', async () => {
      throw Object.assign(new Error('premature close'), {
        code: 'ERR_STREAM_PREMATURE_CLOSE',
      });
    });

    const response = await app.inject({ method: 'GET', url: '/client-abort' });

    expect(response.statusCode).toBe(499);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    await app.close();
  });
});
