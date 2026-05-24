import { afterEach, describe, expect, it } from 'vitest';

import { extractTextFromBuffer } from './extract-text.js';

const ORIGINAL_OCR_ENABLED = process.env.BIDSTACK_OCR_ENABLED;

afterEach(() => {
  if (ORIGINAL_OCR_ENABLED === undefined) {
    delete process.env.BIDSTACK_OCR_ENABLED;
  } else {
    process.env.BIDSTACK_OCR_ENABLED = ORIGINAL_OCR_ENABLED;
  }
});

describe('extractTextFromBuffer', () => {
  it('returns UTF-8 text directly for plain text documents', async () => {
    await expect(
      extractTextFromBuffer({
        buffer: Buffer.from('RFP deadline: Friday\nMandatory security appendix required'),
        contentType: 'text/plain',
        name: 'rfp.txt',
      }),
    ).resolves.toContain('Mandatory security appendix');
  });

  it('treats JSON extensions as text even when content type is generic', async () => {
    await expect(
      extractTextFromBuffer({
        buffer: Buffer.from('{"kind":"rfi","buyer":"Example"}'),
        contentType: 'application/octet-stream',
        name: 'metadata.json',
      }),
    ).resolves.toContain('"rfi"');
  });

  it('fails loudly for image OCR when the optional OCR runtime is disabled', async () => {
    process.env.BIDSTACK_OCR_ENABLED = 'false';

    await expect(
      extractTextFromBuffer({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
        name: 'scan.png',
      }),
    ).rejects.toThrow('Image OCR requires BIDSTACK_OCR_ENABLED=true');
  });
});
