// A paused or in-flight document template has no body yet. The review step
// omitted the preview and left Send for Signature enabled, the same shape as
// a template that arrived with nothing to preview. The payload has not
// arrived, so that is not a finding. A failed read is not a finding either.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentTemplate } from '@bidstack/shared';

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

import { ReviewStep } from './ReviewStep';

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_PATH = `/api/document-templates/${TEMPLATE_ID}`;
const WAITING = 'Checking the document template. The preview has not arrived.';
const LOAD_ERROR = 'Could not load the document template';
const NONE = 'No document preview available';
const SEND = 'Send for Signature';

function template(bodyHtml: string): DocumentTemplate {
  return {
    id: TEMPLATE_ID,
    orgId: '22222222-2222-4222-8222-222222222222',
    name: 'Pursuit proposal',
    kind: 'PROPOSAL',
    description: 'A synthetic proposal template for the demo workspace.',
    bodyHtml,
    defaultVariables: {},
    createdAt: '2026-01-15T12:00:00.000Z',
  };
}

function renderReview(templateId = TEMPLATE_ID) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <ReviewStep
      templateId={templateId}
      recipients={[]}
      variables={{}}
      message=""
      onChangeMessage={() => {}}
      onBack={() => {}}
      onSend={() => {}}
      isSending={false}
    />,
    { wrapper: Wrapper },
  );
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function sendButton() {
  return screen.getByRole('button', { name: SEND }) as HTMLButtonElement;
}

describe('ReviewStep unread document template', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused document template read a missing preview', async () => {
    // WHY: a paused first read has isLoading false and no body. The review
    // left Send enabled with no preview, while the template has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderReview();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
    expect(sendButton().disabled).toBe(true);
  });

  it('does not call an in-flight document template read a missing preview', async () => {
    // WHY: a slow read is not an empty preview. Send stayed available while
    // the template body was still on the way.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderReview();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
    expect(sendButton().disabled).toBe(true);
  });

  it('does not call a failed document template read a missing preview', async () => {
    // WHY: a failed read is not evidence that the proposal template has no
    // preview. Send must not look available on top of a read that failed.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATE_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderReview();

    expect(await screen.findByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(sendButton().disabled).toBe(true);
  });

  it('still says there is no preview once a template arrives with an empty body', async () => {
    // WHY: a payload that arrived with an empty body is a miss. The none
    // line stays, so a real empty preview is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATE_PATH) return Promise.resolve(template(''));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderReview();

    expect(await screen.findByText(NONE)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it('still shows a proposal template that has arrived', async () => {
    // WHY: a loaded template stays in the preview. The unread line must not
    // replace a body the read already returned, and Send stays available.
    apiMock.mockImplementation((path: string) => {
      if (path === TEMPLATE_PATH) return Promise.resolve(template('<p>Terms for the pursuit.</p>'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderReview();

    expect(
      await screen.findByRole('region', { name: 'Document preview: Pursuit proposal' }),
    ).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it('still sends when this review has no document template to load', async () => {
    // WHY: a signature on an existing document never asks for a template.
    // That absent read is not an unread template, and Send stays available.
    apiMock.mockImplementation(hang);

    renderReview('');

    await waitFor(() => {
      expect(sendButton().disabled).toBe(false);
    });
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
