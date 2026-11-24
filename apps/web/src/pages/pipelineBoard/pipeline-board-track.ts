/** Stage columns narrower than this collide a name with its value. */
export const PIPELINE_COLUMN_MIN_PX = 280;

/** Tailwind `gap-3` at the default root size. The board uses that gap. */
export const PIPELINE_COLUMN_GAP_PX = 12;

/**
 * Width of each stage column so `boardWidth` holds a whole number of them.
 *
 * A leftover sliver paints the next stage cut off, and its value sits past
 * the viewport. One column when two minimum columns do not fit. A
 * non-positive width keeps the minimum so the track still has a size.
 */
export function pipelineColumnWidth(boardWidth: number): number {
  const gap = PIPELINE_COLUMN_GAP_PX;
  const min = PIPELINE_COLUMN_MIN_PX;
  if (!Number.isFinite(boardWidth) || boardWidth <= 0) return min;
  const count = Math.max(1, Math.floor((boardWidth + gap) / (min + gap)));
  return (boardWidth - (count - 1) * gap) / count;
}
