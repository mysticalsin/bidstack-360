/**
 * Figures for one focused deal-board column.
 *
 * The unfiltered strip is the portfolio report, because the board stops at 50
 * cards. A stage filter is this column. A closed column is not open pipeline.
 * No book total is filled in when the column is empty.
 */
export interface PipelineColumnKpis {
  stageName: string;
  value: number;
  openValue: number;
  dealCount: number;
  openCount: number;
  pageContinues: boolean;
}

export function pipelineColumnKpis(input: {
  stageName: string;
  isClosed: boolean;
  values: readonly number[];
  pageContinues: boolean;
}): PipelineColumnKpis {
  const value = input.values.reduce((sum, amount) => sum + amount, 0);
  const dealCount = input.values.length;
  const openCount = input.isClosed ? 0 : dealCount;
  return {
    stageName: input.stageName,
    value,
    openValue: input.isClosed ? 0 : value,
    dealCount,
    openCount,
    pageContinues: input.pageContinues,
  };
}
