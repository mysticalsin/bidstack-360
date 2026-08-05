// The strip: one proposed answer, its one-line rationale, and the two clicks
// that settle it. Purely presentational — the fetch, the mutation and the
// optimistic collapse all live in ProposedAnswers / useBidFacts.
//
// Rewritten, not ported, from the CRM's suggestion.tsx: BidStack's Button,
// Icon and token vocabulary throughout, and the amber "held" state is new —
// the CRM had no notion of a source contradicting another source.
//
// THE ONE RULE THIS FILE ENCODES: disagreement does not look like low
// confidence. A held claim is amber with a stated reason; a merely weak claim
// is the ordinary pale strip. Neither is red — nothing here has failed.

import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

export interface SuggestionProps {
  /** The proposed answerDraft text. */
  claim: string;
  /** One line of "why this was proposed", already localised or worker-authored. */
  rationale: string | null;
  /** Sources disagree — render amber and say so. */
  held?: boolean;
  /** A decide is in flight for this suggestion. */
  busy?: boolean;
  /** A decide failed — the strip came back, and the reason is shown inline. */
  error?: string | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function Suggestion({
  claim,
  rationale,
  held = false,
  busy = false,
  error = null,
  onAccept,
  onDismiss,
}: SuggestionProps) {
  const { t } = useTranslation('rfp');

  return (
    <div
      data-slot="agent-suggestion"
      data-held={held || undefined}
      // Indented and pale: the strip is subordinate to the answer above it, and
      // the left rule is what ties it to that row across the whitespace.
      className={cn(
        'flex flex-col gap-1.5 border-l-2 py-2 pl-3 pr-2',
        held
          ? 'border-warning bg-warning-tint'
          : 'border-border-default bg-surface-soft',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {held && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-warning">
              <Icon name="warning" size={12} />
              {t('agent.held', 'Held')}
            </span>
          )}
          <p className="whitespace-normal text-xs text-fg-primary">{claim}</p>
          {rationale && (
            <p className="whitespace-normal text-[11px] text-fg-secondary">{rationale}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onAccept}
            aria-label={t('agent.acceptAria', 'Accept the proposed answer')}
          >
            <Icon name="check" size={14} />
            {t('agent.accept', 'Accept')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDismiss}
            aria-label={t('agent.dismissAria', 'Dismiss the proposed answer')}
          >
            <Icon name="close" size={14} />
            {t('agent.dismiss', 'Dismiss')}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="whitespace-normal text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
