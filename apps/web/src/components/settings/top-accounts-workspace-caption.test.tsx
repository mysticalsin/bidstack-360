import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// WHY: Settings, Top accounts, tells an admin the curated list belongs to
// Mantu. Demo data is a synthetic workspace. The English catalog still carries
// that sentence, and another draft owns the catalog file. This screen has to
// say this workspace, including when the translator would still return the
// catalog sentence for the old key.

const catalog = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'public/locales/en/settings.json'), 'utf8'),
) as {
  topAccounts: { subtitle: string };
};

const WORKSPACE_CAPTION =
  'Hand-pick and order up to 10 accounts for this workspace. This is separate from Key Accounts (regional strategic accounts flagged per company). Saving an empty list reverts the Top Accounts page to the automatic pipeline-value ranking.';

function translate(
  key: string,
  fallback?: string,
  values?: Record<string, unknown>,
): string {
  const template = key === 'topAccounts.subtitle' ? catalog.topAccounts.subtitle : (fallback ?? key);
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('@/hooks/useDebouncedValue', () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

vi.mock('@/hooks/useTopAccounts', () => ({
  useTopAccounts: () => ({
    data: { source: 'curated', items: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateTopAccountList: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  }),
}));

import { TopAccountsSection } from './TopAccountsSection';

const SECTION_SRC = path.resolve(process.cwd(), 'src/components/settings/TopAccountsSection.tsx');

describe('top accounts workspace caption', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not name Mantu on the curated list', () => {
    expect(catalog.topAccounts.subtitle).toMatch(/Mantu/);

    render(<TopAccountsSection />);

    expect(screen.getByText(WORKSPACE_CAPTION)).toBeTruthy();
    expect(screen.queryByText(/Mantu/)).toBeNull();
    expect(readFileSync(SECTION_SRC, 'utf8')).not.toMatch(/Mantu/);
  });
});
