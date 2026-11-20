import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useOrgDemoData, useUpdateOrgDemoData } from '@/hooks/useOrgDemoData';

export function DemoDataSection() {
  const { t } = useTranslation('settings');
  const query = useOrgDemoData();
  const update = useUpdateOrgDemoData();
  const on = query.data?.demoData === true;

  return (
    <Card>
      <SectionHeader
        title={t('demoData.title', 'Demo data')}
        caption={t(
          'demoData.caption',
          'Off by default. Turn this on only to show the built-in sample accounts and sample numbers. Your own records stay either way. Turning it off hides sample rows. It does not delete them.',
        )}
      />
      <div className="space-y-3 p-5">
        {query.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : query.isError ? (
          <ErrorState
            title={t('demoData.errorTitle', 'Could not load demo data')}
            message={t('demoData.errorMessage', 'Try again in a moment.')}
            action={
              <button type="button" className="btn btn-secondary" onClick={() => void query.refetch()}>
                {t('demoData.retry', 'Retry')}
              </button>
            }
          />
        ) : (
          <label className="flex min-h-11 items-center justify-between gap-4">
            <span className="text-sm text-[var(--fg-primary)]">
              {t('demoData.switchLabel', 'Show sample numbers')}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={on}
              disabled={update.isPending}
              aria-describedby="demo-data-help"
              onChange={(event) => update.mutate(event.target.checked)}
            />
          </label>
        )}
        <p id="demo-data-help" className="text-sm text-[var(--fg-secondary)]">
          {on
            ? t('demoData.onHelp', 'Sample numbers are visible in this workspace.')
            : t('demoData.offHelp', 'Sample numbers are hidden. Empty pages ask you to add the first record.')}
        </p>
        {update.isError ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {t('demoData.saveError', 'Could not save. Try again.')}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
