import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureExceptionMock, enqueueSentrySmokeMock, initSentryMock, setTagMock, setUserMock } =
  vi.hoisted(() => ({
    captureExceptionMock: vi.fn(),
    enqueueSentrySmokeMock: vi.fn(),
    initSentryMock: vi.fn(),
    setTagMock: vi.fn(),
    setUserMock: vi.fn(),
  }));

vi.mock('@sentry/node', () => ({
  captureException: captureExceptionMock,
  init: initSentryMock,
  setTag: setTagMock,
  setUser: setUserMock,
}));

vi.mock('../queues/sentry-smoke.js', () => ({
  enqueueSentrySmoke: enqueueSentrySmokeMock,
}));

import { buildServer } from '../server.js';

const smokeToken = 'release-smoke-token-1234567890';
const envKeys = [
  'SENTRY_SMOKE_ENABLED',
  'SENTRY_SMOKE_TOKEN',
  'SENTRY_DSN',
  'SENTRY_RELEASE',
  'SENTRY_ENVIRONMENT',
] as const;
const originalEnv = new Map<string, string | undefined>();

async function buildReadyServer() {
  const server = await buildServer();
  await server.ready();
  return server;
}

describe('ops Sentry smoke routes', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.SENTRY_SMOKE_ENABLED = 'true';
    process.env.SENTRY_SMOKE_TOKEN = smokeToken;
    process.env.SENTRY_DSN = 'https://public@example.com/1';
    process.env.SENTRY_RELEASE = 'bidstack@test';
    process.env.SENTRY_ENVIRONMENT = 'staging';
    enqueueSentrySmokeMock.mockReset();
    captureExceptionMock.mockReset();
    initSentryMock.mockReset();
    setTagMock.mockReset();
    setUserMock.mockReset();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  it('stays invisible unless explicitly enabled', async () => {
    process.env.SENTRY_SMOKE_ENABLED = 'false';
    const server = await buildReadyServer();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/ops/sentry-smoke/worker',
        headers: { 'x-bidstack-sentry-smoke-token': smokeToken },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(enqueueSentrySmokeMock).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('rejects requests without the dedicated smoke token', async () => {
    const server = await buildReadyServer();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/ops/sentry-smoke/worker',
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      expect(enqueueSentrySmokeMock).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('queues a worker smoke failure with release and environment context', async () => {
    enqueueSentrySmokeMock.mockResolvedValue('sentry-smoke-job-1');
    const server = await buildReadyServer();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/ops/sentry-smoke/worker',
        headers: { 'x-bidstack-sentry-smoke-token': smokeToken },
        payload: {},
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({
        queued: true,
        jobId: 'sentry-smoke-job-1',
        marker: 'bidstack-worker-sentry-smoke',
        release: 'bidstack@test',
        environment: 'staging',
      });
      expect(enqueueSentrySmokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          marker: 'bidstack-worker-sentry-smoke',
          release: 'bidstack@test',
          environment: 'staging',
          triggeredAt: expect.any(String),
        }),
      );
    } finally {
      await server.close();
    }
  });

  it('creates a controlled API 5xx marker for Sentry evidence', async () => {
    const server = await buildReadyServer();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/ops/sentry-smoke/api',
        headers: { authorization: `Bearer ${smokeToken}` },
        payload: { marker: 'release-2026-06-17' },
      });

      expect(res.statusCode).toBe(500);
      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
      const captured = captureExceptionMock.mock.calls[0]?.[0];
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toContain('bidstack-api-sentry-smoke');
      expect((captured as Error).message).toContain('release-2026-06-17');
    } finally {
      await server.close();
    }
  });
});
