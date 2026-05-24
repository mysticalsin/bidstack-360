import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { extractTextFromBuffer } from './extract-text.js';
import { readStoredDocument } from './storage-read.js';

let previousRoot: string | undefined;
let previousDriver: string | undefined;
const tempRoots: string[] = [];

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = previousRoot;
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
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
