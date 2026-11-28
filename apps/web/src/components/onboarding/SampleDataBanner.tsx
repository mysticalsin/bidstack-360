import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnboardingStore } from '@/stores/onboarding';
import { Button } from '@/components/ui/Button';
import { confirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useSampleDataStatus, useDeleteSampleData } from '@/hooks/useOnboarding';
import { ONBOARDING_SELLER_COPY } from './reference-copy';

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

  async function removeSampleData() {
    const ok = await confirm({
      title: t('sampleDataBanner.remove', ONBOARDING_SELLER_COPY['sampleDataBanner.remove']),
      description: t('sampleData.confirmClear', ONBOARDING_SELLER_COPY['sampleData.confirmClear']),
      confirmLabel: t('sampleDataBanner.remove', ONBOARDING_SELLER_COPY['sampleDataBanner.remove']),
      destructive: true,
    });
    if (!ok) return;
    del.mutate(undefined, {
      onSuccess: () => {
        setHasSampleData(false);
        setHidden(true);
        toast.success(t('sampleDataBanner.removedToast', ONBOARDING_SELLER_COPY['sampleDataBanner.removedToast']));
      },
      onError: () =>
        toast.error(
          t('sampleDataBanner.removeErrorToast', ONBOARDING_SELLER_COPY['sampleDataBanner.removeErrorToast']),
        ),
    });
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-lg)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('sampleDataBanner.title', ONBOARDING_SELLER_COPY['sampleDataBanner.title'])}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--fg-secondary)]">
            {t('sampleDataBanner.description', ONBOARDING_SELLER_COPY['sampleDataBanner.description'])}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHidden(true)}>
            {t('sampleDataBanner.hide', 'Hide')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void removeSampleData()} disabled={del.isPending}>
            {del.isPending
              ? t('sampleDataBanner.removing', 'Removing…')
              : t('sampleDataBanner.remove', ONBOARDING_SELLER_COPY['sampleDataBanner.remove'])}
          </Button>
        </div>
      </div>
    </div>
  );
}
