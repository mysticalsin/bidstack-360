import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

const MAX_EXTRACTION_BYTES = 50 * 1024 * 1024;

export interface StoredDocument {
  buffer: Buffer;
  sourcePath?: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

function safeJoin(root: string, key: string): string {
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return resolved;
}

function keyBelongsToOrg(storageKey: string, orgId: string): boolean {
  const safeOrg = sanitizeName(orgId) || 'org';
  return storageKey.startsWith(`${safeOrg}/`) || storageKey.startsWith(`orgs/${safeOrg}/`);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_EXTRACTION_BYTES) {
        reject(new Error(`File too large for extraction: ${total} bytes`));
        stream.destroy();
        return;
      }
      chunks.push(buffer);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function readLocal(storageKey: string): Promise<StoredDocument> {
  const root = path.resolve(process.env.LOCAL_STORAGE_ROOT ?? path.join(process.cwd(), '.uploads'));
  const sourcePath = safeJoin(root, storageKey);
  const s = await stat(sourcePath);
  if (s.size > MAX_EXTRACTION_BYTES) {
    throw new Error(`File too large for extraction: ${s.size} bytes`);
  }
  return { buffer: await streamToBuffer(createReadStream(sourcePath)), sourcePath };
}

async function readS3(storageKey: string): Promise<StoredDocument> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET env var required when STORAGE_DRIVER=s3');
  const client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  const body = response.Body;
  if (!body || typeof (body as Readable).on !== 'function') {
    throw new Error('S3 object body is not readable');
  }
  return { buffer: await streamToBuffer(body as Readable) };
}

export async function readStoredDocument(args: {
  orgId: string;
  storageKey: string;
}): Promise<StoredDocument> {
  if (!keyBelongsToOrg(args.storageKey, args.orgId)) {
    throw new Error('Storage key does not belong to org');
  }
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  return driver === 's3' ? readS3(args.storageKey) : readLocal(args.storageKey);
}
