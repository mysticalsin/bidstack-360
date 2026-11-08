import { describe, expect, it, vi } from 'vitest';

import {
  DeliveryRetryError,
  deliverOne,
  sendDailyDigest,
  type DeliveryDeps,
} from './notification-delivery.js';

const TEAMS_URL = 'https://prod-1.westeurope.logic.azure.com/workflows/abc';

function fakeDeps(over: Partial<DeliveryDeps> = {}, env: NodeJS.ProcessEnv = {}) {
  const claims = new Map<string, string>();
  const counters = new Map<string, number>();
  const markSent = vi.fn(async () => undefined);
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
  const deps: DeliveryDeps = {
    store: {
      findUser: vi.fn(async () => ({ email: 'ana@polo.test', name: 'Ana' })),
      findTeamsWebhookEnc: vi.fn(async () => 'enc'),
      markSent,
      digestRecipients: vi.fn(async () => [{ orgId: 'o', userId: 'u' }]),
      digestItems: vi.fn(async () => [
        { title: 'New meeting on Pfizer', body: 'Bo: New meeting on Pfizer', url: '/companies/c' },
      ]),
    },
    limiter: {
      claim: async (key, _ttl, owner) => {
        const held = claims.get(key);
        if (held === undefined) {
          claims.set(key, owner);
          return true;
        }
        return held === owner;
      },
      incr: async (key) => {
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        return n;
      },
    },
    decrypt: () => TEAMS_URL,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    env: { PUBLIC_BASE_URL: 'https://polo.test', ...env },
    log: { info: vi.fn(), warn: vi.fn() },
    now: () => new Date('2026-11-07T12:00:00Z'),
    ...over,
  };
  return { deps, fetchImpl, markSent };
}

const job = (channel: 'email' | 'teams', companyId: string | null = 'c1') => ({
  kind: 'deliver' as const,
  channel,
  orgId: 'o',
  userId: 'u',
  notificationId: 'n1',
  companyId,
  title: 'New meeting on Pfizer',
  body: 'Bo: New meeting on Pfizer',
  url: '/companies/c1',
});

const MAIL_ENV = { RESEND_API_KEY: 'test-key', NOTIFICATION_FROM_EMAIL: 'alerts@polo.test' };

describe('deliverOne email', () => {
  it('logs and skips when no mail provider is configured', async () => {
    const { deps, fetchImpl } = fakeDeps();
    expect(await deliverOne(job('email'), deps, 'j1')).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends through the fake provider with an absolute Open link and marks the row', async () => {
    const { deps, fetchImpl, markSent } = fakeDeps({}, MAIL_ENV);
    expect(await deliverOne(job('email'), deps, 'j1')).toBe('sent');
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.to).toEqual(['ana@polo.test']);
    expect(body.html).toContain('https://polo.test/companies/c1');
    expect(markSent).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', notificationId: 'n1' }),
    );
  });

  it('coalesces a second alert on the same account inside the window', async () => {
    const { deps, fetchImpl } = fakeDeps({}, MAIL_ENV);
    await deliverOne(job('email'), deps, 'j1');
    expect(await deliverOne(job('email'), deps, 'j2')).toBe('coalesced');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a retry of the same job is not treated as a repeat', async () => {
    const { deps } = fakeDeps({}, MAIL_ENV);
    await deliverOne(job('email'), deps, 'j1');
    expect(await deliverOne(job('email'), deps, 'j1')).toBe('sent');
  });

  it('rate limits per user per channel per hour', async () => {
    const { deps } = fakeDeps({}, MAIL_ENV);
    const outcomes = [];
    for (let i = 0; i < 22; i++) outcomes.push(await deliverOne(job('email', null), deps, `j${i}`));
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(20);
    expect(outcomes.at(-1)).toBe('rate_limited');
  });

  it('retries on a provider outage', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const { deps } = fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }, MAIL_ENV);
    await expect(deliverOne(job('email'), deps, 'j1')).rejects.toBeInstanceOf(DeliveryRetryError);
  });
});

describe('deliverOne Teams', () => {
  it('posts an Adaptive Card to the saved webhook', async () => {
    const { deps, fetchImpl } = fakeDeps();
    expect(await deliverOne(job('teams'), deps, 'j1')).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TEAMS_URL);
    expect(JSON.parse(init.body as string).attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
  });

  it('skips when the user has no webhook', async () => {
    const { deps, fetchImpl } = fakeDeps();
    deps.store.findTeamsWebhookEnc = vi.fn(async () => null);
    expect(await deliverOne(job('teams'), deps, 'j1')).toBe('no_webhook');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never posts to a stored URL that is not a Microsoft host', async () => {
    const { deps, fetchImpl } = fakeDeps({ decrypt: () => 'https://evil.example/hook' });
    expect(await deliverOne(job('teams'), deps, 'j1')).toBe('provider_rejected');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('sendDailyDigest', () => {
  it('skips everything when no provider is configured', async () => {
    const { deps, fetchImpl } = fakeDeps();
    expect(await sendDailyDigest(deps)).toEqual({ sent: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends one summary per opted-in user', async () => {
    const { deps, fetchImpl } = fakeDeps({}, MAIL_ENV);
    expect(await sendDailyDigest(deps)).toEqual({ sent: 1, skipped: 0 });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.subject).toBe('Polo: 1 account update in the last day');
  });
});
