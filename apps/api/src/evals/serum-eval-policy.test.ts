import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSerumEvalsQualityGateRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

import {
  enforceSerumEvalGate,
  preflightSerumEvalGate,
  resolveSerumEvalGateContext,
} from './serum-eval-policy.js';

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: {
    evalsQualityGates: 'release',
  },
  checkSerumEvalsQualityGateRuntimePolicy: vi.fn(),
}));

const checkPolicy = vi.mocked(checkSerumEvalsQualityGateRuntimePolicy);

describe('SERUM eval runtime gate helper', () => {
  beforeEach(() => {
    checkPolicy.mockReset();
  });

  it('requires the eval policy automatically for full LLM release mode', () => {
    const context = resolveSerumEvalGateContext({
      EVAL_MODE: 'full',
      SERUM_EVAL_ORG_ID: 'org-123',
      SERUM_EVAL_SUITE: 'rfp_proposal_quality',
    });

    expect(context).toMatchObject({
      required: true,
      orgId: 'org-123',
      environment: 'dev',
      configKey: 'release',
      suite: 'rfp_proposal_quality',
      operation: 'eval.releaseGate',
    });
  });

  it('does not let an env override disable full LLM release policy enforcement', () => {
    const context = resolveSerumEvalGateContext({
      EVAL_MODE: 'full',
      SERUM_EVAL_POLICY_REQUIRED: 'false',
      SERUM_EVAL_ORG_ID: 'org-123',
    });

    expect(context.required).toBe(true);
  });

  it('skips policy checks for heuristic runs unless explicitly required', async () => {
    const context = resolveSerumEvalGateContext({ EVAL_MODE: 'heuristic' });

    await expect(enforceSerumEvalGate(context, { passRate: 0, failedCount: 10 })).resolves.toEqual({
      skipped: true,
      decision: null,
    });
    expect(checkPolicy).not.toHaveBeenCalled();
  });

  it('fails before model-backed evals when a required gate has no org context', async () => {
    const context = resolveSerumEvalGateContext({
      EVAL_MODE: 'full',
    });

    await expect(preflightSerumEvalGate(context)).rejects.toThrow(/SERUM_EVAL_ORG_ID/);
    expect(checkPolicy).not.toHaveBeenCalled();
  });

  it('denies release results that the runtime policy rejects', async () => {
    checkPolicy.mockResolvedValueOnce({
      configType: 'evals_quality_gates',
      configKey: 'release',
      environment: 'dev',
      subject: 'eval.releaseGate:rfp_proposal_quality',
      allowed: false,
      status: 'denied',
      reason: 'Eval pass rate is below the active SERUM threshold.',
      activeConfigVersionId: null,
    });

    const context = resolveSerumEvalGateContext({
      SERUM_EVAL_POLICY_REQUIRED: 'true',
      SERUM_EVAL_ORG_ID: 'org-123',
    });

    await expect(enforceSerumEvalGate(context, { passRate: 0.97, failedCount: 0 })).rejects.toThrow(
      /SERUM eval result denied/,
    );
    expect(checkPolicy).toHaveBeenCalledWith({
      orgId: 'org-123',
      environment: 'dev',
      configKey: 'release',
      operation: 'eval.releaseGate',
      suite: 'rfp_proposal_quality',
      passRate: 0.97,
      failedCount: 0,
    });
  });
});
