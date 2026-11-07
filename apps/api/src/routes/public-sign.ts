/**
 * Public signing routes — no auth required. Served at /sign/:token.
 *
 * These routes power the INTERNAL provider signing page:
 *   GET  /sign/:token        — returns signing metadata (document name, recipient name)
 *   POST /sign/:token        — accepts typed name + canvas signature, marks as signed
 *
 * Security:
 *   - Token is a 256-bit random hex string — unguessable.
 *   - Rate-limited aggressively: 10 attempts per IP per hour.
 *   - Submitter IP + user-agent captured for audit trail.
 *   - No orgId, no auth — the token is the sole credential.
 *   - No PII in logs (recipient email not logged).
 *
 * WHY separate file: public routes skip the auth plugin. Keeping them isolated
 * makes the security boundary obvious.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { InternalSignSubmit, PublicSignatureRequest } from '@bidstack/shared';
import {
  closedSignLinkReason,
  handleInternalSign,
  signLinkExpiresAt,
} from '../services/documents/signature.service.js';

const signSubmitRateLimitMax = Number(process.env.PUBLIC_SIGN_RATE_LIMIT_MAX ?? 10);

export const publicSignRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /sign/:token ──────────────────────────────────────────────────────
  server.get(
    '/sign/:token',
    {
      config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ token: z.string().min(8).max(200) }),
        response: {
          // Must match the shared PublicSignatureRequest contract the page reads
          // — the previous ad-hoc shape (documentName/orgName) left the page
          // rendering "undefined" for templateName/senderName/etc.
          200: PublicSignatureRequest,
          404: z.object({ message: z.string() }),
          410: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { token } = req.params;

      const request = await prisma.signatureRequest.findFirst({
        where: { providerRequestId: token, provider: 'INTERNAL', deletedAt: null },
        include: { document: true, org: { select: { name: true } } },
      });

      if (!request) return reply.status(404).send({ message: 'Signing link not found' });

      const closed = await closedSignLinkReason(request);
      if (closed) return reply.status(410).send({ message: closed });

      const recipients = request.recipients as Array<{ name?: string; email?: string }>;
      const recipient = recipients[0];

      return reply.send({
        id: request.id,
        status: request.status,
        templateName: request.document.name,
        senderName: request.org.name,
        message: null,
        documentPreviewUrl: null,
        recipientName: recipient?.name ?? 'Recipient',
        recipientEmail: recipient?.email ?? 'unknown@unknown.invalid',
        expiresAt: signLinkExpiresAt(request).toISOString(),
      });
    },
  );

  // ── POST /sign/:token ─────────────────────────────────────────────────────
  server.post(
    '/sign/:token',
    {
      config: {
        public: true,
        rateLimit: { max: signSubmitRateLimitMax, timeWindow: '1 hour' },
      },
      schema: {
        params: z.object({ token: z.string().min(8).max(200) }),
        body: InternalSignSubmit,
        response: {
          200: z.object({ requestId: z.string().uuid(), message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { token } = req.params;
      const { typedName, signatureDataUrl } = req.body;

      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'] ?? '';

      const { requestId } = await handleInternalSign({
        token,
        typedName,
        signatureDataUrl,
        ipAddress,
        userAgent,
      });

      return reply.send({
        requestId,
        message: 'Document signed successfully.',
      });
    },
  );
};
