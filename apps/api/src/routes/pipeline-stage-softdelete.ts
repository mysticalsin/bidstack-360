export type StageSoftDeleteDecision =
  | { allowed: true }
  | { allowed: false; statusCode: 409; message: string };

const REFUSAL = 'Cannot soft-delete a pipeline stage while live deals reference it';

/** A live deal is an opportunity that is not tombstoned, including won and lost. */
export function decidePipelineStageSoftDelete(liveDealCount: number): StageSoftDeleteDecision {
  if (!Number.isInteger(liveDealCount) || liveDealCount < 0) {
    throw new Error('live deal count must be a non-negative integer');
  }
  if (liveDealCount > 0) {
    return { allowed: false, statusCode: 409, message: REFUSAL };
  }
  return { allowed: true };
}
