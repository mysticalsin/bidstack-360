/**
 * demo.ts — public endpoints for the "try the demo" door.
 *
 * Only mounted when DEMO_MODE is armed (see plugins/demo-auth.ts for the gate).
 * `POST /demo/session` is the passwordless sign-in: an email in, a signed demo
 * Bearer token out (the SPA then sends it as `Authorization: Bearer`). Tightly
 * rate-limited because each new email provisions + seeds a fresh org.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { isDemoMode, provisionDemoSession } from '../plugins/demo-auth.js';

const SessionBody = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120).optional(),
});

const SessionResponse = z.object({
  token: z.string(),
  email: z.string(),
  orgId: z.string(),
});

export const demoRoutes: FastifyPluginAsync = async (server) => {
  // No demo mode → no public door. The route simply never registers.
  if (!isDemoMode()) return;

  // Lets the SPA detect demo mode and render the demo sign-in screen.
  server.get('/demo/status', { config: { public: true } }, async () => ({ demoMode: true }));

  server.post(
    '/demo/session',
    {
      config: {
        public: true,
        // Each call provisions + seeds an org — keep it tight per IP.
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
      schema: {
        body: SessionBody,
        response: { 200: SessionResponse },
      },
    },
    async (req, reply) => {
      const { email, name } = req.body as z.infer<typeof SessionBody>;
      try {
        return await provisionDemoSession(email, name);
      } catch (err) {
        if ((err as Error).message === 'DEMO_AT_CAPACITY') {
          return reply.serviceUnavailable(
            'The demo is at capacity right now — please try again shortly.',
          );
        }
        throw err;
      }
    },
  );
};
