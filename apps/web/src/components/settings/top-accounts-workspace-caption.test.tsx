import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOP_ACCOUNTS_MAX } from '@bidstack/shared';

import { topAccountsWorkspaceCaption } from './top-accounts-workspace-caption';

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

  it('prints the slot cap for this workspace', () => {
    const caption = topAccountsWorkspaceCaption(TOP_ACCOUNTS_MAX);
    expect(caption).toContain(`up to ${TOP_ACCOUNTS_MAX} accounts`);
    expect(caption).toContain('this workspace');
    expect(caption).not.toMatch(/Mantu/);
    expect(topAccountsWorkspaceCaption(3)).toContain('up to 3 accounts');
  });

  it('does not name Mantu on the curated list', () => {
    expect(catalog.topAccounts.subtitle).toMatch(/Mantu/);

    render(<TopAccountsSection />);

    const src = readFileSync(SECTION_SRC, 'utf8');
    expect(screen.getByText(topAccountsWorkspaceCaption(TOP_ACCOUNTS_MAX))).toBeTruthy();
    expect(screen.queryByText(/Mantu/)).toBeNull();
    expect(src).not.toMatch(/Mantu/);
    expect(src).toContain('topAccountsWorkspaceCaption');
    expect(src).not.toContain("'topAccounts.subtitle'");
  });
});
