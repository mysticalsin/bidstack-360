// AI feedback widget — 1-5 star rating shown after every AI response.
// Shown inline under each AI panel section.
// WHY inline (not modal): lower friction = higher response rate for the
// learning loop.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { useAiFeedback } from '@/hooks/useAiAssistant';

interface AiFeedbackProps {
  sessionId: string;
  /** Called when feedback is successfully submitted */
  onSubmit?: () => void;
}

export function AiFeedback({ sessionId, onSubmit }: AiFeedbackProps) {
  const { t } = useTranslation('crm');
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useAiFeedback();

  function handleRate(rating: number) {
    setSelectedRating(rating);
  }

  function handleSubmit() {
    if (!selectedRating) return;
    mutation.mutate(
      { sessionId, rating: selectedRating, comment: comment.trim() || undefined },
      {
        onSuccess: () => {
          setSubmitted(true);
          onSubmit?.();
        },
      },
    );
  }

  if (submitted) {
    return (
      <p className="text-xs text-[var(--fg-secondary)] mt-2" role="status">
        {t('ai-feedback.thanks', 'Thanks for your feedback!')}
      </p>
    );
  }

  return (
    <div
      className="mt-3 flex flex-col gap-2"
      // WHY aria-label: the stars look purely decorative without it.
      aria-label={t('ai-feedback.aria-rate-response', 'Rate this AI response')}
    >
      <p className="text-xs text-[var(--fg-tertiary)]">{t('ai-feedback.was-this-helpful', 'Was this helpful?')}</p>

      {/* Stars */}
      <div className="flex gap-1" role="group" aria-label={t('ai-feedback.aria-rating', 'Rating')}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = hoveredStar !== null ? star <= hoveredStar : star <= (selectedRating ?? 0);
          return (
            <button
              key={star}
              type="button"
              aria-label={t('ai-feedback.aria-star-rating', '{{count}} star', { count: star })}
              aria-pressed={selectedRating === star}
              className={cn(
                // 44×44 touch target, smaller visual
                'flex h-11 w-11 items-center justify-center rounded-md transition-colors',
                'focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                'hover:bg-[var(--surface-sunken)]',
              )}
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(null)}
              onClick={() => handleRate(star)}
            >
              <span
                aria-hidden
                className={cn(
                  'text-xl leading-none transition-colors',
                  filled ? 'text-yellow-400' : 'text-[var(--fg-muted)]',
                )}
              >
                ★
              </span>
            </button>
          );
        })}
      </div>

      {/* Optional comment (only shown after star is selected) */}
      {selectedRating !== null ? (
        <>
          <textarea
            className={cn(
              'w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2',
              'text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
              'resize-none',
            )}
            rows={2}
            placeholder={t('ai-feedback.comment-placeholder', 'Optional comment…')}
            maxLength={2000}
            value={comment}
            aria-label={t('ai-feedback.aria-comment', 'Feedback comment')}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={handleSubmit}
            className={cn(
              'self-start rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white',
              'hover:opacity-90 active:opacity-80 disabled:opacity-50',
              'focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
              'min-h-[44px]',
            )}
          >
            {mutation.isPending
              ? t('ai-feedback.submitting', 'Sending…')
              : t('ai-feedback.submit', 'Submit feedback')}
          </button>
          {mutation.isError ? (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {t('ai-feedback.error', 'Failed to submit feedback. Please try again.')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
