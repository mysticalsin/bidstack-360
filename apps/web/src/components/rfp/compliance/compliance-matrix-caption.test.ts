import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMPLIANCE_MATRIX_DRAWN } from '@bidstack/shared';

import {
  complianceMatrixCaption,
  complianceMatrixPage,
  shownComplianceMatrix,
} from './compliance-matrix-caption';

/**
 * Take the compliance-matrix query actually uses. A literal page size cuts
 * the later row before the caption can tell that the page is not the whole
 * set. The workspace snapshot is a different query and is not this one.
 */
function complianceMatrixQueryTake(src: string): number {
  const start = src.indexOf('GET /bid-workspaces/:opportunityId/compliance');
  const fn = src.slice(start, src.indexOf('POST /bid-workspaces/:opportunityId/documents'));
  if (fn.includes('take: complianceMatrixTake()')) return COMPLIANCE_MATRIX_DRAWN + 1;
  const match = fn.match(/take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function row(name: string, status: 'pending' | 'compliant' = 'pending') {
  return { id: name, requirement: name, status };
}

function tally(items: readonly { status: string }[]) {
  return {
    compliant: items.filter((item) => item.status === 'compliant').length,
    pending: items.filter((item) => item.status === 'pending').length,
  };
}

describe('compliance matrix page', () => {
  it('does not call the loaded page every row when a later row was loaded', () => {
    // WHY: the opportunity review matrix took five hundred rows and the header
    // printed that length as the compliant total. Cutting a five-hundred-first
    // row left "C / 500 compliant · P pending" as if that page were every row.
    // One more loaded row means those five hundred are not every row. The extra
    // row is dropped. A shorter list keeps "C / N compliant · P pending". No
    // row total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/bid-workspace.ts'),
      'utf8',
    );
    const fn = src.slice(
      src.indexOf('GET /bid-workspaces/:opportunityId/compliance'),
      src.indexOf('POST /bid-workspaces/:opportunityId/documents'),
    );
    expect(fn).toContain('take: complianceMatrixTake()');
    expect(fn).toContain('complianceMatrixPage(');
    expect(fn).toContain('matrixContinues:');
    expect(fn).not.toMatch(/take:\s*500\b/);

    const panel = readFileSync(
      path.resolve(process.cwd(), 'src/components/rfp/compliance/ComplianceMatrix.tsx'),
      'utf8',
    );
    expect(panel).toContain('complianceMatrixCaption(');
    expect(panel).not.toContain('data.total');
    expect(panel).not.toContain('compliance.summary');

    const rows = Array.from({ length: COMPLIANCE_MATRIX_DRAWN + 1 }, (_, n) =>
      row(
        n === COMPLIANCE_MATRIX_DRAWN ? 'Probe Row' : `Row ${n}`,
        n === COMPLIANCE_MATRIX_DRAWN ? 'compliant' : 'pending',
      ),
    );
    const loaded = rows.slice(0, complianceMatrixQueryTake(src));
    const page = complianceMatrixPage(loaded);
    const shown = shownComplianceMatrix(page.items, page.pageContinues);
    const shownCounts = tally(shown.items);
    const caption = complianceMatrixCaption(
      shown.items.length,
      shownCounts.compliant,
      shownCounts.pending,
      shown.pageContinues,
    );
    expect(caption).toBe('500 in the latest 500, not every row');
    expect(caption).not.toBe('0 / 500 compliant · 500 pending');
    expect(caption).not.toBe(
      `${tally(rows).compliant} / ${rows.length} compliant · ${tally(rows).pending} pending`,
    );
    expect(caption).not.toMatch(/501|Show all|View all/i);
    expect(shown.items).toHaveLength(COMPLIANCE_MATRIX_DRAWN);
    expect(shown.items.some((item) => item.requirement === 'Probe Row')).toBe(false);
    expect(loaded.some((item) => item.requirement === 'Probe Row')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownComplianceMatrix(rows, false);
    const carriedCounts = tally(carried.items);
    expect(
      complianceMatrixCaption(
        carried.items.length,
        carriedCounts.compliant,
        carriedCounts.pending,
        carried.pageContinues,
      ),
    ).toBe('500 in the latest 500, not every row');
    expect(carried.items.some((item) => item.requirement === 'Probe Row')).toBe(false);

    const shortLoaded = [row('First', 'compliant'), row('Second', 'pending')].slice(
      0,
      complianceMatrixQueryTake(src),
    );
    const shortPage = complianceMatrixPage(shortLoaded);
    const short = shownComplianceMatrix(shortPage.items, shortPage.pageContinues);
    const shortCounts = tally(short.items);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(2);
    expect(
      complianceMatrixCaption(
        short.items.length,
        shortCounts.compliant,
        shortCounts.pending,
        short.pageContinues,
      ),
    ).toBe('1 / 2 compliant · 1 pending');
    expect(
      complianceMatrixCaption(
        short.items.length,
        shortCounts.compliant,
        shortCounts.pending,
        short.pageContinues,
      ),
    ).not.toMatch(/not every/i);
    expect(
      complianceMatrixCaption(COMPLIANCE_MATRIX_DRAWN, 0, COMPLIANCE_MATRIX_DRAWN, false),
    ).toBe('0 / 500 compliant · 500 pending');
  });
});
