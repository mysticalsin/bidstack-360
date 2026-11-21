import { afterEach, describe, expect, it } from 'vitest';

import { fetchSigningDocumentBytes } from './signing-document-fetch.js';

/**
 * WHY: Hammer ARTEX F-11. sendDocuSignEnvelope fetches Document.storageUrl with
 * the default redirect policy and no public-host check. A metadata URL must
 * throw before any socket opens.
 */

const envKeys = ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT'] as const;
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('fetchSigningDocumentBytes', () => {
  it('throws before a dial when the storage URL is the metadata service', async () => {
    let dialed = false;
    await expect(
      fetchSigningDocumentBytes('http://169.254.169.254/latest/meta-data/', {
        transport: async () => {
          dialed = true;
          return { status: 200, headers: {}, body: new Uint8Array([1]) };
        },
      }),
    ).rejects.toThrow(/https|refused|allowed|blocked/i);
    expect(dialed).toBe(false);
  });

  it('throws before a dial when the host is not the configured bucket', async () => {
    process.env.S3_BUCKET = 'documents';
    process.env.S3_REGION = 'us-east-1';
    let dialed = false;
    await expect(
      fetchSigningDocumentBytes('https://evil.example/file.pdf', {
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
        transport: async () => {
          dialed = true;
          return { status: 200, headers: {}, body: new Uint8Array([1]) };
        },
      }),
    ).rejects.toThrow(/allowed bucket/i);
    expect(dialed).toBe(false);
  });

  it('reads an allowlisted bucket over a pinned connection and refuses redirects', async () => {
    process.env.S3_BUCKET = 'documents';
    process.env.S3_REGION = 'us-east-1';
    const dials: string[] = [];
    const buf = await fetchSigningDocumentBytes('https://documents.s3.us-east-1.amazonaws.com/a.pdf', {
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: async (dial) => {
        dials.push(dial.address);
        return { status: 200, headers: {}, body: new Uint8Array([9, 8, 7]) };
      },
    });
    expect(Buffer.from(buf)).toEqual(Buffer.from([9, 8, 7]));
    expect(dials).toEqual(['93.184.216.34']);
  });
});
