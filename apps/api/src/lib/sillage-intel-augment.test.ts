import type { Logger as PinoLogger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Trigger } from '@bidstack/shared';

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  ensureRedisReady: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  fetchSillageAccountSignals: vi.fn(),
}));

vi.mock('../redis.js', () => ({
  ensureRedisReady: mocks.ensureRedisReady,
  redis: {
    get: mocks.redisGet,
    setex: mocks.redisSetex,
  },
}));

vi.mock('../providers/sillage-signals.js', () => ({
  fetchSillageAccountSignals: mocks.fetchSillageAccountSignals,
}));

import { augmentTriggersWithSillage, sillageIsConfigured } from './sillage-intel-augment.js';

const OLD_ENV = { ...process.env };
const log = { debug: vi.fn(), warn: vi.fn() } as unknown as Pick<PinoLogger, 'debug' | 'warn'>;

function trigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trg-1',
    kind: 'hiring',
    label: 'Posted 4 new AE roles',
    weight: 5,
    observedAt: '2026-07-01T00:00:00.000Z',
    source: 'sillage',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.ensureRedisReady.mockResolvedValue(true);
  mocks.redisGet.mockImplementation(async (key: string) => mocks.store.get(key) ?? null);
  mocks.redisSetex.mockImplementation(async (key: string, _ttl: number, value: string) => {
    mocks.store.set(key, value);
    return 'OK';
  });
  // Unconfigured by default — individual tests opt in with SILLAGE_API_KEY.
  process.env = { ...OLD_ENV, NODE_ENV: 'test', SILLAGE_API_KEY: '', SILLAGE_MCP_URL: '' };
});

afterEach(() => {
  vi.useRealTimers();
  process.env = OLD_ENV;
});

describe('sillageIsConfigured', () => {
  it('is false when neither SILLAGE_MCP_URL nor SILLAGE_API_KEY is set', () => {
    expect(sillageIsConfigured()).toBe(false);
  });

  it('is true when SILLAGE_API_KEY is set', () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    expect(sillageIsConfigured()).toBe(true);
  });
});

describe('augmentTriggersWithSillage', () => {
  it('(a) returns intel unchanged and never calls the provider when unconfigured', async () => {
    const intel = { triggers: [trigger({ id: 'existing' })] };

    const result = await augmentTriggersWithSillage(intel, {
      companyName: 'Acme',
      domain: 'acme.com',
      logger: log,
    });

    expect(result).toBe(intel); // same reference: byte-identical, zero-cost fast path
    expect(mocks.fetchSillageAccountSignals).not.toHaveBeenCalled();
  });

  it('(b) merges provider signals into intel.triggers, deduping a kind+label match against an existing trigger', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    const existing = trigger({
      id: 'existing-1',
      kind: 'hiring',
      label: 'Posted 4 new AE roles',
      weight: 3,
    });
    // Same (kind + label) as `existing` but a different id and higher weight —
    // must lose to the already-persisted trigger, not double up.
    const duplicate = trigger({
      id: 'sillage-dup',
      kind: 'hiring',
      label: 'Posted 4 new AE roles',
      weight: 9,
    });
    const fresh = trigger({ id: 'sillage-2', kind: 'funding', label: 'Raised Series C', weight: 7 });
    mocks.fetchSillageAccountSignals.mockResolvedValue({
      signals: [duplicate, fresh],
      intentScore: 80,
      source: 'rest',
    });

    const intel = { triggers: [existing] };
    const result = (await augmentTriggersWithSillage(intel, {
      companyName: 'Beta Merge Co',
      domain: 'beta-merge.example',
      logger: log,
    })) as { triggers: Trigger[] };

    expect(mocks.fetchSillageAccountSignals).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(intel);
    expect(result.triggers.map((t) => t.id)).toEqual(['sillage-2', 'existing-1']); // sorted by weight desc
    expect(result.triggers.find((t) => t.kind === 'hiring')).toMatchObject({ id: 'existing-1', weight: 3 });
  });

  it('(c) serves the second call from cache and does not call the provider again', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    mocks.fetchSillageAccountSignals.mockResolvedValue({
      signals: [trigger({ id: 'cached-1' })],
      intentScore: 50,
      source: 'rest',
    });

    const input = { companyName: 'Cache Co', domain: 'cache-co.example', logger: log };
    const first = (await augmentTriggersWithSillage({}, input)) as { triggers: Trigger[] };
    const second = (await augmentTriggersWithSillage({}, input)) as { triggers: Trigger[] };

    expect(mocks.fetchSillageAccountSignals).toHaveBeenCalledTimes(1);
    expect(second.triggers.map((t) => t.id)).toEqual(first.triggers.map((t) => t.id));
  });

  it('(d) returns intel unchanged, without throwing, when the provider rejects', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    mocks.fetchSillageAccountSignals.mockRejectedValue(new Error('sillage unreachable'));

    const intel = { triggers: [] as Trigger[] };
    const result = await augmentTriggersWithSillage(intel, {
      companyName: 'Reject Co',
      domain: 'reject-co.example',
      logger: log,
    });

    expect(result).toBe(intel);
  });

  it('(d) returns intel unchanged, without throwing, when the provider hangs past the timeout', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    vi.useFakeTimers();
    mocks.fetchSillageAccountSignals.mockImplementation(() => new Promise(() => {})); // never resolves

    const intel = { triggers: [] as Trigger[] };
    const resultPromise = augmentTriggersWithSillage(intel, {
      companyName: 'Timeout Co',
      domain: 'timeout-co.example',
      logger: log,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await resultPromise;

    expect(result).toBe(intel);
  });

  it('(f) does not persist a negative cache on provider failure, so a later call retries the provider once the in-memory backoff clears', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    vi.useFakeTimers();
    mocks.fetchSillageAccountSignals
      .mockRejectedValueOnce(new Error('sillage unreachable'))
      .mockResolvedValueOnce({
        signals: [trigger({ id: 'recovered-1' })],
        intentScore: 40,
        source: 'rest',
      });

    const input = { companyName: 'Backoff Co', domain: 'backoff-co.example', logger: log };

    await augmentTriggersWithSillage({}, input);
    // A timeout/error must never be written to Redis as if it were a genuine
    // "no signals" result -- that would pin the Buying-triggers card empty for
    // the full 300s negative-cache TTL after one transient failure.
    expect(mocks.redisSetex).not.toHaveBeenCalled();

    // The in-memory failure backoff (30s) is a separate, short-lived throttle;
    // once it clears, the next read must retry the provider instead of being
    // stuck behind a persisted negative result.
    await vi.advanceTimersByTimeAsync(30_000);

    const second = (await augmentTriggersWithSillage({}, input)) as { triggers: Trigger[] };

    expect(mocks.fetchSillageAccountSignals).toHaveBeenCalledTimes(2);
    expect(second.triggers.map((t) => t.id)).toEqual(['recovered-1']);
  });

  it('(g) persists a genuine empty result to the cache, so a second call is served from cache, not the provider', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    mocks.fetchSillageAccountSignals.mockResolvedValue({ signals: [], intentScore: null, source: 'rest' });

    const input = { companyName: 'Quiet Co', domain: 'quiet-co.example', logger: log };

    const first = await augmentTriggersWithSillage({}, input);
    expect(mocks.redisSetex).toHaveBeenCalledTimes(1);
    // Negative-cache TTL (300s) -- distinct from the 3600s positive-result TTL.
    expect(mocks.redisSetex.mock.calls[0]?.[1]).toBe(300);
    expect(first).toEqual({}); // no signals to merge -- intel returned unchanged

    const second = await augmentTriggersWithSillage({}, input);

    expect(mocks.fetchSillageAccountSignals).toHaveBeenCalledTimes(1); // served from cache, not re-fetched
    expect(second).toEqual({});
  });

  it('(e) caps the merged list at 25 and sorts it by weight descending', async () => {
    process.env.SILLAGE_API_KEY = 'sk-test';
    const signals = Array.from({ length: 30 }, (_, i) =>
      trigger({ id: `s-${i}`, kind: 'other', label: `Signal ${i}`, weight: i % 10 }),
    );
    mocks.fetchSillageAccountSignals.mockResolvedValue({ signals, intentScore: 60, source: 'rest' });

    const result = (await augmentTriggersWithSillage(
      {},
      { companyName: 'Cap Co', domain: 'cap-co.example', logger: log },
    )) as { triggers: Trigger[] };

    expect(result.triggers).toHaveLength(25);
    const weights = result.triggers.map((t) => t.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });
});
