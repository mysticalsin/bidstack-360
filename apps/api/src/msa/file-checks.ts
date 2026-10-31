// Content checks for MSA uploads: PDF and DOCX only, verified from the stored
// bytes (magic numbers), never from the client-declared content type alone.
import { createHash } from 'node:crypto';

import type { MsaContentType } from '@bidstack/shared';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Detect the real type of an uploaded MSA file.
 *  - PDF: starts with "%PDF-" (allowing a short leading junk window, which
 *    some generators emit and readers accept, capped at 1 KiB).
 *  - DOCX: a ZIP ("PK\x03\x04") whose central directory names
 *    "word/document.xml". A plain ZIP, XLSX or PPTX is rejected.
 * Returns null for anything else.
 */
export function detectMsaContentType(buf: Buffer): MsaContentType | null {
  if (buf.length < 8) return null;
  const head = buf.subarray(0, 1024);
  const pdfAt = head.indexOf('%PDF-');
  if (pdfAt === 0 || (pdfAt > 0 && pdfAt < 1024)) return PDF;
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (buf.includes(Buffer.from('word/document.xml'))) return DOCX;
  }
  return null;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
