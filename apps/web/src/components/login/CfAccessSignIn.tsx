import { useTranslation } from 'react-i18next';

import { usePoloPublicIdentity } from '@/hooks/usePoloIdentity';
import { useCfAccessStatus } from '@/lib/auth';

export function CfAccessSignIn() {
  const { t } = useTranslation('auth');
  const identity = usePoloPublicIdentity();
  const { failure, retry } = useCfAccessStatus();

  const status = failure?.status ?? null;
  const reason =
    status === 403
      ? t(
          'cfAccess.reason403',
          'Cloudflare Access verified your email, but it is not on the Polo access list. Ask a Polo admin to add it.',
        )
      : status === 401
        ? t(
            'cfAccess.reason401',
            'Polo did not receive your Cloudflare Access identity. Reload the page, or sign out of Cloudflare Access and sign in again.',
          )
        : t(
            'cfAccess.reasonUnavailable',
            'Polo is starting up or could not be reached. This usually clears within a minute.',
          );

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-white/20 bg-white/80 p-8 shadow-xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          {t('cfAccess.kicker', 'Polo')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t('cfAccess.title', 'Your Cloudflare Access identity')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600" data-testid="cf-access-reason">
          {reason}
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-5 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t('cfAccess.retry', 'Try again')}
        </button>
        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t('cfAccess.dataMode', 'Data mode')}</dt>
            <dd className="font-medium text-slate-900">{identity.data?.dataMode ?? '…'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{t('cfAccess.provider', 'Provider')}</dt>
            <dd className="font-medium text-slate-900">{identity.data?.authProvider ?? '…'}</dd>
          </div>
          {failure ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{t('cfAccess.detail', 'Server reply')}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-slate-900">
                {status ?? t('cfAccess.noReply', 'no reply')} {failure.message}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
