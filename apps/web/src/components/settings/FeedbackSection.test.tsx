import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return { api: apiMock, ApiError };
});

import { ApiError } from '@/lib/api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import { FeedbackSection } from './FeedbackSection';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

function renderForm(path = '/opportunities/42') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FeedbackSection />
    </MemoryRouter>,
  );
}

describe('FeedbackSection', () => {
  it('sends a bug with the page and client log, then confirms', async () => {
    apiMock.mockResolvedValue({ ok: true, duplicate: false, id: '1' });
    renderForm();

    fill('What were you doing?', 'Saving a bid score');
    fill('Steps (optional)', 'Open the bid, click save');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/sent/i));

    const body = submittedBody();
    // WHY: admins need the report itself plus where it happened. The client
    // log is attached; the user is not asked for extra fields.
    expect(body.kind).toBe('bug');
    expect(body.featureIntent).toBeUndefined();
    expect(body.whatDoing).toBe('Saving a bid score');
    expect(body.steps).toBe('Open the bid, click save');
    expect(body.page).toBe('/opportunities/42');
    expect(body.clientLog).toMatchObject({
      route: '/opportunities/42',
      build: expect.any(String),
      browser: expect.any(String),
      timestamp: expect.any(String),
    });
    expect(screen.queryByDisplayValue('Saving a bid score')).toBeNull();
  });

  it('sends a feature request as new or improved', async () => {
    apiMock.mockResolvedValue({ ok: true, duplicate: false, id: '2' });
    renderForm('/pipeline');

    fireEvent.click(screen.getByRole('button', { name: 'Feature request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Improved' }));
    fill('What were you doing?', 'Filtering the pipeline by owner');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const body = submittedBody();
    expect(body.kind).toBe('feature');
    expect(body.featureIntent).toBe('improved');
    expect(body.page).toBe('/pipeline');
  });

  it('keeps the draft and shows an error when the send fails', async () => {
    apiMock.mockRejectedValue(new ApiError('unavailable', 503, null));
    renderForm();

    fill('What were you doing?', 'Exporting the shortlist');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/unavailable/i));
    // WHY: a failed send must not throw away what the user wrote.
    expect(screen.getByDisplayValue('Exporting the shortlist')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
}

function submittedBody(): {
  kind: string;
  featureIntent?: string;
  whatDoing: string;
  steps?: string;
  page: string;
  clientLog: { route: string; build: string; browser: string; timestamp: string };
} {
  const call = apiMock.mock.calls[0];
  expect(call?.[0]).toBe('/api/product-reports');
  return (call?.[1] as { body: never }).body;
}
