/**
 * OpenAPI 3.0 auto-generation plugin.
 *
 * Registers `@fastify/swagger` (spec generation) and `@fastify/swagger-ui`
 * (browser UI) using the Zod type-provider already wired in server.ts.
 *
 * Routes: (only when OPENAPI_DOCS_ENABLED=true)
 *   GET /api/openapi.json  — machine-readable OpenAPI 3.0 spec
 *   GET /api/openapi.yaml  — YAML variant for download
 *   GET /api/docs          — Swagger UI (admin-only, CSP-gated)
 *
 * Auth schemes declared:
 *   BearerAuth — Authorization: Bearer <clerk-jwt>
 *   ApiKeyAuth — x-api-key: <key>
 *
 * Tags are applied via route config: `config: { openapi: { tags: ['CRM'] } }`.
 * Routes without a tag land in "Untagged" — acceptable for internal routes.
 */

import type { FastifyPluginAsync } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';

import { config } from '../env.js';

const openapiPluginImpl: FastifyPluginAsync = async (server) => {
  // Always register swagger (spec generation). The spec endpoint is only
  // exposed when OPENAPI_DOCS_ENABLED=true — it may contain internal route
  // names so we default-off in prod until explicitly enabled.
  await server.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'BidStack 360° API',
        description:
          'REST API for BidStack 360° — the bid/presales CRM for Mantu Group. ' +
          'All routes under `/api/v1/` require authentication. ' +
          'Pass either a Clerk JWT (`Authorization: Bearer <token>`) or an ' +
          'API key (`x-api-key: <key>`).',
        version: '1.0.0',
        contact: {
          name: 'BidStack Platform Team',
          email: 'platform@mantu.com',
        },
        license: {
          name: 'Proprietary',
          url: 'https://bidstack.mantu.com',
        },
      },
      servers: [
        {
          url: 'https://api.bidstack.mantu.com',
          description: 'Production',
        },
        {
          url: 'http://localhost:4000',
          description: 'Local development',
        },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Clerk-issued JWT. Obtain via the web app login flow.',
          },
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description: 'API key created in Settings → API Keys.',
          },
        },
      },
      security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication, API keys, sessions' },
        { name: 'CRM', description: 'Contacts, companies, leads, opportunities' },
        { name: 'Tasks', description: 'Task management' },
        { name: 'Activities', description: 'Activity log' },
        { name: 'Proposals', description: 'Proposal lifecycle' },
        { name: 'Bids', description: 'Bid scoring and workspace' },
        { name: 'Analytics', description: 'Sales dashboard, reports, territories' },
        { name: 'Workflows', description: 'Automation workflows' },
        { name: 'Webhooks', description: 'Outbound webhook subscriptions' },
        { name: 'Integrations', description: 'ERP, Dust, Gmail, Microsoft 365' },
        { name: 'Files', description: 'File upload and management' },
        { name: 'Search', description: 'Full-text and faceted search' },
        { name: 'Onboarding', description: 'Onboarding templates and sample data' },
        { name: 'Admin', description: 'Roles, audit logs, custom fields' },
        { name: 'Health', description: 'Health probes and metrics' },
      ],
      externalDocs: {
        url: 'https://docs.bidstack.mantu.com',
        description: 'Full developer documentation',
      },
    },
  });

  if (config.OPENAPI_DOCS_ENABLED !== 'true') {
    // Spec generation is wired but endpoints are not exposed.
    // WHY: spec endpoint exposes internal route structure — default-off until
    // an operator explicitly enables it (e.g. in a private cluster).
    return;
  }

  await server.register(fastifySwaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  // Expose YAML download — handy for partner integrations that prefer YAML.
  server.get(
    '/api/openapi.yaml',
    {
      schema: {
        hide: true, // don't self-reference in the spec
        tags: ['Health'],
      },
    },
    async (_req, reply) => {
      const spec = server.swagger({ yaml: true });
      return reply.type('application/yaml').send(spec);
    },
  );

  // JSON spec — primary machine-readable endpoint.
  server.get(
    '/api/openapi.json',
    {
      schema: {
        hide: true,
        tags: ['Health'],
      },
    },
    async (_req, reply) => {
      const spec = server.swagger();
      return reply.type('application/json').send(spec);
    },
  );
};

/**
 * Fastify plugin wrapper.
 * Must be registered BEFORE route plugins so Swagger sees all route schemas.
 * Must be registered AFTER the Zod type-provider is set up (done in server.ts).
 */
export const openapiPlugin = fp(openapiPluginImpl, {
  name: 'openapi',
  dependencies: [],
});
