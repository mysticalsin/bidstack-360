// The Proposals surface's selection semantics, unit-tested where they are pure.
// The e2e spec proves the URL round-trip through a real browser; this file
// proves the three things that are easy to get subtly wrong and invisible in a
// screenshot: which deadline bucket a date falls in, that absent values sort
// last in BOTH directions, and that a stale `?page=` clamps instead of
// rendering an empty body.

import { describe, expect, it } from 'vitest';

import {
  complianceBandOf,
  dueWindowOf,
  proposalsSearchParams,
  selectProposals,
  type ProposalListInput,
  type ProposalRow,
} from './proposals-search-params';

const NOW = new Date('2026-08-04T09:30:00Z');

function row(overrides: Partial<ProposalRow> & { id: string }): ProposalRow {
  return {
    orgId: 'org-1',
    opportunityId: null,
    name: overrides.id,
    status: 'draft',
    version: 1,
    ownerId: null,
    complianceScore: null,
    dueDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function input(overrides: Partial<ProposalListInput> = {}): ProposalListInput {
  return {
    q: '',
    sort: 'updated',
    dir: 'desc',
    page: 1,
    pageSize: 25,
    status: 'all',
    owner: 'all',
    dueWindow: 'all',
    compliance: 'all',
    ...overrides,
  };
}

const noOwners = () => null;

describe('dueWindowOf', () => {
  it('buckets a date-only deadline against today, not against the clock', () => {
    // 09:30 on the day it is due is still "this week", never overdue.
    expect(dueWindowOf('2026-08-04', NOW)).toBe('week');
    expect(dueWindowOf('2026-08-03', NOW)).toBe('overdue');
    expect(dueWindowOf('2026-08-11', NOW)).toBe('week');
    expect(dueWindowOf('2026-08-12', NOW)).toBe('month');
    expect(dueWindowOf('2026-09-03', NOW)).toBe('month');
    expect(dueWindowOf('2026-09-04', NOW)).toBe('later');
  });

  it('treats a missing or unparseable deadline as "none", never as overdue', () => {
    expect(dueWindowOf(null, NOW)).toBe('none');
    expect(dueWindowOf('not-a-date', NOW)).toBe('none');
  });
});

describe('complianceBandOf', () => {
  it('reads an absent score as unscored — neutral, not failing', () => {
    expect(complianceBandOf(null)).toBe('unscored');
    expect(complianceBandOf(0)).toBe('partial');
    expect(complianceBandOf(89)).toBe('partial');
    expect(complianceBandOf(90)).toBe('complete');
  });
});

describe('selectProposals', () => {
  const rows = [
    row({ id: 'a', name: 'Alpha', status: 'draft', dueDate: '2026-08-06', complianceScore: 95 }),
    row({ id: 'b', name: 'Bravo', status: 'won', ownerId: 'u1' }),
    row({ id: 'c', name: 'Charlie', status: 'draft', dueDate: '2026-07-01', ownerId: 'u1' }),
  ];

  it('filters on stage, owner, deadline and compliance independently', () => {
    expect(selectProposals(rows, input({ status: 'draft' }), noOwners, NOW).total).toBe(2);
    expect(selectProposals(rows, input({ owner: 'u1' }), noOwners, NOW).total).toBe(2);
    expect(selectProposals(rows, input({ owner: 'unassigned' }), noOwners, NOW).total).toBe(1);
    expect(selectProposals(rows, input({ dueWindow: 'overdue' }), noOwners, NOW).total).toBe(1);
    expect(selectProposals(rows, input({ compliance: 'unscored' }), noOwners, NOW).total).toBe(2);
  });

  it('matches the search term case-insensitively on the name', () => {
    const found = selectProposals(rows, input({ q: 'brav' }), noOwners, NOW);
    expect(found.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('sorts nulls last in both directions', () => {
    const asc = selectProposals(rows, input({ sort: 'due', dir: 'asc' }), noOwners, NOW);
    expect(asc.rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    const desc = selectProposals(rows, input({ sort: 'due', dir: 'desc' }), noOwners, NOW);
    expect(desc.rows.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('clamps a page that no longer exists instead of returning an empty body', () => {
    const stale = selectProposals(rows, input({ page: 9, pageSize: 2 }), noOwners, NOW);
    expect(stale.page).toBe(2);
    expect(stale.rows).toHaveLength(1);
    expect(stale.total).toBe(3);
  });
});

describe('proposalsSearchParams', () => {
  it('keeps defaults out of the URL so a cleared view is a bare /proposals', () => {
    expect(proposalsSearchParams.serialize({ status: 'all', page: 1 })).toBe('');
  });

  it('serialises a deep link with only the non-default keys', () => {
    const url = proposalsSearchParams.serialize({ status: 'review', owner: 'u1', page: 3 });
    expect(url).toContain('status=review');
    expect(url).toContain('owner=u1');
    expect(url).toContain('page=3');
  });
});
