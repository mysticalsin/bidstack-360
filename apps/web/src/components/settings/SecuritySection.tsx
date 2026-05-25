// Settings → Security. Surfaces SSO status, auth provider details,
// and workspace domain restrictions.

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth, useUser } from '@/lib/auth';

export function SecuritySection() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const usingClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  const ssoDomains = import.meta.env.VITE_SSO_ALLOWED_EMAIL_DOMAINS ?? 'any';
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const workspaceId = import.meta.env.VITE_BIDSTACK_WORKSPACE_ID ?? 'mantu-presales';

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader title="Authentication" caption="How you sign in to this workspace." />
        <dl className="divide-y divide-[var(--border-subtle)] text-sm">
          <DetailRow label="Sign-in method">
            {microsoftEnabled ? (
              <Badge tone="jade">Microsoft SSO</Badge>
            ) : usingClerk ? (
              <Badge tone="blue">Clerk</Badge>
            ) : (
              <Badge tone="gray">Dev stub</Badge>
            )}
          </DetailRow>
          <DetailRow label="Auth provider">
            <span className="text-[var(--fg-secondary)]">
              {usingClerk ? 'Clerk' : 'Local stub (development)'}
            </span>
          </DetailRow>
          <DetailRow label="Status">
            <Badge tone={isSignedIn ? 'jade' : 'gray'}>
              {isSignedIn ? 'Active session' : 'No session'}
            </Badge>
          </DetailRow>
          <DetailRow label="Email">
            {user?.primaryEmailAddress?.emailAddress ?? '—'}
          </DetailRow>
          <DetailRow label="Allowed domains">
            <span className="text-[var(--fg-secondary)]">
              {ssoDomains === 'any' ? 'Any domain' : ssoDomains}
            </span>
          </DetailRow>
          <DetailRow label="Workspace">
            <code className="font-mono text-xs">{workspaceId}</code>
          </DetailRow>
        </dl>
      </Card>

      {microsoftEnabled && (
        <Card>
          <SectionHeader title="Microsoft SSO" caption="Your Microsoft identity is linked to this account." />
          <div className="p-5">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🪟</span>
              <div>
                <div className="text-sm font-medium text-[var(--fg-primary)]">
                  Microsoft account connected
                </div>
                <div className="text-xs text-[var(--fg-secondary)]">
                  Signed in as {user?.primaryEmailAddress?.emailAddress ?? '—'}
                </div>
              </div>
              <Badge tone="jade" className="ml-auto">Active</Badge>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
