import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractTextFromBuffer } from './extract-text.js';
import { readStoredDocument } from './storage-read.js';

let previousRoot: string | undefined;
let previousDriver: string | undefined;
let previousOmniBase: string | undefined;
let previousOmniTimeout: string | undefined;
const tempRoots: string[] = [];

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = previousRoot;
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
  if (previousOmniBase === undefined) delete process.env.OMNIPARSE_BASE_URL;
  else process.env.OMNIPARSE_BASE_URL = previousOmniBase;
  if (previousOmniTimeout === undefined) delete process.env.OMNIPARSE_TIMEOUT_MS;
  else process.env.OMNIPARSE_TIMEOUT_MS = previousOmniTimeout;
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('worker document extraction utilities', () => {
  it('extracts plain text in the worker process', async () => {
    const text = await extractTextFromBuffer({
      buffer: Buffer.from('Requirement: submit the pricing workbook by Friday.'),
      contentType: 'text/plain',
      name: 'rfp.txt',
    });
    expect(text).toContain('pricing workbook');
  });

  it('uses Omniparse before local binary parsers when configured', async () => {
    previousOmniBase = process.env.OMNIPARSE_BASE_URL;
    previousOmniTimeout = process.env.OMNIPARSE_TIMEOUT_MS;
    process.env.OMNIPARSE_BASE_URL = 'http://omniparse.test';
    process.env.OMNIPARSE_TIMEOUT_MS = '1000';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ markdown: '## Parsed RFP\nMandatory pricing table' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const text = await extractTextFromBuffer({
      buffer: Buffer.from('%PDF-1.4 fake body'),
      contentType: 'application/pdf',
      name: 'rfp.pdf',
    });

    expect(text).toContain('Mandatory pricing table');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://omniparse.test/parse_document',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it.each([
    ['image/heic', 'scan.heic', '/parse_media/image'],
    ['audio/mpeg', 'briefing.mp3', '/parse_media/audio'],
    ['video/quicktime', 'site-visit.mov', '/parse_media/video'],
  ])(
    'routes %s files through the matching Omniparse media endpoint',
    async (contentType, name, endpoint) => {
      previousOmniBase = process.env.OMNIPARSE_BASE_URL;
      previousOmniTimeout = process.env.OMNIPARSE_TIMEOUT_MS;
      process.env.OMNIPARSE_BASE_URL = 'http://omniparse.test/';
      process.env.OMNIPARSE_TIMEOUT_MS = '1000';

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ markdown: 'Parsed source evidence' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const text = await extractTextFromBuffer({
        buffer: Buffer.from('fake binary body'),
        contentType,
        name,
      });

      expect(text).toContain('source evidence');
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://omniparse.test${endpoint}`,
        expect.objectContaining({ method: 'POST' }),
      );
    },
  );

  it('fails audio/video extraction loudly when Omniparse is not configured', async () => {
    await expect(
      extractTextFromBuffer({
        buffer: Buffer.from([0, 1, 2, 3, 4]),
        contentType: 'audio/mpeg',
        name: 'briefing.mp3',
      }),
    ).rejects.toThrow(/OMNIPARSE_BASE_URL/);
  });

  it('reads local storage objects only from the matching org partition', async () => {
    previousRoot = process.env.LOCAL_STORAGE_ROOT;
    previousDriver = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = 'local';

    const root = path.join(tmpdir(), `bidstack-worker-storage-${Date.now()}`);
    tempRoots.push(root);
    const orgId = '11111111-1111-4111-8111-111111111111';
    const storageKey = `${orgId}/account/rfp.txt`;
    await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
    await writeFile(path.join(root, storageKey), 'RFP text');
    process.env.LOCAL_STORAGE_ROOT = root;

    const stored = await readStoredDocument({ orgId, storageKey });
    expect(stored.buffer.toString('utf-8')).toBe('RFP text');
    await expect(
      readStoredDocument({
        orgId: '22222222-2222-4222-8222-222222222222',
        storageKey,
      }),
    ).rejects.toThrow('Storage key does not belong to org');
  });
});
