import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { stageTone, type BadgeTone } from '@/components/ui/Badge';
import {
  getPipelineStages,
  isLegacyOpportunityStage,
  resolvePipelineStage,
} from '@/lib/pipeline-stages';

/**
 * Demo pipeline rows are named Lead, Ongoing, Proposal Sent, Technical
 * Iteration, Negotiation, Closed Won, and Closed Lost. The seed still stores
 * the legacy key (s3_technical_iteration on OP-2041) and leaves
 * pipelineStageId null. `stageTone` only knows those keys, so a chip labeled
 * with the demo name was falling through to gray, the same tone as an unknown
 * stage.
 */
const STAGE_NAME_TO_KEY: Record<string, string> = {
  lead: 's1_lead',
  's1 lead': 's1_lead',
  ongoing: 's1_ongoing',
  's1 ongoing': 's1_ongoing',
  'proposal sent': 's2_sent',
  's2 sent': 's2_sent',
  'technical iteration': 's3_technical_iteration',
  's3 technical iteration': 's3_technical_iteration',
  negotiation: 's4_negotiation',
  's4 negotiation': 's4_negotiation',
  'closed won': 'closed_won',
  'closed lost': 'closed_lost',
};

export interface OpportunityCatalogStage {
  id: string;
  key: string;
  name: string;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
}

/**
 * One chip per catalog stage. When the catalog key is the legacy enum the
 * seed writes, the chip id is that key: the list query already filters on
 * `stage` for it. Keeping the UUID as the chip id matches no seeded bid, so
 * Technical Iteration reads as an empty stage next to a second chip named
 * S3 Technical Iteration. A custom key stays on its id. Until the catalog
 * loads, the legacy chip row stays so the filter does not flash blank.
 */
export function opportunityListStageChips(
  items: readonly Opportunity[],
  catalog: readonly OpportunityCatalogStage[],
): PipelineStage[] {
  if (catalog.length === 0) return getPipelineStages([...items]);

  const chips: PipelineStage[] = [];
  const covered = new Set<string>();

  for (const stage of catalog) {
    const key = stage.key.trim();
    const id = isLegacyOpportunityStage(key) ? key : stage.id;
    chips.push({
      id,
      name: stage.name,
      probability: stage.probability,
      color: stage.color,
      isWon: stage.isWon,
      isLost: stage.isLost,
    });
    covered.add(stage.id);
    covered.add(id);
    covered.add(key);
    covered.add(stage.name.trim().toLowerCase());
  }

  for (const opp of items) {
    const resolved = resolvePipelineStage(opp);
    if (resolved.id === 'unknown') continue;
    const names = [resolved.name, opp.pipelineStage?.name ?? ''];
    if (
      covered.has(resolved.id) ||
      covered.has(opp.stage ?? '') ||
      covered.has(opp.pipelineStageId ?? '') ||
      names.some((name) => covered.has(name.trim().toLowerCase()))
    ) {
      continue;
    }
    covered.add(resolved.id);
    chips.push(resolved);
  }

  return chips;
}

/** The badge and the editor use the catalog chip the bid already belongs to. */
export function opportunityRowStage(
  opp: Opportunity,
  chips: readonly PipelineStage[],
): PipelineStage {
  const resolved = resolvePipelineStage(opp);
  const match = chips.find(
    (chip) =>
      chip.id === resolved.id ||
      chip.id === opp.stage ||
      (opp.pipelineStageId != null && chip.id === opp.pipelineStageId) ||
      chip.name === resolved.name ||
      (opp.pipelineStage != null && chip.name === opp.pipelineStage.name),
  );
  return match ?? resolved;
}

export function opportunityStageChipTone(
  stage: { id: string; name: string } | null | undefined,
): BadgeTone {
  if (!stage) return stageTone('');
  if (isLegacyOpportunityStage(stage.id)) return stageTone(stage.id);
  const key = STAGE_NAME_TO_KEY[stage.name.trim().toLowerCase()];
  if (key) return stageTone(key);
  return stageTone(stage.name);
}
