// Settings → AI & Agents → Dust credentials.
//
// The "plug and play" surface: an org admin enters their Dust API key +
// workspace ID once, we validate them against Dust and store the key encrypted,
// and every AI feature (crew agents, RFP drafting, compliance, document
// intelligence) uses the org's own workspace. The key is never shown back —
// only a masked tail. Non-admins see read-only status.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useDustCredentials,
  useSaveDustCredentials,
  useRemoveDustCredentials,
  type DustCredentialsSummary,
} from '@/hooks/useDustCredentials';
import { useIsAdmin } from '@/lib/auth';

export function DustCredentialsCard() {
  const { t } = useTranslation('integrations');
  const isAdmin = useIsAdmin();
  const creds = useDustCredentials();
  const save = useSaveDustCredentials();
  const remove = useRemoveDustCredentials();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = creds.data;
  const isOrg = data?.source === 'org';

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const apiKey = String(fd.get('apiKey') ?? '').trim();
    const workspaceId = String(fd.get('workspaceId') ?? '').trim();
    const baseUrl = String(fd.get('baseUrl') ?? '').trim();
    const dataSourceId = String(fd.get('dataSourceId') ?? '').trim();
    if (!apiKey || !workspaceId) {
      setError(t('dustCredentials.errorBothRequired', 'API key and workspace ID are both required.'));
      return;
    }
    try {
      await save.mutateAsync({
        apiKey,
        workspaceId,
        baseUrl: baseUrl || undefined,
        dataSourceId: dataSourceId || undefined,
      });
      setOpen(false);
      toast.success(t('dustCredentials.toastConnectedTitle', 'Dust connected'), {
        description: t(
          'dustCredentials.toastConnectedDescription',
          'Credentials validated and saved. AI features now use your workspace.',
        ),
      });
    } catch (err) {
      // The API validates the keys against Dust and returns a clear message.
      setError(
        err instanceof Error
          ? err.message
          : t('dustCredentials.errorCouldNotSave', 'Could not save the credentials.'),
      );
    }
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: t('dustCredentials.confirmRemoveTitle', 'Remove Dust credentials?'),
      description: t(
        'dustCredentials.confirmRemoveDescription',
        'AI features will fall back to the platform default (if one is set) or pause until new keys are added.',
      ),
      confirmLabel: t('dustCredentials.confirmRemoveLabel', 'Remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast.success(t('dustCredentials.toastRemovedTitle', 'Dust credentials removed'));
    } catch (err) {
      toast.error(t('dustCredentials.toastRemoveFailedTitle', 'Remove failed'), {
        description:
          err instanceof Error
            ? err.message
            : t('dustCredentials.errorServerRejected', 'The server rejected the request.'),
      });
    }
  };

  return (
    <Card>
      <SectionHeader
        title={t('dustCredentials.sectionTitle', 'Dust credentials')}
        caption={t(
          'dustCredentials.sectionCaption',
          'Connect your Dust workspace once — crew agents, RFP drafting, compliance and document intelligence all use it automatically.',
        )}
        action={
          isAdmin ? (
            <div className="flex items-center gap-2">
              {isOrg ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--danger)] hover:text-[var(--danger)]"
                  onClick={onRemove}
                  disabled={remove.isPending}
                >
                  {t('dustCredentials.removeButton', 'Remove')}
                </Button>
              ) : null}
              <Dialog
                open={open}
                onOpenChange={(next) => {
                  setOpen(next);
                  if (!next) setError(null);
                }}
              >
                <DialogTrigger asChild>
                  <Button size="sm">
                    {isOrg
                      ? t('dustCredentials.updateKeysButton', 'Update keys')
                      : t('dustCredentials.connectButton', 'Connect Dust')}
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title={
                    isOrg
                      ? t('dustCredentials.dialogUpdateTitle', 'Update Dust credentials')
                      : t('dustCredentials.dialogConnectTitle', 'Connect Dust')
                  }
                  description={t(
                    'dustCredentials.dialogDescription',
                    'We validate the keys against Dust before saving. The API key is encrypted at rest and never shown again.',
                  )}
                >
                  <form onSubmit={onSubmit} className="space-y-4">
                    <Field
                      label={t('dustCredentials.fieldApiKeyLabel', 'API key')}
                      name="apiKey"
                      type="password"
                      placeholder="sk-…"
                      required
                      hint={t('dustCredentials.fieldApiKeyHint', 'From Dust → Settings → API Keys.')}
                    />
                    <Field
                      label={t('dustCredentials.fieldWorkspaceIdLabel', 'Workspace ID')}
                      name="workspaceId"
                      defaultValue={data?.workspaceId ?? ''}
                      placeholder="w-…"
                      required
                    />
                    <Field
                      label={t('dustCredentials.fieldDataSourceIdLabel', 'Data source ID')}
                      name="dataSourceId"
                      defaultValue={data?.dataSourceId ?? ''}
                      placeholder={t(
                        'dustCredentials.fieldDataSourceIdPlaceholder',
                        'Optional — enables document sync',
                      )}
                    />
                    <Field
                      label={t('dustCredentials.fieldBaseUrlLabel', 'Base URL')}
                      name="baseUrl"
                      defaultValue={data?.baseUrl ?? ''}
                      placeholder={t(
                        'dustCredentials.fieldBaseUrlPlaceholder',
                        'Optional — defaults to https://dust.tt/api',
                      )}
                    />
                    {error ? (
                      <p
                        role="alert"
                        className="rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]"
                      >
                        {error}
                      </p>
                    ) : null}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <DialogClose asChild>
                        <Button type="button" variant="secondary" size="sm">
                          {t('dustCredentials.cancelButton', 'Cancel')}
                        </Button>
                      </DialogClose>
                      <Button type="submit" size="sm" disabled={save.isPending}>
                        {save.isPending
                          ? t('dustCredentials.validatingButton', 'Validating…')
                          : t('dustCredentials.validateSaveButton', 'Validate & save')}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          ) : null
        }
      />

      <div className="p-5">
        {creds.isLoading ? (
          <div className="bs-shimmer h-16 w-full rounded-lg" />
        ) : creds.isError ? (
          <ErrorState
            title={t('dustCredentials.loadErrorTitle', 'Could not load Dust credentials')}
            message={t('dustCredentials.loadErrorMessage', 'Please try again.')}
            action={
              <Button size="sm" variant="secondary" onClick={() => void creds.refetch()}>
                {t('dustCredentials.retryButton', 'Retry')}
              </Button>
            }
          />
        ) : data?.configured ? (
          <ConfiguredView data={data} t={t} />
        ) : (
          <EmptyState
            title={t('dustCredentials.emptyTitle', "Dust isn't connected yet")}
            message={
              isAdmin
                ? t(
                    'dustCredentials.emptyMessageAdmin',
                    'Add your Dust API key and workspace ID to turn on AI drafting, compliance and crew agents.',
                  )
                : t(
                    'dustCredentials.emptyMessageNonAdmin',
                    'Ask an admin to connect your Dust workspace to enable AI features.',
                  )
            }
          />
        )}
      </div>
    </Card>
  );
}

function ConfiguredView({
  data,
  t,
}: {
  data: DustCredentialsSummary;
  t: TFunction;
}) {
  const fromEnv = data.source === 'env';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={fromEnv ? 'amber' : 'jade'}>
          {fromEnv
            ? t('dustCredentials.badgePlatformDefault', 'Platform default')
            : t('dustCredentials.badgeConnected', 'Connected')}
        </Badge>
        {data.apiKeyMasked ? (
          <code className="rounded bg-[var(--surface-card)] px-2 py-0.5 font-mono text-xs text-[var(--fg-secondary)]">
            ••••{data.apiKeyMasked.replace(/^\*+/, '')}
          </code>
        ) : null}
      </div>
      {fromEnv ? (
        <p className="text-xs text-[var(--fg-tertiary)]">
          {t(
            'dustCredentials.platformKeyNote',
            "Running on the platform's shared Dust key. Add your own above to use your workspace.",
          )}
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Detail label={t('dustCredentials.detailWorkspaceId', 'Workspace ID')} value={data.workspaceId} />
        <Detail
          label={t('dustCredentials.detailDataSourceId', 'Data source ID')}
          value={data.dataSourceId}
        />
        <Detail
          label={t('dustCredentials.detailBaseUrl', 'Base URL')}
          value={data.baseUrl ?? 'https://dust.tt/api'}
        />
        <Detail
          label={t('dustCredentials.detailAgentOverrides', 'Agent overrides')}
          value={
            Object.keys(data.agentIds).length > 0
              ? t('dustCredentials.agentOverridesConfigured', '{{count}} configured', {
                  count: Object.keys(data.agentIds).length,
                })
              : t('dustCredentials.agentOverridesDefaults', 'Using defaults')
          }
        />
      </dl>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-mono text-sm text-[var(--fg-primary)]">{value ?? '—'}</dd>
    </div>
  );
}

function Field({
  label,
  name,
  hint,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete="off"
        spellCheck={false}
        className="dialog-input"
        {...rest}
      />
      {hint ? <span className="mt-1 block text-xs text-[var(--fg-tertiary)]">{hint}</span> : null}
    </label>
  );
}
