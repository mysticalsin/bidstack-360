/**
 * Demo bids store the legacy stage key and leave pipelineStageId empty.
 * The catalog names are the default pipeline backfill
 * (20260527010100_backfill_pipeline_stages). A stored stage name still wins.
 * A key that is not in that catalog stays as written.
 */
const DEMO_STAGE_NAME: Readonly<Record<string, string>> = {
  s1_lead: 'Lead',
  s1_ongoing: 'Ongoing',
  s2_sent: 'Proposal Sent',
  s3_technical_iteration: 'Technical Iteration',
  s4_negotiation: 'Negotiation',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

export function opportunityBriefStage(input: {
  stage: string;
  pipelineStageName: string | null;
}): string {
  const named = input.pipelineStageName?.trim() ?? '';
  if (named.length > 0) return named;
  return DEMO_STAGE_NAME[input.stage] ?? input.stage;
}
