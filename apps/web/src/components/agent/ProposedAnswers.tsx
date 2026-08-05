// Every live proposal for ONE subject, rendered as strips under that subject's
// row. Props-driven on purpose: the matrix fetches facts for the visible page
// in a single `useSubjectBidFacts` call and owns the one decide mutation, so a
// row cannot open its own query (25 rows × its own hook is the fan-out this
// design exists to bound — see useBidFacts.ts).

import { useTranslation } from 'react-i18next';

import type { BidFact } from '@/hooks/agent/useBidFacts';
import { Suggestion } from './Suggestion';
import { isHeldFact, rationaleLineFor } from './bid-fact-view';

export interface ProposedAnswersProps {
  facts: readonly BidFact[];
  /** The fact whose decide is in flight, if any. */
  busyFactId?: string | null;
  /** The fact whose decide failed, and why. */
  errorFactId?: string | null;
  errorMessage?: string | null;
  onDecide: (factId: string, decision: 'accept' | 'dismiss') => void;
}

export function ProposedAnswers({
  facts,
  busyFactId = null,
  errorFactId = null,
  errorMessage = null,
  onDecide,
}: ProposedAnswersProps) {
  const { t } = useTranslation('rfp');

  if (facts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" data-slot="proposed-answers">
      {facts.map((fact) => (
        <Suggestion
          key={fact.id}
          claim={fact.claim}
          rationale={rationaleLineFor(fact, t)}
          held={isHeldFact(fact)}
          busy={busyFactId === fact.id}
          error={errorFactId === fact.id ? errorMessage : null}
          onAccept={() => onDecide(fact.id, 'accept')}
          onDismiss={() => onDecide(fact.id, 'dismiss')}
        />
      ))}
    </div>
  );
}

