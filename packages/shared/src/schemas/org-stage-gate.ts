// Per-org override of the Amaris stage-gate enforcement mode.
//
// `null` is not "off" — it means "inherit the STAGE_GATE_MODE env default", so
// an org that never opted in follows the deployment's policy and an org that
// explicitly chose 'off' keeps that choice through an env change.
import { z } from 'zod';

export const StageGateMode = z.enum(['off', 'warn', 'enforce']);
export type StageGateMode = z.infer<typeof StageGateMode>;

export const STAGE_GATE_MODES: readonly StageGateMode[] = ['off', 'warn', 'enforce'];

export const OrgStageGateSettings = z.object({
  mode: StageGateMode.nullable(),
});
export type OrgStageGateSettings = z.infer<typeof OrgStageGateSettings>;
