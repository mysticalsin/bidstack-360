import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    apiVersion: string;
  }
}

const DEFAULT_VERSION = 'v1';
const ALLOWED_VERSIONS = new Set([DEFAULT_VERSION]);

export const apiVersioningPlugin: FastifyPluginAsync = fp(async (server) => {
  server.decorateRequest('apiVersion', DEFAULT_VERSION);

  server.addHook('onRequest', async (req, _reply) => {
    const url = req.url;
    let headerVersion: string | undefined;
    let pathVersion: string | undefined;

    const header = req.headers['x-api-version'];
    if (typeof header === 'string') {
      headerVersion = `v${header}`;
    }

    const pathMatch = url.match(/^\/api\/(v\d+)\//);
    if (pathMatch) {
      pathVersion = pathMatch[1];
    }

    if (headerVersion && pathVersion && headerVersion !== pathVersion) {
      throw req.server.httpErrors.badRequest(
        `X-API-Version header (${headerVersion}) does not match URL version (${pathVersion})`,
      );
    }

    const resolved = pathVersion ?? headerVersion ?? DEFAULT_VERSION;
    req.apiVersion = resolved;

    if (!ALLOWED_VERSIONS.has(resolved)) {
      throw req.server.httpErrors.notFound(`API version ${resolved} is not supported`);
    }
  });

  server.addHook('onSend', async (_req, reply) => {
    reply.header('X-API-Version', DEFAULT_VERSION);
  });
});
