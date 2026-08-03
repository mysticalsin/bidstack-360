/**
 * demo.ts — public endpoints for the "try the demo" door.
 *
 * Only mounted when DEMO_MODE is armed (see plugins/demo-auth.ts for the gate).
 * `POST /demo/session` is the passwordless sign-in: an email in, a signed demo
 * Bearer token out (the SPA then sends it as `Authorization: Bearer`). Tightly
 * rate-limited because each new email provisions + seeds a fresh org.
 *
 * The route is public, but an `Authorization: Bearer demo_…` header is still
 * read when present: it is the resume proof that lets a returning visitor back
 * into their OWN workspace. Without it an already-claimed email is refused
 * (409) rather than taken over — SEC-1.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { DEMO_EMAIL_CLAIMED, isDemoMode, provisionDemoSession } from '../plugins/demo-auth.js';

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
      const header = req.headers.authorization ?? '';
      const resumeProof = header.startsWith('Bearer ') ? header.slice(7) : null;
      try {
        return await provisionDemoSession(email, name, resumeProof);
      } catch (err) {
        const message = (err as Error).message;
        if (message === 'DEMO_AT_CAPACITY') {
          return reply.serviceUnavailable(
            'The demo is at capacity right now — please try again shortly.',
          );
        }
        if (message === DEMO_EMAIL_CLAIMED) {
          // Deliberately generic + non-confirming: this is the only response an
          // email-guessing attacker sees, so it must not become an oracle for
          // "this address has a demo workspace".
          return reply.conflict(
            'That email cannot start a new demo workspace right now — try another address.',
          );
        }
        throw err;
      }
    },
  );
};
