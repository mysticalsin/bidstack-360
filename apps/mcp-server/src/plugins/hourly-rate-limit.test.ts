// Hourly rate-limit tests.
//
// Goal: prove the Redis-backed sliding window is *shared* across two
// simulated MCP server replicas. The pre-fix code used a process-local Map
// which let an attacker multiply their effective budget by the replica
// count.
//
// Strategy: build two independent Fastify servers, register the plugin on
// each, but inject the SAME fake Redis client into both. If the plugin's
// state lives in Redis, the two servers will see the same total and stop
// the abuser at MAX_HOURLY combined; if it ever regresses to in-memory, the
// combined budget will be 2x MAX_HOURLY and the test will fail loud.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { hourlyRateLimitPlugin, MAX_HOURLY } from './hourly-rate-limit.js';

// ─── Fake Redis ──────────────────────────────────────────────────────────────
// Implements only the methods our plugin calls: pipeline().incr().expire().mget().exec().
// Both replicas share one instance, mirroring how a real Redis is shared in
// production. TTLs are tracked but we never advance time within a single test,
// so explicit expiration is unnecessary — the test concerns budget arithmetic,
// not key eviction.

interface PipelineOp {
  kind: 'incr' | 'expire' | 'mget';
  args: unknown[];
}

class FakeRedis {
  private store = new Map<string, number>();

  pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  incr(key: string): number {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  expire(_key: string, _seconds: number): number {
    // No-op for the purposes of these tests — we never roll the clock past TTL.
    return 1;
  }

  mget(keys: string[]): Array<string | null> {
    return keys.map((k) => {
      const v = this.store.get(k);
      return v === undefined ? null : String(v);
    });
  }
}

class FakePipeline {
  private ops: PipelineOp[] = [];
  constructor(private readonly redis: FakeRedis) {}

  incr(key: string): this {
    this.ops.push({ kind: 'incr', args: [key] });
    return this;
  }

  expire(key: string, seconds: number): this {
    this.ops.push({ kind: 'expire', args: [key, seconds] });
    return this;
  }

  mget(...keys: string[]): this {
    this.ops.push({ kind: 'mget', args: keys });
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    return this.ops.map((op) => {
      try {
        if (op.kind === 'incr') return [null, this.redis.incr(op.args[0] as string)];
        if (op.kind === 'expire')
          return [null, this.redis.expire(op.args[0] as string, op.args[1] as number)];
        if (op.kind === 'mget') return [null, this.redis.mget(op.args as string[])];
        throw new Error(`Unknown op: ${String(op.kind)}`);
      } catch (err) {
        return [err as Error, undefined];
      }
    });
  }
}

// ─── Failing Redis (for fail-open assertion) ─────────────────────────────────

class FailingRedis {
  pipeline(): { exec: () => Promise<never> } {
    return {
      exec: async () => {
        throw new Error('connection refused');
      },
    };
  }
}

// ─── Test helpers ────────────────────────────────────────────────────────────

interface ReplicaOpts {
  redis: FakeRedis | FailingRedis;
}

async function buildReplica({ redis }: ReplicaOpts) {
  const server = Fastify({ logger: false });
  await server.register(sensible);
  // Cast: FakeRedis intentionally only implements the subset our plugin uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await server.register(hourlyRateLimitPlugin, { redis: redis as any });
  server.post('/mcp', async () => ({ ok: true }));
  await server.ready();
  return server;
}

async function callMcp(server: Awaited<ReturnType<typeof buildReplica>>, token: string) {
  return server.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('mcp hourly rate-limit (Redis-backed)', () => {
  it('shares the per-key budget across two replicas', async () => {
    // Same Redis injected into both replicas — mirrors prod where every pod
    // talks to the cluster-wide Redis.
    const sharedRedis = new FakeRedis();
    const replicaA = await buildReplica({ redis: sharedRedis });
    const replicaB = await buildReplica({ redis: sharedRedis });
    const token = 'shared-budget-token';

    try {
      // Each replica handles half the budget. Total = MAX_HOURLY, all 2xx.
      const half = MAX_HOURLY / 2;
      for (let i = 0; i < half; i += 1) {
        const res = await callMcp(replicaA, token);
        expect(res.statusCode).toBe(200);
      }
      for (let i = 0; i < half; i += 1) {
        const res = await callMcp(replicaB, token);
        expect(res.statusCode).toBe(200);
      }

      // The 601st request on either replica must be rejected because the
      // budget is shared. Pre-fix code would have allowed up to MAX_HOURLY
      // *per replica* because each pod owned its own in-memory counter.
      const overflowFromB = await callMcp(replicaB, token);
      expect(overflowFromB.statusCode).toBe(429);
      expect(overflowFromB.headers['retry-after']).toBeDefined();

      const overflowFromA = await callMcp(replicaA, token);
      expect(overflowFromA.statusCode).toBe(429);
    } finally {
      await replicaA.close();
      await replicaB.close();
    }
  });

  it('isolates budgets by token (different keys do not contend)', async () => {
    const sharedRedis = new FakeRedis();
    const replica = await buildReplica({ redis: sharedRedis });
    try {
      // Burn the whole budget for tokenA.
      for (let i = 0; i < MAX_HOURLY; i += 1) {
        const res = await callMcp(replica, 'tokenA');
        expect(res.statusCode).toBe(200);
      }
      const overflowA = await callMcp(replica, 'tokenA');
      expect(overflowA.statusCode).toBe(429);

      // tokenB should still get full budget — the hashing keys them
      // independently so an abuser cannot starve a co-tenant.
      const okB = await callMcp(replica, 'tokenB');
      expect(okB.statusCode).toBe(200);
    } finally {
      await replica.close();
    }
  });

  it('fails open when Redis is unreachable', async () => {
    // Operations runbook: a Redis outage temporarily disables the hourly
    // window guard. The 60/min @fastify/rate-limit (also Redis-backed but
    // with skipOnError) covers the short window. Failing closed would 503
    // every MCP call during a Redis incident, which is worse than a brief
    // enforcement gap.
    const replica = await buildReplica({ redis: new FailingRedis() });
    try {
      const res = await callMcp(replica, 'any-token');
      expect(res.statusCode).toBe(200);
    } finally {
      await replica.close();
    }
  });

  it('only enforces on /mcp paths, leaving /health alone', async () => {
    const sharedRedis = new FakeRedis();
    const server = Fastify({ logger: false });
    await server.register(sensible);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await server.register(hourlyRateLimitPlugin, { redis: sharedRedis as any });
    server.get('/health', async () => ({ ok: true }));
    await server.ready();
    try {
      // Hit /health far more than MAX_HOURLY — should never get rate-limited
      // because the plugin's hook short-circuits on non-MCP paths.
      for (let i = 0; i < MAX_HOURLY + 50; i += 1) {
        const res = await server.inject({
          method: 'GET',
          url: '/health',
          headers: { authorization: 'Bearer never-counted' },
        });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await server.close();
    }
  });
});
