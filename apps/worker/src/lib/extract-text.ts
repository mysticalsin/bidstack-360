import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);

const OCR_MIN_PDF_TEXT_CHARS = 50;
const OCR_MAX_BUFFER = 20 * 1024 * 1024;

export interface ExtractOptions {
  buffer: Buffer;
  contentType: string;
  name?: string;
  sourcePath?: string;
}

function ocrEnabled(): boolean {
  return process.env.BIDSTACK_OCR_ENABLED === 'true';
}

function ocrTimeoutMs(): number {
  const parsed = Number(process.env.BIDSTACK_OCR_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

function ocrLanguages(): string {
  return process.env.BIDSTACK_OCR_LANGUAGES ?? 'eng';
}

async function runOcrCommand(binary: string, args: string[]): Promise<{ stdout: string }> {
  try {
    return await execFile(binary, args, {
      timeout: ocrTimeoutMs(),
      maxBuffer: OCR_MAX_BUFFER,
      windowsHide: true,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `${binary} is not installed or not on PATH. Install OCRmyPDF/Tesseract or disable BIDSTACK_OCR_ENABLED.`,
        { cause: err },
      );
    }
    throw err;
  }
}

async function withTempFile(buffer: Buffer, suffix: string): Promise<string> {
  const tmp = path.join(
    tmpdir(),
    `bidstack-worker-extract-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
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

function inferExtension(name?: string): string {
  return name ? path.extname(name).toLowerCase() : '';
}

function isImageContentType(contentType: string, ext: string): boolean {
  return (
    contentType.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.bmp'].includes(ext)
  );
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // WHY this shape: pdf-parse@2.x dropped the callable default export of the 1.x
  // line and now ships a `PDFParse` class (pdf.js under the hood). The old
  // `require('pdf-parse')(buffer)` call threw "pdfParse is not a function" for
  // every PDF — fixed to the v2 instance API. A fresh Uint8Array copy is passed
  // because pdf.js detaches the backing buffer during parsing.
  const { PDFParse } = require('pdf-parse') as {
    PDFParse: new (opts: { data: Uint8Array }) => {
      getText(): Promise<{ text?: string }>;
      destroy(): Promise<void>;
    };
  };
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return typeof result.text === 'string' ? result.text : '';
  } finally {
    await parser.destroy();
  }
}

async function ocrPdf(buffer: Buffer): Promise<string> {
  if (!ocrEnabled()) return '';
  const input = await withTempFile(buffer, '.pdf');
  const output = path.join(
    tmpdir(),
    `bidstack-worker-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    await runOcrCommand(process.env.BIDSTACK_OCRMYPDF_BIN ?? 'ocrmypdf', [
      '--skip-text',
      '--deskew',
      '--rotate-pages',
      '-l',
      ocrLanguages(),
      input,
      output,
    ]);
    return extractPdfText(await readFile(output));
  } finally {
    await safeUnlink(input);
    await safeUnlink(output);
  }
}

async function ocrImage(buffer: Buffer, ext: string): Promise<string> {
  if (!ocrEnabled()) return '';
  const input = await withTempFile(buffer, ext && ext !== '.svg' ? ext : '.png');
  try {
    const result = await runOcrCommand(process.env.BIDSTACK_TESSERACT_BIN ?? 'tesseract', [
      input,
      'stdout',
      '-l',
      ocrLanguages(),
    ]);
    return result.stdout.trim();
  } finally {
    await safeUnlink(input);
  }
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

async function extractDoc(sourcePath: string): Promise<string> {
  const WordExtractor = require('word-extractor') as new () => {
    extract(path: string): Promise<{ getBody(): string }>;
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
  if (!text.includes('\u0000')) return text;
  const matches = buffer.toString('latin1').match(/[\x20-\x7E]{3,}/g);
  const cleaned = (matches ?? [])
    .filter((s) => !/^\d+$/.test(s))
    .filter((s) => !/^[0-9a-fA-F]+$/.test(s))
    .filter((s) => new Set(s).size > 2)
    .join('\n');
  return cleaned.length > 100 ? cleaned : '[Binary PowerPoint file - text extraction limited]';
}

export async function extractTextFromBuffer(opts: ExtractOptions): Promise<string> {
  const { buffer, contentType, name, sourcePath } = opts;
  const ct = (contentType.toLowerCase().split(';')[0] ?? '').trim();
  const ext = inferExtension(name);

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
    const text = await extractPdfText(buffer);
    if (text.trim().length >= OCR_MIN_PDF_TEXT_CHARS || !ocrEnabled()) return text;
    return (await ocrPdf(buffer)) || text;
  }

  if (isImageContentType(ct, ext) && ext !== '.svg' && ct !== 'image/svg+xml') {
    const text = await ocrImage(buffer, ext);
    if (text) return text;
    throw new Error(
      'Image OCR requires BIDSTACK_OCR_ENABLED=true plus Tesseract on the worker runtime',
    );
  }

  if (
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ct === 'application/docx' ||
    ext === '.docx'
  ) {
    const mammoth = require('mammoth') as {
      extractRawText(opts: { buffer: Buffer }): Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ct === 'application/msword' || ext === '.doc') {
    const tmp = sourcePath ?? (await withTempFile(buffer, '.doc'));
    try {
      return await extractDoc(tmp);
    } finally {
      if (!sourcePath) await safeUnlink(tmp);
    }
  }

  if (
    ct === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ct === 'application/pptx' ||
    ext === '.pptx'
  ) {
    const tmp = sourcePath ?? (await withTempFile(buffer, '.pptx'));
    try {
      return await extractPptx(tmp);
    } finally {
      if (!sourcePath) await safeUnlink(tmp);
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
    `Unsupported content type for text extraction: ${contentType} (name: ${name ?? 'unknown'})`,
  );
}
