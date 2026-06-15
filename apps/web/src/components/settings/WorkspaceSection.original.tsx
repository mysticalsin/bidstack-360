// Settings → Workspace card. Surfaces the authenticated user + workspace
// fingerprint so an admin can verify they're in the right org before
// minting API keys or wiring integrations. Member management is intentionally
// out-of-scope for v1 — Clerk owns invites in production, and the stub user
// is a single seat in dev.

import { useTranslation } from 'react-i18next';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth, useUser } from '@/lib/auth';

export function WorkspaceSection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const workspaceId = import.meta.env.VITE_BIDSTACK_WORKSPACE_ID ?? 'mantu-presales';
  const env = (import.meta.env.MODE ?? 'development').toLowerCase();
  const usingClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

  return (
    <Card>
      <SectionHeader
        title={t('workspaceSection.original.title', 'Workspace')}
        caption={t(
          'workspaceSection.original.caption',
          "The org you're authenticated against and the user identity scoped to it.",
        )}
      />
      <dl className="divide-y divide-[var(--border-subtle)] text-sm">
        <Row label={t('workspaceSection.original.workspaceIdLabel', 'Workspace ID')}>
          <code className="font-mono text-xs text-[var(--fg-primary)]">{workspaceId}</code>
        </Row>
        <Row label={t('workspaceSection.original.environmentLabel', 'Environment')}>
          <Badge tone={env === 'production' ? 'jade' : env === 'staging' ? 'amber' : 'gray'}>
            {env}
          </Badge>
        </Row>
        <Row label={t('workspaceSection.original.authProviderLabel', 'Auth provider')}>
          <Badge tone={usingClerk ? 'jade' : 'gray'}>
            {usingClerk
              ? t('workspaceSection.original.authProviderClerk', 'Clerk')
              : t('workspaceSection.original.authProviderStub', 'Stub (dev)')}
          </Badge>
        </Row>
        <Row label={t('workspaceSection.original.signedInAsLabel', 'Signed in as')}>
          {isSignedIn && user ? (
            <div className="text-right">
              <div className="font-medium text-[var(--fg-primary)]">
                {user.fullName ?? user.firstName ?? user.primaryEmailAddress?.emailAddress}
              </div>
              {user.primaryEmailAddress ? (
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {user.primaryEmailAddress.emailAddress}
                </div>
              ) : null}
            </div>
          ) : (
            <span className="text-[var(--fg-tertiary)]">
              {t('workspaceSection.original.notSignedIn', 'Not signed in')}
            </span>
          )}
        </Row>
      </dl>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
