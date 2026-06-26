import { describe, expect, it } from 'vitest';

import { processSentrySmokeJob } from './sentry-smoke.js';

describe('processSentrySmokeJob', () => {
  it('fails with the worker Sentry smoke marker and release context', async () => {
    await expect(
      processSentrySmokeJob({
        marker: 'bidstack-worker-sentry-smoke',
        release: 'bidstack@test',
        environment: 'staging',
        triggeredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/bidstack-worker-sentry-smoke.*bidstack@test.*staging/);
  });

  it('rejects malformed smoke jobs before emitting a marker', async () => {
    await expect(
      processSentrySmokeJob({
        marker: '',
        release: 'bidstack@test',
        environment: 'staging',
        triggeredAt: 'not-a-date',
      }),
    ).rejects.toThrow();
  });
});
