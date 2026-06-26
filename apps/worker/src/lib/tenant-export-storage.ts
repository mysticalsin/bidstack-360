// tenant-export-storage — write the export archive to durable storage and mint
// a short-lived signed download URL. Mirrors apps/api/src/storage/index.ts
// driver selection (STORAGE_DRIVER = `local` | `s3`) so dev runs against the
// shared local uploads dir and prod against S3/R2 without code changes.

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export interface UploadArchiveArgs {
  /** Org-namespaced storage key, e.g. `orgs/<org>/exports/<id>.ndjson.gz`. */
  key: string;
  /** Gzipped NDJSON body stream. */
  body: Readable;
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

async function uploadLocal({ key, body }: UploadArchiveArgs): Promise<{ bytes: number }> {
  const target = safeJoin(resolveLocalUploadsRoot(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(body, createWriteStream(target));
  const s = await stat(target);
  return { bytes: s.size };
}

// ─── S3 (lazy-loaded optional peer) ──────────────────────────────────────────

interface S3Module {
  S3Client: new (cfg: unknown) => { send(cmd: unknown): Promise<unknown> };
  PutObjectCommand: new (input: unknown) => unknown;
  GetObjectCommand: new (input: unknown) => unknown;
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

function s3Client(s3: S3Module) {
  return new s3.S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
}

async function uploadS3({ key, body }: UploadArchiveArgs): Promise<{ bytes: number }> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET env var required when STORAGE_DRIVER=s3');
  const { s3 } = await loadS3();
  const client = s3Client(s3);
  // Count bytes as the stream flows so we can record sizeBytes without a HEAD.
  let bytes = 0;
  body.on('data', (chunk: Buffer | string) => {
    bytes += Buffer.byteLength(chunk);
  });
  await client.send(
    new s3.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: CONTENT_TYPE }),
  );
  return { bytes };
}

// ─── public API ──────────────────────────────────────────────────────────────

/** Upload the gzipped NDJSON archive. Returns the byte count for sizeBytes. */
export async function uploadExportArchive(args: UploadArchiveArgs): Promise<{ bytes: number }> {
  return driver() === 's3' ? uploadS3(args) : uploadLocal(args);
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
): Promise<string | null> {
  if (driver() !== 's3') return null;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET env var required when STORAGE_DRIVER=s3');
  const { s3, signer } = await loadS3();
  const client = s3Client(s3);
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
