import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  usePredictiveModels: vi.fn(),
  useRetrainModel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      let text = fallback ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

vi.mock('@/hooks/usePredictiveScore', () => ({
  usePredictiveModels: hookMocks.usePredictiveModels,
  useRetrainModel: hookMocks.useRetrainModel,
}));

import PredictiveAdminPage from './PredictiveAdminPage';

const leadModel = {
  id: 'model_demo_lead',
  entityType: 'lead',
  version: 3,
  isActive: true,
  sampleCount: 12,
  accuracyMetrics: { precision: 0.8, recall: 0.7, auc: 0.9, f1: 0.75 },
  trainedAt: '2026-01-15T12:00:00.000Z',
  modelArtifactS3Key: 'synthetic/model',
};

function idleRetrain() {
  hookMocks.useRetrainModel.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  });
}

describe('Predictive scoring model list', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // WHY: a failed model read has no rows. The table was treating that as an
  // empty training history and telling the demo admin to train the first model.
  it('does not call a failed model read an empty training history', () => {
    idleRetrain();
    const refetch = vi.fn();
    hookMocks.usePredictiveModels.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<PredictiveAdminPage />);

    expect(screen.queryAllByText(/models trained yet/)).toHaveLength(0);
    expect(screen.getAllByText('Could not load scoring models.')).toHaveLength(2);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);
    retries[0]?.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a loaded empty history empty', () => {
    idleRetrain();
    hookMocks.usePredictiveModels.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<PredictiveAdminPage />);

    expect(screen.getByText(/No lead models trained yet/)).toBeTruthy();
    expect(screen.getByText(/No opportunity models trained yet/)).toBeTruthy();
    expect(screen.queryByText('Could not load scoring models.')).toBeNull();
  });

  it('keeps a loaded model on the page', () => {
    idleRetrain();
    hookMocks.usePredictiveModels.mockImplementation((entityType: 'lead' | 'opportunity') => {
      if (entityType === 'lead') {
        return {
          data: { items: [leadModel] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return {
        data: { items: [] },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    render(<PredictiveAdminPage />);

    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByLabelText('Active model')).toBeTruthy();
    expect(screen.queryByText(/No lead models trained yet/)).toBeNull();
    expect(screen.getByText(/No opportunity models trained yet/)).toBeTruthy();
  });

  it('does not call a load in progress an empty training history', () => {
    idleRetrain();
    hookMocks.usePredictiveModels.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<PredictiveAdminPage />);

    expect(screen.queryByText(/models trained yet/)).toBeNull();
    expect(screen.queryByText('Could not load scoring models.')).toBeNull();
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
  });
});
