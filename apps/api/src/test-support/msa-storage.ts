// In-memory storage adapter for MSA tests (stands in for S3 or local disk).
import { Readable } from 'node:stream';

import type { StorageAdapter } from '../storage/index.js';

export interface FakeStorage extends StorageAdapter {
  objects: Map<string, { body: Buffer; contentType: string }>;
  deleted: string[];
  lastDownloadOpts: { expiresInSeconds?: number } | null;
  put(key: string, body: Buffer, contentType: string): void;
}

export function makeFakeStorage(driver: 's3' | 'local'): FakeStorage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const fake: FakeStorage = {
    driver,
    objects,
    deleted: [],
    lastDownloadOpts: null,
    put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async putObject(key, body, contentType) {
      objects.set(key, { body, contentType });
      return { bytes: body.length };
    },
    newKey(orgId, accountId, name) {
      const safe = (v: string) => v.replace(/[^a-zA-Z0-9._-]/g, '_');
      return `orgs/${safe(orgId)}/accounts/${safe(accountId)}/${Math.random().toString(36).slice(2)}-${safe(name)}`;
    },
    async getUploadUrl({ key, contentType, bytes }) {
      return {
        url: `https://bucket.example.test/${key}?X-Amz-SignedHeaders=content-length%3Bcontent-type&len=${bytes}`,
        headers: { 'Content-Type': contentType },
      };
    },
    async getDownload(key, opts) {
      fake.lastDownloadOpts = { expiresInSeconds: opts.expiresInSeconds };
      if (driver === 's3') {
        return {
          kind: 'redirect',
          url: `https://bucket.example.test/${key}?X-Amz-Expires=${opts.expiresInSeconds ?? 900}`,
        };
      }
      const obj = objects.get(key);
      if (!obj) throw new Error('missing');
      return { kind: 'stream', stream: Readable.from(obj.body), bytes: obj.body.length, contentType: opts.contentType };
    },
    async delete(key) {
      fake.deleted.push(key);
      objects.delete(key);
    },
    async head(key) {
      const obj = objects.get(key);
      if (!obj) throw new Error('missing');
      return { bytes: obj.body.length, contentType: obj.contentType, checksum: null };
    },
    async readBuffer(key) {
      const obj = objects.get(key);
      if (!obj) throw new Error('missing');
      return obj.body;
    },
  };
  return fake;
}

export const PDF_TYPE = 'application/pdf';
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function fakePdf(text: string): Buffer {
  return Buffer.from(`%PDF-1.7\n1 0 obj << >> endobj\n% ${text}\n%%EOF\n`);
}

export function fakeDocx(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`\u0000\u0000[Content_Types].xml word/document.xml ${text}`),
  ]);
}
