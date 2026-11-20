import { describe, expect, it } from 'vitest';

import { boundedProbe, probeTimeoutMs, workerReadiness } from './health-probe.js';

const hang = () => new Promise<never>(() => {});

describe('worker readiness', () => {
  it('is ready when Redis and Postgres answer', async () => {
    const r = await workerReadiness('ready', async () => 1, 200);
    expect(r).toEqual({ ok: true, body: { status: 'ok', queue: 'connected', db: 'connected' } });
  });

  it('degrades when Postgres is down', async () => {
    const r = await workerReadiness('ready', async () => {
      throw new Error('ECONNREFUSED');
    }, 200);
    expect(r.ok).toBe(false);
    expect(r.body.db).toBe('disconnected');
  });

  it('degrades when Redis is reconnecting', async () => {
    const r = await workerReadiness('reconnecting', async () => 1, 200);
    expect(r.ok).toBe(false);
    expect(r.body.queue).toBe('disconnected');
  });

  it('answers fast when Postgres hangs', async () => {
    const started = Date.now();
    const r = await workerReadiness('ready', hang, 100);
    expect(r.body.db).toBe('disconnected');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('boundedProbe turns a rejection into false', async () => {
    await expect(boundedProbe(() => Promise.reject(new Error('x')), 100)).resolves.toBe(false);
  });

  it('reads HEALTH_PROBE_TIMEOUT_MS and ignores junk', () => {
    expect(probeTimeoutMs({ HEALTH_PROBE_TIMEOUT_MS: '750' })).toBe(750);
    expect(probeTimeoutMs({ HEALTH_PROBE_TIMEOUT_MS: 'nope' })).toBe(2_000);
    expect(probeTimeoutMs({})).toBe(2_000);
  });
});
