import { formatStage } from '@/lib/format';

import type { Opportunity, OpportunityStage, PipelineStage } from '@bidstack/shared';

export const LEGACY_PIPELINE_STAGES: PipelineStage[] = [
  { id: 's1_lead', name: 'S1 Lead', probability: 10, color: '#3b82f6', isWon: false, isLost: false },
  { id: 's1_ongoing', name: 'S1 Ongoing', probability: 25, color: '#6366f1', isWon: false, isLost: false },
  { id: 's2_sent', name: 'S2 Sent', probability: 40, color: '#06b6d4', isWon: false, isLost: false },
  {
    id: 's3_technical_iteration',
    name: 'S3 Technical Iteration',
    probability: 60,
    color: '#14b8a6',
    isWon: false,
    isLost: false,
  },
  { id: 's4_negotiation', name: 'S4 Negotiation', probability: 80, color: '#f59e0b', isWon: false, isLost: false },
  { id: 'closed_won', name: 'Closed Won', probability: 100, color: '#10b981', isWon: true, isLost: false },
  { id: 'closed_lost', name: 'Closed Lost', probability: 0, color: '#ef4444', isWon: false, isLost: true },
];

const LEGACY_BY_ID = new Map(LEGACY_PIPELINE_STAGES.map((stage) => [stage.id, stage]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPipelineStageIdUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isLegacyOpportunityStage(value: string): value is OpportunityStage {
  return LEGACY_BY_ID.has(value);
}

export function resolvePipelineStage(opp: Opportunity): PipelineStage {
  if (opp.pipelineStage) return opp.pipelineStage;

  const legacy = opp.stage ? LEGACY_BY_ID.get(opp.stage) : undefined;
  if (legacy) return legacy;

  const id = opp.pipelineStageId ?? opp.stage ?? 'unknown';
  return {
    id,
    name: id === 'unknown' ? 'Unknown' : formatStage(id),
    probability: opp.probability,
    color: null,
    isWon: id === 'closed_won',
    isLost: id === 'closed_lost',
  };
}

export function getPipelineStages(items: Opportunity[]): PipelineStage[] {
  const hasCanonicalStages = items.some((opp) => opp.pipelineStage);
  const map = new Map<string, PipelineStage>();

  if (!hasCanonicalStages) {
    for (const stage of LEGACY_PIPELINE_STAGES) map.set(stage.id, stage);
  }

  for (const opp of items) {
    const stage = resolvePipelineStage(opp);
    if (stage.id !== 'unknown') map.set(stage.id, stage);
  }

  const legacyOrder = new Map(LEGACY_PIPELINE_STAGES.map((stage, index) => [stage.id, index]));
  return [...map.values()].sort((a, b) => {
    const ao = legacyOrder.get(a.id);
    const bo = legacyOrder.get(b.id);
    if (ao !== undefined && bo !== undefined) return ao - bo;
    if (ao !== undefined) return -1;
    if (bo !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}
