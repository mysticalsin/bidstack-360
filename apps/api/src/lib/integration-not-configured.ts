import type { FastifyRequest } from 'fastify';

/** Body for a 503 a non-admin can see. The env var name stays in the log. */
export const INTEGRATION_NOT_CONFIGURED = 'integration not configured';

export function throwIntegrationNotConfigured(req: FastifyRequest, missingEnv: string): never {
  req.log.warn({ missingEnv }, INTEGRATION_NOT_CONFIGURED);
  throw req.server.httpErrors.serviceUnavailable(INTEGRATION_NOT_CONFIGURED);
}
