import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('says the signature is not a legally binding e-signature, like the signed PDF', () => {
    signHooks.usePublicSignatureRequest.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(
      <MemoryRouter initialEntries={['/sign/abc12345']}>
        <Routes>
          <Route path="/sign/:token" element={<PublicSignPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        'This is an internal approval signature, not a legally binding e-signature. This page contains no tracking technologies.',
      ),
    ).toBeTruthy();
  });
});

// Until legal signs off, no locale may tell a signer the signature is binding.
// Each footer is pinned so a translation edit cannot reintroduce the claim.
describe('public sign legal copy in every locale', () => {
  const read = (locale: string, file: string) =>
    JSON.parse(
      readFileSync(resolve(__dirname, `../../public/locales/${locale}/${file}.json`), 'utf8'),
    ) as Record<string, Record<string, string>>;

  const FOOTERS: Record<string, string> = {
    en: 'This is an internal approval signature, not a legally binding e-signature. This page contains no tracking technologies.',
    fr: "Il s'agit d'une signature d'approbation interne, et non d'une signature électronique juridiquement contraignante. Cette page ne contient aucune technologie de suivi.",
    es: 'Esta es una firma de aprobación interna, no una firma electrónica legalmente vinculante. Esta página no contiene tecnologías de seguimiento.',
    it: 'Questa è una firma di approvazione interna, non una firma elettronica giuridicamente vincolante. Questa pagina non contiene tecnologie di tracciamento.',
    pt: 'Esta é uma assinatura de aprovação interna, não uma assinatura eletrônica juridicamente vinculativa. Esta página não contém tecnologias de rastreamento.',
    zh: '这是内部审批签名，不是具有法律约束力的电子签名。本页面不包含任何跟踪技术。',
  };

  it.each(Object.keys(FOOTERS))('%s footer matches the pinned wording', (locale) => {
    expect(read(locale, 'crm').publicSign?.footerLegalNote).toBe(FOOTERS[locale]);
  });

  it('English terms and intro do not claim the signature is binding', () => {
    const copy = read('en', 'crm').publicSign ?? {};
    expect(copy.termsAgreement).toMatch(/not a legally binding e-signature/);
    expect(copy.submitLegalIntro).not.toMatch(/legally sign/);
    expect(read('en', 'signatures').pad?.agreed).not.toMatch(/legally equivalent/);
  });
});
