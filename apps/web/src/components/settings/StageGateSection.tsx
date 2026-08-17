// Amaris stage-gate enforcement — the control for the "hard state machine, not
// a checklist" rule in the Bid Office playbook. The API has enforced this since
// the gate shipped; without this screen the only way to change it was an env
// var, which is not a setting an org can own.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { useStageGateMode, useUpdateStageGateMode } from '@/hooks/useStageGateMode';
import type { OrgStageGateSettings, StageGateMode } from '@bidstack/shared';

// '' is the wire's `null` — "no override, follow the server default". A select
// cannot carry null, so the empty string is the sentinel and is mapped back on
// save; it is deliberately the first option so the default reads as inherited.
const OPTIONS: { value: StageGateMode | ''; labelKey: string; fallback: string }[] = [
  { value: '', labelKey: 'stageGate.modeInherit', fallback: 'Use server default' },
  { value: 'off', labelKey: 'stageGate.modeOff', fallback: 'Off — no stage checks' },
  { value: 'warn', labelKey: 'stageGate.modeWarn', fallback: 'Warn — log violations, allow' },
  { value: 'enforce', labelKey: 'stageGate.modeEnforce', fallback: 'Enforce — block violations' },
];

export function StageGateSection() {
  const { t } = useTranslation('settings');
  const stageGate = useStageGateMode();

  if (stageGate.isLoading) return <LoadingSkeleton rows={2} />;
  if (stageGate.isError || !stageGate.data) {
    return (
      <ErrorState
        title={t('stageGate.loadErrorTitle', 'Could not load stage-gate enforcement')}
        message={stageGate.error?.message ?? t('stageGate.loadErrorMessage', 'Try again shortly.')}
      />
    );
  }

  return <StageGateForm key={JSON.stringify(stageGate.data)} initial={stageGate.data} />;
}

function StageGateForm({ initial }: { initial: OrgStageGateSettings }) {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const update = useUpdateStageGateMode();
  const [mode, setMode] = useState<StageGateMode | ''>(initial.mode ?? '');
  const changed = (mode === '' ? null : mode) !== initial.mode;
  const disabled = !isAdmin || update.isPending;

  const onSave = () => {
    update.mutate(
      { mode: mode === '' ? null : mode },
      {
        onSuccess: () => toast.success(t('stageGate.saveSuccess', 'Stage-gate enforcement saved')),
        onError: (err: Error) =>
          toast.error(t('stageGate.saveError', 'Could not save stage-gate enforcement'), {
            description: err.message,
          }),
      },
    );
  };

  return (
    <Card>
      <SectionHeader
        title={t('stageGate.title', 'Stage-gate enforcement')}
        caption={t(
          'stageGate.caption',
          'Amaris Bid Office: block stage jumps and stop a no-bid opportunity from advancing.',
        )}
      />
      <div className="p-5">
        <label
          htmlFor="org-stage-gate-mode"
          className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
        >
          {t('stageGate.modeLabel', 'Enforcement mode')}
        </label>
        <select
          id="org-stage-gate-mode"
          className="input w-full sm:max-w-sm"
          disabled={disabled}
          value={mode}
          onChange={(e) => setMode(e.target.value as StageGateMode | '')}
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey, opt.fallback)}
            </option>
          ))}
        </select>
        <ul className="mt-3 space-y-1 text-xs text-[var(--fg-tertiary)]">
          <li>
            {t(
              'stageGate.ruleJump',
              'Stage jumps: a bid moves one step at a time, or closes, or reopens.',
            )}
          </li>
          <li>
            {t(
              'stageGate.ruleDecision',
              'Standing decision: an opportunity with a recorded No-Go / No-Bid cannot advance until a positive gate or a justified override is on record.',
            )}
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--fg-tertiary)]">
          {isAdmin
            ? t('stageGate.persistedHint', 'Applies to every opportunity in this workspace.')
            : t('stageGate.readOnlyHint', 'Stage-gate enforcement is read-only unless you are an admin.')}
        </p>
        <Button
          variant="primary"
          onClick={onSave}
          disabled={disabled || !changed}
          aria-label={t('stageGate.saveButton', 'Save stage-gate enforcement')}
        >
          {update.isPending
            ? t('stageGate.savingButton', 'Saving...')
            : t('stageGate.saveButton', 'Save stage-gate enforcement')}
        </Button>
      </div>
    </Card>
  );
}
