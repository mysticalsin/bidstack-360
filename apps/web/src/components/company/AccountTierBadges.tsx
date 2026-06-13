// Visual distinction between the two account concepts (demo-feedback M5):
// Top account  = manually curated global top-10  → trophy + amber.
// Key account  = regional strategic account      → star + purple (brand tone).
// Use these everywhere both concepts can appear so they are never confused.

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';

export function TopAccountBadge({ rank }: { rank?: number | null }) {
  return (
    <Badge tone="amber">
      <Icon name="trophy" size={11} ariaHidden />
      {rank ? `Top #${rank}` : 'Top'}
    </Badge>
  );
}

export function KeyAccountBadge() {
  return (
    <Badge tone="purple">
      <Icon name="star" size={11} ariaHidden />
      Key
    </Badge>
  );
}
