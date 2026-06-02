/**
 * E-signature routes — authenticated management + public webhook endpoint.
 *
 * Security:
 *   - All management routes are behind req.auth (Clerk org middleware).
 *   - POST /signatures/webhook/docusign is public but HMAC-verified inside
 *     handleDocuSignWebhook — a forged webhook cannot change request state.
 *   - Public signing surface (GET/POST /sign/:token) is in public-sign.ts;
 *     registered without /api/v1 prefix so it resolves as /sign/:token.
 *   - Audit trail (SignatureEvent) is append-only — no update/delete routes.
 *   - orgId always comes from req.auth, never from the request body.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  SignatureRequestCreate,
  SignatureRequestVoid,
  SignatureStatus,
  SignatureProvider,
  SignatureEventType,
} from '@bidstack/shared';
import {
  createSignatureRequest,
  handleDocuSignWebhook,
  voidSignatureRequest,
  type DocuSignWebhookPayload,
} from '../services/documents/signature.service.js';

// ─── Response shapes ─────────────────────────────────────────────────────────

const RecipientSchema = z.object({
  email: z.string(),
  name: z.string(),
  role: z.string(),
  signedAt: z.string().nullable().optional(),
});

const SignatureRequestResponse = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  documentId: z.string().uuid(),
  provider: SignatureProvider,
  providerRequestId: z.string().nullable(),
  status: SignatureStatus,
  recipients: z.array(RecipientSchema),
  signingUrl: z.string().nullable().optional(),
  sentAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  completedDocumentS3Key: z.string().nullable(),
  createdAt: z.string(),
});

const EventResponse = z.object({
  id: z.string().uuid(),
  type: SignatureEventType,
  recipientEmail: z.string().nullable(),
  occurredAt: z.string(),
  ipAddress: z.string().nullable(),
  payload: z.record(z.unknown()),
});

function serializeRequest(
  row: {
    id: string;
    orgId: string;
    documentId: string;
    provider: string;
    providerRequestId: string | null;
    status: string;
    recipients: unknown;
    sentAt: Date | null;
    completedAt: Date | null;
    voidedAt: Date | null;
    voidReason: string | null;
    completedDocumentS3Key: string | null;
    createdAt: Date;
  },
  signingUrl?: string,
): z.infer<typeof SignatureRequestResponse> {
  return {
    id: row.id,
    orgId: row.orgId,
    documentId: row.documentId,
    provider: row.provider as z.infer<typeof SignatureProvider>,
    providerRequestId: row.providerRequestId,
    status: row.status as z.infer<typeof SignatureStatus>,
    recipients: (row.recipients as Array<Record<string, unknown>>).map((r) => ({
      email: String(r['email'] ?? ''),
      name: String(r['name'] ?? ''),
      role: String(r['role'] ?? 'signer'),
      signedAt: r['signedAt'] ? String(r['signedAt']) : null,
    })),
    signingUrl: signingUrl ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    completedDocumentS3Key: row.completedDocumentS3Key,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const signaturesRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /signatures/requests ──────────────────────────────────────────────
  server.get(
    '/signatures/requests',
    {
      schema: {
        querystring: z.object({
          status: SignatureStatus.optional(),
          documentId: z.string().uuid().optional(),
          recipientEmail: z.string().email().optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({
            items: z.array(SignatureRequestResponse),
            total: z.number().int(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { status, documentId, recipientEmail, page, limit } = req.query;
      const skip = (page - 1) * limit;

      const where = {
        orgId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(documentId ? { documentId } : {}),
        // Filter by recipient email uses JSON contains — only supported on pg with jsonb
        ...(recipientEmail
          ? {
              recipients: {
                path: ['$[*].email'],
                string_contains: recipientEmail,
              },
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.signatureRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.signatureRequest.count({ where }),
      ]);

      return reply.send({ items: items.map((r) => serializeRequest(r)), total });
    },
  );

  // ── POST /signatures/requests ─────────────────────────────────────────────
  server.post(
    '/signatures/requests',
    {
      schema: {
        body: SignatureRequestCreate,
        response: {
          201: SignatureRequestResponse,
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const body = req.body;

      const { id, signingUrl } = await createSignatureRequest({
        orgId,
        documentId: body.documentId,
        recipients: body.recipients,
        message: body.message,
        provider: body.provider ?? 'DOCUSIGN',
      });

      const request = await prisma.signatureRequest.findUniqueOrThrow({ where: { id } });
      return reply.status(201).send(serializeRequest(request, signingUrl));
    },
  );

  // ── GET /signatures/requests/:id ──────────────────────────────────────────
  server.get(
    '/signatures/requests/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: SignatureRequestResponse.extend({
            events: z.array(EventResponse),
          }),
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const request = await prisma.signatureRequest.findFirst({
        where: { id, orgId, deletedAt: null },
        include: {
          events: {
            orderBy: { occurredAt: 'asc' },
          },
        },
      });

      if (!request) return reply.notFound(`Signature request ${id} not found`);

      return reply.send({
        ...serializeRequest(request),
        events: request.events.map((e) => ({
          id: e.id,
          type: e.type as z.infer<typeof SignatureEventType>,
          recipientEmail: e.recipientEmail,
          occurredAt: e.occurredAt.toISOString(),
          ipAddress: e.ipAddress,
          payload: e.payload as Record<string, unknown>,
        })),
      });
    },
  );

  // ── POST /signatures/requests/:id/void ───────────────────────────────────
  server.post(
    '/signatures/requests/:id/void',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SignatureRequestVoid,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;
      const { reason } = req.body;

      await voidSignatureRequest({ orgId, requestId: id, reason });
      return reply.status(204).send();
    },
  );

  // ── POST /signatures/webhook/docusign ─────────────────────────────────────
  // Public endpoint — no auth. HMAC-verified inside handleDocuSignWebhook.
  // Must be registered with addContentTypeParser for raw body access.
  server.post(
    '/signatures/webhook/docusign',
    {
      config: { rawBody: true },
      schema: {
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req, reply) => {
      // Fastify doesn't expose rawBody by default — we access it via the buffer
      // that @fastify/raw-body or our content-type parser provides.
      // The server.ts registers addContentTypeParser for 'application/json' to
      // capture raw bytes for HMAC verification on webhook routes.
      const rawBody =
        (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      const signatureHeader = req.headers['x-docusign-signature-1'] as string | undefined;

      await handleDocuSignWebhook(rawBody, signatureHeader, req.body as DocuSignWebhookPayload);
      return reply.send({ ok: true });
    },
  );
};
