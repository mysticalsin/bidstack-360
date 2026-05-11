import { z } from 'zod';

// Why: hard cap mirrors the API ingest budget (Fastify body limit + queue
// throughput). 50 MB covers PDFs/DOCX/images we expect on a customer account.
// Bumping this requires also raising the Fastify bodyLimit + S3 multipart cfg.
export const FILE_MAX_BYTES = 50 * 1024 * 1024;

// Why: an explicit allow-list prevents the upload endpoint from becoming an
// open file relay. Add types here as product needs them.
export const ALLOWED_FILE_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

export const FileAttachment = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(500),
  uploadedByUserId: z.string().uuid().nullable(),
  uploadedByEmail: z.string().email().nullable(),
  createdAt: z.string().datetime(),
});
export type FileAttachment = z.infer<typeof FileAttachment>;

export const FileUploadUrlRequest = z.object({
  accountId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_FILE_CONTENT_TYPES),
  bytes: z.number().int().positive().max(FILE_MAX_BYTES),
});
export type FileUploadUrlRequest = z.infer<typeof FileUploadUrlRequest>;

export const FileUploadUrlResponse = z.object({
  uploadUrl: z.string().url(),
  storageKey: z.string().min(1).max(500),
  // HTTP headers the client MUST send when PUT-ing to uploadUrl. Adapter
  // dependent: S3 demands Content-Type match the signed value; local mode
  // doesn't care but we still echo Content-Type for parity.
  headers: z.record(z.string()),
});
export type FileUploadUrlResponse = z.infer<typeof FileUploadUrlResponse>;

export const FileFinalizeRequest = z.object({
  accountId: z.string().min(1).max(255),
  storageKey: z.string().min(1).max(500),
  name: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_FILE_CONTENT_TYPES),
  bytes: z.number().int().positive().max(FILE_MAX_BYTES),
});
export type FileFinalizeRequest = z.infer<typeof FileFinalizeRequest>;

export const FileListResponse = z.object({
  items: z.array(FileAttachment),
});
export type FileListResponse = z.infer<typeof FileListResponse>;
