// Below-threshold save dialog. Shown when the computed recommendation is
// no_bid / proceed_with_caution and the user hits Save: they either record
// the score following the recommendation, or override it — which REQUIRES a
// justification (min 30 chars) that is persisted, audit-logged, and surfaced
// to directors/VPs.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';

const MIN_JUSTIFICATION = 30;

export function OverrideDialog({
  open,
  verdict,
  totalScore,
  pending,
  onOpenChange,
  onFollow,
  onOverride,
}: {
  open: boolean;
  verdict: string;
  totalScore: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onFollow: () => void;
  onOverride: (justification: string) => void;
}) {
  const { t } = useTranslation('crm');
  const [justification, setJustification] = useState('');
  const trimmed = justification.trim();
  const remaining = MIN_JUSTIFICATION - trimmed.length;
  const valid = remaining <= 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setJustification('');
        onOpenChange(next);
      }}
    >
      <DialogContent
        title={t('override.title', 'Score is below the bid threshold')}
        description={t(
          'override.description',
          'This evaluation computes {{totalScore}}/100 — {{verdict}}. Save it as-is, or override the recommendation to proceed with the bid. Overrides require a justification and are logged for director/VP review.',
          { totalScore, verdict },
        )}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="override-justification"
              className="mb-1.5 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              {t('override.justificationLabel', 'Override justification')}{' '}
              <span className="text-[var(--danger)]">*</span>
            </label>
            <textarea
              id="override-justification"
              className="dialog-input min-h-[96px] w-full resize-y"
              placeholder={t(
                'override.justificationPlaceholder',
                'Why are we bidding despite the score? Strategic account, market entry, mandated framework…',
              )}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              maxLength={5000}
              aria-required="true"
              aria-invalid={!valid && trimmed.length > 0}
              aria-describedby="override-justification-hint"
            />
            <p
              id="override-justification-hint"
              className="mt-1 text-[11px] text-[var(--fg-tertiary)]"
              aria-live="polite"
            >
              {valid
                ? t('override.hintReady', '{{count}} characters — ready to submit.', {
                    count: trimmed.length,
                  })
                : t(
                    'override.hintMore',
                    'Minimum {{min}} characters ({{remaining}} more needed).',
                    { min: MIN_JUSTIFICATION, remaining: Math.max(remaining, 0) },
                  )}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={onFollow}
              disabled={pending}
              aria-label={t(
                'override.followAriaLabel',
                'Save score and follow the recommendation',
              )}
            >
              {t('override.followButton', 'Save & follow recommendation')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOverride(trimmed)}
              disabled={pending || !valid}
              aria-label={t(
                'override.overrideAriaLabel',
                'Override the recommendation and proceed with the bid',
              )}
            >
              {pending
                ? t('override.saving', 'Saving…')
                : t('override.overrideButton', 'Override & proceed with bid')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
