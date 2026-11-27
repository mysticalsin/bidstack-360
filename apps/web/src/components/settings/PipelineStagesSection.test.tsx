// Demo S3 Technical Iteration is 60 and Closed Won is 100. Clearing the
// probability field used to parse as 0, and 150 used to clamp to 100, so Save
// wrote a percent the admin did not type. An empty field is not zero, and a
// percent outside 0–100 must not be saved.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const patchMocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({
    isLoading: false,
    isError: false,
    data: {
      pageContinues: false,
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          key: 's3_technical_iteration',
          name: 'S3 Technical Iteration',
          orderIndex: 3,
          probability: 60,
          forecastCategory: 'pipeline',
          isWon: false,
          isLost: false,
          color: '#14b8a6',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    },
  }),
  usePatchPipelineStage: () => ({
    isPending: false,
    variables: undefined,
    mutateAsync: patchMocks.mutateAsync,
  }),
}));

import { PipelineStagesSection } from './PipelineStagesSection';

const STAGE_ID = '33333333-3333-4333-8333-333333333333';

function probabilityInput(): HTMLInputElement {
  return screen.getByRole('spinbutton', { name: /Probability, S3 Technical Iteration/i });
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Save S3 Technical Iteration/i });
}

describe('PipelineStagesSection probability', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not save 0 when the probability field is cleared', () => {
    render(<PipelineStagesSection />);
    fireEvent.change(probabilityInput(), { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toMatch(/0 to 100/);
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(probabilityInput().closest('form')!);
    expect(patchMocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('does not clamp 150 down to 100', () => {
    render(<PipelineStagesSection />);
    fireEvent.change(probabilityInput(), { target: { value: '150' } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(probabilityInput().closest('form')!);
    expect(patchMocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('does not enable Save for a non-numeric probability', () => {
    render(<PipelineStagesSection />);
    fireEvent.change(probabilityInput(), { target: { value: 'abc' } });
    expect(saveButton().disabled).toBe(true);
    expect(patchMocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('saves a whole percent the admin typed', async () => {
    render(<PipelineStagesSection />);
    fireEvent.change(probabilityInput(), { target: { value: '70' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(patchMocks.mutateAsync).toHaveBeenCalledWith({
      id: STAGE_ID,
      body: { name: 'S3 Technical Iteration', probability: 70, color: '#14b8a6' },
    });
  });

  it('keeps the stored probability when only the name changes', async () => {
    render(<PipelineStagesSection />);
    fireEvent.change(screen.getByRole('textbox', { name: /stage name/i }), {
      target: { value: 'S3 Technical Review' },
    });
    fireEvent.click(saveButton());
    expect(patchMocks.mutateAsync).toHaveBeenCalledWith({
      id: STAGE_ID,
      body: { name: 'S3 Technical Review', probability: 60, color: '#14b8a6' },
    });
  });
});
