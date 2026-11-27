/**
 * Column id a bid is already filed on.
 *
 * `pipelineStageId` is the column the bid was saved to. The nested
 * `pipelineStage` object is a copy and can still name the previous column
 * after that id changes. Trusting the copy leaves Closed Won empty and
 * keeps a decided bid on the open column.
 *
 * Returns null when the id is missing or is not one of the columns on the
 * board, so the caller can fall back to the stage-key match.
 */
export function filedBoardColumnId(
  pipelineStageId: string | null | undefined,
  columnIds: readonly string[],
): string | null {
  if (!pipelineStageId) return null;
  return columnIds.includes(pipelineStageId) ? pipelineStageId : null;
}
