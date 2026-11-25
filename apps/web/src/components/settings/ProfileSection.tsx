// Settings → Profile. Shows the user's identity, avatar, role,
// and Microsoft account linkage status.

import { useTranslation } from 'react-i18next';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { usePoloPublicIdentity } from '@/hooks/usePoloIdentity';
import { useAuth, useUser, useRole } from '@/lib/auth';
import { profileAuthLabel, type ProfileAuthLabel } from './profile-auth-provider';

export function ProfileSection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { role } = useRole();

  const seed = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Guest';
  const identity = usePoloPublicIdentity();
  const auth = profileAuthLabel({
    status: identity.isLoading ? 'loading' : identity.isError ? 'error' : 'ready',
    authProvider: identity.data?.authProvider,
  });

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title={t('profile.title', 'Profile')}
          caption={t('profile.caption', 'Your identity in this workspace.')}
        />
        <div className="flex items-center gap-4 p-5">
          <Avatar seed={seed} size={64} decorative />
          <div className="min-w-0">
            <div className="text-lg font-semibold text-[var(--fg-primary)]">
              {user?.fullName ?? user?.firstName ?? t('profile.guest', 'Guest')}
            </div>
            <div className="text-sm text-[var(--fg-secondary)]">
              {user?.primaryEmailAddress?.emailAddress ?? t('profile.notSignedIn', 'Not signed in')}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {role ? (
                <Badge tone="purple">{role}</Badge>
              ) : null}
              <ProfileAuthValue label={auth} variant="short" />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader title={t('profile.accountDetailsTitle', 'Account details')} />
        <dl className="divide-y divide-[var(--border-subtle)] text-sm">
          <DetailRow label={t('profile.fullNameLabel', 'Full name')}>
            {user?.fullName ?? '—'}
          </DetailRow>
          <DetailRow label={t('profile.emailLabel', 'Email')}>
            {user?.primaryEmailAddress?.emailAddress ?? '—'}
          </DetailRow>
          <DetailRow label={t('profile.roleLabel', 'Role')}>
            <span className="capitalize">{role ?? '—'}</span>
          </DetailRow>
          <DetailRow label={t('profile.authProviderLabel', 'Auth provider')}>
            <ProfileAuthValue label={auth} variant="long" />
          </DetailRow>
          <DetailRow label={t('profile.statusLabel', 'Status')}>
            <Badge tone={isSignedIn ? 'jade' : 'gray'}>
              {isSignedIn ? t('profile.signedIn', 'Signed in') : t('profile.signedOut', 'Signed out')}
            </Badge>
          </DetailRow>
        </dl>
      </Card>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd className="text-[var(--fg-primary)]">{children}</dd>
    </div>
  );
}

function ProfileAuthValue({
  label,
  variant,
}: {
  label: ProfileAuthLabel;
  variant: 'short' | 'long';
}) {
  const { t } = useTranslation('settings');
  if (label.state === 'loading') {
    return (
      <span
        role="status"
        aria-label={t('profile.providerLoading', 'Loading')}
        className="text-xs text-[var(--fg-tertiary)]"
      >
        {t('profile.providerLoading', 'Loading')}
      </span>
    );
  }
  if (label.state === 'error') {
    return (
      <span
        role="status"
        aria-label={t('profile.providerError', 'Could not load')}
        className="text-xs text-[var(--fg-tertiary)]"
      >
        {t('profile.providerError', 'Could not load')}
      </span>
    );
  }
  if (variant === 'short') {
    if (label.kind === 'demo') {
      return <Badge tone="amber">{t('profile.providerDemoShort', 'Demo')}</Badge>;
    }
    if (label.kind === 'clerk') {
      return <Badge tone="jade">{t('profile.providerClerkShort', 'Clerk')}</Badge>;
    }
    if (label.kind === 'cf-access') {
      return (
        <Badge tone="jade">{t('profile.providerCfAccessShort', 'Cloudflare Access')}</Badge>
      );
    }
    return <Badge tone="amber">{t('profile.providerStubShort', 'Dev stub')}</Badge>;
  }
  if (label.kind === 'demo') {
    return (
      <span className="text-[var(--fg-secondary)]">{t('profile.providerDemoLong', 'Demo session')}</span>
    );
  }
  if (label.kind === 'clerk') {
    return (
      <span className="text-[var(--fg-secondary)]">
        {t('profile.providerClerkLong', 'Clerk (production)')}
      </span>
    );
  }
  if (label.kind === 'cf-access') {
    return (
      <span className="text-[var(--fg-secondary)]">
        {t('profile.providerCfAccessLong', 'Cloudflare Access (per-user email)')}
      </span>
    );
  }
  return (
    <span className="text-[var(--fg-secondary)]">
      {t('profile.providerStubLong', 'Stub (development) \u2014 not for real data')}
    </span>
  );
}
