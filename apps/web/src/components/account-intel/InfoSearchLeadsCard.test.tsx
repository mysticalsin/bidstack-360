// The caption is the only seller-facing label for InfoSearch lead rows.
// preview:true still lists the fixture rows and still names INFOSEARCH_ENABLED.
// Both captions say reference records when the rows are fixtures, and neither
// caption says Sample, demo, or live. A non-preview response keeps the rows
// and drops the credential sentence.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InfoSearchLeadsCard } from './InfoSearchLeadsCard';

const queryState = vi.hoisted(() => ({
  preview: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      enabled: !queryState.preview,
      preview: queryState.preview,
      items: [
        {
          id: 'fixture-lead-1',
          name: 'Ada Fixture',
          company: 'Fixture Co',
          title: 'Buyer',
          phone: null,
          email: 'ada.fixture@example.com',
          listName: 'Reference list',
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

const PREVIEW_CAPTION =
  'Reference records — connect InfoSearch (INFOSEARCH_ENABLED) for call lists';
const CONNECTED_CAPTION = 'Call lists and lead intel for this account — pulled from InfoSearch';
const DEMO_COPY = /\bsample\b|\bdemo\b|\billustrative\b|\blive\b/i;

function caption(): string {
  const heading = screen.getByRole('heading', { name: 'InfoSearch leads' });
  const node = heading.parentElement?.querySelector('p');
  if (!(node instanceof HTMLElement)) throw new Error('lead caption missing');
  return node.textContent ?? '';
}

afterEach(() => {
  cleanup();
  queryState.preview = true;
});

describe('InfoSearchLeadsCard captions', () => {
  it('labels fixture leads as reference records and keeps the credential path', () => {
    queryState.preview = true;
    render(<InfoSearchLeadsCard account="Fixture Co" />);

    // The preview flag still shows the fixture row. The words are not a demo.
    expect(screen.getByText('Ada Fixture')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Email' }).getAttribute('href')).toBe(
      'mailto:ada.fixture@example.com',
    );
    expect(caption()).toBe(PREVIEW_CAPTION);
    expect(caption()).toContain('Reference records');
    expect(caption()).toContain('INFOSEARCH_ENABLED');
    expect(caption()).not.toMatch(DEMO_COPY);
    expect(screen.queryByText(/Sample lead intel/)).toBeNull();
  });

  it('does not mark a configured InfoSearch response as live', () => {
    queryState.preview = false;
    render(<InfoSearchLeadsCard account="Fixture Co" />);

    expect(screen.getByText('Ada Fixture')).toBeTruthy();
    expect(caption()).toBe(CONNECTED_CAPTION);
    expect(caption()).not.toMatch(DEMO_COPY);
    expect(caption()).not.toContain('INFOSEARCH_ENABLED');
    expect(screen.queryByText(/pulled live/)).toBeNull();
  });
});
