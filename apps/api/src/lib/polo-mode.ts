/**
 * API adapter over the shared runtime-mode machine.
 * Callers decide a mode only through that machine.
 */
import {
  boot,
  isPublicDemoDoor,
  resolveProcessData,
  type RuntimeEnv,
  type RuntimeMode,
} from '@bidstack/shared';

export type PoloDataMode = 'demo' | 'real';
export type PoloAuthProvider = 'stub' | 'clerk' | 'demo' | 'cf-access';

function asRuntimeEnv(env: NodeJS.ProcessEnv): RuntimeEnv {
  return env as RuntimeEnv;
}

export function getPoloDataMode(env: NodeJS.ProcessEnv = process.env): PoloDataMode {
  return resolveProcessData(asRuntimeEnv(env));
}

export function isRealDataMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getPoloDataMode(env) === 'real';
}

export function isCfAccessAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const result = boot(asRuntimeEnv(env));
  return result.ok && result.mode.auth === 'cf-access';
}

export function isDemoAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isPublicDemoDoor(asRuntimeEnv(env));
}

export function bootFromProcess(env: NodeJS.ProcessEnv = process.env) {
  return boot(asRuntimeEnv(env));
}

export function resolvePoloAuthProvider(env: NodeJS.ProcessEnv = process.env): PoloAuthProvider {
  const result = bootFromProcess(env);
  if (!result.ok) throw new Error(result.error);
  if (result.mode.publicDemoDoor) return 'demo';
  if (result.mode.auth) return result.mode.auth;
  throw new Error('Runtime mode resolved without an auth provider.');
}

export function realOrgClerkId(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.POLO_REAL_ORG_CLERK?.trim();
  return value && value.length > 0 ? value : 'org_polo_real';
}

/** Boot-time rules. The thrown error is the machine's named guard. */
export function assertPoloAuthBoot(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const result = bootFromProcess(env);
  if (!result.ok) throw new Error(result.error);
  return result.mode;
}
