// Settings, Profile. Shown on Profile & Security. Names the signed-in
// person and the auth door the server reported.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { usePoloPublicIdentity } from '@/hooks/usePoloIdentity';
import { useAuth, useUser, useRole } from '@/lib/auth';
import {
  profileAuthProvider,
  profileDisplayName,
  profileIdentityLine,
  profileRole,
  type PoloAuthProvider,
  type ProfileProviderView,
} from './profile-provider';

export function ProfileSection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { role } = useRole();
  const identity = usePoloPublicIdentity();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const visibleRole = profileRole(isSignedIn, role);
  const displayName = profileDisplayName({
    signedIn: isSignedIn,
    fullName: user?.fullName,
    firstName: user?.firstName,
    email,
    signedInFallback: t('profile.signedIn', 'Signed in'),
    guest: t('profile.guest', 'Guest'),
  });
  const emailLine = profileIdentityLine({
    signedIn: isSignedIn,
    value: email,
    missing: t('profile.emailMissing', 'No email on file'),
    signedOut: t('profile.notSignedIn', 'Not signed in'),
  });
  const providerView = profileAuthProvider({
    status: identity.isLoading ? 'loading' : identity.isError ? 'error' : 'ready',
    authProvider: identity.data?.authProvider ?? null,
  });
  const signedOut = t('profile.notSignedIn', 'Not signed in');
  const notOnFile = t('profile.nameMissing', 'Not on file');

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title={t('profile.title', 'Profile')}
          caption={t('profile.caption', 'Your identity in this workspace.')}
        />
        <div className="flex items-center gap-4 p-5">
          <Avatar seed={displayName} size={64} decorative />
          <div className="min-w-0">
            <div className="text-lg font-semibold text-[var(--fg-primary)]">{displayName}</div>
            <div className="text-sm text-[var(--fg-secondary)]">{emailLine}</div>
            <div className="mt-1.5 flex items-center gap-2">
              {visibleRole ? <Badge tone="purple">{visibleRole}</Badge> : null}
              <ProviderBadge view={providerView} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader title={t('profile.accountDetailsTitle', 'Account details')} />
        <dl className="divide-y divide-[var(--border-subtle)] text-sm">
          <DetailRow label={t('profile.fullNameLabel', 'Full name')}>
            {profileIdentityLine({
              signedIn: isSignedIn,
              value: user?.fullName ?? user?.firstName,
              missing: notOnFile,
              signedOut,
            })}
          </DetailRow>
          <DetailRow label={t('profile.emailLabel', 'Email')}>
            {profileIdentityLine({
              signedIn: isSignedIn,
              value: email,
              missing: notOnFile,
              signedOut,
            })}
          </DetailRow>
          <DetailRow label={t('profile.roleLabel', 'Role')}>
            {visibleRole ? (
              <span className="capitalize">{visibleRole}</span>
            ) : (
              profileIdentityLine({
                signedIn: isSignedIn,
                value: null,
                missing: t('profile.roleMissing', 'Not on file'),
                signedOut,
              })
            )}
          </DetailRow>
          <DetailRow label={t('profile.authProviderLabel', 'Auth provider')}>
            <ProviderDetail view={providerView} />
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

function providerCopy(
  provider: PoloAuthProvider,
  t: (key: string, fallback: string) => string,
): { short: string; long: string; tone: BadgeTone } {
  switch (provider) {
    case 'demo':
      return {
        short: t('profile.providerDemoShort', 'Public demo'),
        long: t('profile.providerDemoLong', 'Public demo door. These records are synthetic.'),
        tone: 'amber',
      };
    case 'cf-access':
      return {
        short: t('profile.providerCfAccessShort', 'Cloudflare Access'),
        long: t('profile.providerCfAccessLong', 'Cloudflare Access (per-user email)'),
        tone: 'jade',
      };
    case 'clerk':
      return {
        short: t('profile.providerClerkShort', 'Clerk'),
        long: t('profile.providerClerkLong', 'Clerk (production)'),
        tone: 'jade',
      };
    case 'stub':
      return {
        short: t('profile.providerStubShort', 'Dev stub'),
        long: t('profile.providerStubLong', 'Stub (development)'),
        tone: 'amber',
      };
  }
}

function ProviderBadge({ view }: { view: ProfileProviderView }) {
  const { t } = useTranslation('settings');
  if (view.state === 'loading') {
    const label = t('profile.providerLoading', 'Loading');
    return (
      <span role="status" aria-label={label}>
        {label}
      </span>
    );
  }
  if (view.state === 'unavailable') {
    const label = t('profile.providerUnavailable', 'Could not load');
    return (
      <span role="status" aria-label={label}>
        {label}
      </span>
    );
  }
  const copy = providerCopy(view.provider, t);
  return <Badge tone={copy.tone}>{copy.short}</Badge>;
}

function ProviderDetail({ view }: { view: ProfileProviderView }) {
  const { t } = useTranslation('settings');
  if (view.state === 'loading') {
    const label = t('profile.providerLoading', 'Loading');
    return (
      <span className="text-[var(--fg-secondary)]" role="status" aria-label={label}>
        {label}
      </span>
    );
  }
  if (view.state === 'unavailable') {
    const label = t('profile.providerUnavailable', 'Could not load');
    return (
      <span className="text-[var(--fg-secondary)]" role="status" aria-label={label}>
        {label}
      </span>
    );
  }
  return (
    <span className="text-[var(--fg-secondary)]">{providerCopy(view.provider, t).long}</span>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd className="text-[var(--fg-primary)]">{children}</dd>
    </div>
  );
}
