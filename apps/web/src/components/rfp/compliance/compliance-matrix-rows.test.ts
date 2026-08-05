// The matrix's row pipeline. The tests that matter are the two "unknown is not
// bad" ones: pending sorts LAST by status, and a null confidence sorts last in
// BOTH directions. Everything else here is bookkeeping.

import { describe, expect, it } from 'vitest';

import type { ComplianceRow } from '@/hooks/rfp/useRfpCompliance';
import {
  ALL,
  filterComplianceRows,
  humaniseSection,
  pageOfRows,
  sectionOptions,
  sortComplianceRows,
  statusCounts,
} from './compliance-matrix-rows';

function row(overrides: Partial<ComplianceRow> = {}): ComplianceRow {
  return {
    id: 'r1',
    requirement: 'Data must reside in the EEA',
    response: null,
    status: 'pending',
    autoFilled: false,
    aiConfidenceBps: null,
    assessmentStatus: 'PENDING',
    section: null,
    mandatory: false,
    ...overrides,
  };
}

const NO_FILTER = { status: ALL, section: ALL, mandatory: ALL, q: '' };

describe('filterComplianceRows', () => {
  const rows = [
    row({ id: 'a', status: 'compliant', section: 'security', mandatory: true, requirement: 'ISO 27001' }),
    row({ id: 'b', status: 'pending', section: 'legal', mandatory: false, requirement: 'GDPR DPA' }),
    row({ id: 'c', status: 'compliant', section: null, mandatory: true, requirement: 'Insurance cover' }),
  ];

  it('passes everything through when nothing is filtered', () => {
    expect(filterComplianceRows(rows, NO_FILTER)).toHaveLength(3);
  });

  it('filters by status, section and mandatory independently', () => {
    expect(filterComplianceRows(rows, { ...NO_FILTER, status: 'compliant' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterComplianceRows(rows, { ...NO_FILTER, section: 'legal' }).map((r) => r.id)).toEqual(['b']);
    expect(filterComplianceRows(rows, { ...NO_FILTER, mandatory: 'yes' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterComplianceRows(rows, { ...NO_FILTER, mandatory: 'no' }).map((r) => r.id)).toEqual(['b']);
  });

  it('searches the requirement and the answer, case-insensitively', () => {
    const withAnswer = [row({ id: 'x', response: 'Hosted in Frankfurt' }), row({ id: 'y' })];
    expect(filterComplianceRows(withAnswer, { ...NO_FILTER, q: 'frankfurt' }).map((r) => r.id)).toEqual(['x']);
  });
});

describe('sortComplianceRows', () => {
  it('sorts pending LAST by status — an unassessed row is not a failure', () => {
    const rows = [
      row({ id: 'pending', status: 'pending' }),
      row({ id: 'compliant', status: 'compliant' }),
      row({ id: 'bad', status: 'non_compliant' }),
    ];
    expect(sortComplianceRows(rows, 'status', 'asc').map((r) => r.id)).toEqual([
      'bad',
      'compliant',
      'pending',
    ]);
  });

  it('keeps null confidence last in BOTH directions', () => {
    const rows = [
      row({ id: 'none', aiConfidenceBps: null }),
      row({ id: 'low', aiConfidenceBps: 2000 }),
      row({ id: 'high', aiConfidenceBps: 9000 }),
    ];
    expect(sortComplianceRows(rows, 'confidence', 'asc').map((r) => r.id)).toEqual(['low', 'high', 'none']);
    expect(sortComplianceRows(rows, 'confidence', 'desc').map((r) => r.id)).toEqual(['high', 'low', 'none']);
  });

  it('leaves the API order alone when no sort is set', () => {
    const rows = [row({ id: 'b', requirement: 'B' }), row({ id: 'a', requirement: 'A' })];
    expect(sortComplianceRows(rows, '', 'asc').map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts by requirement text', () => {
    const rows = [row({ id: 'b', requirement: 'Bravo' }), row({ id: 'a', requirement: 'Alpha' })];
    expect(sortComplianceRows(rows, 'requirement', 'asc').map((r) => r.id)).toEqual(['a', 'b']);
    expect(sortComplianceRows(rows, 'requirement', 'desc').map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('pageOfRows', () => {
  const rows = Array.from({ length: 7 }, (_, index) => row({ id: `r${index}` }));

  it('slices the requested page and clamps a nonsense page number', () => {
    expect(pageOfRows(rows, 2, 3).map((r) => r.id)).toEqual(['r3', 'r4', 'r5']);
    expect(pageOfRows(rows, 0, 3).map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
    expect(pageOfRows(rows, 9, 3)).toEqual([]);
  });
});

describe('sectionOptions / statusCounts', () => {
  it('offers each present section once, humanised, and never a null bucket', () => {
    const rows = [
      row({ section: 'technical_capability' }),
      row({ section: 'technical_capability' }),
      row({ section: null }),
    ];
    expect(sectionOptions(rows)).toEqual([
      { value: 'technical_capability', label: 'Technical capability' },
    ]);
  });

  it('counts rows per status', () => {
    expect(statusCounts([row({ status: 'pending' }), row({ status: 'pending' }), row({ status: 'compliant' })])).toEqual(
      { pending: 2, compliant: 1 },
    );
  });

  it('humanises a wire-format section name', () => {
    expect(humaniseSection('commercial-terms')).toBe('Commercial terms');
  });
});
