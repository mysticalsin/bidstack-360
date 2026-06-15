// Settings → Security. Surfaces SSO status, auth provider details,
// and workspace domain restrictions.

import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth, useUser } from '@/lib/auth';

export function SecuritySection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const usingClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  const ssoDomains = import.meta.env.VITE_SSO_ALLOWED_EMAIL_DOMAINS ?? 'any';
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const workspaceId = import.meta.env.VITE_BIDSTACK_WORKSPACE_ID ?? 'mantu-presales';

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title={t('security.authentication.title', 'Authentication')}
          caption={t('security.authentication.caption', 'How you sign in to this workspace.')}
        />
        <dl className="divide-y divide-[var(--border-subtle)] text-sm">
          <DetailRow label={t('security.signInMethod.label', 'Sign-in method')}>
            {microsoftEnabled ? (
              <Badge tone="jade">{t('security.signInMethod.microsoftSso', 'Microsoft SSO')}</Badge>
            ) : usingClerk ? (
              <Badge tone="blue">{t('security.signInMethod.clerk', 'Clerk')}</Badge>
            ) : (
              <Badge tone="gray">{t('security.signInMethod.devStub', 'Dev stub')}</Badge>
            )}
          </DetailRow>
          <DetailRow label={t('security.authProvider.label', 'Auth provider')}>
            <span className="text-[var(--fg-secondary)]">
              {usingClerk
                ? t('security.authProvider.clerk', 'Clerk')
                : t('security.authProvider.localStub', 'Local stub (development)')}
            </span>
          </DetailRow>
          <DetailRow label={t('security.status.label', 'Status')}>
            <Badge tone={isSignedIn ? 'jade' : 'gray'}>
              {isSignedIn
                ? t('security.status.activeSession', 'Active session')
                : t('security.status.noSession', 'No session')}
            </Badge>
          </DetailRow>
          <DetailRow label={t('security.email.label', 'Email')}>
            {user?.primaryEmailAddress?.emailAddress ?? '—'}
          </DetailRow>
          <DetailRow label={t('security.allowedDomains.label', 'Allowed domains')}>
            <span className="text-[var(--fg-secondary)]">
              {ssoDomains === 'any' ? t('security.allowedDomains.any', 'Any domain') : ssoDomains}
            </span>
          </DetailRow>
          <DetailRow label={t('security.workspace.label', 'Workspace')}>
            <code className="font-mono text-xs">{workspaceId}</code>
          </DetailRow>
        </dl>
      </Card>

      {microsoftEnabled && (
        <Card>
          <SectionHeader
            title={t('security.microsoftSso.title', 'Microsoft SSO')}
            caption={t(
              'security.microsoftSso.caption',
              'Your Microsoft identity is linked to this account.',
            )}
          />
          <div className="p-5">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🪟</span>
              <div>
                <div className="text-sm font-medium text-[var(--fg-primary)]">
                  {t('security.microsoftSso.connected', 'Microsoft account connected')}
                </div>
                <div className="text-xs text-[var(--fg-secondary)]">
                  {t('security.microsoftSso.signedInAs', 'Signed in as {{email}}', {
                    email: user?.primaryEmailAddress?.emailAddress ?? '—',
                  })}
                </div>
              </div>
              <Badge tone="jade" className="ml-auto">
                {t('security.microsoftSso.active', 'Active')}
              </Badge>
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
