import { beforeEach, describe, expect, it, vi } from 'vitest';

const findModel = vi.fn();
const loadModelFromS3 = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    predictiveModel: { findFirst: (...args: unknown[]) => findModel(...args) },
    predictiveScore: { findFirst: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('./scoring/trainer.js', () => ({
  loadModelFromS3: (...args: unknown[]) => loadModelFromS3(...args),
  inferScore: () => 0.91,
  inferXgboostScore: () => null,
  shapAttributions: () => [],
  xgboostShapProxy: () => [],
}));

vi.mock('./scoring/feature-extraction.js', () => ({
  extractLeadFeatures: vi.fn().mockResolvedValue({ values: [1], names: ['a'] }),
  extractOpportunityFeatures: vi.fn(),
}));

const { scoreLead } = await import('./predictive-scoring.service.js');

const redis = {
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn(),
};

beforeEach(() => {
  findModel.mockReset();
  loadModelFromS3.mockReset();
  redis.get.mockClear();
});

describe('scoreLead with a short stored model', () => {
  it('does not score from a model trained on fewer than 50 closed records', async () => {
    findModel.mockResolvedValue({
      modelArtifactS3Key: 'models/org/lead/v1.json',
      sampleCount: 12,
    });
    loadModelFromS3.mockResolvedValue({
      weights: [1],
      bias: 0,
      featureNames: ['a'],
      sampleCount: 12,
      version: 'v1',
      entityType: 'lead',
      orgId: 'org-1',
      trainedAt: '2026-01-01T00:00:00.000Z',
      metrics: { auc: 0.9, f1: 0.9, precision: 0.9, recall: 0.9 },
    });

    const score = await scoreLead('org-1', 'lead-1', redis as never);

    expect(score.score).toBeNull();
    expect(score.modelVersion).toBe('fallback-v0');
    expect(loadModelFromS3).not.toHaveBeenCalled();
  });
});
