// Demo Closed Won is 100 and Closed Lost is 0. The probability field still
// accepted 0 on a won stage and 40 on a lost stage, then Save wrote that
// percent. Terminal stages stay at those percents. An open stage does not.
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

const stageState = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    key: string;
    name: string;
    orderIndex: number;
    probability: number;
    forecastCategory: string;
    isWon: boolean;
    isLost: boolean;
    color: string;
    updatedAt: string;
  }>,
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({
    isLoading: false,
    isError: false,
    data: { pageContinues: false, items: stageState.items },
  }),
  usePatchPipelineStage: () => ({
    isPending: false,
    variables: undefined,
    mutateAsync: patchMocks.mutateAsync,
  }),
}));

import { PipelineStagesSection } from './PipelineStagesSection';

const WON_ID = '11111111-1111-4111-8111-111111111111';
const LOST_ID = '22222222-2222-4222-8222-222222222222';
const OPEN_ID = '33333333-3333-4333-8333-333333333333';

function stage(partial: {
  id: string;
  key: string;
  name: string;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  color: string;
  orderIndex: number;
}) {
  return {
    forecastCategory: partial.isWon ? 'closed_won' : partial.isLost ? 'closed_lost' : 'pipeline',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...partial,
  };
}

function renderStages() {
  render(<PipelineStagesSection />);
}

describe('PipelineStagesSection terminal probability', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    stageState.items = [];
  });

  it('does not save 0 when Closed Won is edited', () => {
    stageState.items = [
      stage({
        id: WON_ID,
        key: 'closed_won',
        name: 'Closed Won',
        probability: 100,
        isWon: true,
        isLost: false,
        color: '#10b981',
        orderIndex: 5,
      }),
    ];
    renderStages();

    const probability = screen.getByRole('spinbutton', { name: 'Probability, Closed Won' });
    expect(probability).toHaveProperty('readOnly', true);
    expect((probability as HTMLInputElement).value).toBe('100');
    expect(screen.getByText('A won stage stays at 100.')).toBeTruthy();

    fireEvent.change(probability, { target: { value: '0' } });
    fireEvent.submit(probability.closest('form')!);

    expect(patchMocks.mutateAsync).not.toHaveBeenCalled();
    expect((probability as HTMLInputElement).value).toBe('100');
  });

  it('saves 100 for a won stage that was stored at 40', () => {
    stageState.items = [
      stage({
        id: WON_ID,
        key: 'closed_won',
        name: 'Closed Won',
        probability: 40,
        isWon: true,
        isLost: false,
        color: '#10b981',
        orderIndex: 5,
      }),
    ];
    renderStages();

    const probability = screen.getByRole('spinbutton', { name: 'Probability, Closed Won' });
    expect((probability as HTMLInputElement).value).toBe('100');
    const save = screen.getByRole('button', { name: 'Save Closed Won' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    expect(patchMocks.mutateAsync).toHaveBeenCalledWith({
      id: WON_ID,
      body: { name: 'Closed Won', probability: 100, color: '#10b981' },
    });
  });

  it('does not save 40 on Closed Lost', () => {
    stageState.items = [
      stage({
        id: LOST_ID,
        key: 'closed_lost',
        name: 'Closed Lost',
        probability: 0,
        isWon: false,
        isLost: true,
        color: '#ef4444',
        orderIndex: 6,
      }),
    ];
    renderStages();

    const probability = screen.getByRole('spinbutton', { name: 'Probability, Closed Lost' });
    expect(probability).toHaveProperty('readOnly', true);
    expect((probability as HTMLInputElement).value).toBe('0');
    expect(screen.getByText('A lost stage stays at 0.')).toBeTruthy();

    fireEvent.change(probability, { target: { value: '40' } });
    fireEvent.submit(probability.closest('form')!);

    expect(patchMocks.mutateAsync).not.toHaveBeenCalled();
    expect((probability as HTMLInputElement).value).toBe('0');
  });

  it('still saves a typed percent on an open stage', () => {
    stageState.items = [
      stage({
        id: OPEN_ID,
        key: 's3_technical_iteration',
        name: 'S3 Technical Iteration',
        probability: 60,
        isWon: false,
        isLost: false,
        color: '#14b8a6',
        orderIndex: 3,
      }),
      stage({
        id: WON_ID,
        key: 'closed_won',
        name: 'Closed Won',
        probability: 100,
        isWon: true,
        isLost: false,
        color: '#10b981',
        orderIndex: 5,
      }),
    ];
    renderStages();

    const open = screen.getAllByRole('spinbutton').find((el) => (el as HTMLInputElement).value === '60');
    if (!open) throw new Error('missing open stage probability');
    expect(open).toHaveProperty('readOnly', false);
    fireEvent.change(open, { target: { value: '70' } });
    fireEvent.click(open.closest('form')!.querySelector('button')!);

    expect(patchMocks.mutateAsync).toHaveBeenCalledWith({
      id: OPEN_ID,
      body: { name: 'S3 Technical Iteration', probability: 70, color: '#14b8a6' },
    });
  });
});
