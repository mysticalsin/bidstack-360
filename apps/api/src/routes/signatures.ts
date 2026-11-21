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
import { prisma, type Prisma } from '@bidstack/db';
import {
  SignatureEvent,
  SignatureRequest,
  SignatureRequestCreate,
  SignatureRequestFilter,
  SignatureRequestPage,
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

/** Create still returns the signing link. The shared request schema does not. */
const SignatureRequestCreated = SignatureRequest.extend({
  signingUrl: z.string().nullable().optional(),
});

function recipientRole(value: unknown): 'SIGNER' | 'CC' {
  return String(value ?? '').trim().toUpperCase() === 'CC' ? 'CC' : 'SIGNER';
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

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
): z.infer<typeof SignatureRequestCreated> {
  return {
    id: row.id,
    orgId: row.orgId,
    documentId: row.documentId,
    provider: row.provider as z.infer<typeof SignatureProvider>,
    providerRequestId: row.providerRequestId,
    status: row.status as z.infer<typeof SignatureStatus>,
    recipients: (row.recipients as Array<Record<string, unknown>>).map((r) => ({
      email: String(r['email'] ?? ''),
      name: String(r['name'] ?? 'Signer'),
      role: recipientRole(r['role']),
      signedAt: isoOrNull(r['signedAt']),
    })),
    ...(signingUrl !== undefined ? { signingUrl } : {}),
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
  // Capture the raw JSON bytes for HMAC verification on the DocuSign webhook.
  // Content-type parsers are ENCAPSULATED to the registering plugin, so this is
  // scoped to the signatures routes and does not affect the rest of the API. The
  // default Fastify parser discards raw bytes, which silently broke webhook HMAC
  // validation in production (the re-serialized JSON never byte-matches the
  // payload DocuSign signed). Mirrors the webhooks plugin's own raw parser.
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      const buf = body as Buffer;
      (_req as unknown as { rawBody: Buffer }).rawBody = buf;
      try {
        done(null, buf.length ? JSON.parse(buf.toString('utf8')) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // ── GET /signatures/requests ──────────────────────────────────────────────
  server.get(
    '/signatures/requests',
    {
      config: { permission: 'documents:read' },
      schema: {
        // limit is a number on the shared filter and a string on the query
        // string. Coerce it; every other field is the shared schema.
        querystring: SignatureRequestFilter.extend({
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
        response: { 200: SignatureRequestPage },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { status, recipientEmail, dateFrom, dateTo, cursor, limit } = req.query;
      if (cursor && !z.string().uuid().safeParse(cursor).success) {
        throw server.httpErrors.badRequest('Invalid cursor');
      }
      const createdAt: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (Number.isNaN(from.getTime())) throw server.httpErrors.badRequest('Invalid dateFrom');
        createdAt.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (Number.isNaN(to.getTime())) throw server.httpErrors.badRequest('Invalid dateTo');
        createdAt.lte = to;
      }

      const where = {
        orgId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
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

      const [rows, total] = await Promise.all([
        prisma.signatureRequest.findMany({
          where,
          // createdAt is not unique. id keeps a tied pair on one page only.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
        prisma.signatureRequest.count({ where }),
      ]);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return reply.send({
        items: page.map((r) => serializeRequest(r)),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
        total,
      });
    },
  );

  // ── POST /signatures/requests ─────────────────────────────────────────────
  server.post(
    '/signatures/requests',
    {
      // Sending a DocuSign envelope is an external, irreversible action (email +
      // provider spend) — gate it like other document mutations, not just org
      // membership. (RFP review finding, 2026-06-04.)
      config: { permission: 'documents:write' },
      preHandler: server.requirePermission('documents:write'),
      schema: {
        body: SignatureRequestCreate,
        response: {
          201: SignatureRequestCreated,
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
      config: { permission: 'documents:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: SignatureRequest.extend({
            events: z.array(SignatureEvent),
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
          signatureRequestId: e.signatureRequestId,
          type: e.type as z.infer<typeof SignatureEventType>,
          recipientEmail:
            e.recipientEmail && z.string().email().safeParse(e.recipientEmail).success
              ? e.recipientEmail
              : null,
          occurredAt: e.occurredAt.toISOString(),
          ipAddress: e.ipAddress,
          userAgent: e.userAgent,
          payload:
            e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload)
              ? (e.payload as Record<string, unknown>)
              : {},
        })),
      });
    },
  );

  // ── POST /signatures/requests/:id/void ───────────────────────────────────
  server.post(
    '/signatures/requests/:id/void',
    {
      config: { permission: 'documents:write' },
      preHandler: server.requirePermission('documents:write'),
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
      config: { public: true, rawBody: true },
      schema: {
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req, reply) => {
      // req.rawBody is populated by the plugin-scoped content-type parser above,
      // so HMAC runs over the exact bytes DocuSign signed. The fallback only
      // applies to a genuinely empty body.
      const rawBody =
        (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      const signatureHeader = req.headers['x-docusign-signature-1'] as string | undefined;

      await handleDocuSignWebhook(rawBody, signatureHeader, req.body as DocuSignWebhookPayload);
      return reply.send({ ok: true });
    },
  );
};
