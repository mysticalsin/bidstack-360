import { describe, expect, it, vi } from 'vitest';

import {
  executeWorkflowAction,
  runWorkflowActions,
  workflowMatchesEvent,
  type WorkflowEffects,
  type WorkflowExecutionContext,
  type WorkflowTriggerEvent,
} from './workflow-engine.js';

// A fully-spied effects double. Every method is a vi.fn so each test asserts the
// engine called the RIGHT effect with org-scoped, allow-listed arguments — the
// thing that actually matters for tenancy + correctness, not just a return code.
function makeEffects(overrides: Partial<WorkflowEffects> = {}): WorkflowEffects {
  return {
    userBelongsToOrg: vi.fn(async () => true),
    oppBelongsToOrg: vi.fn(async () => true),
    createTask: vi.fn(async () => ({ taskId: 'task-1' })),
    createNotification: vi.fn(async () => {}),
    enqueueWebhook: vi.fn(async () => {}),
    updateRecordOwner: vi.fn(async () => 1),
    updateRecordField: vi.fn(async () => 1),
    ...overrides,
  };
}

const baseCtx: WorkflowExecutionContext = { orgId: 'org-1', input: {} };

describe('executeWorkflowAction — create_task', () => {
  it('creates an org-scoped task and passes a validated assignee through', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction(
      'create_task',
      { title: 'Follow up', assigneeId: 'user-9' },
      baseCtx,
      effects,
    );
    expect(effects.userBelongsToOrg).toHaveBeenCalledWith('org-1', 'user-9');
    expect(effects.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', title: 'Follow up', assigneeId: 'user-9' }),
    );
    expect(out).toMatchObject({ taskId: 'task-1', title: 'Follow up' });
  });

  it('rejects a cross-org assignee WITHOUT creating the task (tenancy invariant)', async () => {
    const effects = makeEffects({ userBelongsToOrg: vi.fn(async () => false) });
    const out = await executeWorkflowAction(
      'create_task',
      { title: 'x', assigneeId: 'foreign-user' },
      baseCtx,
      effects,
    );
    expect(effects.createTask).not.toHaveBeenCalled();
    expect(out.error).toContain('does not belong');
  });

  it('rejects a foreign config.oppId WITHOUT creating the task (cross-tenant link guard)', async () => {
    // oppBelongsToOrg returns false → org A may not link a task to org B's opp.
    const effects = makeEffects({ oppBelongsToOrg: vi.fn(async () => false) });
    const out = await executeWorkflowAction(
      'create_task',
      { title: 'x', oppId: 'foreign-opp' },
      baseCtx,
      effects,
    );
    expect(effects.oppBelongsToOrg).toHaveBeenCalledWith('org-1', 'foreign-opp');
    expect(effects.createTask).not.toHaveBeenCalled();
    expect(out).toMatchObject({ taskId: null });
    expect(out.error).toContain('Opportunity not found');
  });

  it('creates a task for an in-org config.oppId (guard passes)', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction(
      'create_task',
      { title: 'Follow up', oppId: 'opp-in-org' },
      baseCtx,
      effects,
    );
    expect(effects.oppBelongsToOrg).toHaveBeenCalledWith('org-1', 'opp-in-org');
    expect(effects.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', title: 'Follow up', oppId: 'opp-in-org' }),
    );
    expect(out).toMatchObject({ taskId: 'task-1' });
  });
});

describe('executeWorkflowAction — create_notification', () => {
  it('calls the notification creator with the resolved recipient', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction(
      'create_notification',
      { userId: 'user-3', title: 'Heads up', message: 'A deal moved' },
      baseCtx,
      effects,
    );
    expect(effects.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', userId: 'user-3', title: 'Heads up' }),
    );
    expect(out).toMatchObject({ notified: true, userId: 'user-3' });
  });

  it('records a per-step error (does NOT throw) when no recipient is resolvable', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction('create_notification', {}, baseCtx, effects);
    expect(effects.createNotification).not.toHaveBeenCalled();
    expect(out).toMatchObject({ notified: false });
    expect(out.error).toContain('No recipient');
  });

  it('falls back to the trigger record owner from input.ownerId', async () => {
    const effects = makeEffects();
    const ctx: WorkflowExecutionContext = { orgId: 'org-1', input: { ownerId: 'owner-7' } };
    await executeWorkflowAction('create_notification', { title: 'hi' }, ctx, effects);
    expect(effects.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-7' }),
    );
  });
});

describe('executeWorkflowAction — call_webhook', () => {
  it('enqueues a webhook delivery for a safe https URL', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction(
      'call_webhook',
      { url: 'https://example.com/hook', event: 'deal.won' },
      baseCtx,
      effects,
    );
    expect(effects.enqueueWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', event: 'deal.won' }),
    );
    expect(out).toMatchObject({ fired: true, enqueued: true });
  });

  it('blocks non-https URLs WITHOUT enqueuing (SSRF/HTTPS guard preserved)', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction(
      'call_webhook',
      { url: 'http://example.com/hook' },
      baseCtx,
      effects,
    );
    expect(effects.enqueueWebhook).not.toHaveBeenCalled();
    expect(out.error).toContain('HTTPS');
  });

  it('blocks private/internal hosts WITHOUT enqueuing', async () => {
    const effects = makeEffects();
    const out = await executeWorkflowAction(
      'call_webhook',
      { url: 'https://127.0.0.1/hook' },
      baseCtx,
      effects,
    );
    expect(effects.enqueueWebhook).not.toHaveBeenCalled();
    expect(out.error).toContain('Private');
  });
});

describe('executeWorkflowAction — assign_owner', () => {
  it('issues an org-scoped owner update on the trigger opportunity', async () => {
    const effects = makeEffects();
    const ctx: WorkflowExecutionContext = {
      orgId: 'org-1',
      triggerRecordType: 'opportunity',
      triggerRecordId: 'opp-5',
      input: {},
    };
    const out = await executeWorkflowAction('assign_owner', { ownerId: 'user-2' }, ctx, effects);
    expect(effects.updateRecordOwner).toHaveBeenCalledWith({
      orgId: 'org-1',
      recordType: 'opportunity',
      recordId: 'opp-5',
      ownerId: 'user-2',
    });
    expect(out).toMatchObject({ assigned: true, ownerId: 'user-2' });
  });

  it('rejects a cross-org owner without updating', async () => {
    const effects = makeEffects({ userBelongsToOrg: vi.fn(async () => false) });
    const ctx: WorkflowExecutionContext = {
      orgId: 'org-1',
      triggerRecordType: 'opportunity',
      triggerRecordId: 'opp-5',
      input: {},
    };
    const out = await executeWorkflowAction('assign_owner', { ownerId: 'foreign' }, ctx, effects);
    expect(effects.updateRecordOwner).not.toHaveBeenCalled();
    expect(out.error).toContain('does not belong');
  });
});

describe('executeWorkflowAction — update_field', () => {
  it('updates an allow-listed field via an org-scoped update', async () => {
    const effects = makeEffects();
    const ctx: WorkflowExecutionContext = {
      orgId: 'org-1',
      triggerRecordType: 'opportunity',
      triggerRecordId: 'opp-5',
      input: {},
    };
    const out = await executeWorkflowAction(
      'update_field',
      { field: 'probability', value: 80 },
      ctx,
      effects,
    );
    expect(effects.updateRecordField).toHaveBeenCalledWith({
      orgId: 'org-1',
      recordType: 'opportunity',
      recordId: 'opp-5',
      field: 'probability',
      value: 80,
    });
    expect(out).toMatchObject({ updated: true, field: 'probability' });
  });

  it('rejects an unknown / non-allow-listed field WITHOUT updating', async () => {
    const effects = makeEffects();
    const ctx: WorkflowExecutionContext = {
      orgId: 'org-1',
      triggerRecordType: 'opportunity',
      triggerRecordId: 'opp-5',
      input: {},
    };
    const out = await executeWorkflowAction(
      'update_field',
      { field: 'orgId', value: 'other-org' },
      ctx,
      effects,
    );
    expect(effects.updateRecordField).not.toHaveBeenCalled();
    expect(out.error).toContain('not settable');
  });

  it('rejects update_field on opportunity.stage WITHOUT writing (data-integrity guard)', async () => {
    // 'stage' is intentionally OFF the allow-list: a raw stage write desyncs the
    // enum from pipelineStageId and skips the audit/concurrency/dispatch path
    // that POST /opportunities/:id/stage performs. This test fails if 'stage' is
    // ever re-added to UPDATE_FIELD_ALLOWLIST.opportunity.
    const effects = makeEffects();
    const ctx: WorkflowExecutionContext = {
      orgId: 'org-1',
      triggerRecordType: 'opportunity',
      triggerRecordId: 'opp-5',
      input: {},
    };
    const out = await executeWorkflowAction(
      'update_field',
      { field: 'stage', value: 'closed_won' },
      ctx,
      effects,
    );
    expect(effects.updateRecordField).not.toHaveBeenCalled();
    expect(out).toMatchObject({ updated: false });
    expect(out.error).toContain('not settable');
  });
});

describe('runWorkflowActions — loop semantics', () => {
  it('keys outputs by step and continues past per-step (non-throwing) errors', async () => {
    const effects = makeEffects();
    const { outputs, error } = await runWorkflowActions(
      [
        { kind: 'create_task', config: { title: 'a' } },
        { kind: 'create_notification', config: {} }, // resolvable-input error, not a throw
      ],
      baseCtx,
      effects,
    );
    expect(error).toBeNull();
    expect(outputs).toHaveProperty('step_1_create_task');
    expect(outputs).toHaveProperty('step_2_create_notification');
  });

  it('stops the run as failed when an effect THROWS (real I/O failure)', async () => {
    const effects = makeEffects({
      createTask: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const { outputs, error } = await runWorkflowActions(
      [
        { kind: 'create_task', config: { title: 'a' } },
        { kind: 'create_task', config: { title: 'b' } },
      ],
      baseCtx,
      effects,
    );
    expect(error).toBe('db down');
    // Second step never ran — the loop broke on the first throw.
    expect(outputs).not.toHaveProperty('step_2_create_task');
  });
});

describe('workflowMatchesEvent — trigger matching', () => {
  const stageEvent: WorkflowTriggerEvent = {
    orgId: 'org-1',
    triggerKind: 'stage_changed',
    recordType: 'opportunity',
    recordId: 'opp-1',
    changes: { stage: 'closed_won' },
  };

  it('matches a stage_changed workflow targeting that exact stage', () => {
    expect(
      workflowMatchesEvent(
        {
          orgId: 'org-1',
          active: true,
          triggerKind: 'stage_changed',
          triggerConfig: { recordType: 'opportunity', stage: 'closed_won' },
        },
        stageEvent,
      ),
    ).toBe(true);
  });

  it('does NOT match a workflow targeting a different stage', () => {
    expect(
      workflowMatchesEvent(
        {
          orgId: 'org-1',
          active: true,
          triggerKind: 'stage_changed',
          triggerConfig: { stage: 's4_negotiation' },
        },
        stageEvent,
      ),
    ).toBe(false);
  });

  it('matches when triggerConfig has no stage filter (fire on any stage change)', () => {
    expect(
      workflowMatchesEvent(
        { orgId: 'org-1', active: true, triggerKind: 'stage_changed', triggerConfig: {} },
        stageEvent,
      ),
    ).toBe(true);
  });

  it('never selects a workflow from another org (tenant isolation)', () => {
    expect(
      workflowMatchesEvent(
        { orgId: 'org-2', active: true, triggerKind: 'stage_changed', triggerConfig: {} },
        stageEvent,
      ),
    ).toBe(false);
  });

  it('does not match an inactive workflow or a different trigger kind', () => {
    expect(
      workflowMatchesEvent(
        { orgId: 'org-1', active: false, triggerKind: 'stage_changed', triggerConfig: {} },
        stageEvent,
      ),
    ).toBe(false);
    expect(
      workflowMatchesEvent(
        { orgId: 'org-1', active: true, triggerKind: 'record_created', triggerConfig: {} },
        stageEvent,
      ),
    ).toBe(false);
  });
});
