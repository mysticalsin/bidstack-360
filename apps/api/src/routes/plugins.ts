import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { Plugin, PluginInstall } from '@bidstack/shared';

export const pluginRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/plugins
  server.get(
    '/plugins',
    {
      schema: { response: { 200: z.object({ items: z.array(Plugin) }) } },
    },
    async (req) => {
      const rows = await prisma.plugin.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { installedAt: 'desc' },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          manifestUrl: r.manifestUrl,
          name: r.name,
          version: r.version,
          permissions: r.permissions,
          config: r.config as Record<string, unknown>,
          active: r.active,
          installedAt: r.installedAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/plugins
  server.post(
    '/plugins',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: PluginInstall,
        response: { 201: Plugin },
      },
    },
    async (req, reply) => {
      // S-M10: Validate manifestUrl is a proper HTTPS URL to prevent SSRF
      // via plugin installation. Only allow https: scheme and no private IPs.
      const manifestUrl = req.body.manifestUrl;
      let url: URL;
      try {
        url = new URL(manifestUrl);
      } catch {
        throw server.httpErrors.badRequest('manifestUrl must be a valid URL');
      }
      if (url.protocol !== 'https:') {
        throw server.httpErrors.badRequest('manifestUrl must use HTTPS');
      }
      // Reject private/internal addresses (basic SSRF defense).
      const hostname = url.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.20.') ||
        hostname.startsWith('172.21.') ||
        hostname.startsWith('172.22.') ||
        hostname.startsWith('172.23.') ||
        hostname.startsWith('172.24.') ||
        hostname.startsWith('172.25.') ||
        hostname.startsWith('172.26.') ||
        hostname.startsWith('172.27.') ||
        hostname.startsWith('172.28.') ||
        hostname.startsWith('172.29.') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.')
      ) {
        throw server.httpErrors.badRequest(
          'manifestUrl must not point to a private or internal address',
        );
      }

      // In production, fetch manifest from URL and validate
      const manifest = {
        name: 'Custom Plugin',
        version: '1.0.0',
        permissions: ['read:opportunities', 'read:contacts'],
      };
      const created = await prisma.plugin.create({
        data: {
          orgId: req.auth.orgId,
          manifestUrl,
          name: manifest.name,
          version: manifest.version,
          permissions: manifest.permissions,
          config: req.body.config as Prisma.InputJsonValue,
        },
      });
      return reply.code(201).send({
        id: created.id,
        orgId: created.orgId,
        manifestUrl: created.manifestUrl,
        name: created.name,
        version: created.version,
        permissions: created.permissions,
        config: created.config as Record<string, unknown>,
        active: created.active,
        installedAt: created.installedAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // DELETE /api/plugins/:id
  server.delete(
    '/plugins/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.plugin.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Plugin not found');
      await prisma.plugin.delete({ where: { id: existing.id } });
      return reply.code(204).send(null);
    },
  );
};
