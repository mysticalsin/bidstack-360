// F-07: the no-queue fallback must not put the pixel token on the warn record
// when the direct update throws. The token is the capability for the pixel.

import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    emailTrackingPixel: {
      findUnique: vi.fn(async () => {
        throw new Error('db down');
      }),
    },
  },
}));

import { createTrackRoutes } from './track.js';

const TOKEN = 'c'.repeat(24);

describe('track-open DB fallback log (F-07)', () => {
  it('hashes the token when the direct update throws', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const app = Fastify({
      disableRequestLogging: true,
      logger: { level: 'warn', stream },
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible);
    await app.register(createTrackRoutes());
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/track/email/open/${TOKEN}`,
      });
      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      const logged = lines.join('\n');
      expect(logged).not.toContain(TOKEN);
      expect(logged).toContain(createHash('sha256').update(TOKEN).digest('hex').slice(0, 8));
      expect(logged).not.toMatch(/"token"\s*:/);
    } finally {
      await app.close();
    }
  });
});
