import { describe, expect, it } from 'vitest';

import { boundedProbe, probeTimeoutMs } from './bounded-probe.js';

describe('boundedProbe', () => {
  it('passes through a healthy probe', async () => {
    await expect(boundedProbe(async () => 1, 200)).resolves.toBe(true);
    await expect(boundedProbe(async () => true, 200)).resolves.toBe(true);
  });

  it('reports a failing or false probe as down', async () => {
    await expect(boundedProbe(() => Promise.reject(new Error('ECONNREFUSED')), 200)).resolves.toBe(false);
    await expect(boundedProbe(async () => false, 200)).resolves.toBe(false);
  });

  it('answers fast when the dependency hangs', async () => {
    const started = Date.now();
    await expect(boundedProbe(() => new Promise(() => {}), 100)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reads HEALTH_PROBE_TIMEOUT_MS and ignores junk', () => {
    expect(probeTimeoutMs({ HEALTH_PROBE_TIMEOUT_MS: '500' })).toBe(500);
    expect(probeTimeoutMs({ HEALTH_PROBE_TIMEOUT_MS: '-1' })).toBe(2_000);
  });
});
