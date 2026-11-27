// A paused or in-flight signing read has no document yet. The page used a
// blank shell, the same shape as a missing document. A failed read said the
// link was invalid. The document has not arrived, so that is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import type { PublicSignatureRequest } from '@bidstack/shared';

const signHooks = vi.hoisted(() => ({
  usePublicSignatureRequest: vi.fn(),
  useSubmitSignature: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useSignatureRequests', () => signHooks);

import { PublicSignPage } from './PublicSignPage';

const CHECKING = 'Checking this signing link. The document has not arrived.';
const FAILED = 'Could not load this signing link.';
const INVALID = 'Invalid signing link';
const EXPIRED = 'Link expired';
const LOADED = 'Northwind approval';

const DOCUMENT: PublicSignatureRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'SENT',
  templateName: LOADED,
  senderName: 'Ada North',
  message: null,
  documentPreviewUrl: null,
  recipientName: 'Casey Example',
  recipientEmail: 'casey@example.com',
  expiresAt: null,
};

function renderSign(query: Record<string, unknown>) {
  signHooks.usePublicSignatureRequest.mockReturnValue(query);
  return render(
    <MemoryRouter initialEntries={['/sign/demo-token']}>
      <Routes>
        <Route path="/sign/:token" element={<PublicSignPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoSettledLink() {
  expect(screen.queryByRole('heading', { name: INVALID })).toBeNull();
  expect(screen.queryByRole('heading', { name: EXPIRED })).toBeNull();
  expect(screen.queryByText(LOADED)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

describe('PublicSignPage unread signing link', () => {
  afterEach(() => {
    cleanup();
    signHooks.usePublicSignatureRequest.mockReset();
  });

  it('does not call a paused signing read a missing document', async () => {
    // WHY: a paused first read has isLoading false and no payload. The page
    // showed an empty shell, while the document has not arrived.
    renderSign({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      status: 'pending',
      fetchStatus: 'paused',
    });

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledLink();
  });

  it('does not call an in-flight signing read a missing document', async () => {
    // WHY: a slow read showed only the loading shimmer. A document that has
    // not arrived is not a blank signing page.
    renderSign({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
      status: 'pending',
      fetchStatus: 'fetching',
    });

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledLink();
    expect(screen.queryByLabelText('Loading document')).toBeNull();
  });

  it('does not call a failed signing read an invalid link', async () => {
    // WHY: a failed read is not evidence that the link was deleted or expired.
    // The error stays, and the page does not say the link is invalid.
    renderSign({
      data: undefined,
      error: new Error('offline'),
      isError: true,
      isLoading: false,
      status: 'error',
      fetchStatus: 'idle',
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: INVALID })).toBeNull();
    expect(screen.queryByRole('heading', { name: EXPIRED })).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('still shows a link the server says is invalid', async () => {
    // WHY: a settled 404 is an invalid link. That sentence stays, so a real
    // miss is not dressed up as a slow network.
    renderSign({
      data: undefined,
      error: new ApiError('Signing link not found', 404, null),
      isError: true,
      isLoading: false,
      status: 'error',
      fetchStatus: 'idle',
    });

    expect(await screen.findByRole('heading', { name: INVALID })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('still shows a document that has arrived', async () => {
    // WHY: a loaded document stays on the page. The unread line must not
    // replace a document the read already returned.
    renderSign({
      data: DOCUMENT,
      error: null,
      isError: false,
      isLoading: false,
      status: 'success',
      fetchStatus: 'idle',
    });

    expect(await screen.findByText(LOADED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('heading', { name: INVALID })).toBeNull();
  });
});
