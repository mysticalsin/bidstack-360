import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { TeamSection } from '@/components/settings/TeamSection';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { usePoloMe, usePoloPublicIdentity } from '@/hooks/usePoloIdentity';

export function IdentitySection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const isAdmin = useIsAdmin();
  const publicId = usePoloPublicIdentity();
  const me = usePoloMe(isSignedIn);
  const provider = publicId.data?.authProvider ?? me.data?.authProvider;

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title={t('identity.title', 'Login identity')}
          caption={t(
            'identity.caption',
            'Who Polo thinks you are. In real mode this is your Cloudflare Access or Clerk email, never a shared Jane Smith stub.',
          )}
        />
        <div className="space-y-3 p-5 text-sm">
          {publicId.isLoading || (isSignedIn && me.isLoading) ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <>
              <Row label={t('identity.dataMode', 'Data mode')}>
                {publicId.isError || !publicId.data ? (
                  <span>
                    {publicId.isError
                      ? t('identity.modeFailed', 'Could not load data mode. It has not arrived.')
                      : t('identity.modeUnread', 'Checking data mode. It has not arrived.')}
                  </span>
                ) : (
                  <Badge tone={publicId.data.dataMode === 'real' ? 'jade' : 'amber'}>
                    {publicId.data.dataMode === 'real'
                      ? t('identity.modeReal', 'Real')
                      : t('identity.modeDemo', 'Demo')}
                  </Badge>
                )}
              </Row>
              <Row label={t('identity.provider', 'Auth provider')}>
                {provider
                  ? providerLabel(provider, t)
                  : publicId.isError || me.isError
                    ? t(
                        'identity.providerFailed',
                        'Could not load the auth provider. It has not arrived.',
                      )
                    : t(
                        'identity.providerUnread',
                        'Checking the auth provider. It has not arrived.',
                      )}
              </Row>
              {!isSignedIn ? (
                <Row label={t('identity.signedInAs', 'Signed in as')}>
                  {t('identity.signedOut', 'Not signed in')}
                </Row>
              ) : me.isError || !me.data ? (
                <Row label={t('identity.signedInAs', 'Signed in as')}>
                  {me.isError
                    ? t(
                        'identity.personFailed',
                        'Could not load who is signed in. The identity has not arrived.',
                      )
                    : t(
                        'identity.personUnread',
                        'Checking who is signed in. The identity has not arrived.',
                      )}
                </Row>
              ) : (
                <>
                  <Row label={t('identity.signedInAs', 'Signed in as')}>
                    {me.data.name || me.data.email || t('identity.unknown', 'Unknown')}
                  </Row>
                  <Row label={t('identity.email', 'Email')}>{me.data.email ?? '—'}</Row>
                  <Row label={t('identity.legacyRole', 'Legacy role')}>{me.data.role ?? '—'}</Row>
                  <Row label={t('identity.rbacRoles', 'RBAC roles')}>
                    {(me.data.roles ?? []).length > 0 ? me.data.roles.join(', ') : '—'}
                  </Row>
                </>
              )}
            </>
          )}
        </div>
      </Card>

      {isAdmin ? (
        <Card>
          <SectionHeader
            title={t('identity.allowlistTitle', 'Allowlisted users')}
            caption={t(
              'identity.allowlistCaption',
              'Admission control from POLO_ALLOWED_USERS. Cloudflare Access still has to let the person reach Polo; this list is who Polo will provision.',
            )}
          />
          <div className="p-5">
            {!isSignedIn ? (
              <p role="status" className="text-sm text-[var(--fg-secondary)]">
                {t(
                  'identity.allowlistSignedOut',
                  'Sign in to read the allowlist. It has not arrived.',
                )}
              </p>
            ) : !me.isError && me.data === undefined ? (
              <p role="status" className="text-sm text-[var(--fg-secondary)]">
                {t('identity.allowlistUnread', 'Checking the allowlist. It has not arrived.')}
              </p>
            ) : me.isError || !me.data ? (
              <ErrorState
                title={t('identity.allowlistFailedTitle', 'Could not load the allowlist.')}
                message={t('identity.allowlistFailedMessage', 'The allowlist has not arrived.')}
                action={
                  <Button size="sm" variant="secondary" onClick={() => void me.refetch()}>
                    {t('identity.retry', 'Retry')}
                  </Button>
                }
              />
            ) : !me.data.allowlist || me.data.allowlist.length === 0 ? (
              <p className="text-sm text-[var(--fg-secondary)]">
                {t(
                  'identity.allowlistEmpty',
                  'No allowlist configured. Set POLO_ALLOWED_USERS=email:Role,… before loading real data.',
                )}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
                    <th className="py-2 pr-4 font-medium">{t('identity.colEmail', 'Email')}</th>
                    <th className="py-2 font-medium">{t('identity.colRole', 'Role')}</th>
                  </tr>
                </thead>
                <tbody>
                  {me.data.allowlist.map((row) => (
                    <tr key={row.email} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="py-2 pr-4">{row.email}</td>
                      <td className="py-2">
                        <Badge tone="purple">{row.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      <TeamSection />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd className="text-[var(--fg-primary)]">{children}</dd>
    </div>
  );
}

function providerLabel(
  provider: string | undefined,
  t: (key: string, fallback: string) => string,
): string {
  switch (provider) {
    case 'cf-access':
      return t('identity.providerCfAccess', 'Cloudflare Access');
    case 'clerk':
      return t('identity.providerClerk', 'Clerk');
    case 'demo':
      return t('identity.providerDemo', 'Public demo door');
    default:
      return t('identity.providerStub', 'Dev stub (Jane Smith) — not for real data');
  }
}
