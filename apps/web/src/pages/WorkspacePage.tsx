/**
 * WorkspacePage — the embedded AppFlowy collaborative workspace ("Collaborate").
 *
 * Gated by the per-org AppModules toggle. When enabled + a URL is configured by
 * an admin (Settings → Modules), it iframes the deployed AppFlowy instance.
 * Once that record has loaded and the module is off, it shows a setup state.
 * A read that has not arrived is not that setup state. NOTE: AppFlowy is a
 * separate platform (its own auth/data). This is an embed boundary, not a
 * data-integrated module; see docs/solutions/appflowy-workspace.md
 * (AGPL + SSO + data-governance caveats).
 */
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { useAppModules } from '@/hooks/useAppModules';
import { useIsAdmin } from '@/lib/auth';

export default function WorkspacePage() {
  const { data, isPending, isError, refetch } = useAppModules();
  const isAdmin = useIsAdmin();

  if (isPending) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <p role="status">Checking the saved workspace.</p>
          <LoadingSkeleton rows={3} />
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="sr-only">Collaborate</h1>
        <Card>
          <SectionHeader title="Collaborate" caption="Shared workspace for the team" />
          <ErrorState
            title="Could not load the workspace"
            message="The saved workspace has not arrived."
            action={
              <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
                Retry
              </button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!data.appflowyEnabled || !data.appflowyUrl) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="sr-only">Collaborate</h1>
        <Card>
          <SectionHeader title="Collaborate" caption="Shared workspace for the team" />
          <EmptyState
            title="Workspace not configured yet"
            message={
              isAdmin
                ? 'Enable the Collaborate module and paste your AppFlowy workspace URL in Settings → Modules.'
                : 'An admin needs to enable this workspace in Settings → Modules.'
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h,56px))] flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <Icon name="note" size={16} className="text-[var(--fg-tertiary)]" ariaHidden />
        <h1 className="text-sm font-semibold text-[var(--fg-primary)]">Collaborate</h1>
        <a
          href={data.appflowyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-[var(--fg-tertiary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        >
          Open in new tab
        </a>
      </div>
      <iframe
        src={data.appflowyUrl}
        title="Collaborative workspace"
        className="min-h-0 flex-1 border-0"
        // AppFlowy runs its own scripts + auth; allow the minimum it needs.
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
