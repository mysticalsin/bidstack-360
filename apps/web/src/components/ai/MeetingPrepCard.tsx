// Meeting prep card — shown on the calendar event detail page.
// Collapses to a skeleton while fetching; expands with briefing sections
// when ready.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { AiFeedback } from './ai-feedback';
import { useMeetingPrep, type MeetingPrepResult } from '@/hooks/useAiAssistant';

interface MeetingPrepCardProps {
  calendarEventId: string;
}

export function MeetingPrepCard({ calendarEventId }: MeetingPrepCardProps) {
  const { t } = useTranslation('crm');
  const [result, setResult] = useState<MeetingPrepResult | null>(null);
  const mutation = useMeetingPrep(calendarEventId);

  function handleGenerate() {
    mutation.mutate(undefined, { onSuccess: setResult });
  }

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4',
      )}
      aria-label={t('meetingPrep.ariaLabel', 'AI Meeting Prep')}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('meetingPrep.title', '✦ AI Meeting Prep')}
        </h3>
        {!result ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={mutation.isPending}
            onClick={handleGenerate}
          >
            {mutation.isPending
              ? t('meetingPrep.preparing', 'Preparing…')
              : t('meetingPrep.generateButton', 'Generate brief')}
          </Button>
        ) : null}
      </div>

      {/* Pending skeleton */}
      {mutation.isPending ? (
        <div className="space-y-2 animate-pulse" aria-label={t('meetingPrep.generatingAriaLabel', 'Generating meeting brief…')} aria-live="polite">
          {[80, 60, 70, 50].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded bg-[var(--surface-sunken)] dark:bg-[var(--border-subtle)]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : null}

      {/* Error */}
      {mutation.isError ? (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {mutation.error.message.includes('cap')
            ? t('meetingPrep.errorCapReached', 'Daily AI limit reached. Try again tomorrow.')
            : t('meetingPrep.errorGeneric', 'Failed to prepare brief. Please try again.')}
        </p>
      ) : null}

      {/* Result */}
      {result ? (
        <div className="space-y-4">
          {/* Attendees */}
          {result.attendees.length > 0 ? (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">
                {t('meetingPrep.sectionAttendees', 'Attendees')}
              </h4>
              <ul className="space-y-1">
                {result.attendees.map((a, i) => (
                  <li key={i} className="text-xs text-[var(--fg-primary)]">
                    <span className="font-medium">{a.name}</span>
                    {a.role ? <span className="text-[var(--fg-secondary)]"> — {a.role}</span> : null}
                    {a.company ? <span className="text-[var(--fg-tertiary)]">, {a.company}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Open opportunities */}
          {result.openOpps.length > 0 ? (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">
                {t('meetingPrep.sectionOpenDeals', 'Open Deals')}
              </h4>
              <ul className="space-y-1">
                {result.openOpps.map((opp) => (
                  <li key={opp.id} className="text-xs text-[var(--fg-primary)]">
                    {opp.title}{' '}
                    <span className="rounded-sm bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]">
                      {opp.stage}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Talking points */}
          {result.talkingPoints.length > 0 ? (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">
                {t('meetingPrep.sectionTalkingPoints', 'Talking Points')}
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {result.talkingPoints.map((tp, i) => (
                  <li key={i} className="text-xs text-[var(--fg-primary)]">
                    {tp}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Suggested questions */}
          {result.suggestedQuestions.length > 0 ? (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">
                {t('meetingPrep.sectionSuggestedQuestions', 'Suggested Questions')}
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {result.suggestedQuestions.map((q, i) => (
                  <li key={i} className="text-xs text-[var(--fg-primary)]">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Recent interactions */}
          {result.recentInteractions.length > 0 ? (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">
                {t('meetingPrep.sectionRecentInteractions', 'Recent Interactions')}
              </h4>
              <ul className="space-y-1">
                {result.recentInteractions.map((ri, i) => (
                  <li key={i} className="text-xs text-[var(--fg-tertiary)]">
                    {ri}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[10px] text-[var(--fg-muted)]">
            {t('meetingPrep.cost', 'Cost: ${{amount}}', {
              amount: (result.costMicros / 1_000_000).toFixed(4),
            })}
          </p>

          <AiFeedback sessionId={result.sessionId} />
        </div>
      ) : null}

      {/* Empty state — not yet generated */}
      {!mutation.isPending && !mutation.isError && !result ? (
        <p className="text-xs text-[var(--fg-tertiary)]">
          {t(
            'meetingPrep.emptyState',
            'Generate an AI-powered brief covering attendees, open deals, talking points, and suggested questions for this meeting.',
          )}
        </p>
      ) : null}
    </section>
  );
}
