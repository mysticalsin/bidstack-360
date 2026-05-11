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
} from '@bidstack/shared';

import { getStorage } from '../storage/index.js';

// accountId is a free-text string (not a UUID FK) — different cases of the
// same brand should resolve to one account. Lowercase + trim at every write
// site so "Aritzia" and "aritzia" share notes/files. The cockpit route param
// is already lowercase via normalizeName(); this is the symmetric write-side.
function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

interface DbFileRow {
  id: string;
  accountId: string;
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
  // 1. Issue a pre-signed upload URL.
  server.post(
    '/files/upload-url',
    {
      schema: {
        body: FileUploadUrlRequest,
        response: { 200: FileUploadUrlResponse },
      },
    },
    async (req) => {
      const storage = await getStorage();
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

  // 2. Local-mode PUT target. Streams body to disk under apps/api/.uploads/.
  // S3 mode never reaches this endpoint — clients PUT directly to the bucket.
  server.put<{ Querystring: { key: string } }>(
    '/files/local-upload',
    {
      schema: { querystring: z.object({ key: z.string().min(1).max(500) }) },
      // Why: Fastify's default 1 MB cap blocks larger files. We lift the cap
      // to FILE_MAX_BYTES at the route boundary so the global cap stays small.
      bodyLimit: FILE_MAX_BYTES,
    },
    async (req, reply) => {
      const storage = await getStorage();
      if (storage.driver !== 'local' || !storage.writeLocal) {
        throw server.httpErrors.badRequest('Local upload only available with STORAGE_DRIVER=local');
      }
      const result = await storage.writeLocal(req.query.key, req.raw);
      return reply.code(200).send({ bytes: result.bytes });
    },
  );

  // 3. Persist metadata after the client confirms the upload.
  server.post(
    '/files/finalize',
    {
      schema: { body: FileFinalizeRequest, response: { 201: FileAttachment } },
    },
    async (req, reply) => {
      const accountId = normalizeAccountId(req.body.accountId);
      const created = await prisma.fileAttachment.create({
        data: {
          orgId: req.auth.orgId,
          accountId,
          name: req.body.name,
          contentType: req.body.contentType,
          bytes: req.body.bytes,
          storageKey: req.body.storageKey,
          uploadedByUserId: req.auth.userId,
        },
        include: { uploader: { select: { email: true } } },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'file.upload',
          targetType: 'file_attachment',
          targetId: created.id,
          diff: { name: req.body.name, bytes: req.body.bytes, accountId },
        },
      });
      return reply.code(201).send(serialize(created));
    },
  );

  // 4. List by account.
  server.get(
    '/files',
    {
      schema: {
        querystring: z.object({
          accountId: z.string().min(1).max(255),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: FileListResponse },
      },
    },
    async (req) => {
      const items = await prisma.fileAttachment.findMany({
        where: { orgId: req.auth.orgId, accountId: normalizeAccountId(req.query.accountId) },
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
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!row) throw server.httpErrors.notFound('File not found');

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
        reply.header('Content-Disposition', `attachment; filename="${row.name.replace(/"/g, '')}"`);
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
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const row = await prisma.fileAttachment.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!row) throw server.httpErrors.notFound('File not found');

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
      await prisma.fileAttachment.delete({ where: { id: row.id } });
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
