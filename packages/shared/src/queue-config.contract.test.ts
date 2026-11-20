// Retry policy contract for every shared queue config: retries are capped,
// retried jobs back off, and failed jobs are kept long enough to inspect but
// never grow the Redis failed set without bound.
import { describe, expect, it } from 'vitest';

import * as configs from './queue-config.js';

interface Candidate {
  name?: unknown;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: unknown;
    removeOnFail?: boolean | number | { age?: number; count?: number };
  };
}

const MAX_ATTEMPTS = 10;

const queueConfigs = Object.entries(configs as Record<string, unknown>).filter(
  (entry): entry is [string, Candidate] => {
    const value = entry[1] as Candidate | null;
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof value.name === 'string' &&
      typeof value.defaultJobOptions === 'object'
    );
  },
);

describe('queue retry policy', () => {
  it('finds the shared queue configs', () => {
    expect(queueConfigs.length).toBeGreaterThan(10);
  });

  it('queue names are unique', () => {
    const names = queueConfigs.map(([, c]) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(queueConfigs)('%s caps retries and backs off', (_key, config) => {
    const opts = config.defaultJobOptions ?? {};
    const attempts = opts.attempts ?? 1;
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
    if (attempts > 1) expect(opts.backoff).toBeDefined();
  });

  it.each(queueConfigs)('%s bounds its failed set', (_key, config) => {
    const removeOnFail = config.defaultJobOptions?.removeOnFail;
    // `false` or missing keeps every failed job forever.
    expect(removeOnFail).toBeDefined();
    expect(removeOnFail).not.toBe(false);
    if (typeof removeOnFail === 'object') {
      expect(removeOnFail.age ?? removeOnFail.count).toBeDefined();
    }
  });
});
