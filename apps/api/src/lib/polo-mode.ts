/**
 * Polo data-mode and auth-provider resolution.
 *
 * Default is demo so `main` stays a fixture-friendly preview. Real mode is an
 * explicit operator opt-in (`POLO_DATA_MODE=real`) and refuses the shared stub
 * Jane Smith session.
 */

export type PoloDataMode = 'demo' | 'real';
export type PoloAuthProvider = 'stub' | 'clerk' | 'demo' | 'cf-access';

export function getPoloDataMode(env: NodeJS.ProcessEnv = process.env): PoloDataMode {
  return env.POLO_DATA_MODE === 'real' ? 'real' : 'demo';
}

export function isRealDataMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getPoloDataMode(env) === 'real';
}

export function isCfAccessAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CF_ACCESS_AUTH === 'true';
}

export function isDemoAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

export function resolvePoloAuthProvider(env: NodeJS.ProcessEnv = process.env): PoloAuthProvider {
  if (env.CLERK_SECRET_KEY) return 'clerk';
  if (isCfAccessAuthEnabled(env)) return 'cf-access';
  if (isDemoAuthEnabled(env)) return 'demo';
  return 'stub';
}

export function realOrgClerkId(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.POLO_REAL_ORG_CLERK?.trim();
  return value && value.length > 0 ? value : 'org_polo_real';
}

/**
 * Boot-time rules that sit next to env.ts semantic checks. Thrown errors are
 * the operator-facing contract: real data cannot share a stub session.
 */
export function assertPoloAuthBoot(env: NodeJS.ProcessEnv = process.env): void {
  const dataMode = getPoloDataMode(env);
  const hasClerk = Boolean(env.CLERK_SECRET_KEY);
  const cfAccess = isCfAccessAuthEnabled(env);
  const demo = isDemoAuthEnabled(env);
  const nodeEnv = env.NODE_ENV;
  const allowStub = nodeEnv === 'development' || nodeEnv === 'test';

  if (demo && hasClerk) {
    throw new Error('DEMO_MODE cannot run with CLERK_SECRET_KEY set');
  }
  if (demo && cfAccess) {
    throw new Error('DEMO_MODE cannot run with CF_ACCESS_AUTH=true');
  }
  if (cfAccess && hasClerk) {
    throw new Error('CF_ACCESS_AUTH cannot run with CLERK_SECRET_KEY set');
  }
  if (dataMode === 'real' && demo) {
    throw new Error('POLO_DATA_MODE=real cannot run with DEMO_MODE=true');
  }
  if (dataMode === 'real' && !hasClerk && !cfAccess) {
    throw new Error(
      'POLO_DATA_MODE=real requires CLERK_SECRET_KEY or CF_ACCESS_AUTH=true (stub/shared Jane Smith is disabled)',
    );
  }
  if (!hasClerk && !cfAccess && !demo && !allowStub) {
    throw new Error('CLERK_SECRET_KEY required in production');
  }
}
