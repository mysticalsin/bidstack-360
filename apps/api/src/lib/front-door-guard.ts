import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

/**
 * Azure Front Door origin lock.
 *
 * Container Apps ingress is publicly reachable, so without this check a client
 * can skip Front Door (and its WAF) and talk to the origin directly, where it
 * also controls X-Forwarded-For. Front Door stamps every request it forwards
 * with `X-Azure-FDID: <profile frontDoorId>`; when AZURE_FRONT_DOOR_ID is set
 * we reject anything that does not carry that exact value.
 *
 * Platform probes (/livez, /readyz, /health) and the bearer-protected /metrics
 * scrape come from inside the environment and are exempt.
 *
 * Unset = disabled (local dev, CI, non-Azure deploys).
 */
const EXEMPT_PATHS = new Set(['/livez', '/readyz', '/health', '/metrics']);

function sameId(a: string, b: string): boolean {
  const ab = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function registerFrontDoorGuard(server: FastifyInstance, expectedId: string | undefined): void {
  const expected = expectedId?.trim();
  if (!expected) return;
  server.addHook('onRequest', async (req, reply) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (EXEMPT_PATHS.has(path)) return;
    const header = req.headers['x-azure-fdid'];
    const got = Array.isArray(header) ? header[0] : header;
    if (typeof got === 'string' && sameId(got.trim(), expected)) return;
    return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Forbidden' });
  });
}
