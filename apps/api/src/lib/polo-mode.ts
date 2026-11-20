/**
 * API adapter over the shared runtime-mode machine.
 * Callers decide a mode only through that machine.
 */
import {
  boot,
  isPublicDemoDoor,
  resolveProcessData,
  resolveRuntimeMode,
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

export function resolvePoloAuthProvider(env: NodeJS.ProcessEnv = process.env): PoloAuthProvider {
  const result = resolveRuntimeMode(asRuntimeEnv(env));
  if (result.ok && result.mode.publicDemoDoor) return 'demo';
  if (result.ok && result.mode.auth) return result.mode.auth;
  return 'stub';
}

export function realOrgClerkId(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.POLO_REAL_ORG_CLERK?.trim();
  return value && value.length > 0 ? value : 'org_polo_real';
}

/** Boot-time rules. The thrown error is the machine's named guard. */
export function assertPoloAuthBoot(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const result = boot(asRuntimeEnv(env));
  if (!result.ok) throw new Error(result.error);
  return result.mode;
}
