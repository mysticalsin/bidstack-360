// A paused or in-flight template read has no payload yet. The review step
// rendered no preview, which is a missing document. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentTemplate } from '@bidstack/shared';

interface TemplateSnapshot {
  data?: DocumentTemplate;
  isLoading: boolean;
  isError: boolean;
  status: string;
  fetchStatus: 'idle' | 'fetching' | 'paused';
}

const hookMocks = vi.hoisted(() => ({
  template: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'idle',
  } as TemplateSnapshot,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useDocumentTemplates', () => ({
  useDocumentTemplate: () => hookMocks.template,
}));

import { ReviewStep } from './ReviewStep';

const CHECKING = 'Checking this document. The preview has not arrived.';
const FAILED = 'Could not load this document.';
const PREVIEW_TITLE = 'Master services agreement';

const TEMPLATE: DocumentTemplate = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  name: PREVIEW_TITLE,
  kind: 'MSA',
  description: null,
  bodyHtml: '<p>Hello {{client}}</p>',
  defaultVariables: {},
  createdAt: '2026-01-01T00:00:00.000Z',
};

function settle(data: DocumentTemplate | undefined, extra: Partial<TemplateSnapshot> = {}) {
  hookMocks.template = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderStep() {
  return render(
    <ReviewStep
      templateId={TEMPLATE.id}
      recipients={[{ email: 'ada@example.com', name: 'Ada Signer', role: 'SIGNER' }]}
      variables={{ client: 'Northwind' }}
      message=""
      onChangeMessage={() => undefined}
      onBack={() => undefined}
      onSend={() => undefined}
      isSending={false}
    />,
  );
}

describe('ReviewStep document read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused document read as a missing preview', () => {
    // WHY: a paused first read has isLoading false and no payload. A blank
    // preview is a missing document. The template has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderStep();

    expect(screen.queryByTitle(PREVIEW_TITLE)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No document preview available')).toBeNull();
  });

  it('does not treat an in-flight document read as a missing preview', () => {
    // WHY: a slow read also has no payload. Hiding the preview is not a settled
    // empty document, and it is not a failed load.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderStep();

    expect(screen.queryByTitle(PREVIEW_TITLE)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No document preview available')).toBeNull();
  });

  it('keeps a failed document read on the error', () => {
    // WHY: a failed read is not evidence that the document is missing. The
    // error stays, and a blank preview does not stand in for the template.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderStep();

    expect(screen.queryByTitle(PREVIEW_TITLE)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('No document preview available')).toBeNull();
  });

  it('lets a failed read win over a stale document', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing the agreement from a template that is no longer the read.
    settle(TEMPLATE, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderStep();

    expect(screen.queryByTitle(PREVIEW_TITLE)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('No document preview available')).toBeNull();
  });

  it('stays empty when a settled document has no body', () => {
    // WHY: a template that arrived with an empty body stays an empty preview.
    // A slow network must not be dressed up as that outcome, and this one must.
    settle({ ...TEMPLATE, bodyHtml: '' });
    renderStep();

    expect(screen.queryByTitle(PREVIEW_TITLE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send for Signature' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No document preview available')).toBeNull();
  });

  it('still shows a document when the preview has arrived', () => {
    // WHY: a loaded document stays. The unread line must not replace a preview
    // the template already returned.
    settle(TEMPLATE);
    renderStep();

    expect(screen.getByTitle(PREVIEW_TITLE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No document preview available')).toBeNull();
  });
});
