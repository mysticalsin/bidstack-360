import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumEvalsQualityGateRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';
import type {
  SerumConfigEnvironment,
  SerumRuntimeDecision as SerumRuntimeDecisionDto,
} from '@bidstack/shared';

const DEFAULT_EVAL_SUITE = 'rfp_proposal_quality';
const DEFAULT_EVAL_OPERATION = 'eval.releaseGate';

export type SerumEvalGateContext = {
  required: boolean;
  orgId: string | null;
  environment: SerumConfigEnvironment;
  configKey: string;
  suite: string;
  operation: string;
};

export type SerumEvalGateResult = {
  skipped: boolean;
  decision: SerumRuntimeDecisionDto | null;
};

type EnvSource = Record<string, string | undefined>;

function parseBoolean(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'required'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'optional'].includes(normalized)) return false;
  return null;
}

function parseEnvironment(value: string | undefined): SerumConfigEnvironment {
  return value === 'staging' || value === 'production' ? value : 'dev';
}

export function resolveSerumEvalGateContext(env: EnvSource = process.env): SerumEvalGateContext {
  const explicitRequired = parseBoolean(env.SERUM_EVAL_POLICY_REQUIRED);
  const fullMode = env.EVAL_MODE === 'full';
  return {
    required: fullMode || explicitRequired === true,
    orgId: env.SERUM_EVAL_ORG_ID?.trim() || env.EVAL_ORG_ID?.trim() || null,
    environment: parseEnvironment(env.SERUM_EVAL_ENVIRONMENT ?? env.SERUM_CONFIG_ENVIRONMENT),
    configKey: env.SERUM_EVALS_CONFIG_KEY?.trim() || SERUM_RUNTIME_CONFIG_KEYS.evalsQualityGates,
    suite: env.SERUM_EVAL_SUITE?.trim() || DEFAULT_EVAL_SUITE,
    operation: env.SERUM_EVAL_OPERATION?.trim() || DEFAULT_EVAL_OPERATION,
  };
}

function assertOrgId(context: SerumEvalGateContext): string {
  if (!context.orgId) {
    throw new Error(
      'SERUM eval runtime policy is required, but SERUM_EVAL_ORG_ID or EVAL_ORG_ID is not set.',
    );
  }
  return context.orgId;
}

function throwIfDenied(stage: string, decision: SerumRuntimeDecisionDto): void {
  if (decision.allowed) return;
  throw new Error(`SERUM eval ${stage} denied (${decision.status}): ${decision.reason}`);
}

export async function preflightSerumEvalGate(
  context: SerumEvalGateContext,
): Promise<SerumEvalGateResult> {
  if (!context.required) return { skipped: true, decision: null };

  const decision = await checkSerumEvalsQualityGateRuntimePolicy({
    orgId: assertOrgId(context),
    environment: context.environment,
    configKey: context.configKey,
    operation: context.operation,
    suite: context.suite,
    passRate: 1,
    failedCount: 0,
  });
  throwIfDenied('preflight', decision);
  return { skipped: false, decision };
}

export async function enforceSerumEvalGate(
  context: SerumEvalGateContext,
  result: { passRate: number; failedCount: number },
): Promise<SerumEvalGateResult> {
  if (!context.required) return { skipped: true, decision: null };

  const decision = await checkSerumEvalsQualityGateRuntimePolicy({
    orgId: assertOrgId(context),
    environment: context.environment,
    configKey: context.configKey,
    operation: context.operation,
    suite: context.suite,
    passRate: result.passRate,
    failedCount: result.failedCount,
  });
  throwIfDenied('result', decision);
  return { skipped: false, decision };
}
