import { useOnboardingStore } from '@/stores/onboarding';
import { Button } from '@/components/ui/Button';

export function SampleDataBanner() {
  const hasSampleData = useOnboardingStore((state) => state.hasSampleData);
  const setHasSampleData = useOnboardingStore((state) => state.setHasSampleData);

  if (!hasSampleData) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-lg)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-[var(--fg-primary)]">Sample data is on</div>
          <p className="mt-1 text-xs leading-5 text-[var(--fg-secondary)]">
            Demo records are visible in this workspace. Hide them before executive or client demos.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setHasSampleData(false)}>
          Hide
        </Button>
      </div>
    </div>
  );
}
