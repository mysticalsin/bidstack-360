// Extract plain text from common document formats for LLM ingestion.
//
// Supported formats:
//   - text/* (txt, csv, json, xml, html, md, etc.) — direct UTF-8 decode
//   - application/pdf — pdf-parse
//   - application/vnd.openxmlformats-officedocument.wordprocessingml.document — mammoth
//   - application/msword (.doc) — word-extractor
//   - application/vnd.openxmlformats-officedocument.presentationml.presentation — node-pptx-parser
//   - application/vnd.ms-powerpoint (.ppt) — best-effort via unzip+XML fallback
//   - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet — xlsx
//   - application/vnd.ms-excel (.xls) — xlsx
//
// Why `require()` instead of `import`: several extraction libraries are CommonJS-only
// and their type declarations are inconsistent. Dynamic require keeps tsc happy.

import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);

const OCR_MIN_PDF_TEXT_CHARS = 50;
const OCR_MAX_BUFFER = 20 * 1024 * 1024;

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
        `${binary} is not installed or not on PATH. Install the open-source OCR runtime or disable BIDSTACK_OCR_ENABLED.`,
        { cause: err },
      );
    }
    throw err;
  }
}

export interface ExtractOptions {
  buffer: Buffer;
  contentType: string;
  name?: string;
  /** Absolute file path when the file is already on disk (local storage).
   *  Some parsers (word-extractor, node-pptx-parser) only accept paths. */
  sourcePath?: string;
}

async function withTempFile(buffer: Buffer, suffix: string): Promise<string> {
  const tmp = path.join(
    tmpdir(),
    `bidstack-extract-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
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
  if (!name) return '';
  const ext = path.extname(name).toLowerCase();
  return ext;
}

function isImageContentType(contentType: string, ext: string): boolean {
  return (
    contentType.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.bmp'].includes(ext)
  );
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(buffer);
  return typeof result.text === 'string' ? result.text : '';
}

async function ocrPdf(buffer: Buffer): Promise<string> {
  if (!ocrEnabled()) {
    return '';
  }

  const input = await withTempFile(buffer, '.pdf');
  const output = path.join(
    tmpdir(),
    `bidstack-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
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
  if (!ocrEnabled()) {
    return '';
  }

  const suffix = ext && ext !== '.svg' ? ext : '.png';
  const input = await withTempFile(buffer, suffix);
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

// ─── XLSX / XLS ────────────────────────────────────────────────────────────

async function extractXlsx(buffer: Buffer): Promise<string> {
  const xlsx = require('@e965/xlsx');
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = xlsx.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      lines.push(`--- Sheet: ${sheetName} ---`);
      lines.push(csv);
    }
  }
  return lines.join('\n');
}

// ─── PPTX ──────────────────────────────────────────────────────────────────

async function extractPptx(sourcePath: string): Promise<string> {
  const { default: PptxParser } = require('node-pptx-parser');
  const parser = new PptxParser(sourcePath);
  const result = await parser.parse();
  const slides = result.slides ?? [];
  const lines: string[] = [];
  for (const slide of slides) {
    const slideText = (slide.text ?? '').trim();
    if (slideText) lines.push(slideText);
  }
  return lines.join('\n\n---\n\n');
}

// ─── DOC (old Word) ────────────────────────────────────────────────────────

async function extractDoc(sourcePath: string): Promise<string> {
  const WordExtractor = require('word-extractor');
  const extractor = new WordExtractor();
  const doc = await extractor.extract(sourcePath);
  return doc.getBody() ?? '';
}

// ─── PPT (old PowerPoint) — best effort ────────────────────────────────────

async function extractPpt(buffer: Buffer): Promise<string> {
  // .ppt is a binary OLE format. Without a dedicated parser, we try to extract
  // readable strings from the binary blob. This is lossy but often yields enough
  // keywords for the LLM to work with.
  const text = buffer.toString('utf-8');
  const isBinary = text.includes('\u0000');
  if (!isBinary) return text;

  // Extract sequences of printable ASCII chars (3+ chars)
  const matches = buffer.toString('latin1').match(/[\x20-\x7E]{3,}/g);
  if (matches && matches.length > 0) {
    // Filter out obvious noise (hex sequences, repeated chars)
    const cleaned = matches
      .filter((s: string) => !/^\d+$/.test(s))
      .filter((s: string) => !/^[0-9a-fA-F]+$/.test(s))
      .filter((s: string) => new Set(s).size > 2)
      .join('\n');
    if (cleaned.length > 100) return cleaned;
  }
  return '[Binary PowerPoint file — text extraction limited]';
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function extractTextFromBuffer(opts: ExtractOptions): Promise<string> {
  const { buffer, contentType, name, sourcePath } = opts;
  const ct = (contentType.toLowerCase().split(';')[0] ?? '').trim();
  const ext = inferExtension(name);

  // Plain text
  if (ct.startsWith('text/')) {
    return buffer.toString('utf-8');
  }

  // JSON / CSV / XML — often sent as application/* but are text
  if (
    ct === 'application/json' ||
    ct === 'application/csv' ||
    ct === 'application/xml' ||
    ct === 'application/javascript' ||
    ext === '.json' ||
    ext === '.csv' ||
    ext === '.xml' ||
    ext === '.md' ||
    ext === '.yaml' ||
    ext === '.yml'
  ) {
    return buffer.toString('utf-8');
  }

  // PDF
  if (ct === 'application/pdf' || ext === '.pdf') {
    const text = await extractPdfText(buffer);
    if (text.trim().length >= OCR_MIN_PDF_TEXT_CHARS || !ocrEnabled()) {
      return text;
    }
    const ocrText = await ocrPdf(buffer);
    return ocrText || text;
  }

  // Images and scans. SVG is accepted for uploads but intentionally not OCRed
  // because it can contain active content; treat it as unsupported for text extraction.
  if (isImageContentType(ct, ext) && ext !== '.svg' && ct !== 'image/svg+xml') {
    const text = await ocrImage(buffer, ext);
    if (text) return text;
    throw new Error(
      'Image OCR requires BIDSTACK_OCR_ENABLED=true plus Tesseract installed on the API runtime',
    );
  }

  // DOCX
  if (
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ct === 'application/docx' ||
    ext === '.docx'
  ) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // DOC (old Word)
  if (ct === 'application/msword' || ext === '.doc') {
    const tmp = sourcePath ?? (await withTempFile(buffer, '.doc'));
    try {
      const text = await extractDoc(tmp);
      return text;
    } finally {
      if (!sourcePath) await safeUnlink(tmp);
    }
  }

  // PPTX
  if (
    ct === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ct === 'application/pptx' ||
    ext === '.pptx'
  ) {
    const tmp = sourcePath ?? (await withTempFile(buffer, '.pptx'));
    try {
      const text = await extractPptx(tmp);
      return text;
    } finally {
      if (!sourcePath) await safeUnlink(tmp);
    }
  }

  // PPT (old PowerPoint)
  if (ct === 'application/vnd.ms-powerpoint' || ext === '.ppt') {
    return extractPpt(buffer);
  }

  // XLSX / XLS
  if (
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ct === 'application/vnd.ms-excel' ||
    ct === 'application/excel' ||
    ext === '.xlsx' ||
    ext === '.xls'
  ) {
    return extractXlsx(buffer);
  }

  // Fallback: try UTF-8 text for unknown types
  try {
    const text = buffer.toString('utf-8');
    const printableRatio =
      text.length > 0
        ? [...text].filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
          }).length / text.length
        : 0;
    if (printableRatio > 0.85) {
      return text;
    }
  } catch {
    // ignore
  }

  throw new Error(
    `Unsupported content type for text extraction: ${contentType} (name: ${name ?? 'unknown'})`,
  );
}
