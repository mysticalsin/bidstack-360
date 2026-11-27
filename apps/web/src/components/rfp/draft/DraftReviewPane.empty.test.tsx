// The demo book stores the Siemens executive summary as a proposal with no
// sections. This pane is mounted only after the pipeline is waiting on
// approval, which is after section drafting. The empty list was still
// captioned as a draft that would arrive when drafting finished, so a
// reviewer waited on text that was not coming.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftSection } from '@/hooks/rfp/useRfpDraft';

const SUMMARY_ID = '22222222-2222-4222-8222-222222222222';

const draft = vi.hoisted(() => ({
  proposalId: '22222222-2222-4222-8222-222222222222',
  sections: [] as DraftSection[],
}));

const EN: Record<string, string> = {
  'draft.heading': 'Draft Sections',
  'draft.emptyTitle': 'No draft yet',
  'draft.emptyMessage': 'Draft sections will appear here once section drafting is complete.',
  'draft.selectSection': 'Select a section above to review and edit it.',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => EN[key] ?? fallback ?? key,
  }),
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: (selector: (state: { bidWorkspaceId: string }) => unknown) =>
    selector({ bidWorkspaceId: 'ws-siemens' }),
}));

vi.mock('@/hooks/rfp/useRfpDraft', () => ({
  useRfpDraft: () => ({
    query: {
      data: draft,
      isLoading: false,
      isError: false,
      error: null,
    },
    saveSection: { mutate: vi.fn(), isPending: false },
  }),
}));

import { DraftReviewPane } from './DraftReviewPane';

const TECHNICAL_SECTION: DraftSection = {
  id: '11111111-1111-4111-8111-111111111111',
  order: 0,
  title: 'Executive summary',
  content: '<p>Win themes for the Siemens ERP bid.</p>',
  aiGenerated: false,
  humanReviewed: false,
  lastEditedAt: null,
};

describe('DraftReviewPane empty demo draft', () => {
  afterEach(() => {
    cleanup();
    draft.proposalId = SUMMARY_ID;
    draft.sections = [];
  });

  it('does not tell a reviewer that section drafting will still fill an empty proposal', () => {
    // WHY: the Siemens executive summary is a stored proposal. Its section
    // list is empty because nothing was written, not because drafting is
    // still running. The approval pane is already past that stage.
    render(<DraftReviewPane />);

    expect(
      screen.getByRole('heading', { name: 'This proposal has no sections.' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This draft has no section text. Section drafting is not still running.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('No draft yet')).toBeNull();
    expect(
      screen.queryByText('Draft sections will appear here once section drafting is complete.'),
    ).toBeNull();
  });

  it('still lists sections when the opened proposal has them', () => {
    // WHY: the Siemens technical proposal can hold the draft. An empty
    // sibling must not make this pane say the open proposal has no sections.
    draft.proposalId = '11111111-1111-4111-8111-111111111111';
    draft.sections = [TECHNICAL_SECTION];

    render(<DraftReviewPane />);

    expect(screen.getByRole('button', { name: 'Executive summary' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'This proposal has no sections.' })).toBeNull();
    expect(
      screen.queryByText('Draft sections will appear here once section drafting is complete.'),
    ).toBeNull();
  });
});
