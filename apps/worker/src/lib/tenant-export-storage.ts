// tenant-export-storage — write the export archive to durable storage and mint
// a short-lived signed download URL. Mirrors apps/api/src/storage/index.ts
// driver selection (STORAGE_DRIVER = `local` | `s3`) so dev runs against the
// shared local uploads dir and prod against S3/R2 without code changes.

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { resolveRegionalBucket, type DataRegion } from '@bidstack/shared';

export interface UploadArchiveArgs {
  /** Org-namespaced storage key, e.g. `orgs/<org>/exports/<id>.ndjson.gz`. */
  key: string;
  /** Gzipped NDJSON body stream. */
  body: Readable;
  /** Org data residency tag; picks S3_BUCKET_<REGION> when configured. */
  region?: DataRegion | null;
}

export interface UploadResult {
  bytes: number;
  /** Region whose bucket received the archive; null = default bucket or local. */
  storageRegion: DataRegion | null;
}

const CONTENT_TYPE = 'application/gzip';

function driver(): 'local' | 's3' {
  return (process.env.STORAGE_DRIVER ?? 'local').toLowerCase() === 's3' ? 's3' : 'local';
}

// ─── local filesystem ────────────────────────────────────────────────────────

// Resolve the SAME uploads root the API serves from. Mirrors
// resolveLocalUploadsRoot() in apps/api/src/storage/index.ts.
function resolveLocalUploadsRoot(): string {
  if (process.env.LOCAL_STORAGE_ROOT) return path.resolve(process.env.LOCAL_STORAGE_ROOT);
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return path.join(dir, 'apps', 'api', '.uploads');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), '.uploads');
}

function safeJoin(root: string, key: string): string {
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return resolved;
}

async function uploadLocal({ key, body }: UploadArchiveArgs): Promise<UploadResult> {
  const target = safeJoin(resolveLocalUploadsRoot(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(body, createWriteStream(target));
  const s = await stat(target);
  return { bytes: s.size, storageRegion: null };
}

// ─── S3 (lazy-loaded optional peer) ──────────────────────────────────────────

interface S3Module {
  S3Client: new (cfg: unknown) => { send(cmd: unknown): Promise<unknown> };
  PutObjectCommand: new (input: unknown) => unknown;
  GetObjectCommand: new (input: unknown) => unknown;
  DeleteObjectCommand: new (input: unknown) => unknown;
}
interface SignerModule {
  getSignedUrl(client: unknown, cmd: unknown, opts: { expiresIn: number }): Promise<string>;
}

async function loadS3(): Promise<{ s3: S3Module; signer: SignerModule }> {
  // Hide the literal specifier from tsc so machines without the optional AWS
  // SDK still typecheck (mirrors apps/api/src/storage/index.ts).
  const s3Spec = '@aws-sdk/' + 'client-s3';
  const signerSpec = '@aws-sdk/' + 's3-request-presigner';
  const s3 = (await import(s3Spec)) as unknown as S3Module;
  const signer = (await import(signerSpec)) as unknown as SignerModule;
  return { s3, signer };
}

function s3Target(region: DataRegion | null | undefined): {
  bucket: string;
  s3Region: string;
  regional: boolean;
} {
  const { bucket, s3Region, regional } = resolveRegionalBucket(region ?? null, process.env);
  if (!bucket) throw new Error('S3_BUCKET env var required when STORAGE_DRIVER=s3');
  return { bucket, s3Region, regional };
}

function s3Client(s3: S3Module, s3Region: string) {
  return new s3.S3Client({
    region: s3Region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
}

async function uploadS3({ key, body, region }: UploadArchiveArgs): Promise<UploadResult> {
  const { bucket, s3Region, regional } = s3Target(region);
  const { s3 } = await loadS3();
  const client = s3Client(s3, s3Region);
  // Count bytes as the stream flows so we can record sizeBytes without a HEAD.
  let bytes = 0;
  body.on('data', (chunk: Buffer | string) => {
    bytes += Buffer.byteLength(chunk);
  });
  await client.send(
    new s3.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: CONTENT_TYPE }),
  );
  return { bytes, storageRegion: regional ? (region ?? null) : null };
}

// ─── public API ──────────────────────────────────────────────────────────────

/** Upload the gzipped NDJSON archive. Returns the byte count and the bucket region used. */
export async function uploadExportArchive(args: UploadArchiveArgs): Promise<UploadResult> {
  return driver() === 's3' ? uploadS3(args) : uploadLocal(args);
}

/** Delete an archive. A missing object is not an error. */
export async function deleteExportArchive(key: string, region?: DataRegion | null): Promise<void> {
  if (driver() !== 's3') {
    await rm(safeJoin(resolveLocalUploadsRoot(), key), { force: true });
    return;
  }
  const { bucket, s3Region } = s3Target(region);
  const { s3 } = await loadS3();
  await s3Client(s3, s3Region).send(new s3.DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Mint a download URL valid for `expiresInSec`. S3 returns a pre-signed GET;
 * local returns null so the API issues the authenticated, org-scoped streaming
 * route instead (it re-checks org ownership + expiry, so no bearer URL is
 * minted in dev). The raw storage key is never returned to the client.
 */
export async function signExportDownloadUrl(
  key: string,
  expiresInSec: number,
  region?: DataRegion | null,
): Promise<string | null> {
  if (driver() !== 's3') return null;
  const { bucket, s3Region } = s3Target(region);
  const { s3, signer } = await loadS3();
  const client = s3Client(s3, s3Region);
  const filename = path.basename(key);
  return signer.getSignedUrl(
    client,
    new s3.GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: CONTENT_TYPE,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    }),
    { expiresIn: expiresInSec },
  );
}
