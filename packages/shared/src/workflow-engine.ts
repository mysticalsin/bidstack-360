// Workflow engine — the single source of truth for executing a workflow's
// actions. PURE and I/O-free: every side effect (DB write, notification,
// webhook enqueue) is injected via the `WorkflowEffects` interface so the SAME
// branching/allow-list/SSRF logic runs in BOTH apps:
//   - apps/api  — the manual `POST /workflows/:id/run` route (synchronous)
//   - apps/worker — the trigger-dispatch + schedule consumers (async)
//
// WHY injected effects instead of a shared file: the monorepo's tsconfig
// `rootDir` walls forbid apps/api and apps/worker importing each other's src,
// and @bidstack/shared must stay free of a runtime prisma/bullmq dependency.
// Keeping the *decisions* here (allow-list, SSRF gate, condition matching) and
// injecting the *I/O* gives one tested code path without crossing those walls.

import { z } from 'zod';

import { isPublicHostname } from './utils/webhook-url.js';
import type { WorkflowActionKind, WorkflowTriggerKind } from './schemas/workflow.js';

/**
 * The triggering context an action can act on. For a manual run this is just
 * `{ orgId, input }`; for a trigger-dispatched run it also carries the record
 * that fired the event so `assign_owner` / `update_field` know what to mutate.
 */
export interface WorkflowExecutionContext {
  orgId: string;
  triggerRecordType?: string | null;
  triggerRecordId?: string | null;
  /** Free-form input (manual run body, or the event `changes` payload). */
  input: Record<string, unknown>;
}

/**
 * Record types whose owner / fields a workflow may mutate. Kept narrow on
 * purpose — only the entities a presales workflow legitimately drives.
 */
export type WorkflowRecordType = 'opportunity' | 'lead' | 'task';

/**
 * Per-record-type allow-list of fields `update_field` may set. Anything not
 * listed is rejected with a per-step error (never written). WHY an allow-list:
 * `update_field` config is user-authored — without this an action could set
 * `orgId`, `id`, or any column and break tenancy / integrity invariants.
 */
export const UPDATE_FIELD_ALLOWLIST: Record<WorkflowRecordType, readonly string[]> = {
  // 'stage' is deliberately EXCLUDED: writing the stage enum alone desyncs it
  // from pipelineStageId, skips the audit row, the optimistic-concurrency guard,
  // and the downstream stage_changed dispatch — all of which only the dedicated
  // POST /opportunities/:id/stage route performs. Stage moves must go through it.
  opportunity: ['probability', 'industry', 'country'],
  lead: ['status', 'priority', 'source'],
  task: ['status', 'title'],
} as const;

/** A single injected side effect's input shapes. */
export interface CreateTaskEffectInput {
  orgId: string;
  title: string;
  oppId?: string;
  assigneeId?: string;
}

export interface CreateNotificationEffectInput {
  orgId: string;
  userId: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface EnqueueWebhookEffectInput {
  orgId: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface UpdateOwnerEffectInput {
  orgId: string;
  recordType: WorkflowRecordType;
  recordId: string;
  ownerId: string;
}

export interface UpdateFieldEffectInput {
  orgId: string;
  recordType: WorkflowRecordType;
  recordId: string;
  field: string;
  value: unknown;
}

/**
 * The I/O seam. Each app supplies an implementation backed by its own prisma
 * client / queue / notification service. Every method is org-scoped by contract
 * — implementations MUST filter on `input.orgId`.
 */
export interface WorkflowEffects {
  /** Returns true iff a user with this id exists in the org (cross-org guard). */
  userBelongsToOrg(orgId: string, userId: string): Promise<boolean>;
  /** Returns true iff a non-deleted opportunity with this id exists in the org. */
  oppBelongsToOrg(orgId: string, oppId: string): Promise<boolean>;
  createTask(input: CreateTaskEffectInput): Promise<{ taskId: string }>;
  createNotification(input: CreateNotificationEffectInput): Promise<void>;
  enqueueWebhook(input: EnqueueWebhookEffectInput): Promise<void>;
  /** Org-scoped owner update. Returns the number of rows updated (0 = not found). */
  updateRecordOwner(input: UpdateOwnerEffectInput): Promise<number>;
  /** Org-scoped single-field update. Returns rows updated (0 = not found). */
  updateRecordField(input: UpdateFieldEffectInput): Promise<number>;
}

/** Result of one action: a JSON-serializable record merged into run output. */
export type ActionResult = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Resolve the record this action should act on. Prefers explicit config
 * (recordType/recordId) and falls back to the trigger context. Returns null
 * with a reason if neither yields a usable, allow-listed record type.
 */
function resolveTargetRecord(
  config: Record<string, unknown>,
  ctx: WorkflowExecutionContext,
): { recordType: WorkflowRecordType; recordId: string } | { error: string } {
  const rawType = asString(config.recordType) ?? asString(ctx.triggerRecordType) ?? undefined;
  const recordId = asString(config.recordId) ?? asString(ctx.triggerRecordId) ?? undefined;
  if (!rawType || !recordId) {
    return { error: 'No target record (need a trigger record or recordType+recordId in config)' };
  }
  if (!(rawType in UPDATE_FIELD_ALLOWLIST)) {
    return { error: `Unsupported record type: ${rawType}` };
  }
  return { recordType: rawType as WorkflowRecordType, recordId };
}

/**
 * Execute one workflow action through the injected effects. Returns a result
 * object on success; for *resolvable-input* problems (missing recipient, unknown
 * field, blocked URL) it returns `{ error }` WITHOUT throwing so the per-step
 * loop can record it. It throws only on genuine I/O failures (effect rejected),
 * matching the route's "one failing step stops the run as failed" semantics.
 */
export async function executeWorkflowAction(
  kind: WorkflowActionKind,
  config: Record<string, unknown>,
  ctx: WorkflowExecutionContext,
  effects: WorkflowEffects,
): Promise<ActionResult> {
  switch (kind) {
    case 'create_task': {
      const title = asString(config.title) ?? 'Workflow task';
      const assigneeId = asString(config.assigneeId);
      if (assigneeId && !(await effects.userBelongsToOrg(ctx.orgId, assigneeId))) {
        return { error: `Assignee ${assigneeId} does not belong to this organization` };
      }
      // A user-authored `config.oppId` is untrusted — verify it belongs to the
      // caller's org before linking a task to it (otherwise org A could attach a
      // task to org B's opportunity). The trigger-record fallback is already
      // org-scoped by the dispatch loader, so only the config path needs the gate.
      const configOppId = asString(config.oppId);
      if (configOppId && !(await effects.oppBelongsToOrg(ctx.orgId, configOppId))) {
        return { taskId: null, error: 'Opportunity not found in this organization' };
      }
      const oppId = configOppId ?? asString(ctx.triggerRecordId);
      const { taskId } = await effects.createTask({
        orgId: ctx.orgId,
        title,
        ...(oppId && (configOppId || ctx.triggerRecordType === 'opportunity') ? { oppId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      });
      return { taskId, title };
    }

    case 'create_notification': {
      // Recipient may come from config (explicit) or the trigger record's owner
      // passed through input. If none is resolvable, record a per-step error.
      const userId = asString(config.userId) ?? asString(ctx.input.ownerId);
      if (!userId) {
        return { notified: false, error: 'No recipient resolvable for notification' };
      }
      if (!(await effects.userBelongsToOrg(ctx.orgId, userId))) {
        return { notified: false, error: `Recipient ${userId} does not belong to this organization` };
      }
      await effects.createNotification({
        orgId: ctx.orgId,
        userId,
        title: asString(config.title) ?? asString(config.message) ?? 'Workflow notification',
        body: asString(config.body) ?? asString(config.message) ?? null,
        entityType: ctx.triggerRecordType ?? null,
        entityId: ctx.triggerRecordId ?? null,
      });
      return { notified: true, userId };
    }

    case 'call_webhook': {
      const rawUrl = asString(config.url);
      if (!rawUrl) return { fired: false, error: 'Missing URL' };
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return { fired: false, error: 'Invalid URL' };
      }
      // SSRF + HTTPS guard (unchanged from the route). NOTE: `config.url` is only
      // payload metadata here — actual delivery goes to the org's *registered*
      // webhook subscriptions, which the delivery worker re-guards with a
      // DNS-rebind-safe fetch. This check is therefore defense-in-depth (keeps a
      // blocked-host URL out of the enqueued payload); do not remove it.
      if (url.protocol !== 'https:') return { fired: false, error: 'URL must use HTTPS' };
      if (!isPublicHostname(url.hostname)) {
        return { fired: false, error: 'Private/internal URLs are not allowed' };
      }
      await effects.enqueueWebhook({
        orgId: ctx.orgId,
        event: asString(config.event) ?? 'workflow.call_webhook',
        payload: {
          url: rawUrl,
          triggerRecordType: ctx.triggerRecordType ?? null,
          triggerRecordId: ctx.triggerRecordId ?? null,
          ...(config.payload && typeof config.payload === 'object'
            ? (config.payload as Record<string, unknown>)
            : {}),
        },
      });
      return { fired: true, url: rawUrl, enqueued: true };
    }

    case 'assign_owner': {
      const target = resolveTargetRecord(config, ctx);
      if ('error' in target) return { assigned: false, error: target.error };
      const ownerId = asString(config.ownerId) ?? asString(config.assigneeId);
      if (!ownerId) return { assigned: false, error: 'Missing ownerId' };
      if (!(await effects.userBelongsToOrg(ctx.orgId, ownerId))) {
        return { assigned: false, error: `Owner ${ownerId} does not belong to this organization` };
      }
      if (target.recordType !== 'opportunity') {
        // Only opportunities have an owner column today; surface clearly.
        return { assigned: false, error: `assign_owner is only supported for opportunity records` };
      }
      const count = await effects.updateRecordOwner({
        orgId: ctx.orgId,
        recordType: target.recordType,
        recordId: target.recordId,
        ownerId,
      });
      return count > 0
        ? { assigned: true, recordId: target.recordId, ownerId }
        : { assigned: false, error: 'Target record not found in this organization' };
    }

    case 'update_field': {
      const target = resolveTargetRecord(config, ctx);
      if ('error' in target) return { updated: false, error: target.error };
      const field = asString(config.field);
      if (!field) return { updated: false, error: 'Missing field' };
      const allowed = UPDATE_FIELD_ALLOWLIST[target.recordType];
      if (!allowed.includes(field)) {
        return {
          updated: false,
          error: `Field "${field}" is not settable on ${target.recordType}`,
        };
      }
      const count = await effects.updateRecordField({
        orgId: ctx.orgId,
        recordType: target.recordType,
        recordId: target.recordId,
        field,
        value: config.value,
      });
      return count > 0
        ? { updated: true, recordId: target.recordId, field }
        : { updated: false, error: 'Target record not found in this organization' };
    }

    // send_email / send_slack / run_dust_agent are NOT wired by the engine.
    // They are hidden in the UI (NewWorkflowDialog) so no dead automation can be
    // created. If one is reached anyway (legacy row), record a clear no-op error
    // instead of silently claiming success.
    default:
      return { kind, executed: false, error: `Action "${kind}" is not implemented` };
  }
}

/**
 * Run every action of a workflow in `sortOrder`. Mirrors the manual route's
 * loop semantics exactly: results are keyed by `step_<n>_<kind>`; the FIRST
 * action that throws (a real I/O failure) stops the run and marks it failed.
 * Per-step `{ error }` results (resolvable-input problems) do NOT stop the run.
 */
export async function runWorkflowActions(
  actions: ReadonlyArray<{ kind: WorkflowActionKind; config: Record<string, unknown> }>,
  ctx: WorkflowExecutionContext,
  effects: WorkflowEffects,
): Promise<{ outputs: Record<string, unknown>; error: string | null }> {
  const outputs: Record<string, unknown> = {};
  let error: string | null = null;
  let step = 0;
  for (const action of actions) {
    try {
      const out = await executeWorkflowAction(action.kind, action.config, ctx, effects);
      outputs[`step_${step + 1}_${action.kind}`] = out;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
    step += 1;
  }
  return { outputs, error };
}

// ─── Trigger condition matching ────────────────────────────────────────────

/** A dispatched trigger event. `changes` carries event-specific fields. */
export interface WorkflowTriggerEvent {
  orgId: string;
  triggerKind: WorkflowTriggerKind;
  recordType: string;
  recordId: string;
  changes: Record<string, unknown>;
}

/** The minimal workflow shape the matcher needs. */
export interface MatchableWorkflow {
  orgId: string;
  active: boolean;
  triggerKind: string;
  triggerConfig: Record<string, unknown>;
}

/**
 * Decide whether a workflow should fire for an event. Org isolation is the
 * first gate (defence in depth — the loader already scopes by org). Then:
 *   - triggerKind must equal the event's kind
 *   - if `triggerConfig.recordType` is set, it must equal the event recordType
 *   - for stage_changed, an optional `triggerConfig.stage` (or `targetStage`)
 *     must equal the event's `changes.stage` when present.
 */
export function workflowMatchesEvent(
  workflow: MatchableWorkflow,
  event: WorkflowTriggerEvent,
): boolean {
  if (workflow.orgId !== event.orgId) return false;
  if (!workflow.active) return false;
  if (workflow.triggerKind !== event.triggerKind) return false;

  const wantedType = asString(workflow.triggerConfig.recordType);
  if (wantedType && wantedType !== event.recordType) return false;

  if (event.triggerKind === 'stage_changed') {
    const wantedStage =
      asString(workflow.triggerConfig.stage) ?? asString(workflow.triggerConfig.targetStage);
    if (wantedStage) {
      const eventStage = asString(event.changes.stage);
      if (eventStage !== wantedStage) return false;
    }
  }
  return true;
}

/** Zod schema for the dispatch job payload (shared producer ↔ consumer). */
export const WorkflowDispatchJob = z.object({
  orgId: z.string().uuid(),
  triggerKind: z.enum(['record_created', 'stage_changed']),
  recordType: z.string(),
  recordId: z.string(),
  changes: z.record(z.unknown()).default({}),
});
export type WorkflowDispatchJob = z.infer<typeof WorkflowDispatchJob>;
