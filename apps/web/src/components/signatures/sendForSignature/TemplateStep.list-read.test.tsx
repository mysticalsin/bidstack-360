// A paused or in-flight document template catalog has no rows yet. The picker
// used the same empty menu as a catalog that arrived with nothing in it. The
// list has not arrived, so that empty menu is not a finding. A failed read is
// not a finding either.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentTemplatePage } from '@bidstack/shared';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      const template = typeof fallback === 'string' ? fallback : key;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

import { TemplateStep } from './TemplateStep';

const TEMPLATES_PATH = '/api/document-templates';
const WAITING = 'Checking document templates. The list has not arrived.';
const LOAD_ERROR = 'Could not load document templates';
const TEMPLATE_OPTION = 'Pursuit master agreement (MSA)';

function page(items: DocumentTemplatePage['items']): DocumentTemplatePage {
  return { items, nextCursor: null, total: items.length };
}

function template(): DocumentTemplatePage['items'][number] {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    name: 'Pursuit master agreement',
    kind: 'MSA',
    description: 'A synthetic master agreement for the demo workspace.',
    bodyHtml: '<p>Terms for the pursuit.</p>',
    defaultVariables: {},
    createdAt: '2026-01-15T12:00:00.000Z',
  };
}

function renderStep() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <TemplateStep
      selectedId=""
      variables={{}}
      onSelectTemplate={() => {}}
      onChangeVariable={() => {}}
      onNext={() => {}}
    />,
    { wrapper: Wrapper },
  );
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('option', { name: TEMPLATE_OPTION })).toBeNull();
  expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
}

describe('TemplateStep unread document catalog', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused document template read an empty catalog', async () => {
    // WHY: a paused first read has isLoading false and no rows. The picker
    // showed an empty template menu, while the list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderStep();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Document template' })).toBeNull();
    expectNoSettledMiss();
  });

  it('does not call an in-flight document template read an empty catalog', async () => {
    // WHY: a slow read is not an empty template menu. The pulse alone still
    // sat where a settled empty catalog sits.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderStep();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Document template' })).toBeNull();
    expectNoSettledMiss();
  });

  it('does not call a failed document template read an empty catalog', async () => {
    // WHY: a failed read is not evidence that no document templates exist.
    // The error stays, and the picker does not show an empty menu.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATES_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderStep();

    expect(await screen.findByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Document template' })).toBeNull();
  });

  it('still shows a settled catalog that found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. The empty menu
    // stays, so a real empty list is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATES_PATH) return Promise.resolve(page([]));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderStep();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Document template' })).toBeTruthy();
    });
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('option', { name: 'Select a template…' })).toBeTruthy();
    expectNoSettledMiss();
  });

  it('still shows a document template that has arrived', async () => {
    // WHY: a loaded template stays in the menu. The unread line must not
    // replace a row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATES_PATH) return Promise.resolve(page([template()]));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderStep();

    expect(await screen.findByRole('option', { name: TEMPLATE_OPTION })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
