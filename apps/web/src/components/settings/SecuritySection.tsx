// Settings → Security. Surfaces SSO status, auth provider details,
// and workspace domain restrictions.

import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth, useUser } from '@/lib/auth';
import { ssoSignInPolicy } from '@/lib/sso-policy';

export function SecuritySection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const usingClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  const ssoDomains = import.meta.env.VITE_SSO_ALLOWED_EMAIL_DOMAINS ?? 'any';
  const { microsoft: microsoftEnabled, google: googleEnabled } = ssoSignInPolicy();
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
              <Badge tone="jade">
                {t('security.signInMethod.microsoftOfficial', 'Microsoft, official')}
              </Badge>
            ) : usingClerk ? (
              <Badge tone="blue">{t('security.signInMethod.clerk', 'Clerk')}</Badge>
            ) : (
              <Badge tone="gray">{t('security.signInMethod.devStub', 'Dev stub')}</Badge>
            )}
          </DetailRow>
          <DetailRow label={t('security.googleSignIn.label', 'Google sign-in')}>
            <Badge tone={googleEnabled ? 'blue' : 'gray'}>
              {googleEnabled
                ? t('security.googleSignIn.available', 'Available in this version, including Gmail')
                : t('security.googleSignIn.off', 'Turned off')}
            </Badge>
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
              'Microsoft is the official account. Google sign-in and Gmail stay available in this version.',
            )}
          />
          <div className="p-5">
            <div className="flex items-center gap-3">
              <MicrosoftLogo />
              <div>
                <div className="text-sm font-medium text-[var(--fg-primary)]">
                  {usingClerk
                    ? t('security.microsoftSso.connected', 'Microsoft account connected')
                    : t(
                        'security.microsoftSso.officialNotLive',
                        'Microsoft is the official account. This dev session is not a Microsoft login.',
                      )}
                </div>
                <div className="text-xs text-[var(--fg-secondary)]">
                  {t('security.microsoftSso.signedInAs', 'Signed in as {{email}}', {
                    email: user?.primaryEmailAddress?.emailAddress ?? '—',
                  })}
                </div>
              </div>
              <Badge tone={usingClerk ? 'jade' : 'gray'} className="ml-auto">
                {usingClerk
                  ? t('security.microsoftSso.active', 'Active')
                  : t('security.microsoftSso.notLive', 'Not live')}
              </Badge>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// The official Microsoft four-square brand mark, matching the SVG used on the
// login screen (login/Navbar.tsx) — a real logo instead of the 🪟 Windows
// emoji, which is an OS glyph, not the Microsoft identity mark.
function MicrosoftLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
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
