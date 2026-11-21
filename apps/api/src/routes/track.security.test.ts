// Hammer ARTEX F-02 / F-07 / F-08.
// A tracking token is already in the recipient's mail. The click route may
// redirect only to an https URL this server signed for that token. Open
// tracking must record req.ip (trust-proxy applied) and must not write the
// raw token into warn logs.

import { createHash, createHmac } from 'node:crypto';
import { Writable } from 'node:stream';

import sensible from '@fastify/sensible';
import type { Queue } from 'bullmq';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';

import { hopCountTrust } from '../lib/trust-proxy.js';

import { createTrackRoutes } from './track.js';

const SECRET = 'test-click-secret';
const TOKEN = 'b'.repeat(24);

function clickSig(token: string, url: string, secret = SECRET): string {
  const canonical = new URL(url).href;
  return createHmac('sha256', secret).update(`${token}\n${canonical}`).digest('base64url');
}

function tokenLogId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

async function clickApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(createTrackRoutes());
  await app.ready();
  return app;
}

afterEach(() => {
  delete process.env.EMAIL_CLICK_SIGNING_SECRET;
});

describe('GET /track/email/click signed target (F-02)', () => {
  it('redirects to the https URL signed for this token and nowhere else', async () => {
    process.env.EMAIL_CLICK_SIGNING_SECRET = SECRET;
    const target = 'https://customer.example/pricing';
    const app = await clickApp();
    try {
      const ok = await app.inject({
        method: 'GET',
        url: `/track/email/click/${TOKEN}?url=${encodeURIComponent(target)}&sig=${clickSig(TOKEN, target)}`,
      });
      expect(ok.statusCode).toBe(302);
      expect(ok.headers.location).toBe(target);

      const swapped = await app.inject({
        method: 'GET',
        url: `/track/email/click/${TOKEN}?url=${encodeURIComponent('https://attacker.example/login')}&sig=${clickSig(TOKEN, target)}`,
      });
      expect(swapped.statusCode).toBe(404);
      expect(swapped.headers.location).toBeUndefined();

      const httpTarget = 'http://customer.example/pricing';
      const insecure = await app.inject({
        method: 'GET',
        url: `/track/email/click/${TOKEN}?url=${encodeURIComponent(httpTarget)}&sig=${clickSig(TOKEN, httpTarget)}`,
      });
      expect(insecure.statusCode).toBe(404);
      expect(insecure.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('GET /track/email/open client IP and logs (F-07, F-08)', () => {
  it('queues req.ip when a public peer spoofs X-Forwarded-For', async () => {
    const queued: Array<{ token?: string; ip?: string | null }> = [];
    const queue = {
      add: async (_name: string, data: { token?: string; ip?: string | null }) => {
        queued.push(data);
      },
    } as unknown as Queue;
    const app = Fastify({ trustProxy: hopCountTrust(2) });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible);
    await app.register(createTrackRoutes(queue));
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/track/email/open/${TOKEN}`,
        remoteAddress: '52.10.0.20',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      expect(res.statusCode).toBe(200);
      expect(queued).toEqual([{ token: TOKEN, ip: '52.10.0.20' }]);
    } finally {
      await app.close();
    }
  });

  it('does not write the raw tracking token when the open queue rejects', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const queue = {
      add: async () => {
        throw new Error('queue down');
      },
    } as unknown as Queue;
    const app = Fastify({
      disableRequestLogging: true,
      logger: { level: 'warn', stream },
      trustProxy: hopCountTrust(2),
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible);
    await app.register(createTrackRoutes(queue));
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/track/email/open/${TOKEN}`,
        remoteAddress: '52.10.0.20',
      });
      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
      const logged = lines.join('\n');
      expect(logged).not.toContain(TOKEN);
      expect(logged).toContain(tokenLogId(TOKEN));
      expect(logged).not.toMatch(/"token"\s*:/);
    } finally {
      await app.close();
    }
  });
});
