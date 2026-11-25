// The seeded library's "Last used" cell called toLocaleDateString() and
// rendered nothing when the timestamp was missing. DNB Bank has never been
// used (usage 0, lastUsedAt null), so the cell was the same em dash as a
// missing document. CI Financial was used 12 days ago and Rush 30 days ago;
// a numeric locale date does not say that, and it ignores the app locale.
import { render } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDate } from '@/lib/format';
import type { Reference } from '@/hooks/useReferences';

import { buildReferenceColumns } from './reference-columns';
import { describeReferenceLastUsed } from './reference-last-used';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const DAY_MS = 86_400_000;

const t = ((key: string, fallback?: string) => fallback ?? key) as TFunction;

function at(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY_MS).toISOString();
}

function reference(lastUsedAt: string | null): Reference {
  return {
    id: '4ef00000-0000-4000-8000-000000000003',
    companyId: null,
    title: 'DNB Bank — Multi-region cloud landing zone',
    description: null,
    industry: 'financial_services',
    valueMicros: null,
    contactName: null,
    contactEmail: null,
    usageCount: 0,
    lastUsedAt,
    documentUrl: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    company: { id: 'company-dnb', name: 'DNB Bank', logoUrl: null },
  };
}

function lastUsedCell(lastUsedAt: string | null) {
  const columns = buildReferenceColumns({
    t,
    canWrite: false,
    onUse: () => {},
    onDelete: () => {},
    isUsing: false,
    isDeleting: false,
  });
  const column = columns.find((item) => item.id === 'lastUsedAt');
  if (!column) throw new Error('last used column missing');
  return column.cell(reference(lastUsedAt));
}

describe('reference last used', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.localStorage.setItem('bidstack-locale', 'en');
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.removeItem('bidstack-locale');
  });

  it('says Never for the seeded case study that has not been used', () => {
    // WHY: DNB Bank is seeded with usageCount 0 and no lastUsedAt. An empty
    // cell becomes the table's em dash, which is the same mark as a missing
    // document. The row has to say the case study was never used.
    expect(describeReferenceLastUsed(null, NOW, 'en')).toEqual({ kind: 'never' });
    const view = render(<div>{lastUsedCell(null)}</div>);
    expect(view.container.textContent).toBe('Never');
  });

  it('says how many days ago the seeded CI and Rush case studies were used', () => {
    // WHY: CI Financial was used 12 days ago and Rush 30 days ago. A numeric
    // locale date hides that comparison. The exact day stays on the title.
    const ci = at(12);
    const rush = at(30);
    expect(describeReferenceLastUsed(ci, NOW, 'en')).toEqual({
      kind: 'shown',
      text: '12 days ago',
      title: formatDate(ci, 'en'),
    });
    expect(describeReferenceLastUsed(rush, NOW, 'en').text).toBe('30 days ago');

    const view = render(<div>{lastUsedCell(ci)}</div>);
    const label = view.container.querySelector('span');
    expect(label?.textContent).toBe('12 days ago');
    expect(label?.getAttribute('title')).toBe(formatDate(ci, 'en'));
    expect(label?.textContent).not.toBe(new Date(ci).toLocaleDateString());
  });

  it('uses the app locale, and a date older than the seeded window stays a date', () => {
    // WHY: toLocaleDateString() with no locale follows the browser, not
    // bidstack-locale. Past 30 days the seed no longer encodes a recency, so
    // the cell shows the absolute date. A future or unreadable timestamp is
    // not "Never" and not "in N days".
    window.localStorage.setItem('bidstack-locale', 'fr');
    const recent = at(12);
    const french = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' }).format(-12, 'day');
    expect(describeReferenceLastUsed(recent, NOW).text).toBe(french);
    expect(describeReferenceLastUsed(recent, NOW).text).not.toBe('12 days ago');

    const older = at(31);
    expect(describeReferenceLastUsed(older, NOW, 'en')).toEqual({
      kind: 'shown',
      text: formatDate(older, 'en'),
      title: formatDate(older, 'en'),
    });
    expect(describeReferenceLastUsed(older, NOW, 'en').text).not.toBe(
      new Date(older).toLocaleDateString(),
    );

    const future = new Date(NOW + 6 * DAY_MS).toISOString();
    expect(describeReferenceLastUsed(future, NOW, 'en').text).toBe(formatDate(future, 'en'));
    expect(describeReferenceLastUsed('not-a-date', NOW, 'en')).toEqual({ kind: 'unknown' });
    const view = render(<div>{lastUsedCell('not-a-date')}</div>);
    expect(view.container.textContent).toBe('');
  });
});
