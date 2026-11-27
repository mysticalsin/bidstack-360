// The page paints this view before SSE connects. It has to match the stream
// map, or a refresh would show a different stage than the live bar.
import { describe, expect, it } from 'vitest';

import { resumePipelineView } from './useRfpPipeline';

describe('resumePipelineView', () => {
  it('paints a saved human gate as awaiting approval with a full bar', () => {
    // WHY: the review suite mounts only at this stage. A zero bar would say
    // the gate is still at the start of the pipeline.
    expect(resumePipelineView('awaiting_approval', 'awaiting_approval')).toEqual({
      stage: 'awaiting_approval',
      progress: 100,
    });
  });

  it('paints a running section draft from the phase, not from the running state', () => {
    // WHY: the database leaves state at "running" for the whole job. Mapping
    // that word itself has no UI stage, so the phase is what the desk shows.
    const view = resumePipelineView('running', 'section_draft');
    expect(view.stage).toBe('section_drafting');
    expect(view.progress).toBeGreaterThan(0);
    expect(view.progress).toBeLessThan(100);
  });
});
