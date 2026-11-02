import { useTranslation } from 'react-i18next';

import { usePoloPublicIdentity } from '@/hooks/usePoloIdentity';

export function CfAccessSignIn() {
  const { t } = useTranslation('auth');
  const identity = usePoloPublicIdentity();

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-white/20 bg-white/80 p-8 shadow-xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          {t('cfAccess.kicker', 'Polo')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t('cfAccess.title', 'Your Cloudflare Access identity')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t(
            'cfAccess.body',
            'Polo no longer shares a stub admin. Sign-in is the email Cloudflare Access already verified. If you reached this screen, that email is missing from POLO_ALLOWED_USERS or the Access header did not reach the API.',
          )}
        </p>
        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t('cfAccess.dataMode', 'Data mode')}</dt>
            <dd className="font-medium text-slate-900">{identity.data?.dataMode ?? '…'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t('cfAccess.provider', 'Provider')}</dt>
            <dd className="font-medium text-slate-900">{identity.data?.authProvider ?? '…'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
