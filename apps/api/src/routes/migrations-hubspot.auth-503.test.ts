// WHY: the HubSpot start route is the one 503 that still named env vars.
// Admin or not, the body stays a fixed sentence. The names stay in the log.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../plugins/error-handler.js';
import { hubspotMigrationRoutes } from './migrations-hubspot.routes.js';

describe('HubSpot auth 503', () => {
  const previous = {
    client: process.env.HUBSPOT_CLIENT_ID,
    redirect: process.env.HUBSPOT_REDIRECT_URI,
  };
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    restore('HUBSPOT_CLIENT_ID', previous.client);
    restore('HUBSPOT_REDIRECT_URI', previous.redirect);
  });

  it('does not name HUBSPOT_CLIENT_ID or HUBSPOT_REDIRECT_URI', async () => {
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_REDIRECT_URI;
    const lines: string[] = [];
    const server = Fastify({
      logger: {
        level: 'warn',
        stream: {
          write(chunk: string) {
            lines.push(chunk);
          },
        },
      },
    }).withTypeProvider<ZodTypeProvider>();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    await server.register(sensible);
    await server.register(errorHandlerPlugin);
    server.decorate('requirePermission', () => async () => undefined);
    await server.register(hubspotMigrationRoutes);
    close = () => server.close();

    const res = await server.inject({ method: 'GET', url: '/migrations/hubspot/auth' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      statusCode: 503,
      message: 'HubSpot is not configured',
    });
    expect(res.body).not.toContain('HUBSPOT_CLIENT_ID');
    expect(res.body).not.toContain('HUBSPOT_REDIRECT_URI');
    const logged = lines.join('\n');
    expect(logged).toContain('HUBSPOT_CLIENT_ID');
    expect(logged).toContain('HUBSPOT_REDIRECT_URI');
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
