// Storage adapter — abstracts file persistence so dev runs against the local
// filesystem and prod can use S3 / R2 without route changes.
//
// Selection: STORAGE_DRIVER env (`local` (default) | `s3`).
// LocalStorage writes under apps/api/.uploads/ and serves PUT/GET via the API.
// S3Storage is gated behind a runtime import — it throws "S3 not installed"
// unless `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are present.

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * RFC 5987 safe Content-Disposition filename encoding. Rejects control chars
 * outright and percent-encodes everything else that isn't a safe token char.
 * Prevents CRLF injection (S-M5).
 */
function safeContentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const sanitized = filename.replace(/[\x00-\x1f\x7f]/g, '');
  return `attachment; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
}

export interface UploadUrlOptions {
  key: string;
  contentType: string;
  bytes: number;
}

export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export interface DownloadResult {
  // Either a pre-signed URL we 302-redirect the client to, OR a stream we
  // pipe directly back. Local mode uses streams; S3 uses URLs.
  kind: 'redirect' | 'stream';
  url?: string;
  stream?: Readable;
  contentType?: string;
  bytes?: number;
  filename?: string;
}

export interface ObjectMetadata {
  bytes: number;
  contentType?: string;
  checksum?: string | null;
}

export interface StorageAdapter {
  driver: 'local' | 's3';
  // Returns the URL the client should PUT bytes to and the headers required.
  getUploadUrl(opts: UploadUrlOptions): Promise<PresignedUpload>;
  // Generates a fresh storage key for a new upload. Opaque to callers, but
  // the implementation MUST partition keys by orgId so two tenants cannot
  // collide on a chosen accountId. See files.ts for the only call site.
  newKey(orgId: string, accountId: string, name: string): string;
  // Returns a download URL or a readable stream depending on driver.
  getDownload(
    key: string,
    opts: { filename: string; contentType: string },
  ): Promise<DownloadResult>;
  // Hard-delete the underlying object. Idempotent: missing keys do not throw.
  delete(key: string): Promise<void>;
  // Verify an object exists and return storage-sourced metadata. Finalization
  // must use this instead of trusting client-provided bytes/content type.
  head(key: string): Promise<ObjectMetadata>;
  // Read the full object into memory as a Buffer.
  readBuffer(key: string): Promise<Buffer>;
  // Local-only: persist a PUT body to disk. Absent on s3 driver.
  writeLocal?(key: string, body: Readable | Buffer): Promise<{ bytes: number }>;
}

// ─── Local filesystem adapter ────────────────────────────────────────────

const LOCAL_ROOT = path.resolve(process.cwd(), '.uploads');

function safeJoin(root: string, key: string): string {
  // Why: defend against `../` escapes. We resolve and verify the result is
  // still inside the configured root before any disk operation.
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return resolved;
}

function sanitizeName(name: string): string {
  // Strip path separators and control chars; keep readable suffix for the key.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

export function keyBelongsToOrg(storageKey: string, orgId: string): boolean {
  const safeOrg = sanitizeName(orgId) || 'org';
  return storageKey.startsWith(`${safeOrg}/`) || storageKey.startsWith(`orgs/${safeOrg}/`);
}

class LocalStorage implements StorageAdapter {
  driver = 'local' as const;
  private apiBaseUrl: string;

  constructor(apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  newKey(orgId: string, accountId: string, name: string): string {
    // Partition by orgId first so two tenants can never collide on an
    // accountId namespace. The orgId is a UUID — already safe for filesystem
    // segments — but we still sanitize defensively.
    const safeOrg = sanitizeName(orgId) || 'org';
    const safeAccount = sanitizeName(accountId) || 'account';
    return `${safeOrg}/${safeAccount}/${randomUUID()}-${sanitizeName(name) || 'file'}`;
  }

  async getUploadUrl({ key, contentType }: UploadUrlOptions): Promise<PresignedUpload> {
    const url = `${this.apiBaseUrl}/api/files/local-upload?key=${encodeURIComponent(key)}`;
    return { url, headers: { 'Content-Type': contentType } };
  }

  async writeLocal(key: string, body: Readable | Buffer): Promise<{ bytes: number }> {
    const target = safeJoin(LOCAL_ROOT, key);
    await mkdir(path.dirname(target), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await writeFile(target, body);
    } else {
      // Stream → file. Wraps the pipe in a Promise so callers can await it.
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(target);
        body.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', () => resolve());
        body.pipe(ws);
      });
    }
    const s = await stat(target);
    return { bytes: s.size };
  }

  async getDownload(
    key: string,
    opts: { filename: string; contentType: string },
  ): Promise<DownloadResult> {
    const target = safeJoin(LOCAL_ROOT, key);
    const s = await stat(target);
    return {
      kind: 'stream',
      stream: createReadStream(target),
      bytes: s.size,
      contentType: opts.contentType,
      filename: opts.filename,
    };
  }

  async delete(key: string): Promise<void> {
    const target = safeJoin(LOCAL_ROOT, key);
    await rm(target, { force: true });
  }

  async head(key: string): Promise<ObjectMetadata> {
    const target = safeJoin(LOCAL_ROOT, key);
    const s = await stat(target);
    return { bytes: s.size, checksum: null };
  }

  async readBuffer(key: string): Promise<Buffer> {
    const target = safeJoin(LOCAL_ROOT, key);
    const s = await stat(target);
    // Safety: reject files > 50 MB to avoid OOM during text extraction.
    const MAX_BYTES = 50 * 1024 * 1024;
    if (s.size > MAX_BYTES) {
      throw new Error(`File too large for text extraction: ${s.size} bytes (max ${MAX_BYTES})`);
    }
    const chunks: Buffer[] = [];
    const stream = createReadStream(target);
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else chunks.push(Buffer.from(chunk, 'utf-8'));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

// ─── S3 adapter (lazy-loaded) ────────────────────────────────────────────

// WHY: AWS SDK types are only present when the optional deps are installed;
// `unknown` keeps this adapter compiling on dev machines that haven't
// installed them while still surfacing a hard cast at every use site.
type AnyClient = unknown;
// Helper that asserts an AnyClient is callable as if it were the SDK module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WHY: see above
function asSdk(c: AnyClient): any {
  return c;
}

class S3Storage implements StorageAdapter {
  driver = 's3' as const;
  private bucket: string;
  private client: AnyClient;
  private mod: AnyClient;
  private signer: AnyClient;

  constructor(args: { bucket: string; client: AnyClient; mod: AnyClient; signer: AnyClient }) {
    this.bucket = args.bucket;
    this.client = args.client;
    this.mod = args.mod;
    this.signer = args.signer;
  }

  static async create(): Promise<S3Storage> {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT || undefined;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
    if (!bucket) throw new Error('S3_BUCKET env var required when STORAGE_DRIVER=s3');
    let mod: AnyClient;
    let signer: AnyClient;
    try {
      // WHY dynamic specifier: the AWS SDK is an optional peer; a literal
      // `import('@aws-sdk/client-s3')` would fail typecheck on machines that
      // haven't installed it. Composing the specifier hides it from tsc's
      // module resolver while keeping the runtime import semantics.
      const s3Spec = '@aws-sdk/' + 'client-s3';
      const signerSpec = '@aws-sdk/' + 's3-request-presigner';
      mod = await import(s3Spec);
      signer = await import(signerSpec);
    } catch {
      throw new Error(
        'S3 not installed: add @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner to apps/api',
      );
    }
    const client = new (asSdk(mod).S3Client)({ region, endpoint, forcePathStyle });
    return new S3Storage({ bucket, client, mod, signer });
  }

  newKey(orgId: string, accountId: string, name: string): string {
    // Partition by orgId first so two tenants can never collide on an
    // accountId namespace. The orgId is a UUID — already safe for an S3 key
    // segment — but we still sanitize defensively.
    const safeOrg = sanitizeName(orgId) || 'org';
    const safeAccount = sanitizeName(accountId) || 'account';
    return `orgs/${safeOrg}/accounts/${safeAccount}/${randomUUID()}-${sanitizeName(name) || 'file'}`;
  }

  async getUploadUrl({ key, contentType }: UploadUrlOptions): Promise<PresignedUpload> {
    const cmd = new (asSdk(this.mod).PutObjectCommand)({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url: string = await asSdk(this.signer).getSignedUrl(this.client, cmd, {
      expiresIn: 900,
    });
    return { url, headers: { 'Content-Type': contentType } };
  }

  async getDownload(
    key: string,
    opts: { filename: string; contentType: string },
  ): Promise<DownloadResult> {
    const cmd = new (asSdk(this.mod).GetObjectCommand)({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: safeContentDisposition(opts.filename),
      ResponseContentType: opts.contentType,
    });
    const url: string = await asSdk(this.signer).getSignedUrl(this.client, cmd, {
      expiresIn: 900,
    });
    return { kind: 'redirect', url };
  }

  async delete(key: string): Promise<void> {
    const cmd = new (asSdk(this.mod).DeleteObjectCommand)({
      Bucket: this.bucket,
      Key: key,
    });
    await asSdk(this.client).send(cmd);
  }

  async head(key: string): Promise<ObjectMetadata> {
    const cmd = new (asSdk(this.mod).HeadObjectCommand)({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await asSdk(this.client).send(cmd);
    return {
      bytes: Number(response.ContentLength ?? 0),
      contentType: response.ContentType,
      checksum: response.ChecksumSHA256 ?? response.ETag ?? null,
    };
  }

  async readBuffer(key: string): Promise<Buffer> {
    const cmd = new (asSdk(this.mod).GetObjectCommand)({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await asSdk(this.client).send(cmd);
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else chunks.push(Buffer.from(chunk, 'utf-8'));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────

let cached: StorageAdapter | null = null;

export async function getStorage(): Promise<StorageAdapter> {
  if (cached) return cached;
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver === 's3') {
    cached = await S3Storage.create();
  } else {
    const baseUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
    cached = new LocalStorage(baseUrl);
  }
  return cached;
}

// Test seam: lets unit tests inject a fake adapter.
export function __setStorageForTest(adapter: StorageAdapter | null): void {
  cached = adapter;
}
