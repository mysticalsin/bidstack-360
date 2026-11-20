import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountNewsSignalCard } from './AccountNewsSignalCard';

const hookMocks = vi.hoisted(() => ({
  response: {
    source: 'google-news' as const,
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
    refetch: vi.fn(),
  }),
}));

describe('AccountNewsSignalCard provenance', () => {
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
});
