import { describe, it, expect } from 'vitest';

// Why: the health route returns ok=true ONLY when the DB roundtrip works.
// This contract is what our deploy-status check relies on — if the route
// drifts to "always 200" we lose the deploy-time canary.

describe('health route contract', () => {
  it('exports a Fastify plugin (smoke-only — full route test in integration)', async () => {
    const mod = await import('./health.js');
    expect(typeof mod.healthRoute).toBe('function');
  });
});
