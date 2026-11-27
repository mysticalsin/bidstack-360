// The review pane keeps one TipTap editor for whichever section is open.
// useEditor reads `content` only when that editor is created. Choosing the
// next section updated the heading and left the previous section's words in
// the box. Save writes the box onto the section that is open, so Pricing
// could be stored as the executive summary.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftSection } from '@/hooks/rfp/useRfpDraft';

const SUMMARY = 'Win themes for the Siemens ERP bid.';
const PRICING = 'Commercial terms for the Siemens ERP bid.';

const sections: DraftSection[] = [
  {
    id: 'section-summary',
    order: 0,
    title: 'Executive summary',
    content: `<p>${SUMMARY}</p>`,
    aiGenerated: false,
    humanReviewed: false,
    lastEditedAt: null,
  },
  {
    id: 'section-pricing',
    order: 1,
    title: 'Pricing',
    content: `<p>${PRICING}</p>`,
    aiGenerated: false,
    humanReviewed: false,
    lastEditedAt: null,
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: (selector: (state: { bidWorkspaceId: string }) => unknown) =>
    selector({ bidWorkspaceId: 'ws-siemens' }),
}));

vi.mock('@/hooks/rfp/useRfpDraft', () => ({
  useRfpDraft: () => ({
    query: {
      data: { proposalId: 'proposal-siemens', sections },
      isLoading: false,
      isError: false,
      error: null,
    },
    saveSection: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@tiptap/react', async () => {
  const React = await import('react');
  return {
    // TipTap applies `content` when the editor is created, then ignores later
    // values. useState matches that: a re-render keeps the first document, and
    // a new mount (a new section) starts from the content it was given.
    useEditor: (opts: { content?: string }) => {
      const [html] = React.useState(opts.content ?? '');
      return { getHTML: () => html };
    },
    EditorContent: ({ editor }: { editor: { getHTML: () => string } | null }) =>
      React.createElement(
        'div',
        { 'data-testid': 'section-editor-body' },
        editor?.getHTML() ?? '',
      ),
  };
});

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));

import { DraftReviewPane } from './DraftReviewPane';

function editorBody(): string {
  return screen.getByTestId('section-editor-body').textContent ?? '';
}

describe('DraftReviewPane section body', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the section that was just selected, not the one that was open before', () => {
    // WHY: the heading already follows the tab. The editor did not, because
    // TipTap keeps the document it was created with. The next section then
    // looked filled with the previous section's words.
    render(<DraftReviewPane />);

    fireEvent.click(screen.getByRole('button', { name: 'Executive summary' }));
    expect(editorBody()).toContain(SUMMARY);

    fireEvent.click(screen.getByRole('button', { name: 'Pricing' }));

    expect(screen.getByRole('heading', { name: 'Pricing' })).toBeTruthy();
    expect(editorBody()).toContain(PRICING);
    expect(editorBody()).not.toContain(SUMMARY);
  });
});
