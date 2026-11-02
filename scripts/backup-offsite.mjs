#!/usr/bin/env node
/**
 * Upload one custom-format dump to Cloudflare R2 (S3 API) and drop objects
 * older than POLO_BACKUP_RETENTION_DAYS (default 14). Disabled unless the
 * caller already checked endpoint + keys.
 */
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function loadS3() {
  const fromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
  for (const req of [require, fromApi]) {
    try {
      return req('@aws-sdk/client-s3');
    } catch {
      /* try next */
    }
  }
  throw new Error('Install @aws-sdk/client-s3 to upload backups to R2');
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/backup-offsite.mjs <polo-*.dump>');
  process.exit(1);
}

const endpoint = process.env.POLO_BACKUP_S3_ENDPOINT;
const accessKeyId = process.env.POLO_BACKUP_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.POLO_BACKUP_S3_SECRET_ACCESS_KEY;
const bucket = process.env.POLO_BACKUP_S3_BUCKET || 'polo-backups';
const region = process.env.POLO_BACKUP_S3_REGION || 'auto';
const keepDays = Number(process.env.POLO_BACKUP_RETENTION_DAYS || '14');

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error('Offsite upload is not configured');
  process.exit(1);
}

const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = loadS3();
const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

const key = basename(file);
const info = await stat(file);
await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(file),
    ContentType: 'application/octet-stream',
    ContentLength: info.size,
  }),
);
console.log(`Uploaded s3://${bucket}/${key} via ${endpoint}`);

if (Number.isFinite(keepDays) && keepDays > 0) {
  const cutoff = Date.now() - keepDays * 86_400_000;
  let token;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'polo-', ContinuationToken: token }),
    );
    for (const obj of listed.Contents ?? []) {
      const last = obj.LastModified ? obj.LastModified.getTime() : Date.now();
      if (obj.Key && last < cutoff) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
        console.log(`Dropped expired offsite object ${obj.Key}`);
      }
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}
