// A paused or in-flight template catalog has no rows yet. The picker used the
// same blank list as a catalog that arrived empty. The list has not arrived,
// so that blank is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { OnboardingTemplate } from '@/hooks/useOnboarding';
import { useOnboardingStore } from '@/stores/onboarding';

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

import { TemplatePicker } from './TemplatePicker';

const TEMPLATES_PATH = '/api/onboarding/templates';
const WAITING = 'Checking starter templates. The list has not arrived.';
const TEMPLATE_NAME = 'Enterprise pursuit';

function template(): OnboardingTemplate {
  return {
    key: 'ENTERPRISE_SALES',
    name: TEMPLATE_NAME,
    description: 'A long cycle with a buying committee.',
    stageCount: 6,
  };
}

function renderPicker() {
  useOnboardingStore.getState().openTemplatePicker();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<TemplatePicker />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('button', { name: new RegExp(TEMPLATE_NAME) })).toBeNull();
  expect(screen.queryByRole('heading', { name: "Couldn't load templates" })).toBeNull();
}

describe('TemplatePicker unread catalog', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
    useOnboardingStore.getState().closeTemplatePicker();
  });

  it('does not call a paused template read an empty catalog', async () => {
    // WHY: a paused first read has isLoading false and no rows. The picker
    // showed a blank catalog, while the list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPicker();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight template read an empty catalog', async () => {
    // WHY: the skeleton alone still sat where a settled empty catalog sits.
    // A slow read is not an empty template list.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPicker();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed template read an empty catalog', async () => {
    // WHY: a failed read is not evidence that no starter pipelines exist. The
    // error stays, and the picker does not show a blank catalog.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATES_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPicker();

    expect(await screen.findByRole('heading', { name: "Couldn't load templates" })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(TEMPLATE_NAME) })).toBeNull();
  });

  it('still shows a settled catalog that found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. The blank catalog
    // stays, so a real empty list is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATES_PATH) return Promise.resolve([]);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPicker();

    expect(await screen.findByRole('button', { name: 'Install pipeline' })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoSettledMiss();
  });

  it('still shows a template that has arrived', async () => {
    // WHY: a loaded template stays in the picker. The unread line must not
    // replace a row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATES_PATH) return Promise.resolve([template()]);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPicker();

    expect(await screen.findByRole('button', { name: new RegExp(TEMPLATE_NAME) })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
