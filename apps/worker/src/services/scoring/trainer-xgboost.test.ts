/**
 * Smoke tests for the XGBoost sidecar wrapper.
 *
 * These verify the wrapper's contract — early-return on disabled,
 * early-return on too-few-samples — without actually invoking Python
 * (so they pass on any CI machine without xgboost installed).
 *
 * An integration test that DOES invoke Python lives outside this file
 * because it requires `pip install -r apps/worker/python/requirements.txt`
 * to be present. CI can opt in by setting RUN_XGBOOST_INTEGRATION=true.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { trainWithXgboost } from './trainer-xgboost.js';

describe('trainWithXgboost', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to a known baseline for each test
    delete process.env['PREDICTIVE_USE_XGBOOST'];
    delete process.env['PREDICTIVE_PYTHON_BIN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when PREDICTIVE_USE_XGBOOST is not set', async () => {
    const result = await trainWithXgboost({
      X: Array.from({ length: 20 }, () => [1, 2, 3]),
      y: Array.from({ length: 20 }, (_, i) => i % 2),
      featureNames: ['a', 'b', 'c'],
    });
    expect(result).toBeNull();
  });

  it('returns null when PREDICTIVE_USE_XGBOOST is "false"', async () => {
    process.env['PREDICTIVE_USE_XGBOOST'] = 'false';
    const result = await trainWithXgboost({
      X: Array.from({ length: 20 }, () => [1, 2, 3]),
      y: Array.from({ length: 20 }, (_, i) => i % 2),
      featureNames: ['a', 'b', 'c'],
    });
    expect(result).toBeNull();
  });

  it('returns null for tiny datasets even when XGBoost is enabled', async () => {
    process.env['PREDICTIVE_USE_XGBOOST'] = 'true';
    const result = await trainWithXgboost({
      X: [[1, 2], [2, 3], [3, 1]], // only 3 samples
      y: [0, 1, 0],
      featureNames: ['a', 'b'],
    });
    expect(result).toBeNull();
  });

  // WHY this test matters: misconfiguring the binary should not crash the
  // training pipeline — the wrapper should log + return null so the LR
  // fallback continues to ship a model.
  it('returns null (not throw) when python binary is missing', async () => {
    process.env['PREDICTIVE_USE_XGBOOST'] = 'true';
    process.env['PREDICTIVE_PYTHON_BIN'] = '/this/binary/does/not/exist';
    const result = await trainWithXgboost({
      X: Array.from({ length: 20 }, () => [1, 2, 3]),
      y: Array.from({ length: 20 }, (_, i) => i % 2),
      featureNames: ['a', 'b', 'c'],
    });
    expect(result).toBeNull();
  });
});
