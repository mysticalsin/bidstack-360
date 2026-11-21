import { resolveDeployment, type DeploymentDecision } from './deployment.js';
import { refuse } from './guards.js';
import { resolveProcessData } from './process-data.js';
import { STUB_LOGIN_BANNER, type AuthMode, type DataMode, type GuardName, type Refusal, type RuntimeEnv, type RuntimeMode } from './types.js';

export type BootDecision = { ok: true; mode: RuntimeMode } | Refusal;

function clerkConfigured(env: RuntimeEnv): boolean {
  return typeof env.CLERK_SECRET_KEY === 'string' && env.CLERK_SECRET_KEY.trim().length > 0;
}

function accessConfigured(env: RuntimeEnv): boolean {
  return env.CF_ACCESS_AUTH === 'true';
}

export function isPublicDemoDoor(env: RuntimeEnv): boolean {
  return env.DEMO_MODE === 'true';
}

function mode(
  processData: DataMode,
  auth: AuthMode | null,
  deployment: DeploymentDecision & { ok: true },
  publicDemoDoor: boolean,
): BootDecision {
  return {
    ok: true,
    mode: {
      processData,
      effectiveData: 'real',
      auth,
      deployment: deployment.deployment,
      publicDemoDoor,
      stubBanner: auth === 'stub' ? STUB_LOGIN_BANNER : null,
    },
  };
}

/**
 * Boot, evaluated once.
 * Real data needs Clerk or Cloudflare Access.
 * Stub is local+demo, or explicit preview+demo. It is never real and never production.
 */
export function boot(env: RuntimeEnv): BootDecision {
  const processData = resolveProcessData(env);
  const deployment = resolveDeployment(env);
  const clerk = clerkConfigured(env);
  const access = accessConfigured(env);
  const door = isPublicDemoDoor(env);
  const guards: GuardName[] = [];

  if (!deployment.ok) guards.push(...deployment.guards);
  if (clerk && access) guards.push('clerk-with-cf-access');
  if (door && processData === 'real') guards.push('demo-door-with-real-data');
  if (door && clerk) guards.push('demo-door-with-clerk');
  if (door && access) guards.push('demo-door-with-cf-access');
  if (
    door &&
    deployment.ok &&
    deployment.deployment === 'production' &&
    env.DEMO_PUBLIC_DEPLOYMENT_ACK !== 'true'
  ) {
    guards.push('demo-door-without-ack');
  }

  const configured = clerk || access;
  if (processData === 'real' && !configured && !door) {
    guards.push('real-without-auth');
  }

  const stubCandidate = !clerk && !access && !door;
  if (stubCandidate && processData === 'real') guards.push('stub-with-real-data');
  if (stubCandidate && deployment.ok && deployment.deployment === 'production') {
    guards.push('stub-in-production');
  }

  if (guards.length > 0) {
    const primary = orderGuards(guards, deployment.ok ? deployment.deployment : null, processData);
    return refuse(primary);
  }

  if (!deployment.ok) return deployment;

  if (door) return mode(processData, null, deployment, true);
  if (clerk) return mode(processData, 'clerk', deployment, false);
  if (access) return mode(processData, 'cf-access', deployment, false);
  return mode(processData, 'stub', deployment, false);
}

function orderGuards(guards: GuardName[], deployment: 'local' | 'preview' | 'production' | null, processData: DataMode): GuardName[] {
  const present = new Set(guards);
  const ordered: GuardName[] = [];
  const prefer: GuardName[] = [];
  if (deployment === 'production' && processData === 'real' && present.has('real-without-auth')) {
    prefer.push('real-without-auth');
  } else if (present.has('stub-with-real-data')) {
    prefer.push('stub-with-real-data');
  } else if (present.has('stub-in-production')) {
    prefer.push('stub-in-production');
  }
  for (const guard of [...prefer, ...guards]) {
    if (present.has(guard) && !ordered.includes(guard)) ordered.push(guard);
  }
  return ordered;
}

export function admitStub(input: {
  deployment: 'local' | 'preview' | 'production';
  explicitPreview: boolean;
  processData: DataMode;
}): { ok: true; auth: 'stub' } | Refusal {
  const guards: GuardName[] = [];
  if (input.processData === 'real') guards.push('stub-with-real-data', 'real-without-auth');
  if (input.deployment === 'production') guards.push('stub-in-production');
  if (input.deployment === 'preview' && !input.explicitPreview) guards.push('preview-without-explicit-env');
  if (guards.length > 0) return refuse(orderGuards(guards, input.deployment, input.processData));
  return { ok: true, auth: 'stub' };
}
