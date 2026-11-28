import type { BadgeTone } from '@/components/ui/Badge';

/**
 * Column badge tone for the deal board.
 *
 * Demo backfill names the columns Lead, Ongoing, Proposal Sent, Technical
 * Iteration, Negotiation, Closed Won, and Closed Lost. `stageTone` only
 * knows the legacy enum keys, so those names all fall through to gray,
 * including a win and a loss. The same stages also appear as S1 Lead, S1
 * Ongoing, S2 Sent, S3 Technical Iteration, and S4 Negotiation.
 *
 * A won or lost flag wins over the name, so a custom column named Won is
 * not left gray. A name this map does not know stays gray.
 */
const TONE_BY_NAME: Record<string, BadgeTone> = {
  lead: 'gray',
  's1 lead': 'gray',
  ongoing: 'purple',
  's1 ongoing': 'purple',
  'proposal sent': 'blue',
  's2 sent': 'blue',
  'technical iteration': 'teal',
  's3 technical iteration': 'teal',
  negotiation: 'amber',
  's4 negotiation': 'amber',
  'closed won': 'jade',
  'closed lost': 'tomato',
};

function stageNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function dealBoardStageTone(input: {
  name: string;
  isWon?: boolean;
  isLost?: boolean;
}): BadgeTone {
  if (input.isWon) return 'jade';
  if (input.isLost) return 'tomato';
  return TONE_BY_NAME[stageNameKey(input.name)] ?? 'gray';
}
