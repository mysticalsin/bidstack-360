import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { OPPORTUNITY_DOCUMENTS_DRAWN } from '@bidstack/shared';

import {
  opportunityDocumentCaption,
  opportunityDocumentPage,
  shownOpportunityDocuments,
} from './opportunity-document-caption';

/**
 * Take the deal-detail documents query actually uses. A literal page size
 * cuts the later file before the caption can tell that the page is not the
 * whole set. The MCP get is already paged and is not this query.
 */
function opportunityDocumentQueryTake(src: string): number {
  const start = src.indexOf("'/opportunities/:id'");
  const fn = src.slice(start, src.indexOf('// PATCH /api/opportunities/:id'));
  if (fn.includes('take: opportunityDocumentTake()')) return OPPORTUNITY_DOCUMENTS_DRAWN + 1;
  const match = fn.match(/documents:\s*\{[^}]*take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function file(name: string) {
  return { id: name, name, kind: 'RFP', bytes: 1 };
}

describe('deal document page', () => {
  it('does not call the loaded page every file when a later file was loaded', () => {
    // WHY: the deal documents tab took fifty rows and the header printed that
    // length as the file count. Cutting a fifty-first file left "50 files" as
    // if that page were every file. One more loaded row means those fifty are
    // not every file. The extra row is dropped. A shorter list keeps "N files".
    // No file total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/opportunities.ts'),
      'utf8',
    );
    const fn = src.slice(
      src.indexOf("'/opportunities/:id'"),
      src.indexOf('// PATCH /api/opportunities/:id'),
    );
    expect(fn).toContain('take: opportunityDocumentTake()');
    expect(fn).toContain('opportunityDocumentPage(');
    expect(fn).toContain('documentsContinue:');
    expect(fn).not.toMatch(/documents:\s*\{[^}]*take:\s*50\b/);

    const panel = readFileSync(
      path.resolve(process.cwd(), 'src/components/opportunity/OpportunityTabs.tsx'),
      'utf8',
    );
    expect(panel).toContain('opportunityDocumentCaption(');
    expect(panel).not.toContain('documentsCount');
    expect(panel).not.toContain('count: documents.length');

    const rows = Array.from({ length: OPPORTUNITY_DOCUMENTS_DRAWN + 1 }, (_, n) =>
      file(n === OPPORTUNITY_DOCUMENTS_DRAWN ? 'Probe File' : `File ${n}`),
    );
    const loaded = rows.slice(0, opportunityDocumentQueryTake(src));
    const page = opportunityDocumentPage(loaded);
    const shown = shownOpportunityDocuments(page.items, page.pageContinues);
    const caption = opportunityDocumentCaption(shown.items.length, shown.pageContinues);
    expect(caption).toBe('50 in the latest 50, not every file');
    expect(caption).not.toBe('50 files');
    expect(caption).not.toBe(`${rows.length} files`);
    expect(caption).not.toMatch(/51|Show all|View all/i);
    expect(shown.items).toHaveLength(OPPORTUNITY_DOCUMENTS_DRAWN);
    expect(shown.items.some((row) => row.name === 'Probe File')).toBe(false);
    expect(loaded.some((row) => row.name === 'Probe File')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownOpportunityDocuments(rows, false);
    expect(opportunityDocumentCaption(carried.items.length, carried.pageContinues)).toBe(
      '50 in the latest 50, not every file',
    );
    expect(carried.items.some((row) => row.name === 'Probe File')).toBe(false);

    const shortLoaded = rows.slice(0, 2).slice(0, opportunityDocumentQueryTake(src));
    const shortPage = opportunityDocumentPage(shortLoaded);
    const short = shownOpportunityDocuments(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(2);
    expect(opportunityDocumentCaption(short.items.length, short.pageContinues)).toBe('2 files');
    expect(opportunityDocumentCaption(short.items.length, short.pageContinues)).not.toMatch(
      /not every/i,
    );
    expect(opportunityDocumentCaption(OPPORTUNITY_DOCUMENTS_DRAWN, false)).toBe('50 files');
  });
});
