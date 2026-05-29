/**
 * Tests for the rfpPipeline Zustand store.
 *
 * WHY: The store is the single source of truth for all RFP pipeline state;
 * every stage transition, error state, and memory-cap behaviour must be
 * deterministic and independently verifiable outside any React component.
 *
 * NOTE ON TYPES: The name `PipelineStage` is also exported from
 * @bidstack/shared as an object type (opportunity pipeline stage), causing a
 * tsc resolution collision when imported. We use `as unknown as PipelineEvent`
 * casts on test fixtures that pass literal strings to avoid the false error,
 * and only annotate variables with the locally-resolved type where safe.
 *
 * Note: Zustand stores share module-level singleton state. We call reset()
 * in beforeEach rather than re-importing to stay aligned with how the app
 * uses the store (one instance, many consumers).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRfpPipelineStore } from '../rfpPipeline';
import type { PipelineEvent } from '../rfpPipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PipelineEvent for a given stage string.
 * Stage is typed as string here because tsc resolves `PipelineStage` from
 * the shared package (an object type) rather than the local string union.
 */
let eventCounter = 0;
function makeEvent(stage: string, overrides: Partial<PipelineEvent> = {}): PipelineEvent {
  eventCounter++;
  const date = new Date('2026-05-28T00:00:00.000Z');
  date.setSeconds(date.getSeconds() + eventCounter);
  return {
    stage,
    message: `Event for ${stage}`,
    timestamp: date.toISOString(),
    ...overrides,
  } as unknown as PipelineEvent;
}

function getState() {
  return useRfpPipelineStore.getState();
}

// ---------------------------------------------------------------------------
// Reset before every test so tests don't bleed state
// ---------------------------------------------------------------------------

beforeEach(() => {
  eventCounter = 0;
  getState().reset();
});

afterEach(() => {
  getState().reset();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — initial state', () => {
  it('starts at idle stage with zeroed progress and null error', () => {
    const s = getState();
    expect(s.stage).toBe('idle');
    expect(s.progress).toBe(0);
    expect(s.error).toBe(null);
    expect(s.events).toHaveLength(0);
    expect(s.orchestrationId).toBe(null);
    expect(s.bidWorkspaceId).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Stage transitions — all valid PipelineStage string values
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — applyEvent stage transitions', () => {
  // All valid stage string values from the union in rfpPipeline.ts
  const stages = [
    'idle',
    'queued',
    'extracting',
    'story_matching',
    'section_drafting',
    'compliance_fill',
    'legal_scan',
    'qa_review',
    'awaiting_approval',
    'approved',
    'failed',
  ] as const;

  it.each(stages)('transitions to stage "%s"', (stage) => {
    getState().applyEvent(makeEvent(stage));
    expect(getState().stage).toBe(stage);
  });

  it('sequences through a typical happy-path pipeline', () => {
    const happyPath = [
      'queued',
      'extracting',
      'story_matching',
      'section_drafting',
      'compliance_fill',
      'legal_scan',
      'qa_review',
      'awaiting_approval',
      'approved',
    ] as const;

    for (let i = 0; i < happyPath.length; i++) {
      const s = happyPath[i];
      if (s !== undefined) getState().applyEvent(makeEvent(s, { progress: i * 12 }));
    }

    expect(getState().stage).toBe('approved');
    expect(getState().events).toHaveLength(happyPath.length);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — error events', () => {
  it('sets state.error when an event carries an error field', () => {
    getState().applyEvent(makeEvent('failed', { error: 'Extraction timed out' }));
    expect(getState().stage).toBe('failed');
    expect(getState().error).toBe('Extraction timed out');
  });

  it('clears a previous error when a non-error event follows', () => {
    // First introduce an error
    getState().applyEvent(makeEvent('failed', { error: 'Something went wrong' }));
    expect(getState().error).toBe('Something went wrong');

    // A recovery event arriving at a valid stage clears the error field
    // WHY: applyEvent reducer always sets error: event.error ?? null
    getState().applyEvent(makeEvent('queued'));
    expect(getState().error).toBe(null);
  });

  it('stores the error message exactly as provided', () => {
    const errorMsg = 'PDF parser crashed with code -42';
    getState().applyEvent(makeEvent('failed', { error: errorMsg }));
    expect(getState().error).toBe(errorMsg);
  });
});

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — progress field', () => {
  it('updates progress when event carries a progress value', () => {
    getState().applyEvent(makeEvent('queued', { progress: 25 }));
    expect(getState().progress).toBe(25);
  });

  it('retains the previous progress value when event has no progress', () => {
    getState().applyEvent(makeEvent('queued', { progress: 40 }));
    // Next event omits progress — WHY: SSE events for stage transitions may
    // not carry a redundant progress value; the store must not reset to 0.
    getState().applyEvent(makeEvent('extracting'));
    expect(getState().progress).toBe(40);
  });

  it('updates to 100 on an approved event with progress: 100', () => {
    getState().applyEvent(makeEvent('approved', { progress: 100 }));
    expect(getState().progress).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Event log cap at 50 items
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — event log cap', () => {
  it('retains up to 50 events', () => {
    for (let i = 0; i < 50; i++) {
      getState().applyEvent(makeEvent('queued', { message: `Event ${i}` }));
    }
    expect(getState().events).toHaveLength(50);
  });

  it('evicts the oldest event when a 51st event arrives', () => {
    for (let i = 0; i < 50; i++) {
      getState().applyEvent(makeEvent('queued', { message: `Event ${i}` }));
    }
    getState().applyEvent(makeEvent('extracting', { message: 'Event 50 — should be newest' }));

    const events = getState().events;
    // WHY: slice(-50) keeps the LAST 50, so index 0 is message "Event 1"
    expect(events).toHaveLength(50);
    expect(events[0]?.message).toBe('Event 1');
    expect(events[49]?.message).toBe('Event 50 — should be newest');
  });

  it('never exceeds 50 items regardless of how many events are applied', () => {
    for (let i = 0; i < 200; i++) {
      getState().applyEvent(makeEvent('queued', { message: `Event ${i}` }));
    }
    expect(getState().events).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — reset()', () => {
  it('restores every field to its initial value', () => {
    getState().setOrchestrationId('orch-abc');
    getState().setBidWorkspaceId('ws-xyz');
    getState().applyEvent(makeEvent('approved', { progress: 100 }));

    getState().reset();

    const s = getState();
    expect(s.orchestrationId).toBe(null);
    expect(s.bidWorkspaceId).toBe(null);
    expect(s.stage).toBe('idle');
    expect(s.events).toHaveLength(0);
    expect(s.progress).toBe(0);
    expect(s.error).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// setOrchestrationId / setBidWorkspaceId
// ---------------------------------------------------------------------------

describe('rfpPipelineStore — setters', () => {
  it('stores the orchestration ID', () => {
    getState().setOrchestrationId('orch-001');
    expect(getState().orchestrationId).toBe('orch-001');
  });

  it('stores the bid workspace ID', () => {
    getState().setBidWorkspaceId('ws-001');
    expect(getState().bidWorkspaceId).toBe('ws-001');
  });

  it('overwrites the orchestration ID if set again', () => {
    getState().setOrchestrationId('orch-001');
    getState().setOrchestrationId('orch-002');
    expect(getState().orchestrationId).toBe('orch-002');
  });
});
