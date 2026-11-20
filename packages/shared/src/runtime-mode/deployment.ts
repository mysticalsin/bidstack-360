import { refuse } from './guards.js';
import type { DeploymentEnv, Refusal, RuntimeEnv } from './types.js';

export type DeploymentDecision =
  | { ok: true; deployment: DeploymentEnv; explicitPreview: boolean }
  | Refusal;

const EXPLICIT: Record<string, DeploymentEnv> = {
  local: 'local',
  preview: 'preview',
  production: 'production',
};

function rawDeployment(env: RuntimeEnv): string | undefined {
  const raw = env.POLO_DEPLOYMENT_ENV;
  if (raw === undefined || raw === '') return undefined;
  return raw;
}

/** Preview is this exact value and nothing else. Near-misses are not preview. */
export function enterPreview(env: RuntimeEnv): { ok: true; deployment: 'preview'; explicitPreview: true } | Refusal {
  if (env.POLO_DEPLOYMENT_ENV === 'preview') {
    return { ok: true, deployment: 'preview', explicitPreview: true };
  }
  return refuse(['preview-without-explicit-env']);
}

export function resolveDeployment(env: RuntimeEnv, claimPreview = false): DeploymentDecision {
  const raw = rawDeployment(env);
  if (raw === 'preview') {
    return { ok: true, deployment: 'preview', explicitPreview: true };
  }
  if (claimPreview || (raw !== undefined && !(raw in EXPLICIT))) {
    return refuse(['preview-without-explicit-env']);
  }
  if (raw === 'local' || raw === 'production') {
    return { ok: true, deployment: EXPLICIT[raw] ?? 'production', explicitPreview: false };
  }
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    return { ok: true, deployment: 'local', explicitPreview: false };
  }
  if (env.NODE_ENV === 'production') {
    return { ok: true, deployment: 'production', explicitPreview: false };
  }
  return refuse(['unknown-deployment']);
}
