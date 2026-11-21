import { refuse } from './guards.js';
import { visibleRows } from './rows.js';
import { actorMayToggle, type DataMode, type Refusal, type SampleRow, type ToggleActor } from './types.js';

export function applyOrgOverride(processData: DataMode, orgDemoData: boolean | null): {
  ok: true;
  processData: DataMode;
  effectiveData: DataMode;
} {
  const effectiveData: DataMode = processData === 'demo' && orgDemoData === true ? 'demo' : 'real';
  return { ok: true, processData, effectiveData };
}

export type ToggleDecision =
  | {
      ok: true;
      orgDemoData: boolean;
      processData: DataMode;
      effectiveData: DataMode;
      stored: readonly SampleRow[];
      visible: readonly SampleRow[];
      deleted: false;
    }
  | (Refusal & { stored: readonly SampleRow[]; visible: readonly SampleRow[]; deleted: false });

export function toggleDemoData(input: {
  actor: ToggleActor;
  orgDemoData: boolean;
  next: boolean;
  processData?: DataMode;
  rows: readonly SampleRow[];
}): ToggleDecision {
  const processData = input.processData ?? 'real';
  const stored = input.rows.slice();
  if (!actorMayToggle(input.actor)) {
    const guard = input.actor === 'api-key' ? 'api-key-toggle' : 'member-toggle';
    return refuse([guard], { stored, visible: [], deleted: false }) as ToggleDecision;
  }
  const applied = applyOrgOverride(processData, input.next);
  const view = visibleRows(applied.effectiveData, stored);
  return {
    ok: true,
    orgDemoData: input.next,
    processData,
    effectiveData: applied.effectiveData,
    stored: view.stored,
    visible: view.visible,
    deleted: false,
  };
}
