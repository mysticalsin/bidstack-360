/**
 * Snapshot share of loaded cards sitting past this column.
 *
 * An empty column is not 100%. Demo S1 Lead holds no bids while the rest of
 * the book sits later, and advanced / (0 + advanced) prints 100. A continued
 * page is not the book, so it has no rate. A won or lost column has no next
 * open stage to convert into. The caller leaves losses out of laterCount:
 * a loss is not forward progress. A win later in the book still counts.
 */
export function pipelineColumnConversion(input: {
  stageCount: number;
  laterCount: number;
  isClosed: boolean;
  pageContinues: boolean;
}): number | null {
  if (input.isClosed || input.pageContinues || input.stageCount <= 0) return null;
  const reached = input.stageCount + input.laterCount;
  if (reached <= 0) return null;
  return Math.round((input.laterCount / reached) * 100);
}
