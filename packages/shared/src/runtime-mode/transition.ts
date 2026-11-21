import { admitStub, boot } from './boot.js';
import { enterPreview, resolveDeployment } from './deployment.js';
import { applyOrgOverride, toggleDemoData } from './org-data.js';
import { resolveProcessData } from './process-data.js';
import { connectProvider } from './providers.js';
import { visibleRows } from './rows.js';
import type { DataMode, ProviderId, RuntimeEnv, SampleRow, ToggleActor } from './types.js';

export type TransitionInput = {
  env?: RuntimeEnv;
  claimPreview?: boolean;
  deployment?: 'local' | 'preview' | 'production';
  explicitPreview?: boolean;
  processData?: DataMode;
  orgDemoData?: boolean | null;
  actor?: ToggleActor;
  next?: boolean;
  rows?: readonly SampleRow[];
  effectiveData?: DataMode;
  providerId?: ProviderId;
  approved?: boolean | string | null;
};

export function transition(name: 'resolve-process-data', input: TransitionInput): ReturnType<typeof resolveWrapped>;
export function transition(name: 'enter-preview', input: TransitionInput): ReturnType<typeof enterPreview>;
export function transition(name: 'resolve-deployment', input: TransitionInput): ReturnType<typeof resolveDeployment>;
export function transition(name: 'resolve-auth', input: TransitionInput): ReturnType<typeof boot>;
export function transition(name: 'admit-stub', input: TransitionInput): ReturnType<typeof admitStub>;
export function transition(name: 'boot', input: TransitionInput): ReturnType<typeof boot>;
export function transition(name: 'apply-org-override', input: TransitionInput): ReturnType<typeof applyOrgOverride>;
export function transition(name: 'toggle-demo-data', input: TransitionInput): ReturnType<typeof toggleDemoData>;
export function transition(name: 'hide-sample-rows', input: TransitionInput): ReturnType<typeof hideWrapped>;
export function transition(name: 'connect-provider', input: TransitionInput): ReturnType<typeof connectProvider>;
export function transition(name: string, input: TransitionInput): unknown {
  switch (name) {
    case 'resolve-process-data':
      return resolveWrapped(input.env ?? {});
    case 'enter-preview':
      return enterPreview(input.env ?? {});
    case 'resolve-deployment':
      return resolveDeployment(input.env ?? {}, input.claimPreview === true);
    case 'resolve-auth':
    case 'boot':
      return boot(input.env ?? {});
    case 'admit-stub':
      return admitStub({
        deployment: input.deployment ?? 'production',
        explicitPreview: input.explicitPreview === true,
        processData: input.processData ?? 'real',
      });
    case 'apply-org-override':
      return applyOrgOverride(input.processData ?? 'real', input.orgDemoData ?? null);
    case 'toggle-demo-data':
      return toggleDemoData({
        actor: input.actor ?? 'member',
        orgDemoData: input.orgDemoData === true,
        next: input.next === true,
        processData: input.processData,
        rows: input.rows ?? [],
      });
    case 'hide-sample-rows':
      return hideWrapped(input.effectiveData ?? 'real', input.rows ?? []);
    case 'connect-provider':
      return connectProvider(input.providerId ?? 'apollo', input.approved);
    default:
      throw new Error(`Unknown runtime-mode transition: ${name}`);
  }
}

function resolveWrapped(env: RuntimeEnv): { ok: true; processData: DataMode } {
  return { ok: true, processData: resolveProcessData(env) };
}

function hideWrapped(effectiveData: DataMode, rows: readonly SampleRow[]) {
  return { ok: true as const, ...visibleRows(effectiveData, rows) };
}
