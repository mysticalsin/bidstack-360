import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractTextFromBuffer } from './extract-text.js';
import { buildUnlimitedOcrRequest, unlimitedOcrToText } from './unlimited-ocr.js';

const envKeys = [
  'BIDSTACK_OCR_ENABLED',
  'BIDSTACK_UNLIMITED_OCR_URL',
  'BIDSTACK_UNLIMITED_OCR_MODEL',
  'BIDSTACK_UNLIMITED_OCR_TIMEOUT_MS',
  'BIDSTACK_UNLIMITED_OCR_DPI',
  'BIDSTACK_UNLIMITED_OCR_MAX_PAGES',
  'BIDSTACK_PDFTOPPM_BIN',
  'BIDSTACK_GHOSTSCRIPT_BIN',
  'BIDSTACK_OCRMYPDF_BIN',
  'BIDSTACK_TESSERACT_BIN',
  'BIDSTACK_OCR_TIMEOUT_MS',
  'OMNIPARSE_BASE_URL',
] as const;

const previousEnv = new Map<string, string | undefined>();
const tempRoots: string[] = [];

function rememberEnv(): void {
  if (previousEnv.size > 0) return;
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
}

function restoreEnv(): void {
  for (const key of envKeys) {
    const previous = previousEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  previousEnv.clear();
}

function enableUnlimitedOcr(): void {
  rememberEnv();
  delete process.env.OMNIPARSE_BASE_URL;
  process.env.BIDSTACK_OCR_ENABLED = 'true';
  process.env.BIDSTACK_UNLIMITED_OCR_URL = 'http://unlimited-ocr.test:10000';
  process.env.BIDSTACK_UNLIMITED_OCR_MODEL = 'Unlimited-OCR-2';
  process.env.BIDSTACK_UNLIMITED_OCR_TIMEOUT_MS = '5000';
  process.env.BIDSTACK_OCRMYPDF_BIN = '/no/such/ocrmypdf';
  process.env.BIDSTACK_TESSERACT_BIN = '/no/such/tesseract';
}

async function writeRasterizer(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'bidstack-uocr-test-'));
  tempRoots.push(root);
  const bin = path.join(root, 'rasterizer.cjs');
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');
const args = process.argv.slice(2);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const pdf = outArg ? args[args.length - 1] : args[args.length - 2];
const out = outArg
  ? outArg.slice('-sOutputFile='.length).replace('%03d', '001').replace('%d', '1')
  : args[args.length - 1] + '-1.png';
const hash = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
fs.writeFileSync(out, Buffer.from('PAGE:' + hash));
`,
  );
  await chmod(bin, 0o755);
  return bin;
}

function pageMarker(buffer: Buffer): string {
  return Buffer.from(`PAGE:${createHash('sha256').update(buffer).digest('hex')}`).toString(
    'base64',
  );
}

function completion(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const scannedLayout =
  '<PAGE><BLOCK>title<LEVEL1>[0,0,100,20]<FORK>MASTER SERVICES AGREEMENT\n<BLOCK>text[0,30,100,80]<FORK>OCR RUNTIME READY';

function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

afterEach(async () => {
  restoreEnv();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('unlimited OCR layout text', () => {
  it('keeps plain model text when the server did not emit layout tokens', () => {
    expect(unlimitedOcrToText('  Pricing workbook due Friday.  ')).toBe(
      'Pricing workbook due Friday.',
    );
  });

  it('reads title and body text out of layout tokens', () => {
    const text = unlimitedOcrToText(scannedLayout);
    expect(text).toContain('# MASTER SERVICES AGREEMENT');
    expect(text).toContain('OCR RUNTIME READY');
  });

  it('returns nothing for an empty or image-only parse', () => {
    expect(unlimitedOcrToText('')).toBe('');
    expect(unlimitedOcrToText('   ')).toBe('');
    expect(
      unlimitedOcrToText('<PAGE><BLOCK>image[0,0,10,10]<FORK>[image]<BLOCK>text[0,0,1,1]<FORK>'),
    ).toBe('');
  });
});

describe('unlimited OCR request', () => {
  it('sends every page image and the multi-page prompt', () => {
    enableUnlimitedOcr();
    const first = Buffer.from('page-one-scan');
    const second = Buffer.from('page-two-scan');
    const request = buildUnlimitedOcrRequest([
      { buffer: first, mime: 'image/png' },
      { buffer: second, mime: 'image/jpeg' },
    ]);

    expect(request.url).toBe('http://unlimited-ocr.test:10000/v1/chat/completions');
    expect(request.body.model).toBe('Unlimited-OCR-2');
    expect(request.body.temperature).toBe(0);
    expect(request.body.images_config).toEqual({ crop_mode: true });
    const content = request.body.messages[0]?.content ?? [];
    expect(content[0]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${first.toString('base64')}` },
    });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${second.toString('base64')}` },
    });
    expect(content[2]).toEqual({
      type: 'text',
      text: '<PAGE><image><PAGE><image>Multi page parsing.',
    });
  });

  it('rejects a non-http service URL before any request is built', () => {
    enableUnlimitedOcr();
    process.env.BIDSTACK_UNLIMITED_OCR_URL = 'ftp://unlimited-ocr.test/ocr';
    expect(() =>
      buildUnlimitedOcrRequest([{ buffer: Buffer.from('x'), mime: 'image/png' }]),
    ).toThrow(/http\(s\) URL/);
  });
});

describe('extractTextFromBuffer Unlimited OCR', () => {
  it('passes a scanned PDF through Unlimited OCR and returns the recognized text', async () => {
    enableUnlimitedOcr();
    const rasterizer = await writeRasterizer();
    process.env.BIDSTACK_PDFTOPPM_BIN = rasterizer;
    const buffer = await readFile(new URL('./__fixtures__/ocr-smoke-scanned.pdf', import.meta.url));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion(scannedLayout));

    const text = await extractTextFromBuffer({
      buffer,
      contentType: 'application/pdf',
      name: 'ocr-smoke-scanned.pdf',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe('http://unlimited-ocr.test:10000/v1/chat/completions');
    expect(call?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    const body = String((call?.[1] as RequestInit | undefined)?.body ?? '');
    expect(body).toContain(pageMarker(buffer));
    expect(body).toContain('<PAGE><image>Multi page parsing.');
    expect(text).toContain('MASTER SERVICES AGREEMENT');
    expect(text).toContain('OCR RUNTIME READY');
  });

  it('passes an image scan through Unlimited OCR instead of local tesseract', async () => {
    enableUnlimitedOcr();
    const scan = Buffer.from('this-is-a-scanned-page-not-utf8-text');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(completion('<BLOCK>text[0,0,10,10]<FORK>submit the pricing workbook'));

    const text = await extractTextFromBuffer({
      buffer: scan,
      contentType: 'image/png',
      name: 'scan.png',
    });

    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? '');
    expect(body).toContain(scan.toString('base64'));
    expect(text).toContain('pricing workbook');
  });

  it('does not invent text when Unlimited OCR returns an empty parse', async () => {
    enableUnlimitedOcr();
    const rasterizer = await writeRasterizer();
    process.env.BIDSTACK_PDFTOPPM_BIN = rasterizer;
    const buffer = await readFile(new URL('./__fixtures__/ocr-smoke-scanned.pdf', import.meta.url));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(completion('<PAGE><BLOCK>image[0,0,10,10]<FORK>[image]'));

    const text = await extractTextFromBuffer({
      buffer,
      contentType: 'application/pdf',
      name: 'ocr-smoke-scanned.pdf',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? '');
    expect(body).toContain(pageMarker(buffer));
    // The fixture's only embedded text is a page label. An empty OCR read must
    // leave that label in place and must not invent a document body.
    expect(text.trim()).toBe('-- 1 of 1 --');
    expect(text).not.toContain('MASTER SERVICES AGREEMENT');
    expect(text).not.toContain('OCR RUNTIME READY');
  });

  it('fails an image scan when Unlimited OCR returns no text', async () => {
    enableUnlimitedOcr();
    const scan = Buffer.from('empty-scan');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion('   '));

    await expect(
      extractTextFromBuffer({ buffer: scan, contentType: 'image/png', name: 'blank.png' }),
    ).rejects.toThrow(/no text from Unlimited OCR/);
    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? '');
    expect(body).toContain(scan.toString('base64'));
  });

  it('fails the extraction when the Unlimited OCR service returns an error', async () => {
    enableUnlimitedOcr();
    const scan = Buffer.from('failed-scan');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('model unavailable', { status: 502 }),
    );

    await expect(
      extractTextFromBuffer({ buffer: scan, contentType: 'image/png', name: 'scan.png' }),
    ).rejects.toThrow(/Unlimited OCR request failed \(502\)/);
  });

  it('fails the extraction when the Unlimited OCR service cannot be reached', async () => {
    enableUnlimitedOcr();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:10000'),
    );

    await expect(
      extractTextFromBuffer({
        buffer: Buffer.from('offline-scan'),
        contentType: 'image/jpeg',
        name: 'scan.jpg',
      }),
    ).rejects.toThrow(/Unlimited OCR request failed: connect ECONNREFUSED/);
  });

  it('fails a scanned PDF when neither pdftoppm nor ghostscript is installed', async () => {
    enableUnlimitedOcr();
    process.env.BIDSTACK_PDFTOPPM_BIN = '/no/such/pdftoppm';
    process.env.BIDSTACK_GHOSTSCRIPT_BIN = '/no/such/gs';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion(scannedLayout));
    const buffer = await readFile(new URL('./__fixtures__/ocr-smoke-scanned.pdf', import.meta.url));

    await expect(
      extractTextFromBuffer({
        buffer,
        contentType: 'application/pdf',
        name: 'ocr-smoke-scanned.pdf',
      }),
    ).rejects.toThrow(/pdftoppm \(poppler-utils\) or ghostscript/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rasterizes with ghostscript when pdftoppm is not installed', async () => {
    enableUnlimitedOcr();
    process.env.BIDSTACK_PDFTOPPM_BIN = '/no/such/pdftoppm';
    process.env.BIDSTACK_GHOSTSCRIPT_BIN = await writeRasterizer();
    const buffer = await readFile(new URL('./__fixtures__/ocr-smoke-scanned.pdf', import.meta.url));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion(scannedLayout));

    const text = await extractTextFromBuffer({
      buffer,
      contentType: 'application/pdf',
      name: 'ocr-smoke-scanned.pdf',
    });

    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? '');
    expect(body).toContain(pageMarker(buffer));
    expect(text).toContain('OCR RUNTIME READY');
  });

  it('leaves a born-digital PDF on the text parser', async () => {
    enableUnlimitedOcr();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('OCR must not be called'));
    const sentence = 'Mandatory: the vendor shall provide a pricing workbook by Friday.';
    const text = await extractTextFromBuffer({
      buffer: buildMinimalPdf(sentence),
      contentType: 'application/pdf',
      name: 'born-digital.pdf',
    });

    expect(text.replace(/\s+/g, ' ')).toContain(sentence);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not call Unlimited OCR when the OCR gate is off', async () => {
    rememberEnv();
    delete process.env.OMNIPARSE_BASE_URL;
    process.env.BIDSTACK_OCR_ENABLED = 'false';
    process.env.BIDSTACK_UNLIMITED_OCR_URL = 'http://unlimited-ocr.test:10000';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('OCR must not be called'));
    const buffer = await readFile(new URL('./__fixtures__/ocr-smoke-scanned.pdf', import.meta.url));

    const text = await extractTextFromBuffer({
      buffer,
      contentType: 'application/pdf',
      name: 'ocr-smoke-scanned.pdf',
    });

    expect(text.trim()).toBe('-- 1 of 1 --');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
