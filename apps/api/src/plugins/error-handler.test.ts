import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorHandlerPlugin } from './error-handler.js';

describe('error handler', () => {
  it('returns JSON when a response fails its schema', async () => {
    // WHY: a schema miss used to write plain text. The agreements card then
    // showed "Invalid JSON response from server".
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    app.get(
      '/broken',
      { schema: { response: { 200: z.object({ id: z.string().uuid() }) } } },
      async () => ({ id: 'not-a-uuid' }),
    );

    const res = await app.inject({ method: 'GET', url: '/broken' });

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toMatchObject({
      statusCode: 500,
      message: 'Something went wrong',
    });
    await app.close();
  });
});
