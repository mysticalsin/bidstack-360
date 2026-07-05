// Human labels for WinLossReasonCode, shared by the Pareto chart and the
// closed-bids table. Consumers render t(entry.key, entry.label) so the English
// fallback works before a translation lands.
import type { WinLossReasonCode } from '@bidstack/shared';

export const REASON_LABELS: Record<WinLossReasonCode, { key: string; label: string }> = {
  price: { key: 'winLoss.reason.price', label: 'Price' },
  product_fit: { key: 'winLoss.reason.productFit', label: 'Product fit' },
  timing: { key: 'winLoss.reason.timing', label: 'Timing' },
  competitor: { key: 'winLoss.reason.competitor', label: 'Competitor' },
  relationship: { key: 'winLoss.reason.relationship', label: 'Relationship' },
  scope: { key: 'winLoss.reason.scope', label: 'Scope' },
  no_decision: { key: 'winLoss.reason.noDecision', label: 'No decision' },
  other: { key: 'winLoss.reason.other', label: 'Other' },
};
