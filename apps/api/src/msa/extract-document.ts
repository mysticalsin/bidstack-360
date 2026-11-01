// Synchronous text extraction for MSA intake. PDF text layer only; scanned
// files are flagged needsOcr. No third-party OCR or LLM here.
import { createRequire } from 'node:module';

import type { TextPage } from '@bidstack/shared';

const require = createRequire(import.meta.url);

const MIN_CHARS_PER_PAGE = 40;

export interface ExtractedDocument {
  text: string;
  pages: TextPage[];
  pageCount: number;
  needsOcr: boolean;
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const { PDFParse } = require('pdf-parse') as {
    PDFParse: new (opts: { data: Uint8Array }) => {
      getText(): Promise<{ text?: string; pages?: Array<{ text?: string; num?: number }> }>;
      getInfo?: () => Promise<{ total?: number }>;
      destroy(): Promise<void>;
    };
  };
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = typeof result.text === 'string' ? result.text : '';
    const rawPages = Array.isArray(result.pages) ? result.pages : [];
    const pages: TextPage[] =
      rawPages.length > 0
        ? rawPages.map((p, i) => ({ page: p.num ?? i + 1, text: typeof p.text === 'string' ? p.text : '' }))
        : text
            .split(/\f/g)
            .map((pageText, i, all) => ({ page: all.length > 1 ? i + 1 : 1, text: pageText }));
    const pageCount = pages.length || 1;
    const letters = (text.match(/[A-Za-z]{2,}/g) ?? []).join('').length;
    const needsOcr = letters < pageCount * MIN_CHARS_PER_PAGE;
    return { text, pages, pageCount, needsOcr };
  } catch {
    // Image-only or structurally invalid PDFs have no text layer. Flag OCR
    // instead of inventing content or failing the upload.
    return { text: '', pages: [{ page: 1, text: '' }], pageCount: 1, needsOcr: true };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value ?? '';
  const letters = (text.match(/[A-Za-z]{2,}/g) ?? []).join('').length;
  return {
    text,
    pages: [{ page: null, text }],
    pageCount: 1,
    needsOcr: letters < MIN_CHARS_PER_PAGE,
  };
}

export async function extractMsaDocument(buffer: Buffer, contentType: string): Promise<ExtractedDocument> {
  if (contentType === 'application/pdf') return extractPdf(buffer);
  return extractDocx(buffer);
}
