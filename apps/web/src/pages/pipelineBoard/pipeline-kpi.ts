/**
 * The deal board draws cards from the opportunity list. The headline totals
 * come from a separate pipeline report. A missing report is not an empty book:
 * "0 active deals" and "No closed bids" would contradict cards still on screen.
 */
export interface PipelineKpiReport {
  byStage: ReadonlyArray<{ stage: string; count: number; valueSum: number }>;
  totalOpen: number;
  totalValueOpen: number;
}

export function pipelineKpiReadiness(input: {
  opportunitiesLoading: boolean;
  reportLoading: boolean;
  report: PipelineKpiReport | null | undefined;
}): 'loading' | 'unavailable' | 'ready' {
  if (input.opportunitiesLoading || input.reportLoading) return 'loading';
  if (!input.report) return 'unavailable';
  return 'ready';
}
