export {
  AUTH_MODES,
  DATA_MODES,
  DEMO_DATA_TOGGLE_AUDIENCE,
  DEPLOYMENT_ENVS,
  GUARD_NAMES,
  NOT_CONNECTED,
  PROVIDER_IDS,
  RUNTIME_TRANSITIONS,
  STUB_LOGIN_BANNER,
  actorMayToggle,
} from './types.js';
export type {
  AuthMode,
  DataMode,
  DemoDataAudience,
  DeploymentEnv,
  GuardName,
  ProviderId,
  Refusal,
  RuntimeEnv,
  RuntimeMode,
  SampleRow,
  ToggleActor,
  TransitionName,
} from './types.js';

export { boot, admitStub } from './boot.js';
export { isPublicDemoDoor } from './boot.js';
export { enterPreview, resolveDeployment } from './deployment.js';
export { resolveProcessData } from './process-data.js';
export { applyOrgOverride, toggleDemoData } from './org-data.js';
export { connectProvider, providerApprovalFromEnv } from './providers.js';
export { isSampleOrFixture, visibleRows } from './rows.js';
export { guardContainerEnv } from './container.js';
export { transition } from './transition.js';

import { boot } from './boot.js';
import { applyOrgOverride } from './org-data.js';
import type { RuntimeEnv, RuntimeMode } from './types.js';
import type { Refusal } from './types.js';

/** The one resolver. orgDemoData is absent at boot and on the public identity call. */
export function resolveRuntimeMode(
  env: RuntimeEnv,
  orgDemoData?: boolean | null,
): { ok: true; mode: RuntimeMode } | Refusal {
  const booted = boot(env);
  if (!booted.ok) return booted;
  const applied = applyOrgOverride(booted.mode.processData, orgDemoData ?? null);
  return { ok: true, mode: { ...booted.mode, effectiveData: applied.effectiveData } };
}
