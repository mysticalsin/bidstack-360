import { describe, expect, it } from 'vitest';

import { decidePipelineStageSoftDelete } from './pipeline-stage-softdelete.js';

describe('pipeline stage soft-delete guard', () => {
  it('refuses a soft-delete while a live deal references the stage', () => {
    // WHY: removing a stage that still has deals would hide those deals from
    // the pipeline without a place to put them.
    const decision = decidePipelineStageSoftDelete(1);
    expect(decision).toEqual({
      allowed: false,
      statusCode: 409,
      message: 'Cannot soft-delete a pipeline stage while live deals reference it',
    });
  });

  it('allows a soft-delete when no live deal references the stage', () => {
    expect(decidePipelineStageSoftDelete(0)).toEqual({ allowed: true });
  });

  it('treats a closed deal that is not deleted as live', () => {
    // WHY: won and lost deals still point at the stage. Only a tombstoned
    // opportunity stops blocking the soft-delete.
    expect(decidePipelineStageSoftDelete(2).allowed).toBe(false);
  });
});
