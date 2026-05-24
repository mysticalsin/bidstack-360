// Unit tests for the auth audit-log helper.
//
// We mock Prisma rather than touching Postgres so the tests run in the
// same suite as the unit-only plugin tests (auth.test.ts, rbac.test.ts).
// Integration coverage for the calling auth flow lives in
// audit-logs.test.ts and the auth plugin's own integration tests.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '@bidstack/db';
import { clientFingerprint, writeAuthAudit } from './auth-audit.js';

const createMock = vi.mocked(prisma.auditLog.create);

function mockRequest(opts: { ip?: string | null; ua?: string | null } = {}) {
  return {
    ip: opts.ip === null ? '' : (opts.ip ?? '203.0.113.7'),
    headers: opts.ua === null ? {} : { 'user-agent': opts.ua ?? 'jest/1' },
    log: { warn: vi.fn() },
  } as unknown as Parameters<typeof writeAuthAudit>[0];
}

afterEach(() => {
  createMock.mockReset();
});

describe('clientFingerprint', () => {
  it('returns ip and userAgent when both are present', () => {
    const result = clientFingerprint(mockRequest({ ip: '198.51.100.1', ua: 'curl/7' }));
    expect(result).toEqual({ ip: '198.51.100.1', userAgent: 'curl/7' });
  });

  it('coerces missing fields to explicit null instead of empty strings', () => {
    // The audit log diff is JSONB, so null and undefined are equivalent
    // in storage but null is more searchable. Lock the contract here.
    const result = clientFingerprint(mockRequest({ ip: null, ua: null }));
    expect(result).toEqual({ ip: null, userAgent: null });
  });
});

describe('writeAuthAudit', () => {
  it('forwards the action and folds ip + userAgent into the diff', async () => {
    createMock.mockResolvedValueOnce({} as never);
    const req = mockRequest({ ip: '198.51.100.2', ua: 'Mozilla/x' });

    await writeAuthAudit(req, {
      action: 'auth.login',
      orgId: 'org-1',
      actorUserId: 'user-1',
      targetType: 'user',
      targetId: 'user-1',
      diff: { newUser: false, role: 'admin' },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.action).toBe('auth.login');
    expect(call.data.orgId).toBe('org-1');
    expect(call.data.userId).toBe('user-1');
    expect(call.data.targetType).toBe('user');
    expect(call.data.targetId).toBe('user-1');
    expect(call.data.diff).toEqual({
      newUser: false,
      role: 'admin',
      ip: '198.51.100.2',
      userAgent: 'Mozilla/x',
    });
  });

  it('skips the write and warns when orgId is empty', async () => {
    // audit_log.org_id is NOT NULL — without this guard a misconfigured
    // caller would 5xx on every sign-in attempt while we tried to insert.
    const req = mockRequest();
    await writeAuthAudit(req, {
      action: 'auth.login_failed',
      orgId: '',
      actorUserId: null,
      diff: { reason: 'unknown_org' },
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(req.log.warn as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login_failed' }),
      expect.stringContaining('orgId is empty'),
    );
  });

  it('swallows Prisma errors so a sign-in is never blocked by audit failure', async () => {
    // Critical contract: writeAuthAudit must NEVER throw. The audit-log
    // write is best-effort — a corrupted JSON column, a connection pool
    // exhaustion, or a constraint failure cannot turn into a 5xx for the
    // signing-in user. The signal that audit was lost is the pino warn
    // line plus the standard SLO alert on audit_log write failures.
    createMock.mockRejectedValueOnce(new Error('connection terminated'));
    const req = mockRequest();

    await expect(
      writeAuthAudit(req, {
        action: 'auth.login',
        orgId: 'org-1',
        actorUserId: 'user-1',
        diff: { role: 'member' },
      }),
    ).resolves.not.toThrow();

    expect(req.log.warn as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login' }),
      expect.stringContaining('audit-log write failed'),
    );
  });
});
