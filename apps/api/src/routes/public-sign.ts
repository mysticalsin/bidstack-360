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
import { InternalSignSubmit } from '@bidstack/shared';
import { handleInternalSign } from '../services/documents/signature.service.js';

export const publicSignRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /sign/:token ──────────────────────────────────────────────────────
  server.get(
    '/sign/:token',
    {
      config: { skipAuth: true },
      schema: {
        params: z.object({ token: z.string().min(8).max(200) }),
        response: {
          200: z.object({
            documentName: z.string(),
            recipientName: z.string(),
            orgName: z.string(),
            status: z.string(),
          }),
          404: z.object({ message: z.string() }),
          410: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { token } = req.params;

      const request = await prisma.signatureRequest.findFirst({
        where: { providerRequestId: token, provider: 'INTERNAL' },
        include: { document: true, org: { select: { name: true } } },
      });

      if (!request) return reply.status(404).send({ message: 'Signing link not found' });

      if (request.status === 'SIGNED') {
        return reply.status(410).send({ message: 'This document has already been signed.' });
      }
      if (request.status === 'VOIDED') {
        return reply.status(410).send({ message: 'This signing request has been voided.' });
      }

      const recipients = request.recipients as Array<{ name: string }>;
      const recipientName = recipients[0]?.name ?? 'Recipient';

      return reply.send({
        documentName: request.document.name,
        recipientName,
        orgName: request.org.name,
        status: request.status,
      });
    },
  );

  // ── POST /sign/:token ─────────────────────────────────────────────────────
  server.post(
    '/sign/:token',
    {
      config: { skipAuth: true },
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
