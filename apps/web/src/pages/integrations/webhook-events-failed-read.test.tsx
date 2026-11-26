import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, string | number>) => {
      const template = fallback ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values?.[name] ?? ''),
      );
    },
  }),
}));

import { WebhookEventsCard } from './WebhookEventsCard';
import type { WebhookEvent } from './types';

const DUST: WebhookEvent = {
  id: 'evt-dust-1',
  receivedAt: '2026-11-25T12:00:00.000Z',
  source: 'dust.webhook',
  eventType: 'crm.company.updated',
  status: 'accepted',
  error: null,
};

afterEach(() => {
  cleanup();
});

describe('WebhookEventsCard failed read', () => {
  it('does not call a failed webhook read a quiet empty stream', () => {
    // WHY: Integrations, Recent webhook events is where a demo admin reads
    // Dust callbacks. A failed read has no rows. The badge still said quiet,
    // and the card still said No webhook events yet.
    render(<WebhookEventsCard events={[]} isLoading={false} isError />);

    expect(screen.queryByText('quiet')).toBeNull();
    expect(screen.queryByText('No webhook events yet')).toBeNull();
    expect(screen.getByText('not loaded')).toBeTruthy();
    expect(screen.getByText('Could not load webhook events')).toBeTruthy();
  });

  it('does not call a load in progress a quiet stream', () => {
    // WHY: the same card paints before the page arrives. A quiet badge during
    // the load is the empty stream the reader has not earned yet.
    render(<WebhookEventsCard events={[]} isLoading />);

    expect(screen.queryByText('quiet')).toBeNull();
    expect(screen.queryByText('No webhook events yet')).toBeNull();
    expect(screen.getByText('checking')).toBeTruthy();
  });

  it('keeps a loaded empty stream quiet', () => {
    // WHY: a settled read with no events is an empty stream. That copy stays.
    render(<WebhookEventsCard events={[]} isLoading={false} />);

    expect(screen.getByText('quiet')).toBeTruthy();
    expect(screen.getByText('No webhook events yet')).toBeTruthy();
    expect(screen.queryByText('Could not load webhook events')).toBeNull();
  });

  it('keeps a loaded Dust callback', () => {
    // WHY: a demo callback that arrived still names the event.
    render(<WebhookEventsCard events={[DUST]} isLoading={false} />);

    expect(screen.getByText('crm.company.updated')).toBeTruthy();
    expect(screen.getByText('dust.webhook')).toBeTruthy();
    expect(screen.getByText('processing')).toBeTruthy();
    expect(screen.queryByText('No webhook events yet')).toBeNull();
  });
});
