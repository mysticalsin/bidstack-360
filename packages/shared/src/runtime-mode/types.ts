/**
 * Named states for Polo's runtime mode.
 *
 * Data mode and auth mode are separate from the public passwordless door.
 * Deployment is local, preview, or production. Preview is never inferred.
 */

export const DATA_MODES = ['real', 'demo'] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const AUTH_MODES = ['stub', 'cf-access', 'clerk'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const DEPLOYMENT_ENVS = ['local', 'preview', 'production'] as const;
export type DeploymentEnv = (typeof DEPLOYMENT_ENVS)[number];

/**
 * Who may see and change the Demo data control.
 * Members are not in this list. Tony can change the audience later in this one place.
 */
export const DEMO_DATA_TOGGLE_AUDIENCE = ['owner', 'admin'] as const;
export type DemoDataAudience = (typeof DEMO_DATA_TOGGLE_AUDIENCE)[number];
export type ToggleActor = DemoDataAudience | 'member' | 'api-key';

export const NOT_CONNECTED = 'Not connected';
export const STUB_LOGIN_BANNER = 'Test login: not a real account';

export const PROVIDER_IDS = [
  'apollo',
  'seamless',
  'sec-edgar',
  'esef',
  'fx',
  'dust',
  'merx',
  'external-crm',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const RUNTIME_TRANSITIONS = [
  'resolve-process-data',
  'enter-preview',
  'resolve-deployment',
  'resolve-auth',
  'admit-stub',
  'boot',
  'apply-org-override',
  'toggle-demo-data',
  'hide-sample-rows',
  'connect-provider',
] as const;
export type TransitionName = (typeof RUNTIME_TRANSITIONS)[number];

export const GUARD_NAMES = [
  'stub-with-real-data',
  'stub-in-production',
  'preview-without-explicit-env',
  'real-without-auth',
  'demo-door-with-real-data',
  'demo-door-with-clerk',
  'demo-door-with-cf-access',
  'clerk-with-cf-access',
  'member-toggle',
  'api-key-toggle',
  'provider-not-approved',
  'unknown-deployment',
  'local-claim-in-production',
  'demo-door-without-ack',
] as const;
export type GuardName = (typeof GUARD_NAMES)[number];

/** Process environment the resolver reads. Only the exact strings below are meaningful. */
export type RuntimeEnv = {
  POLO_DATA_MODE?: string;
  POLO_DEPLOYMENT_ENV?: string;
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
  CF_ACCESS_AUTH?: string;
  DEMO_MODE?: string;
} & Record<string, string | undefined>;

export type SampleRow = {
  id: string;
  sample?: boolean;
  source?: string | null;
};

export type RuntimeMode = {
  processData: DataMode;
  /** What this caller may show. Real when the org flag is off or absent. */
  effectiveData: DataMode;
  /** Null when the public passwordless door is the sign-in. That door is not an auth mode. */
  auth: AuthMode | null;
  deployment: DeploymentEnv;
  publicDemoDoor: boolean;
  /** Set only while stub auth itself is the sign-in. */
  stubBanner: string | null;
};

export type Refusal = {
  ok: false;
  guard: GuardName;
  guards: readonly GuardName[];
  error: string;
  stored?: readonly SampleRow[];
  visible?: readonly SampleRow[];
  deleted?: false;
  status?: typeof NOT_CONNECTED;
  enablePath?: false;
  providerId?: ProviderId;
};

export function actorMayToggle(actor: ToggleActor): boolean {
  return (DEMO_DATA_TOGGLE_AUDIENCE as readonly string[]).includes(actor);
}
