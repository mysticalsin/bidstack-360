import { describe, expect, it } from 'vitest';

import { opportunityStageListQuery } from './opportunity-list-stage';

// Demo pipeline stages are UUIDs whose key is the legacy enum the seed writes
// (s3_technical_iteration on OP-2041). The row's pipelineStageId stays null.
// A list query for the UUID matches nothing, so the chip looks on and the book
// looks empty.
const TECHNICAL_ITERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOM_STAGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('opportunityStageListQuery', () => {
  it('asks for the seeded stage key when the chip is a demo stage', () => {
    const keys = new Map([[TECHNICAL_ITERATION, 's3_technical_iteration']]);

    expect(opportunityStageListQuery(TECHNICAL_ITERATION, keys)).toEqual({
      stage: 's3_technical_iteration',
    });
  });

  it('keeps a legacy chip on the enum the row already stores', () => {
    expect(opportunityStageListQuery('s1_ongoing', new Map())).toEqual({
      stage: 's1_ongoing',
    });
  });

  it('keeps a custom stage on its id when the key is not a seeded enum', () => {
    const keys = new Map([[CUSTOM_STAGE, 'partner_intro']]);

    expect(opportunityStageListQuery(CUSTOM_STAGE, keys)).toEqual({
      pipelineStageId: CUSTOM_STAGE,
    });
  });

  it('keeps the id query when the stage catalog has not loaded', () => {
    expect(opportunityStageListQuery(TECHNICAL_ITERATION, new Map())).toEqual({
      pipelineStageId: TECHNICAL_ITERATION,
    });
  });

  it('trims a stored key before treating it as the seeded enum', () => {
    const keys = new Map([[TECHNICAL_ITERATION, '  s3_technical_iteration  ']]);

    expect(opportunityStageListQuery(TECHNICAL_ITERATION, keys)).toEqual({
      stage: 's3_technical_iteration',
    });
  });

  it('sends no stage clause when the filter is clear or unknown', () => {
    expect(opportunityStageListQuery(null, new Map())).toEqual({});
    expect(opportunityStageListQuery('not-a-stage', new Map())).toEqual({});
  });
});
