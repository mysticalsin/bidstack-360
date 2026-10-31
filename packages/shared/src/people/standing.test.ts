import { describe, expect, it } from 'vitest';

import {
  applyFactDecision,
  connectionStanding,
  intakePersonFact,
  resolvedReportsToId,
  type PersonFactView,
} from './standing.js';

const NOW = new Date('2026-10-31T00:00:00.000Z');

function fact(overrides: Partial<PersonFactView> & Pick<PersonFactView, 'status' | 'kind'>): PersonFactView {
  return {
    id: 'fact-1',
    reportsToContactId: null,
    opportunityId: null,
    companyId: null,
    linkLabel: null,
    observedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('connectionStanding', () => {
  it('keeps a person unknown when there is no evidence, including a bare job title', () => {
    // Standing does not take a title. A CEO with an empty fact list is unknown
    // because a title is not proof of authority or of a reporting line.
    expect(connectionStanding([], NOW)).toBe('unknown');
  });

  it('does not treat a suggestion as evidence', () => {
    const suggested = fact({
      status: 'proposed',
      kind: 'reports_to',
      reportsToContactId: 'mgr-1',
    });
    expect(connectionStanding([suggested], NOW)).toBe('unknown');
    expect(resolvedReportsToId([suggested], NOW)).toBeNull();
  });

  it('becomes evidenced only after a fact is accepted', () => {
    const accepted = fact({
      status: 'accepted',
      kind: 'company_link',
      companyId: 'co-1',
    });
    expect(connectionStanding([accepted], NOW)).toBe('evidenced');
  });

  it('marks an old accepted fact stale instead of current', () => {
    const accepted = fact({
      status: 'accepted',
      kind: 'reports_to',
      reportsToContactId: 'mgr-1',
      observedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(connectionStanding([accepted], NOW)).toBe('stale');
    expect(resolvedReportsToId([accepted], NOW)).toBeNull();
  });

  it('stays conflicted when two accepted reporting lines disagree', () => {
    const facts = [
      fact({ id: 'a', status: 'accepted', kind: 'reports_to', reportsToContactId: 'mgr-1' }),
      fact({ id: 'b', status: 'accepted', kind: 'reports_to', reportsToContactId: 'mgr-2' }),
    ];
    expect(connectionStanding(facts, NOW)).toBe('conflicted');
    expect(resolvedReportsToId(facts, NOW)).toBeNull();
  });

  it('does not auto-link ambiguous text, even if an id was supplied', () => {
    const stored = intakePersonFact({
      kind: 'reports_to',
      reportsToContactId: 'mgr-1',
      opportunityId: null,
      companyId: null,
      linkLabel: null,
      ambiguous: true,
    });
    expect(stored.status).toBe('needs_review');
    expect(stored.reportsToContactId).toBeNull();
    expect(
      connectionStanding(
        [fact({ status: 'needs_review', kind: 'reports_to', reportsToContactId: null, observedAt: null })],
        NOW,
      ),
    ).toBe('needs_review');
  });

  it('refuses to accept a needs-review fact until a person is named', () => {
    const decided = applyFactDecision(
      {
        kind: 'reports_to',
        status: 'needs_review',
        reportsToContactId: null,
        opportunityId: null,
        companyId: null,
        linkLabel: null,
      },
      'accept',
    );
    expect(decided.status).toBe('needs_review');
    expect(decided.reportsToContactId).toBeNull();
  });
});
