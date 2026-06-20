// Files / attachments routes.
//
// Flow:
//   1. Client POSTs /api/files/upload-url with metadata → API issues a
//      pre-signed URL (or local PUT URL) and an opaque storageKey.
//   2. Client PUTs the bytes to that URL.
//   3. Client POSTs /api/files/finalize → API writes a FileAttachment row.
//   4. List / download / delete go through the API to keep org-scoping
//      enforced server-side.
//
// Why split upload-url + finalize: matches S3 best practice (avoid streaming
// large bodies through the API process) and keeps the API endpoint compatible
// once we flip STORAGE_DRIVER=s3.

import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  FILE_MAX_BYTES,
  FileAttachment,
  FileFinalizeRequest,
  FileListResponse,
  FileUploadUrlRequest,
  FileUploadUrlResponse,
  isExtractableForIntel,
} from '@bidstack/shared';

import { getStorage, keyBelongsToOrg } from '../storage/index.js';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import { canReadAccount } from '../lib/account-access.js';
import { enqueueDocumentExtract } from '../queues/document-extract.js';

// accountId is a free-text string (not a UUID FK) — different cases of the
// same brand should resolve to one account. Lowercase + trim at every write
// site so "Aritzia" and "aritzia" share notes/files. The cockpit route param
// is already lowercase via normalizeName(); this is the symmetric write-side.
function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * RFC 5987 safe Content-Disposition filename encoding. Rejects control chars
 * outright and percent-encodes everything else that isn't a safe token char.
 * Prevents CRLF injection (S-M5).
 */
function safeContentDisposition(filename: string): string {
  // Reject control chars (0x00–0x1F, 0x7F) outright — these have no business
  // in filenames and are the root of CRLF injection. The control-char regex
  // is exactly what we want here; eslint's no-control-regex would block it.
  // eslint-disable-next-line no-control-regex
  const sanitized = filename.replace(/[\x00-\x1f\x7f]/g, '');
  return `attachment; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
}

interface DbFileRow {
  id: string;
  accountId: string;
  companyId: string | null;
  name: string;
  contentType: string;
  bytes: number;
  storageKey: string;
  uploadedByUserId: string | null;
  createdAt: Date;
  uploader: { email: string } | null;
}

function serialize(row: DbFileRow): FileAttachment {
  return {
    id: row.id,
    accountId: row.accountId,
    companyId: row.companyId ?? undefined,
    name: row.name,
    contentType: row.contentType,
    bytes: row.bytes,
    storageKey: row.storageKey,
    uploadedByUserId: row.uploadedByUserId,
    uploadedByEmail: row.uploader?.email ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const filesRoutes: FastifyPluginAsyncZod = async (server) => {
  async function ensureAccountVisible(input: {
    orgId: string;
    userId: string;
    accountId: string;
    companyId?: string | null;
  }) {
    const access = await canReadAccount({
      orgId: input.orgId,
      userId: input.userId,
      accountId: input.accountId,
      companyId: input.companyId,
      prismaClient: prisma,
    });
    if (!access.allowed) throw server.httpErrors.notFound('Account not found');
  }

  // RBAC: gate every route in this plugin by method — writes need 'files:write',
  // reads need 'files:read'. Runs after the global auth onRequest.
  server.addHook('preHandler', async (req) => {
    const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
    await server.requirePermission(isWrite ? 'files:write' : 'files:read')(req);
  });
  // 1. Issue a pre-signed upload URL.
  server.post(
    '/files/upload-url',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: FileUploadUrlRequest,
        response: { 200: FileUploadUrlResponse },
      },
    },
    async (req) => {
      const storage = await getStorage();
      if (
        req.body.companyId &&
        !(await tenantEntityBelongsToOrg('company', req.body.companyId, req.auth.orgId))
      ) {
        throw server.httpErrors.notFound('Company not found');
      }
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.body.accountId,
        companyId: req.body.companyId,
      });
      // Storage key is namespaced under req.auth.orgId so a malicious upload
      // request can't target another tenant's accountId namespace. The
      // sibling FileAttachment row also writes orgId at finalize time, but
      // we want the storage object itself to be safely partitioned so a
      // cross-tenant collision attempt fails at the storage layer (S3 PutObject
      // overwrite, local-fs path collision) before the DB step.
      const accountId = normalizeAccountId(req.body.accountId);
      const key = storage.newKey(req.auth.orgId, accountId, req.body.name);
      const presigned = await storage.getUploadUrl({
        key,
        contentType: req.body.contentType,
        bytes: req.body.bytes,
      });
      return { uploadUrl: presigned.url, storageKey: key, headers: presigned.headers };
    },
  );

  // 2. Local-mode PUT target. Streams the raw upload body to disk under
  // apps/api/.uploads/. Encapsulated in its own context with a catch-all raw
  // parser so the bytes of ANY uploaded file type (pdf, docx, json, txt, image…)
  // reach req.raw UNCONSUMED — without swallowing the JSON request bodies that
  // upload-url/finalize need parsed (those keep the inherited JSON parser in the
  // parent scope). WHY this matters: ALLOWED_FILE_CONTENT_TYPES includes
  // application/json, so a plugin-wide passthrough would null out the JSON bodies
  // of the sibling routes. S3 mode never hits this endpoint — clients PUT to the
  // bucket. The bodyLimit override lifts Fastify's 1 MB cap to FILE_MAX_BYTES.
  await server.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', (_req, _payload, done) => done(null));
    raw.put<{ Querystring: { key: string } }>(
      '/files/local-upload',
      {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: { querystring: z.object({ key: z.string().min(1).max(500) }) },
        bodyLimit: FILE_MAX_BYTES,
      },
      async (req, reply) => {
        const storage = await getStorage();
        if (storage.driver !== 'local' || !storage.writeLocal) {
          throw raw.httpErrors.badRequest('Local upload only available with STORAGE_DRIVER=local');
        }
        // S-M6: Verify the key belongs to the caller's org so a malicious client
        // can't target another tenant's storage namespace.
        if (!keyBelongsToOrg(req.query.key, req.auth.orgId)) {
          throw raw.httpErrors.forbidden('Storage key does not belong to your organization');
        }
        const result = await storage.writeLocal(req.query.key, req.raw);
        return reply.code(200).send({ bytes: result.bytes });
      },
    );
  });

  // 3. Persist metadata after the client confirms the upload.
  server.post(
    '/files/finalize',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { body: FileFinalizeRequest, response: { 201: FileAttachment } },
    },
    async (req, reply) => {
      const storage = await getStorage();
      // S-M4: Verify storageKey starts with the caller's orgId. A malicious
      // client that obtained a valid pre-signed URL for another org could
      // otherwise register the foreign object under their own account.
      if (!keyBelongsToOrg(req.body.storageKey, req.auth.orgId)) {
        throw server.httpErrors.forbidden('Storage key does not belong to your organization');
      }
      if (
        req.body.companyId &&
        !(await tenantEntityBelongsToOrg('company', req.body.companyId, req.auth.orgId))
      ) {
        throw server.httpErrors.notFound('Company not found');
      }
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.body.accountId,
        companyId: req.body.companyId,
      });

      let metadata;
      try {
        metadata = await storage.head(req.body.storageKey);
      } catch (err) {
        req.log.warn({ err, key: req.body.storageKey }, 'storage object missing during finalize');
        throw server.httpErrors.notFound('Uploaded object not found');
      }
      if (metadata.bytes !== req.body.bytes) {
        throw server.httpErrors.badRequest('Uploaded object size does not match finalize payload');
      }
      if (metadata.contentType && metadata.contentType !== req.body.contentType) {
        throw server.httpErrors.badRequest(
          'Uploaded object content type does not match finalize payload',
        );
      }
      const scanStatus = process.env.STORAGE_SCAN_REQUIRED === 'true' ? 'pending' : 'not_required';
      if (scanStatus === 'pending') {
        throw server.httpErrors.conflict('Uploaded object has not passed malware scan');
      }

      const accountId = normalizeAccountId(req.body.accountId);
      // Atomic create + audit so a crash can't leave a file row without a
      // paper trail.
      const fileId = randomUUID();
      const [created] = await prisma.$transaction([
        prisma.fileAttachment.create({
          data: {
            id: fileId,
            orgId: req.auth.orgId,
            accountId,
            companyId: req.body.companyId ?? null,
            name: req.body.name,
            contentType: req.body.contentType,
            bytes: metadata.bytes,
            storageKey: req.body.storageKey,
            uploadedByUserId: req.auth.userId,
          },
          include: { uploader: { select: { email: true } } },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'file.upload',
            targetType: 'file_attachment',
            targetId: fileId,
            diff: {
              name: req.body.name,
              bytes: metadata.bytes,
              accountId,
              checksum: metadata.checksum ?? null,
              scanStatus,
            },
          },
        }),
      ]);

      // Auto-extract: an account-scoped document becomes intelligence the moment
      // it lands, so the user never has to hunt for a separate "Extract" action
      // (the old hidden two-step that made uploads feel like nothing happened).
      // Best-effort + fail-open — a queue/Redis hiccup must never fail the upload.
      // Skipped under NODE_ENV=test so the integration suite keeps asserting
      // explicit extraction control; dev/prod opt in by default.
      if (
        accountId &&
        process.env.NODE_ENV !== 'test' &&
        isExtractableForIntel(req.body.contentType)
      ) {
        try {
          const extraction = await prisma.documentExtraction.create({
            data: {
              orgId: req.auth.orgId,
              documentId: fileId,
              accountId,
              companyId: req.body.companyId ?? null,
              status: 'pending',
              extractedData: {},
            },
          });
          const jobId = await enqueueDocumentExtract({
            orgId: req.auth.orgId,
            accountId,
            documentId: fileId,
            extractionId: extraction.id,
            storageKey: req.body.storageKey,
            contentType: req.body.contentType,
            name: req.body.name,
            // Low priority: a bulk import must not starve user-initiated extracts.
            priority: 10,
          });
          if (!jobId) {
            // Queue disabled or Redis down — no worker will ever pick this up.
            // Mark it errored (not stuck 'pending' forever) so the UI shows a
            // retryable state; the user can re-run from the Extractions tab.
            await prisma.documentExtraction.updateMany({
              where: { id: extraction.id, orgId: req.auth.orgId, documentId: fileId },
              data: { status: 'error', error: 'Extraction queue unavailable — retry' },
            });
          }
        } catch (err) {
          req.log.warn({ err, fileId }, 'auto-extract enqueue failed (upload still succeeded)');
        }
      }

      return reply.code(201).send({
        ...serialize(created),
        verifiedBytes: metadata.bytes,
        verifiedContentType: metadata.contentType ?? req.body.contentType,
        checksum: metadata.checksum ?? null,
        scanStatus,
      });
    },
  );

  // 4. List by account.
  server.get(
    '/files',
    {
      schema: {
        querystring: z.object({
          accountId: z.string().min(1).max(255),
          companyId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: FileListResponse },
      },
    },
    async (req) => {
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.query.accountId,
        companyId: req.query.companyId,
      });
      const accountId = normalizeAccountId(req.query.accountId);
      const items = await prisma.fileAttachment.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.companyId
            ? { OR: [{ companyId: req.query.companyId }, { accountId }] }
            : { accountId }),
        },
        include: { uploader: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { items: items.map(serialize) };
    },
  );

  // 5. Download — 302 to a presigned URL (S3) OR stream local file inline.
  server.get<{ Params: { id: string } }>(
    '/files/:id/download',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const row = await prisma.fileAttachment.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!row) throw server.httpErrors.notFound('File not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: row.accountId,
        companyId: row.companyId,
      });

      const storage = await getStorage();
      const dl = await storage.getDownload(row.storageKey, {
        filename: row.name,
        contentType: row.contentType,
      });

      if (dl.kind === 'redirect' && dl.url) {
        return reply.redirect(dl.url, 302);
      }
      if (dl.kind === 'stream' && dl.stream) {
        reply.header('Content-Type', dl.contentType ?? row.contentType);
        reply.header('Content-Disposition', safeContentDisposition(row.name));
        if (dl.bytes != null) reply.header('Content-Length', String(dl.bytes));
        // Why pipeline(): handles backpressure + closes both ends on client
        // disconnect. Plain reply.send(stream) leaks file handles on aborts.
        await pipeline(dl.stream, reply.raw);
        return reply;
      }
      throw server.httpErrors.internalServerError('Storage returned no download target');
    },
  );

  // 6. Delete.
  server.delete<{ Params: { id: string } }>(
    '/files/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } } },
    async (req, reply) => {
      const row = await prisma.fileAttachment.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!row) throw server.httpErrors.notFound('File not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: row.accountId,
        companyId: row.companyId,
      });

      const storage = await getStorage();
      try {
        await storage.delete(row.storageKey);
      } catch (err) {
        // Log but proceed — orphaned blobs are cleaned by a janitor job; the
        // DB row is the source of truth from the user's perspective.
        req.log.warn(
          { err, key: row.storageKey },
          'storage delete failed; proceeding with DB row removal',
        );
      }
      await prisma.fileAttachment.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'file.delete',
          targetType: 'file_attachment',
          targetId: row.id,
          diff: { name: row.name, accountId: row.accountId },
        },
      });
      return reply.code(204).send();
    },
  );
};
