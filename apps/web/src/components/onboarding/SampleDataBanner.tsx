import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnboardingStore } from '@/stores/onboarding';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useSampleDataStatus, useDeleteSampleData } from '@/hooks/useOnboarding';

export function SampleDataBanner() {
  const { t } = useTranslation('onboarding');
  // Source of truth is the server status query (the store flag is a fast-path
  // set right after a template install, before the query refetches).
  const status = useSampleDataStatus();
  const storeHas = useOnboardingStore((s) => s.hasSampleData);
  const setHasSampleData = useOnboardingStore((s) => s.setHasSampleData);
  const del = useDeleteSampleData();
  const [hidden, setHidden] = useState(false);

  const hasSampleData = (status.data?.hasSampleData ?? false) || storeHas;
  if (hidden || !hasSampleData) return null;

  function removeSampleData() {
    del.mutate(undefined, {
      onSuccess: () => {
        setHasSampleData(false);
        setHidden(true);
        toast.success(t('sampleDataBanner.removedToast', 'Sample data removed'));
      },
      onError: () =>
        toast.error(t('sampleDataBanner.removeErrorToast', 'Could not remove sample data')),
    });
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-lg)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('sampleDataBanner.title', 'Sample data is on')}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--fg-secondary)]">
            {t(
              'sampleDataBanner.description',
              'Demo records are visible in this workspace. Hide this notice, or remove the sample records entirely before executive or client demos.',
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHidden(true)}>
            {t('sampleDataBanner.hide', 'Hide')}
          </Button>
          <Button variant="secondary" size="sm" onClick={removeSampleData} disabled={del.isPending}>
            {del.isPending
              ? t('sampleDataBanner.removing', 'Removing…')
              : t('sampleDataBanner.remove', 'Remove sample data')}
          </Button>
        </div>
      </div>
    </div>
  );
}
