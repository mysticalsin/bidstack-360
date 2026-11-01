import { PDFDocument, StandardFonts } from 'pdf-lib';

import { SYNTHETIC_NORTHWIND_MSA_TEXT } from '@bidstack/shared';

/** Text-layer PDF of the synthetic Northwind HEMA MSA. Safe for intake tests. */
export async function syntheticNorthwindMsaPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = SYNTHETIC_NORTHWIND_MSA_TEXT.trim().split('\n');
  let page = doc.addPage();
  const { width } = page.getSize();
  let y = page.getSize().height - 36;
  const size = 9;
  const maxWidth = width - 72;
  for (const raw of lines) {
    const line = raw.trimEnd() || ' ';
    if (y < 36) {
      page = doc.addPage();
      y = page.getSize().height - 36;
    }
    const clipped = line.length > 120 ? line.slice(0, 120) : line;
    page.drawText(clipped, { x: 36, y, size, font, maxWidth });
    y -= 12;
  }
  return Buffer.from(await doc.save());
}
