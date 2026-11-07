import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const signHooks = vi.hoisted(() => ({
  usePublicSignatureRequest: vi.fn(),
  useSubmitSignature: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/hooks/useSignatureRequests', () => signHooks);

import { PublicSignPage } from './PublicSignPage';

function renderWithError(error: unknown) {
  signHooks.usePublicSignatureRequest.mockReturnValue({ data: undefined, isLoading: false, error });
  render(
    <MemoryRouter initialEntries={['/sign/abc12345']}>
      <Routes>
        <Route path="/sign/:token" element={<PublicSignPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicSignPage error states', () => {
  afterEach(cleanup);

  it('tells a signer who reopens a signed link that it is already signed', () => {
    renderWithError(new ApiError('This document has already been signed.', 410, null));
    expect(screen.getByRole('heading', { name: 'Signing closed' })).toBeTruthy();
    expect(screen.getByText('This document has already been signed.')).toBeTruthy();
    expect(screen.queryByText('Invalid signing link')).toBeNull();
  });

  it('shows the expired state for an expired link', () => {
    renderWithError(new ApiError('This signing link has expired.', 410, null));
    expect(screen.getByRole('heading', { name: 'Link expired' })).toBeTruthy();
  });

  it('shows the invalid state for an unknown token', () => {
    renderWithError(new ApiError('Signing link not found', 404, null));
    expect(screen.getByRole('heading', { name: 'Invalid signing link' })).toBeTruthy();
  });

  it('keeps the signing consent copy', () => {
    signHooks.usePublicSignatureRequest.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(
      <MemoryRouter initialEntries={['/sign/abc12345']}>
        <Routes>
          <Route path="/sign/:token" element={<PublicSignPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText('Your signature is legally binding. This page contains no tracking technologies.'),
    ).toBeTruthy();
  });
});
