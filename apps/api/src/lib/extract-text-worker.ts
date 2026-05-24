// Worker-thread entry for the document-extract sandbox. See the
// companion file in apps/worker/src/lib/extract-text-worker.ts for the
// full rationale. The two files are intentionally near-identical
// because the api and worker workspaces are built separately and don't
// share a runtime library yet.

import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

interface WorkerInput {
  bufferData: ArrayBuffer;
  contentType: string;
  name?: string;
  sourcePath?: string;
}

function inferExtension(name?: string): string {
  return name ? path.extname(name).toLowerCase() : '';
}

function isImageContentType(contentType: string, ext: string): boolean {
  return (
    contentType.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.bmp'].includes(ext)
  );
}

async function withTempFile(buffer: Buffer, suffix: string): Promise<string> {
  const tmp = path.join(
    tmpdir(),
    `bidstack-api-sandbox-extract-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
  );
  await writeFile(tmp, buffer);
  return tmp;
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // ignore
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text?: string }>;
  const result = await pdfParse(buffer);
  return typeof result.text === 'string' ? result.text : '';
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const xlsx = require('@e965/xlsx') as {
    read(
      buffer: Buffer,
      opts: { type: string },
    ): {
      SheetNames: string[];
      Sheets: Record<string, unknown>;
    };
    utils: { sheet_to_csv(sheet: unknown): string };
  };
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = xlsx.utils.sheet_to_csv(sheet);
    if (csv.trim()) lines.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return lines.join('\n');
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = require('mammoth') as {
    extractRawText(opts: { buffer: Buffer }): Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractDoc(sourcePath: string): Promise<string> {
  const WordExtractor = require('word-extractor') as new () => {
    extract(p: string): Promise<{ getBody(): string }>;
  };
  const extractor = new WordExtractor();
  const doc = await extractor.extract(sourcePath);
  return doc.getBody() ?? '';
}

async function extractPptx(sourcePath: string): Promise<string> {
  const { default: PptxParser } = require('node-pptx-parser') as {
    default: new (path: string) => { parse(): Promise<{ slides?: Array<{ text?: string }> }> };
  };
  const parser = new PptxParser(sourcePath);
  const result = await parser.parse();
  return (result.slides ?? [])
    .map((slide: { text?: string }) => slide.text?.trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function extractBinaryPpt(buffer: Buffer): string {
  const text = buffer.toString('utf-8');
  if (!text.includes(' ')) return text;
  const matches = buffer.toString('latin1').match(/[\x20-\x7E]{3,}/g);
  const cleaned = (matches ?? [])
    .filter((s) => !/^\d+$/.test(s))
    .filter((s) => !/^[0-9a-fA-F]+$/.test(s))
    .filter((s) => new Set(s).size > 2)
    .join('\n');
  return cleaned.length > 100 ? cleaned : '[Binary PowerPoint file - text extraction limited]';
}

async function extractText(input: WorkerInput): Promise<string> {
  const buffer = Buffer.from(input.bufferData);
  const ct = (input.contentType.toLowerCase().split(';')[0] ?? '').trim();
  const ext = inferExtension(input.name);

  if (ct.startsWith('text/')) return buffer.toString('utf-8');
  if (
    ['application/json', 'application/csv', 'application/xml', 'application/javascript'].includes(
      ct,
    ) ||
    ['.json', '.csv', '.xml', '.md', '.yaml', '.yml'].includes(ext)
  ) {
    return buffer.toString('utf-8');
  }

  if (ct === 'application/pdf' || ext === '.pdf') {
    return extractPdfText(buffer);
  }

  if (isImageContentType(ct, ext) && ext !== '.svg' && ct !== 'image/svg+xml') {
    throw new Error('Image OCR is not supported in the sandbox; run the OCR runtime out-of-band');
  }

  if (
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ct === 'application/docx' ||
    ext === '.docx'
  ) {
    return extractDocx(buffer);
  }

  if (ct === 'application/msword' || ext === '.doc') {
    const tmp = input.sourcePath ?? (await withTempFile(buffer, '.doc'));
    try {
      return await extractDoc(tmp);
    } finally {
      if (!input.sourcePath) await safeUnlink(tmp);
    }
  }

  if (
    ct === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ct === 'application/pptx' ||
    ext === '.pptx'
  ) {
    const tmp = input.sourcePath ?? (await withTempFile(buffer, '.pptx'));
    try {
      return await extractPptx(tmp);
    } finally {
      if (!input.sourcePath) await safeUnlink(tmp);
    }
  }

  if (ct === 'application/vnd.ms-powerpoint' || ext === '.ppt') return extractBinaryPpt(buffer);

  if (
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ct === 'application/vnd.ms-excel' ||
    ct === 'application/excel' ||
    ext === '.xlsx' ||
    ext === '.xls'
  ) {
    return extractXlsx(buffer);
  }

  const text = buffer.toString('utf-8');
  const printable =
    text.length > 0
      ? [...text].filter((c) => {
          const code = c.charCodeAt(0);
          return code >= 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
        }).length / text.length
      : 0;
  if (printable > 0.85) return text;

  throw new Error(
    `Unsupported content type for text extraction: ${input.contentType} (name: ${input.name ?? 'unknown'})`,
  );
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('extract-text-worker.ts must be loaded via worker_threads');
  }

  const input = workerData as WorkerInput;
  try {
    const text = await extractText(input);
    parentPort.postMessage({ ok: true, text });
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

void main();
