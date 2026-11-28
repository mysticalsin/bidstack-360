import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirm: mocks.confirm }));
vi.mock('@/components/ui/Toast', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock('@/hooks/useOnboarding', () => ({
  useSampleDataStatus: () => ({ data: { hasSampleData: true } }),
  useDeleteSampleData: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { SampleDataBanner } from './SampleDataBanner';

/** Seller-visible banner copy. Internal flags such as hasSampleData stay. */
const REMOVE_LABEL = 'Remove reference records';
const REMOVED_TOAST = 'Reference records removed';
const REMOVE_ERROR_TOAST = 'Could not remove reference records';
// DESIGN.md 9.5 pins this destructive-action warning. Rewording it needs sign-off.
const PINNED_CLEAR_WARNING = 'Delete all demonstration data? This action cannot be undone.';

const SAMPLE_OR_DEMO = /\b(sample|demos?|demonstrations?)\b/i;

const LOCALE_REFERENCE: Record<string, RegExp> = {
  en: /reference records/i,
  es: /registros de referencia/i,
  fr: /enregistrements de référence/i,
  pt: /registros de referência/i,
  it: /record di riferimento/i,
  zh: /参考记录/,
};

const LOCALE_SAMPLE_OR_DEMO: Record<string, RegExp> = {
  en: SAMPLE_OR_DEMO,
  es: /muestra|ejemplo|demostraci/i,
  fr: /exemple|démonstration|demonstration|\bdemo\b/i,
  pt: /exemplo|demonstra|\bdemo\b/i,
  it: /esempio|dimostrativ|\bdemo\b/i,
  zh: /示例|演示/,
};

function assertReferenceSellerCopy(text: string) {
  expect(text, 'seeded fixtures must read as reference records').toMatch(/reference records/i);
  expect(text, 'sellers must not see sample or demo wording').not.toMatch(SAMPLE_OR_DEMO);
}

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.mutate.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(() => cleanup());

describe('SampleDataBanner', () => {
  it('tells sellers the workspace has reference records, not sample or demo data', () => {
    render(<SampleDataBanner />);
    assertReferenceSellerCopy(document.body.textContent ?? '');
    expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled();
    expect(screen.getByRole('button', { name: REMOVE_LABEL })).toBeEnabled();
  });

  it('asks before clearing reference records and does nothing on cancel', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: REMOVE_LABEL }));
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: REMOVE_LABEL,
          description: PINNED_CLEAR_WARNING,
          confirmLabel: REMOVE_LABEL,
          destructive: true,
        }),
      ),
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('removes reference records after confirm and says so in the toast', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: REMOVE_LABEL }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(REMOVED_TOAST);
    assertReferenceSellerCopy(REMOVED_TOAST);
    expect(screen.queryByRole('button', { name: REMOVE_LABEL })).not.toBeInTheDocument();
  });

  it('reports a failed clear as reference records, not sample data', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.mutate.mockImplementation((_vars: unknown, opts: { onError: () => void }) => opts.onError());
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: REMOVE_LABEL }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(REMOVE_ERROR_TOAST));
    assertReferenceSellerCopy(REMOVE_ERROR_TOAST);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('ships the same reference-record meaning in sampleDataBanner locale keys', () => {
    const localesDir = join(process.cwd(), 'public/locales');
    const locales = readdirSync(localesDir);
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const raw = readFileSync(join(localesDir, locale, 'onboarding.json'), 'utf8');
      const banner = (JSON.parse(raw) as { sampleDataBanner?: Record<string, string> }).sampleDataBanner;
      if (!banner) continue;
      const reference = LOCALE_REFERENCE[locale];
      const forbidden = LOCALE_SAMPLE_OR_DEMO[locale];
      expect(reference, `${locale} sampleDataBanner needs a reference-record expectation`).toBeDefined();
      expect(forbidden, `${locale} sampleDataBanner needs a sample/demo rejection`).toBeDefined();
      const sellerCopy = Object.values(banner).join('\n');
      expect(sellerCopy, `${locale} sellers should see reference records`).toMatch(reference!);
      expect(sellerCopy, `${locale} sellers must not see sample or demo wording`).not.toMatch(forbidden!);
    }
  });
});
