import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountNewsSignalCard } from './AccountNewsSignalCard';

const hookMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  response: {
    source: 'google-news' as const,
    read: 'ok' as 'ok' | 'unavailable',
    fetchedAt: '2026-06-17T12:00:00.000Z',
    sourceAttribution: {
      source: 'google_news_open_web',
      label: 'Google News',
      sourceUrl: 'https://news.google.com/',
      fetchedAt: '2026-06-17T12:00:00.000Z',
      confidence: 0.62,
      providerMetadata: { signalType: 'public_news' },
    },
    items: [
      {
        title: 'Acme expands European AI team',
        url: 'https://news.google.com/articles/acme',
        source: 'Reuters',
        publishedAt: '2026-06-17T09:00:00.000Z',
      },
    ],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountNews', () => ({
  useAccountNews: () => ({
    data: hookMocks.response,
    isLoading: false,
    isError: false,
    refetch: hookMocks.refetch,
  }),
}));

describe('AccountNewsSignalCard provenance', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders source and source-confidence badges for open-web account news', () => {
    render(<AccountNewsSignalCard accountId="Acme" />);

    expect(screen.getByText('Acme expands European AI team')).toBeTruthy();
    expect(screen.getByTestId('account-news-source').textContent).toBe('Google News');
    expect(screen.getByTestId('account-news-source-confidence').textContent).toBe(
      '62% source confidence',
    );
    expect(screen.getByTestId('account-news-source').getAttribute('aria-label')).toContain(
      'Google News open-web feed checked',
    );
  });

  it('says the open-web feed failed instead of claiming a demo account has no news', () => {
    // An unanswered courtesy feed is not an empty match. The card must not
    // say "No recent news", and it must not show a source-confidence badge
    // for a check that did not happen.
    const prior = hookMocks.response;
    hookMocks.response = { ...prior, read: 'unavailable', items: [] };
    hookMocks.refetch.mockClear();
    try {
      render(<AccountNewsSignalCard accountId="CI Financial" />);

      expect(screen.getByRole('heading', { name: 'Could not load news' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'No recent news' })).toBeNull();
      expect(screen.queryByTestId('account-news-source-confidence')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(hookMocks.refetch).toHaveBeenCalledTimes(1);
    } finally {
      hookMocks.response = prior;
    }
  });

  it('still says there is no news when the feed answered with nothing', () => {
    const prior = hookMocks.response;
    hookMocks.response = { ...prior, read: 'ok', items: [] };
    try {
      render(<AccountNewsSignalCard accountId="CI Financial" />);
      expect(screen.getByRole('heading', { name: 'No recent news' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Could not load news' })).toBeNull();
    } finally {
      hookMocks.response = prior;
    }
  });
});
