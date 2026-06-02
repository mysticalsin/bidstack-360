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
  'application/xml',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/json',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'text/rtf',
  'text/yaml',
  'text/x-yaml',
  'message/rfc822',
  'application/yaml',
  'application/x-yaml',
  'application/x-rtf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'image/heif',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/flac',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/mpeg',
] as const;
export type AllowedFileContentType = (typeof ALLOWED_FILE_CONTENT_TYPES)[number];

export const FILE_CONTENT_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  eml: 'message/rfc822',
  html: 'text/html',
  htm: 'text/html',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
} as const satisfies Record<string, AllowedFileContentType>;

const ALLOWED_FILE_CONTENT_TYPE_SET = new Set<string>(ALLOWED_FILE_CONTENT_TYPES);

export const FILE_INPUT_ACCEPT = [
  ...Object.keys(FILE_CONTENT_TYPE_BY_EXTENSION).map((ext) => `.${ext}`),
  ...ALLOWED_FILE_CONTENT_TYPES,
].join(',');

export function isAllowedFileContentType(
  contentType: string | null | undefined,
): contentType is AllowedFileContentType {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  return !!normalized && ALLOWED_FILE_CONTENT_TYPE_SET.has(normalized);
}

export function inferAllowedFileContentType(
  name: string,
  reportedContentType?: string | null,
): AllowedFileContentType | null {
  const normalized = reportedContentType?.split(';')[0]?.trim().toLowerCase();
  if (isAllowedFileContentType(normalized)) return normalized;
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return FILE_CONTENT_TYPE_BY_EXTENSION[ext as keyof typeof FILE_CONTENT_TYPE_BY_EXTENSION] ?? null;
}

export const FileAttachment = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(255),
  companyId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(500),
  uploadedByUserId: z.string().uuid().nullable(),
  uploadedByEmail: z.string().email().nullable(),
  createdAt: z.string().datetime(),
  verifiedBytes: z.number().int().nonnegative().optional(),
  verifiedContentType: z.string().min(1).max(100).optional(),
  checksum: z.string().nullable().optional(),
  scanStatus: z.enum(['not_required', 'pending', 'passed', 'failed']).optional(),
});
export type FileAttachment = z.infer<typeof FileAttachment>;

export const FileUploadUrlRequest = z.object({
  accountId: z.string().min(1).max(255),
  companyId: z.string().uuid().optional(),
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
  companyId: z.string().uuid().optional(),
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
