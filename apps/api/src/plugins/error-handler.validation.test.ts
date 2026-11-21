// WHY: Fastify's schema compiler answers a bad body with "body/name Required"
// and "Expected array, received string". That text is the compiler's path
// notation, not a sentence a person can act on, and the page prints it as-is.
// A 413 from the body limit is named FastifyError. Neither may leave this process.

import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorHandlerPlugin } from './error-handler.js';

const LEAK = /body\/|params\/|querystring\/|Expected .+ received|invalid_type|ZodError|FastifyError/;

async function app() {
  const server = Fastify({ logger: false, bodyLimit: 64 }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  await server.register(errorHandlerPlugin);
  server.post(
    '/companies',
    {
      schema: {
        body: z.object({
          name: z.string(),
          rows: z.array(z.string()),
        }),
      },
    },
    async () => ({ ok: true }),
  );
  server.get(
    '/companies/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async () => ({ ok: true }),
  );
  return server;
}

describe('error handler validation envelope', () => {
  let server: Awaited<ReturnType<typeof app>>;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('replaces a schema failure with a safe message and does not echo compiler paths', async () => {
    server = await app();
    const res = await server.inject({
      method: 'POST',
      url: '/companies',
      payload: { rows: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ message: string; code?: string }>();
    expect(body.message).toBe('Validation failed');
    expect(body.code).toBe('validation');
    expect(res.body).not.toMatch(LEAK);
  });

  it('does not describe an invalid id as params/id Invalid uuid', async () => {
    server = await app();
    const res = await server.inject({ method: 'GET', url: '/companies/not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation', message: 'Validation failed' });
    expect(res.body).not.toMatch(LEAK);
  });

  it('names an oversized body as too large, not FastifyError', async () => {
    server = await app();
    const res = await server.inject({
      method: 'POST',
      url: '/companies',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'N'.repeat(200), rows: [] },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      code: 'payload_too_large',
      message: 'That upload is too large.',
    });
    expect(res.body).not.toMatch(LEAK);
  });
});
