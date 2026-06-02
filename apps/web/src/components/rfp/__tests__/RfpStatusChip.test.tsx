/**
 * Tests for RfpStatusChip.
 *
 * Verifies label text and color class for every pipeline stage string value.
 * Color assertions check the Tailwind class that drives the visual; we test
 * the class rather than computed CSS because happy-dom does not apply
 * Tailwind stylesheets.
 *
 * NOTE ON TYPES: `PipelineStage` from @bidstack/shared collides with the
 * local string union (both are named PipelineStage but have incompatible
 * shapes). We use `as unknown as` casts when passing stage strings to props
 * to avoid the tsc false-positive; the runtime behavior is correct.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RfpStatusChip } from '../shared/RfpStatusChip';
import type { PipelineStage } from '@/stores/rfpPipeline';

afterEach(() => {
  cleanup();
});

// -----------------------------------------------------------------------
// Stage → expected label and a distinctive CSS substring to assert
// -----------------------------------------------------------------------

// We cast via unknown to avoid the PipelineStage name-collision with
// @bidstack/shared; the runtime values are valid stage strings.
type StageCaseRow = { stage: PipelineStage; label: string; colorSubstring: string };

const STAGE_CASES: StageCaseRow[] = [
  { stage: 'idle', label: 'Idle', colorSubstring: 'tag-gray' },
  { stage: 'queued', label: 'Queued', colorSubstring: 'tag-blue' },
  { stage: 'extracting', label: 'Extracting', colorSubstring: 'tag-purple' },
  { stage: 'story_matching', label: 'Matching Stories', colorSubstring: 'tag-purple' },
  { stage: 'section_drafting', label: 'Drafting', colorSubstring: 'tag-purple' },
  { stage: 'compliance_fill', label: 'Compliance', colorSubstring: 'tag-teal' },
  { stage: 'legal_scan', label: 'Review Crew', colorSubstring: 'tag-amber' },
  { stage: 'qa_review', label: 'QA Review', colorSubstring: 'tag-amber' },
  { stage: 'awaiting_approval', label: 'Awaiting Approval', colorSubstring: 'tag-amber' },
  { stage: 'approved', label: 'Approved', colorSubstring: 'tag-jade' },
  { stage: 'completed', label: 'Completed', colorSubstring: 'tag-jade' },
  { stage: 'failed', label: 'Failed', colorSubstring: 'tag-tomato' },
  { stage: 'rejected', label: 'Rejected', colorSubstring: 'tag-tomato' },
  { stage: 'timeout', label: 'Timed Out', colorSubstring: 'tag-gray' },
] as unknown[] as StageCaseRow[];

describe('RfpStatusChip — label rendering', () => {
  it.each(STAGE_CASES)('renders "$label" for stage "$stage"', ({ stage, label }) => {
    render(<RfpStatusChip stage={stage} />);
    expect(screen.getByText(label)).toBeDefined();
  });
});

describe('RfpStatusChip — color class per stage', () => {
  it.each(STAGE_CASES)(
    'applies "$colorSubstring" class for stage "$stage"',
    ({ stage, colorSubstring }) => {
      render(<RfpStatusChip stage={stage} />);
      const chip = screen.getByLabelText(/Pipeline status:/);
      expect(chip.className).toContain(colorSubstring);
    },
  );
});

describe('RfpStatusChip — semantic groupings', () => {
  it('approved stage carries green/jade class', () => {
    render(<RfpStatusChip stage={'approved' as unknown as PipelineStage} />);
    const chip = screen.getByLabelText(/Pipeline status:/);
    expect(chip.className).toContain('tag-jade');
  });

  it('failed stage carries red/tomato class', () => {
    render(<RfpStatusChip stage={'failed' as unknown as PipelineStage} />);
    const chip = screen.getByLabelText(/Pipeline status:/);
    expect(chip.className).toContain('tag-tomato');
  });

  it('queued stage carries blue class', () => {
    render(<RfpStatusChip stage={'queued' as unknown as PipelineStage} />);
    const chip = screen.getByLabelText(/Pipeline status:/);
    expect(chip.className).toContain('tag-blue');
  });
});

describe('RfpStatusChip — accessibility', () => {
  it('has an aria-label describing the pipeline status', () => {
    render(<RfpStatusChip stage={'queued' as unknown as PipelineStage} />);
    expect(screen.getByLabelText('Pipeline status: Queued')).toBeDefined();
  });

  it('renders as a span (inline, non-interactive)', () => {
    render(<RfpStatusChip stage={'approved' as unknown as PipelineStage} />);
    const chip = screen.getByLabelText(/Pipeline status:/);
    expect(chip.tagName).toBe('SPAN');
  });
});
