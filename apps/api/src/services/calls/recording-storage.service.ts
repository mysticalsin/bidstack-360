/**
 * Recording storage service — uploads call recordings to S3 and generates
 * short-lived signed URLs for frontend playback.
 *
 * WHY S3 (not serve from Twilio/Zoom directly):
 *  - Zoom recording URLs expire after 24 h.
 *  - Twilio recording URLs require HTTP Basic auth (TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN).
 *  - Storing in our own S3 gives us lifecycle control (retention policy, PII delete).
 *  - Signed URLs limit access to authenticated users; expiry is configurable.
 *
 * WHY AWS SDK v3 (modular): tree-shakeable; only imports S3Client + PutObjectCommand +
 * GetObjectCommand. Avoids pulling in the entire v2 SDK.
 *
 * IMPORTANT: This module only runs in apps/api and apps/worker — not in browser code.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ─── Config ────────────────────────────────────────────────────────────────

function getS3Config() {
  return {
    bucket: process.env.CALL_RECORDINGS_S3_BUCKET ?? '',
    prefix: process.env.CALL_RECORDINGS_S3_PREFIX ?? 'recordings',
    region: process.env.CALL_RECORDINGS_S3_REGION ?? 'eu-west-1',
    accessKeyId: process.env.CALL_RECORDINGS_S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.CALL_RECORDINGS_S3_SECRET ?? '',
    signedUrlTtlSec: Number(process.env.CALL_RECORDINGS_SIGNED_URL_TTL_SEC ?? '300'),
  };
}

function getS3Client(cfg: ReturnType<typeof getS3Config>): S3Client {
  return new S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Uploads a recording Buffer to S3.
 *
 * @param callSessionId - UUID of the CallSession (used as S3 object key prefix).
 * @param buffer - Raw audio bytes (MP3, MP4, WebM).
 * @param mimeType - MIME type of the audio.
 * @returns The S3 object key (not a URL — sign at serve time).
 */
export async function uploadRecording(
  callSessionId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const cfg = getS3Config();

  if (!cfg.bucket) {
    throw new Error('RecordingStorage: CALL_RECORDINGS_S3_BUCKET env var is required');
  }

  const ext = mimeType === 'audio/mpeg' || mimeType === 'audio/mp3' ? 'mp3' : 'webm';
  const objectKey = `${cfg.prefix}/${callSessionId}/recording.${ext}`;

  const client = getS3Client(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256',
      // Metadata for compliance / lifecycle rules
      Metadata: {
        'call-session-id': callSessionId,
        'uploaded-at': new Date().toISOString(),
      },
    }),
  );

  return objectKey;
}

/**
 * Generates a short-lived presigned S3 URL for frontend playback.
 *
 * WHY short TTL (default 5 min): recordings contain PII (names, financials).
 * The frontend fetches a fresh URL on each playback session via GET /calls/:id.
 *
 * @param objectKey - The S3 object key returned by `uploadRecording`.
 * @returns Presigned URL string valid for CALL_RECORDINGS_SIGNED_URL_TTL_SEC seconds.
 */
export async function getSignedRecordingUrl(objectKey: string): Promise<string> {
  const cfg = getS3Config();

  if (!cfg.bucket) {
    throw new Error('RecordingStorage: CALL_RECORDINGS_S3_BUCKET env var is required');
  }

  const client = getS3Client(cfg);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey }),
    { expiresIn: cfg.signedUrlTtlSec },
  );
}
