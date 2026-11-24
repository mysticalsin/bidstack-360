// The click route is a factory. It is not mounted by server.routes today.
// Mounting it must not turn a tracking token plus ?url= into an open redirect
// or a response-splitting Location header. The pixel row stores no destination.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';

import { createTrackRoutes } from './track.js';

const TARGETS = [
  'https://evil.example/phish',
  'http://evil.example/phish',
  'https://evil.example/%0d%0aSet-Cookie:%20a=b',
  'javascript:alert(1)',
  '//evil.example/phish',
];

describe('GET /track/email/click/:token', () => {
  it.each(TARGETS)('does not redirect to %s', async (url) => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible);
    await app.register(createTrackRoutes());
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/track/email/click/${'a'.repeat(24)}?url=${encodeURIComponent(url)}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).not.toContain('evil.example');
    expect(res.body).not.toContain('Set-Cookie');
    await app.close();
  });
});
