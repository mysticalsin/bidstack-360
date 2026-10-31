import { afterEach, describe, expect, it, vi } from 'vitest';

// Regression: the S3 presigned PUT did not sign Content-Length, so a client
// could reuse the URL to store an object of any size (FILE_MAX_BYTES was only
// enforced later, at finalize, after the bytes were already in the bucket).
describe('S3 presigned upload', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('signs content-length and content-type into the upload URL', async () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_BUCKET', 'unit-test-bucket');
    vi.stubEnv('S3_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'unit-test-access-key-id');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'unit-test-only-not-a-secret');
    vi.resetModules();
    const { getStorage } = await import('./index.js');
    const storage = await getStorage();

    const { url, headers } = await storage.getUploadUrl({
      key: 'org/acct/file.pdf',
      contentType: 'application/pdf',
      bytes: 1234,
    });

    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toEqual(expect.arrayContaining(['content-length', 'host']));
    expect(headers['Content-Type']).toBe('application/pdf');
  });
});
