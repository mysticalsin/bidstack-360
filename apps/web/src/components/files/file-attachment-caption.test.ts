import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FILE_ATTACHMENTS_DRAWN } from '@bidstack/shared';

import {
  fileAttachmentCaption,
  fileAttachmentPage,
  shownFileAttachments,
} from './file-attachment-caption';

/**
 * Take the files query actually uses. A literal page size cuts the later
 * attachment before the caption can tell that the page is not the whole set.
 */
function fileAttachmentQueryTake(src: string): number {
  const start = src.indexOf('// 4. List by account.');
  const fn = src.slice(start, src.indexOf('// 5. Download'));
  if (fn.includes('take: fileAttachmentTake(req.query.limit)')) return FILE_ATTACHMENTS_DRAWN + 1;
  if (/take:\s*req\.query\.limit/.test(fn)) return FILE_ATTACHMENTS_DRAWN;
  const match = fn.match(/take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function attachment(name: string) {
  return { id: name, name };
}

describe('account file page', () => {
  it('does not call the loaded page every attachment when a later file was loaded', () => {
    // WHY: the account files list took one hundred rows and the header printed
    // that length as the attachment count. Cutting a one-hundred-and-first file
    // left "100 attachment(s)" as if that page were every file. One more loaded
    // row means those hundred are not every attachment. The extra row is
    // dropped. A shorter list keeps "N attachment(s)". No attachment total
    // is invented.
    const src = readFileSync(path.resolve(process.cwd(), '../api/src/routes/files.ts'), 'utf8');
    const fn = src.slice(src.indexOf('// 4. List by account.'), src.indexOf('// 5. Download'));
    expect(fn).toContain('take: fileAttachmentTake(req.query.limit)');
    expect(fn).toContain('fileAttachmentPage(');
    expect(fn).toContain('itemsContinue:');
    expect(fn).not.toMatch(/take:\s*req\.query\.limit\b/);
    expect(fn).not.toMatch(/take:\s*100\b/);

    const panel = readFileSync(path.resolve(process.cwd(), 'src/components/files/FilesPanel.tsx'), 'utf8');
    expect(panel).toContain('fileAttachmentCaption(');
    expect(panel).not.toContain('attachmentCountScoped');

    const rows = Array.from({ length: FILE_ATTACHMENTS_DRAWN + 1 }, (_, n) =>
      attachment(n === FILE_ATTACHMENTS_DRAWN ? 'Probe Attachment' : `File ${n}`),
    );
    const loaded = rows.slice(0, fileAttachmentQueryTake(src));
    const page = fileAttachmentPage(loaded);
    const shown = shownFileAttachments(page.items, page.pageContinues);
    const caption = fileAttachmentCaption(shown.items.length, shown.pageContinues);
    expect(caption).toBe('100 in the latest 100, not every attachment');
    expect(caption).not.toBe('100 attachment(s)');
    expect(caption).not.toBe('100 attachment(s) - access follows account groups');
    expect(caption).not.toBe(`${rows.length} attachment(s)`);
    expect(caption).not.toMatch(/101|Show all|View all/i);
    expect(shown.items).toHaveLength(FILE_ATTACHMENTS_DRAWN);
    expect(shown.items.some((row) => row.name === 'Probe Attachment')).toBe(false);
    expect(loaded.some((row) => row.name === 'Probe Attachment')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownFileAttachments(rows, false);
    expect(fileAttachmentCaption(carried.items.length, carried.pageContinues)).toBe(
      '100 in the latest 100, not every attachment',
    );
    expect(carried.items.some((row) => row.name === 'Probe Attachment')).toBe(false);

    const shortLoaded = rows.slice(0, 2).slice(0, fileAttachmentQueryTake(src));
    const short = shownFileAttachments(
      fileAttachmentPage(shortLoaded).items,
      fileAttachmentPage(shortLoaded).pageContinues,
    );
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(2);
    expect(fileAttachmentCaption(short.items.length, short.pageContinues)).toBe(
      '2 attachment(s) - access follows account groups',
    );
    expect(fileAttachmentCaption(short.items.length, short.pageContinues)).not.toMatch(/not every/i);
    expect(fileAttachmentCaption(FILE_ATTACHMENTS_DRAWN, false)).toBe(
      '100 attachment(s) - access follows account groups',
    );
  });
});
