// Data residency tag for the workspace. Tenant exports are written to the
// regional bucket for this tag (S3_BUCKET_<REGION>); the list below says what
// the tag does not cover yet, so nobody reads it as a full residency guarantee.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { useDataResidency, useUpdateDataResidency } from '@/hooks/useDataResidency';
import type { DataRegion, OrgDataResidencyView } from '@bidstack/shared';

// '' is the wire's `null` (not pinned); a select cannot carry null.
const OPTIONS: { value: DataRegion | ''; labelKey: string; fallback: string }[] = [
  { value: '', labelKey: 'dataResidency.regionNone', fallback: 'Not pinned (deployment default)' },
  { value: 'eu', labelKey: 'dataResidency.regionEu', fallback: 'European Union' },
  { value: 'uk', labelKey: 'dataResidency.regionUk', fallback: 'United Kingdom' },
  { value: 'us', labelKey: 'dataResidency.regionUs', fallback: 'United States' },
  { value: 'ca', labelKey: 'dataResidency.regionCa', fallback: 'Canada' },
];

export function DataResidencySection() {
  const { t } = useTranslation('settings');
  const residency = useDataResidency();

  if (residency.isLoading) return <LoadingSkeleton rows={2} />;
  if (residency.isError || !residency.data) {
    return (
      <ErrorState
        title={t('dataResidency.loadErrorTitle', 'Could not load the data region')}
        message={residency.error?.message ?? t('dataResidency.loadErrorMessage', 'Try again shortly.')}
      />
    );
  }
  return <DataResidencyForm key={JSON.stringify(residency.data)} initial={residency.data} />;
}

function DataResidencyForm({ initial }: { initial: OrgDataResidencyView }) {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const update = useUpdateDataResidency();
  const [region, setRegion] = useState<DataRegion | ''>(initial.region ?? '');
  const changed = (region === '' ? null : region) !== initial.region;
  const disabled = !isAdmin || update.isPending;

  const onSave = () => {
    update.mutate(
      { region: region === '' ? null : region },
      {
        onSuccess: () => toast.success(t('dataResidency.saveSuccess', 'Data region saved')),
        onError: (err: Error) =>
          toast.error(t('dataResidency.saveError', 'Could not save the data region'), {
            description: err.message,
          }),
      },
    );
  };

  return (
    <Card>
      <SectionHeader
        title={t('dataResidency.title', 'Data residency')}
        caption={t(
          'dataResidency.caption',
          'Region tag for this workspace. Tenant exports are stored in the bucket configured for the region.',
        )}
      />
      <div className="p-5">
        <label
          htmlFor="org-data-region"
          className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
        >
          {t('dataResidency.regionLabel', 'Data region')}
        </label>
        <select
          id="org-data-region"
          className="input w-full sm:max-w-sm"
          disabled={disabled}
          value={region}
          onChange={(e) => setRegion(e.target.value as DataRegion | '')}
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey, opt.fallback)}
            </option>
          ))}
        </select>
        <p className="mt-3 text-xs text-[var(--fg-secondary)]">
          {initial.regionalStorage
            ? t('dataResidency.storageReady', 'A regional bucket is configured for this region.')
            : t(
                'dataResidency.storageMissing',
                'No regional bucket is configured for this region; exports use the default bucket.',
              )}{' '}
          {initial.enforced
            ? t('dataResidency.enforcedOn', 'Strict mode is on: exports fail rather than leave the region.')
            : t('dataResidency.enforcedOff', 'Strict mode is off.')}
        </p>
        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          {t(
            'dataResidency.gaps',
            'Not enforced yet: file uploads, call recordings, the database itself and AI model providers. These still follow the deployment configuration.',
          )}
        </p>
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--fg-tertiary)]">
          {isAdmin
            ? t('dataResidency.persistedHint', 'Applies to the whole workspace.')
            : t('dataResidency.readOnlyHint', 'The data region is read-only unless you are an admin.')}
        </p>
        <Button
          variant="primary"
          onClick={onSave}
          disabled={disabled || !changed}
          aria-label={t('dataResidency.saveButton', 'Save data region')}
        >
          {update.isPending
            ? t('dataResidency.savingButton', 'Saving...')
            : t('dataResidency.saveButton', 'Save data region')}
        </Button>
      </div>
    </Card>
  );
}
