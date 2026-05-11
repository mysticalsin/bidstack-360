// Files route — unit-level Zod / contract tests.
//
// Why offline: full route exercise lives alongside the opportunities
// integration suite, which expects a live Postgres + seed. Here we lock
// the wire schemas (request + response) so a refactor that loosens them
// fails CI even when the DB is unreachable. We also pin the local-storage
// upload-URL contract because the web client constructs PUT requests
// against that exact shape.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  ALLOWED_FILE_CONTENT_TYPES,
  FILE_MAX_BYTES,
  FileFinalizeRequest,
  FileUploadUrlRequest,
  FileUploadUrlResponse,
} from '@bidstack/shared';

import { __setStorageForTest, type StorageAdapter } from '../storage/index.js';
import { filesRoutes } from './files.js';

describe('files route contract', () => {
  beforeEach(() => __setStorageForTest(null));

  it('exports a Fastify plugin', () => {
    expect(typeof filesRoutes).toBe('function');
  });

  it('rejects oversize uploads at the request schema', () => {
    const tooBig = FileUploadUrlRequest.safeParse({
      accountId: 'acme',
      name: 'huge.pdf',
      contentType: 'application/pdf',
      bytes: FILE_MAX_BYTES + 1,
    });
    // Why: the cap is enforced in shared schema so both client and server
    // reject the request without round-tripping the bytes.
    expect(tooBig.success).toBe(false);
  });

  it('rejects unknown content types', () => {
    const badType = FileUploadUrlRequest.safeParse({
      accountId: 'acme',
      name: 'evil.exe',
      contentType: 'application/x-msdownload',
      bytes: 1024,
    });
    // Why: prevents the upload endpoint from becoming an arbitrary file
    // relay. New types must be added to ALLOWED_FILE_CONTENT_TYPES.
    expect(badType.success).toBe(false);
  });

  it('accepts every documented content type', () => {
    for (const ct of ALLOWED_FILE_CONTENT_TYPES) {
      const ok = FileUploadUrlRequest.safeParse({
        accountId: 'acme',
        name: 'doc',
        contentType: ct,
        bytes: 1,
      });
      expect(ok.success, `expected ${ct} to be accepted`).toBe(true);
    }
  });

  it('round-trips finalize payloads', () => {
    const ok = FileFinalizeRequest.safeParse({
      accountId: 'acme',
      storageKey: 'acme/abc123-rfp.pdf',
      name: 'rfp.pdf',
      contentType: 'application/pdf',
      bytes: 4096,
    });
    expect(ok.success).toBe(true);
  });

  it('locks the upload-url response shape (uploadUrl, storageKey, headers)', () => {
    // Why: the web client builds the PUT request against this exact shape;
    // dropping `headers` or renaming `storageKey` is a silent breaking change.
    const ok = FileUploadUrlResponse.safeParse({
      uploadUrl: 'http://localhost:4000/api/files/local-upload?key=acme%2Ffoo',
      storageKey: 'acme/foo',
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(ok.success).toBe(true);
  });

  it('local storage adapter generates org-isolated keys + a working PUT URL', async () => {
    const { getStorage } = await import('../storage/index.js');
    process.env.STORAGE_DRIVER = 'local';
    process.env.PUBLIC_API_URL = 'http://localhost:4000';
    __setStorageForTest(null);
    const storage = await getStorage();
    expect(storage.driver).toBe('local');

    const key = storage.newKey(
      '11111111-1111-1111-1111-111111111111',
      'acme corp',
      'My Report.pdf',
    );
    // Why: keys must contain a UUID to prevent collisions when two users
    // upload files with the same name to the same account simultaneously,
    // AND must be partitioned by orgId so two tenants can never collide on
    // the same accountId namespace.
    expect(key).toMatch(
      /^11111111-1111-1111-1111-111111111111\/acme_corp\/[0-9a-f-]{36}-My_Report\.pdf$/,
    );

    const presigned = await storage.getUploadUrl({
      key,
      contentType: 'application/pdf',
      bytes: 1234,
    });
    expect(presigned.url).toContain('/api/files/local-upload?key=');
    expect(presigned.url).toContain(encodeURIComponent(key));
    expect(presigned.headers['Content-Type']).toBe('application/pdf');
  });

  it('s3 driver throws a descriptive error if the AWS SDK is not installed', async () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'bidstack-files';
    __setStorageForTest(null);
    // Why: prod deploy without optional AWS deps must fail loudly at boot,
    // not silently fall back to local disk where files would vanish on
    // container restarts.
    const { getStorage } = await import('../storage/index.js');
    let err: unknown;
    try {
      await getStorage();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/S3 not installed|bucket/i);
    // restore
    process.env.STORAGE_DRIVER = 'local';
    delete process.env.S3_BUCKET;
    __setStorageForTest(null);
  });

  it('test seam swaps in a fake adapter (used by integration tests)', () => {
    const fake: StorageAdapter = {
      driver: 'local',
      newKey: () => 'fake-key',
      getUploadUrl: async () => ({ url: 'http://x', headers: {} }),
      getDownload: async () => ({ kind: 'redirect', url: 'http://x' }),
      delete: async () => undefined,
    };
    __setStorageForTest(fake);
    // No assertion needed — this just locks the type signature so future
    // changes to StorageAdapter break compilation here, surfacing the API
    // contract change to anyone touching it.
    expect(fake.driver).toBe('local');
  });
});
