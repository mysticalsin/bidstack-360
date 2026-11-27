import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { TeamSection } from '@/components/settings/TeamSection';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { usePoloMe, usePoloPublicIdentity } from '@/hooks/usePoloIdentity';
import {
  LOGIN_IDENTITY_CAPTION,
  loginDataModeLabel,
  loginDoor,
  loginProviderLabel,
  loginRoleList,
  loginText,
} from './login-identity';

export function IdentitySection() {
  const { t } = useTranslation('settings');
  const { isSignedIn } = useAuth();
  const isAdmin = useIsAdmin();
  const publicId = usePoloPublicIdentity();
  const me = usePoloMe(isSignedIn);
  const notOnFile = t('identity.notOnFile', 'Not on file');
  const couldNotLoad = t('identity.couldNotLoad', 'Could not load');
  const door = loginDoor({
    publicId: {
      status: publicId.isLoading ? 'loading' : publicId.isError ? 'error' : 'ready',
      dataMode: publicId.data?.dataMode,
      authProvider: publicId.data?.authProvider,
    },
    me: {
      status: me.isLoading ? 'loading' : me.isError ? 'error' : 'ready',
      dataMode: me.data?.dataMode,
      authProvider: me.data?.authProvider,
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title={t('identity.title', 'Login identity')}
          caption={t('identity.caption', LOGIN_IDENTITY_CAPTION)}
        />
        <div className="space-y-3 p-5 text-sm">
          {door.state === 'loading' ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <>
              <Row label={t('identity.dataMode', 'Data mode')}>
                {door.state === 'ready' ? (
                  <Badge tone={door.dataMode === 'real' ? 'jade' : 'amber'}>
                    {door.dataMode === 'real'
                      ? t('identity.modeReal', loginDataModeLabel('real'))
                      : t('identity.modeDemo', loginDataModeLabel('demo'))}
                  </Badge>
                ) : (
                  <span role="status" aria-label={couldNotLoad}>
                    {couldNotLoad}
                  </span>
                )}
              </Row>
              <Row label={t('identity.provider', 'Auth provider')}>
                {door.state === 'ready' ? (
                  t(`identity.provider.${door.provider}`, loginProviderLabel(door.provider))
                ) : (
                  <span role="status" aria-label={couldNotLoad}>
                    {couldNotLoad}
                  </span>
                )}
              </Row>
              <Row label={t('identity.signedInAs', 'Signed in as')}>
                {loginText(me.data?.name || me.data?.email, notOnFile)}
              </Row>
              <Row label={t('identity.email', 'Email')}>{loginText(me.data?.email, notOnFile)}</Row>
              <Row label={t('identity.legacyRole', 'Legacy role')}>
                {loginText(me.data?.role, notOnFile)}
              </Row>
              <Row label={t('identity.rbacRoles', 'RBAC roles')}>
                {loginRoleList(me.data?.roles, notOnFile)}
              </Row>
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
            {!me.data?.allowlist || me.data.allowlist.length === 0 ? (
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
