/**
 * Tests for PipelineProgress.
 *
 * Implementation notes (spec vs reality):
 * - The spec describes role="progressbar" with aria-valuenow. The real
 *   component renders a <nav>/<ol>/<li> step-indicator with aria-current="step"
 *   on the active step. There is no progressbar role.
 * - Tests reflect the actual accessible structure: nav landmark, ordered list,
 *   aria-current="step" on the active stage, and stage labels via i18n.
 * - ORDERED_STAGES = ['queued','extracting','story_matching',
 *   'section_drafting','compliance_fill','legal_scan','qa_review'] (7 items).
 *   'idle', 'awaiting_approval', 'approved', 'failed' are not in the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { PipelineProgress } from '../shared/PipelineProgress';
import type { PipelineStage } from '@/stores/rfpPipeline';

// ---------------------------------------------------------------------------
// Mock react-i18next — return key as label
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Map stage keys to human-readable labels matching STAGE_LABELS logic
      const labels: Record<string, string> = {
        'pipeline.stages.queued': 'Uploading',
        'pipeline.stages.extracting': 'Extracting',
        'pipeline.stages.story_matching': 'Matching Stories',
        'pipeline.stages.section_drafting': 'Drafting',
        'pipeline.stages.compliance_fill': 'Compliance',
        'pipeline.stages.legal_scan': 'Legal Scan',
        'pipeline.stages.qa_review': 'QA Review',
        'pipeline.progressLabel': 'Pipeline progress',
      };
      return labels[key] ?? key;
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Ordered stages definition (must match the component constant)
// ---------------------------------------------------------------------------

const ORDERED_STAGES: PipelineStage[] = [
  'queued',
  'extracting',
  'story_matching',
  'section_drafting',
  'compliance_fill',
  'legal_scan',
  'qa_review',
];

// ---------------------------------------------------------------------------
// Nav landmark and structure
// ---------------------------------------------------------------------------

describe('PipelineProgress — landmark structure', () => {
  it('renders a navigation landmark for pipeline progress', () => {
    render(<PipelineProgress currentStage="queued" />);
    expect(screen.getByRole('navigation')).toBeDefined();
  });

  it('renders an ordered list of steps', () => {
    render(<PipelineProgress currentStage="queued" />);
    expect(screen.getByRole('list')).toBeDefined();
  });

  it('renders 7 list items — one per ordered stage', () => {
    render(<PipelineProgress currentStage="queued" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

describe('PipelineProgress — stage labels', () => {
  it.each(ORDERED_STAGES)('renders label for stage "%s"', (stage) => {
    render(<PipelineProgress currentStage={stage} />);
    // Each stage dot has a text label — the mock maps the i18n key
    const labels: Record<PipelineStage, string> = {
      queued: 'Uploading',
      extracting: 'Extracting',
      story_matching: 'Matching Stories',
      section_drafting: 'Drafting',
      compliance_fill: 'Compliance',
      legal_scan: 'Legal Scan',
      qa_review: 'QA Review',
      idle: 'idle',
      awaiting_approval: 'awaiting_approval',
      approved: 'approved',
      completed: 'completed',
      failed: 'failed',
      rejected: 'rejected',
      timeout: 'timeout',
    };
    expect(screen.getByText(labels[stage])).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// aria-current="step" on the active stage
// ---------------------------------------------------------------------------

describe('PipelineProgress — aria-current on active step', () => {
  it('marks the first stage dot as aria-current="step" when currentStage is queued', () => {
    render(<PipelineProgress currentStage="queued" />);
    const currentEls = document.querySelectorAll('[aria-current="step"]');
    expect(currentEls).toHaveLength(1);
  });

  it.each(ORDERED_STAGES)(
    'exactly one step dot has aria-current="step" for stage "%s"',
    (stage) => {
      render(<PipelineProgress currentStage={stage} />);
      const currentEls = document.querySelectorAll('[aria-current="step"]');
      expect(currentEls).toHaveLength(1);
      cleanup();
    },
  );

  it('has NO aria-current step when stage is awaiting_approval (all done)', () => {
    render(<PipelineProgress currentStage="awaiting_approval" />);
    const currentEls = document.querySelectorAll('[aria-current="step"]');
    // All steps are marked done; none is active
    expect(currentEls).toHaveLength(0);
  });

  it('has NO aria-current step when stage is approved (all done)', () => {
    render(<PipelineProgress currentStage="approved" />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage index progress (step numbers and check marks)
// ---------------------------------------------------------------------------

describe('PipelineProgress — step number vs checkmark', () => {
  it('shows step numbers on upcoming stages and a checkmark on completed stages', () => {
    // When on extracting (idx=1), queued (idx=0) should show checkmark
    render(<PipelineProgress currentStage="extracting" />);
    // The done step renders aria-hidden "✓"
    const checkmarks = document.querySelectorAll('[aria-hidden="true"]');
    // At least one "✓" should be present (the completed queued step)
    const checkmarkTexts = Array.from(checkmarks).map((el) => el.textContent);
    expect(checkmarkTexts.some((t) => t === '✓')).toBe(true);
  });

  it('shows no checkmarks when currentStage is the first ordered stage', () => {
    render(<PipelineProgress currentStage="queued" />);
    // No prior stages are done; only connector-aria-hiddens and the ✦ glyph from badge (not here)
    const checkmarks = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter(
      (el) => el.textContent === '✓',
    );
    expect(checkmarks).toHaveLength(0);
  });

  it('all 7 checkmarks visible when stage is awaiting_approval (terminal success)', () => {
    render(<PipelineProgress currentStage="awaiting_approval" />);
    const checkmarks = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter(
      (el) => el.textContent === '✓',
    );
    expect(checkmarks).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Failed stage rendering
// ---------------------------------------------------------------------------

describe('PipelineProgress — failed stage', () => {
  it('renders without throwing when currentStage is failed', () => {
    // failed is not in ORDERED_STAGES; the component should render gracefully
    // with no active step (currentIdx = -1)
    expect(() => render(<PipelineProgress currentStage="failed" />)).not.toThrow();
  });

  it('renders without throwing when currentStage is idle', () => {
    expect(() => render(<PipelineProgress currentStage="idle" />)).not.toThrow();
  });
});
