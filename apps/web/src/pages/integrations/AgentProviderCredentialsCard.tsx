import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useAgentProviderCredentials,
  useRemoveAgentProviderCredential,
  useSaveAgentProviderCredential,
  useSetActiveAgentProvider,
  useTestAgentProvider,
  type AgentProviderCredentialSummary,
  type AgentProviderTestResult,
  type DirectAgentProvider,
} from '@/hooks/useAgentProviderCredentials';
import { useIsAdmin } from '@/lib/auth';

const PROVIDERS: Array<{
  value: DirectAgentProvider;
  label: string;
  placeholderModel: string;
  placeholderBaseUrl: string;
  keyOptional?: boolean;
}> = [
  {
    value: 'omniroute',
    label: 'OmniRoute (free gateway)',
    placeholderModel: 'auto/best-free',
    placeholderBaseUrl: 'http://localhost:20128/v1',
    keyOptional: true,
  },
  {
    value: 'claude',
    label: 'Claude',
    placeholderModel: 'claude-sonnet-4-5',
    placeholderBaseUrl: 'https://api.anthropic.com/v1/messages',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    placeholderModel: 'gpt-4o-mini',
    placeholderBaseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'kimi',
    label: 'Kimi',
    placeholderModel: 'moonshot-v1-32k',
    placeholderBaseUrl: 'https://api.moonshot.ai/v1',
  },
  {
    value: 'nvidia_nim',
    label: 'NVIDIA NIM',
    placeholderModel: 'deepseek-ai/deepseek-v4-pro',
    placeholderBaseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    value: 'gemma',
    label: 'Gemma/local',
    placeholderModel: 'gemma3',
    placeholderBaseUrl: 'http://localhost:11434/v1',
    keyOptional: true,
  },
];

function providerMeta(provider: DirectAgentProvider) {
  return PROVIDERS.find((item) => item.value === provider) ?? PROVIDERS[0]!;
}

export function AgentProviderCredentialsCard() {
  const { t } = useTranslation('integrations');
  const isAdmin = useIsAdmin();
  const credentials = useAgentProviderCredentials();
  const save = useSaveAgentProviderCredential();
  const remove = useRemoveAgentProviderCredential();
  const setActive = useSetActiveAgentProvider();
  const test = useTestAgentProvider();
  const [editing, setEditing] = useState<AgentProviderCredentialSummary | null>(null);
  const [draftProvider, setDraftProvider] = useState<DirectAgentProvider>('openai');
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AgentProviderTestResult>>({});
  const [testingProvider, setTestingProvider] = useState<DirectAgentProvider | null>(null);

  const items = credentials.data?.items ?? [];
  const active = credentials.data?.active ?? null;
  const configuredCount = items.filter((item) => item.configured).length;

  const onSetActive = async (provider: DirectAgentProvider | null) => {
    try {
      await setActive.mutateAsync(provider);
      toast.success(
        provider
          ? t('agentProviderCredentials.toast.activeSet', '{{label}} is now the active model', {
              label: providerMeta(provider).label,
            })
          : t('agentProviderCredentials.toast.activeCleared', 'Active model cleared'),
        {
          description: t(
            'agentProviderCredentials.toast.activeSetDescription',
            'Every AI step uses this provider until you switch again — no redeploy.',
          ),
        },
      );
    } catch (err) {
      toast.error(t('agentProviderCredentials.toast.switchFailedTitle', 'Could not switch provider'), {
        description:
          err instanceof Error
            ? err.message
            : t('agentProviderCredentials.toast.serverRejected', 'The server rejected the request.'),
      });
    }
  };

  const onTest = async (provider: DirectAgentProvider) => {
    setTestingProvider(provider);
    try {
      const result = await test.mutateAsync(provider);
      setTestResults((prev) => ({ ...prev, [provider]: result }));
      if (result.ok) {
        toast.success(
          t('agentProviderCredentials.toast.testAliveTitle', '{{label}} is alive', {
            label: providerMeta(provider).label,
          }),
          {
            description: t(
              'agentProviderCredentials.toast.testAliveDescription',
              '{{model}} responded in {{latencyMs}} ms.',
              { model: result.model ?? 'model', latencyMs: result.latencyMs },
            ),
          },
        );
      } else {
        toast.error(
          t('agentProviderCredentials.toast.testNoResponseTitle', '{{label}} did not respond', {
            label: providerMeta(provider).label,
          }),
          {
            description:
              result.error ??
              t('agentProviderCredentials.toast.testNoResponseDescription', 'No response from the provider.'),
          },
        );
      }
    } catch (err) {
      toast.error(t('agentProviderCredentials.toast.testFailedTitle', 'Test failed'), {
        description:
          err instanceof Error
            ? err.message
            : t('agentProviderCredentials.toast.serverRejected', 'The server rejected the request.'),
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const openNew = () => {
    setError(null);
    setDraftProvider('openai');
    setEditing({
      provider: 'openai',
      configured: false,
      source: null,
      model: null,
      baseUrl: null,
      apiKeyMasked: null,
      updatedAt: null,
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!editing) return;

    const fd = new FormData(event.currentTarget);
    const provider = String(fd.get('provider') ?? draftProvider) as DirectAgentProvider;
    const meta = providerMeta(provider);
    const apiKey = String(fd.get('apiKey') ?? '').trim();
    const model = String(fd.get('model') ?? '').trim();
    const baseUrl = String(fd.get('baseUrl') ?? '').trim();

    if (!meta.keyOptional && !apiKey && !editing.configured) {
      setError(
        t('agentProviderCredentials.error.apiKeyRequired', 'API key is required for this provider.'),
      );
      return;
    }
    if (provider === 'claude' && !model && !editing.model) {
      setError(
        t(
          'agentProviderCredentials.error.claudeModelRequired',
          'Claude requires a model, for example claude-sonnet-4-5.',
        ),
      );
      return;
    }

    try {
      await save.mutateAsync({
        provider,
        apiKey: apiKey || undefined,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
      });
      setEditing(null);
      toast.success(
        t('agentProviderCredentials.toast.savedTitle', '{{label}} saved', { label: meta.label }),
        {
          description: t(
            'agentProviderCredentials.toast.savedDescription',
            'Provider status and Agent Studio readiness were refreshed.',
          ),
        },
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('agentProviderCredentials.error.saveFailed', 'Could not save provider credentials.'),
      );
    }
  };

  const onRemove = async (provider: DirectAgentProvider) => {
    const meta = providerMeta(provider);
    const ok = await confirm({
      title: t('agentProviderCredentials.remove.confirmTitle', 'Remove {{label}} credentials?', {
        label: meta.label,
      }),
      description: t(
        'agentProviderCredentials.remove.confirmDescription',
        'Agents will fall back to platform env credentials if available. Existing agent definitions stay intact.',
      ),
      confirmLabel: t('agentProviderCredentials.remove.confirmLabel', 'Remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(provider);
      toast.success(
        t('agentProviderCredentials.toast.removedTitle', '{{label}} credentials removed', {
          label: meta.label,
        }),
      );
    } catch (err) {
      toast.error(t('agentProviderCredentials.toast.removeFailedTitle', 'Remove failed'), {
        description:
          err instanceof Error
            ? err.message
            : t('agentProviderCredentials.toast.serverRejected', 'The server rejected the request.'),
      });
    }
  };

  return (
    <Card>
      <SectionHeader
        title={t('agentProviderCredentials.header.title', 'Model providers')}
        caption={t(
          'agentProviderCredentials.header.caption',
          'Stay vendor-independent: store org-owned keys for GPT, Claude, Kimi, NVIDIA NIM, or local Gemma, then pick the active one. Switching the active provider takes effect on the next AI step — no redeploy. Keys are encrypted at rest and never shown again.',
        )}
        action={
          isAdmin ? (
            <Button size="sm" onClick={openNew}>
              {t('agentProviderCredentials.header.addProvider', 'Add provider')}
            </Button>
          ) : null
        }
      />

      <div className="p-5">
        {credentials.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : credentials.isError ? (
          <ErrorState
            title={t('agentProviderCredentials.errorState.title', 'Could not load provider keys')}
            message={t(
              'agentProviderCredentials.errorState.message',
              'Provider readiness still uses server env fallback, but saved org keys could not be loaded.',
            )}
            action={
              <Button size="sm" variant="secondary" onClick={() => void credentials.refetch()}>
                {t('agentProviderCredentials.errorState.retry', 'Retry')}
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('agentProviderCredentials.emptyState.title', 'No provider list returned')}
            message={t(
              'agentProviderCredentials.emptyState.message',
              'The API should always return the supported direct providers.',
            )}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-secondary)]">
              <Badge tone={configuredCount > 0 ? 'jade' : 'amber'}>
                {configuredCount === 1
                  ? t('agentProviderCredentials.summary.savedCountOne', '{{count}} org provider saved', {
                      count: configuredCount,
                    })
                  : t('agentProviderCredentials.summary.savedCountOther', '{{count}} org providers saved', {
                      count: configuredCount,
                    })}
              </Badge>
              {active ? (
                <Badge tone="purple">
                  {t('agentProviderCredentials.summary.activeBadge', 'Active · {{label}}', {
                    label: providerMeta(active).label,
                  })}
                </Badge>
              ) : (
                <Badge tone="gray">
                  {t(
                    'agentProviderCredentials.summary.noActiveBadge',
                    'No active provider — using platform default',
                  )}
                </Badge>
              )}
              <span>
                {t(
                  'agentProviderCredentials.summary.fallbackNote',
                  'Platform env providers remain available as fallback when configured.',
                )}
              </span>
            </div>
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((item) => (
                <ProviderRow
                  key={item.provider}
                  item={item}
                  isAdmin={isAdmin}
                  isActive={active === item.provider}
                  testResult={testResults[item.provider] ?? null}
                  testPending={test.isPending && testingProvider === item.provider}
                  setActivePending={setActive.isPending}
                  onEdit={() => {
                    setError(null);
                    setDraftProvider(item.provider);
                    setEditing(item);
                  }}
                  onRemove={() => void onRemove(item.provider)}
                  onSetActive={() => void onSetActive(item.provider)}
                  onTest={() => void onTest(item.provider)}
                  removePending={remove.isPending}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <ProviderDialog
        editing={editing}
        draftProvider={draftProvider}
        error={error}
        savePending={save.isPending}
        onProviderChange={setDraftProvider}
        onSubmit={onSubmit}
        onClose={() => {
          setEditing(null);
          setError(null);
        }}
      />
    </Card>
  );
}

function ProviderRow({
  item,
  isAdmin,
  isActive,
  testResult,
  testPending,
  setActivePending,
  onEdit,
  onRemove,
  onSetActive,
  onTest,
  removePending,
}: {
  item: AgentProviderCredentialSummary;
  isAdmin: boolean;
  isActive: boolean;
  testResult: AgentProviderTestResult | null;
  testPending: boolean;
  setActivePending: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onSetActive: () => void;
  onTest: () => void;
  removePending: boolean;
}) {
  const { t } = useTranslation('integrations');
  const meta = providerMeta(item.provider);
  return (
    <li
      className={`rounded-xl border bg-[var(--surface-card)] p-4 ${
        isActive ? 'border-[var(--accent)]' : 'border-[var(--border-subtle)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{meta.label}</h3>
            {isActive ? (
              <Badge tone="purple">{t('agentProviderCredentials.row.activeBadge', 'Active')}</Badge>
            ) : null}
            <Badge tone={item.configured ? 'jade' : 'gray'}>
              {item.configured
                ? t('agentProviderCredentials.row.orgKeySaved', 'Org key saved')
                : t('agentProviderCredentials.row.noOrgKey', 'No org key')}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">
            {isActive
              ? t('agentProviderCredentials.row.activeDescription', 'Drives every AI step for this tenant right now.')
              : item.configured
                ? t(
                    'agentProviderCredentials.row.readyDescription',
                    'Saved and ready — set it active to route AI through it.',
                  )
                : t('agentProviderCredentials.row.fallbackDescription', 'Uses platform env fallback if configured.')}
          </p>
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {item.configured
                ? t('agentProviderCredentials.row.edit', 'Edit')
                : t('agentProviderCredentials.row.connect', 'Connect')}
            </Button>
            {item.configured ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-[var(--danger)] hover:text-[var(--danger)]"
                onClick={onRemove}
                disabled={removePending}
              >
                {t('agentProviderCredentials.row.remove', 'Remove')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <Detail label={t('agentProviderCredentials.detail.model', 'Model')} value={item.model ?? meta.placeholderModel} />
        <Detail
          label={t('agentProviderCredentials.detail.endpoint', 'Endpoint')}
          value={item.baseUrl ?? meta.placeholderBaseUrl}
        />
        <Detail
          label={t('agentProviderCredentials.detail.key', 'Key')}
          value={
            item.apiKeyMasked ??
            (meta.keyOptional
              ? t('agentProviderCredentials.detail.keyOptional', 'Optional')
              : t('agentProviderCredentials.detail.keyNotSaved', 'Not saved'))
          }
        />
        <Detail
          label={t('agentProviderCredentials.detail.updated', 'Updated')}
          value={
            item.updatedAt
              ? new Date(item.updatedAt).toLocaleString()
              : t('agentProviderCredentials.detail.updatedNever', 'Never')
          }
        />
      </dl>
      {isAdmin && item.configured ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          {isActive ? (
            <Badge tone="purple">{t('agentProviderCredentials.row.inUse', 'In use')}</Badge>
          ) : (
            <Button size="sm" onClick={onSetActive} disabled={setActivePending}>
              {t('agentProviderCredentials.row.setActive', 'Set active')}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onTest} disabled={testPending}>
            {testPending
              ? t('agentProviderCredentials.row.testing', 'Testing…')
              : t('agentProviderCredentials.row.test', 'Test')}
          </Button>
          {testResult ? (
            <span
              role="status"
              className={`text-xs ${testResult.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
            >
              {testResult.ok
                ? t('agentProviderCredentials.row.testAlive', 'Alive · {{latencyMs}} ms', {
                    latencyMs: testResult.latencyMs,
                  })
                : t('agentProviderCredentials.row.testFailed', 'Failed · {{error}}', {
                    error:
                      testResult.error ??
                      t('agentProviderCredentials.row.testNoResponse', 'no response'),
                  })}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ProviderDialog({
  editing,
  draftProvider,
  error,
  savePending,
  onProviderChange,
  onSubmit,
  onClose,
}: {
  editing: AgentProviderCredentialSummary | null;
  draftProvider: DirectAgentProvider;
  error: string | null;
  savePending: boolean;
  onProviderChange: (provider: DirectAgentProvider) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('integrations');
  const meta = providerMeta(draftProvider);
  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          editing?.configured
            ? t('agentProviderCredentials.dialog.updateTitle', 'Update {{label}}', { label: meta.label })
            : t('agentProviderCredentials.dialog.addTitle', 'Add model provider')
        }
        description={t(
          'agentProviderCredentials.dialog.description',
          'The API key is encrypted before storage and never returned to the browser. Leave the key blank when editing to keep the saved key.',
        )}
      >
        {editing ? (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-xs font-medium text-[var(--fg-secondary)]">
              {t('agentProviderCredentials.dialog.providerLabel', 'Provider')}
              <select
                name="provider"
                value={draftProvider}
                onChange={(event) => onProviderChange(event.currentTarget.value as DirectAgentProvider)}
                disabled={editing.configured}
                className="mt-1 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-sm text-[var(--fg-primary)]"
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={
                meta.keyOptional
                  ? t('agentProviderCredentials.dialog.apiKeyLabelOptional', 'API key (optional)')
                  : t('agentProviderCredentials.dialog.apiKeyLabel', 'API key')
              }
              name="apiKey"
              type="password"
              placeholder={
                editing.configured
                  ? t(
                      'agentProviderCredentials.dialog.apiKeyPlaceholderKeep',
                      'Leave blank to keep the saved key',
                    )
                  : meta.keyOptional
                    ? t(
                        'agentProviderCredentials.dialog.apiKeyPlaceholderOptional',
                        'Optional for local runtimes',
                      )
                    : t('agentProviderCredentials.dialog.apiKeyPlaceholder', 'Paste provider key')
              }
              hint={
                draftProvider === 'omniroute'
                  ? t(
                      'agentProviderCredentials.omnirouteHint',
                      'Free local AI gateway — no key needed. Routes across many free providers with auto-fallback.',
                    )
                  : undefined
              }
            />
            <Field
              label={t('agentProviderCredentials.dialog.modelLabel', 'Model')}
              name="model"
              defaultValue={editing.model ?? ''}
              placeholder={meta.placeholderModel}
            />
            <Field
              label={t('agentProviderCredentials.dialog.baseUrlLabel', 'Base URL')}
              name="baseUrl"
              defaultValue={editing.baseUrl ?? ''}
              placeholder={meta.placeholderBaseUrl}
              hint={
                draftProvider === 'gemma'
                  ? t(
                      'agentProviderCredentials.dialog.baseUrlHintLocal',
                      'Localhost is accepted only in local development. Production requires public https.',
                    )
                  : t('agentProviderCredentials.dialog.baseUrlHint', 'Must be a public https endpoint.')
              }
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
                  {t('agentProviderCredentials.dialog.cancel', 'Cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending
                  ? t('agentProviderCredentials.dialog.saving', 'Saving...')
                  : t('agentProviderCredentials.dialog.save', 'Save provider')}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
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
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-medium text-[var(--fg-secondary)]">
      {label}
      <input
        name={name}
        type={type}
        className="mt-1 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]"
        {...rest}
      />
      {hint ? <span className="mt-1 block text-[11px] text-[var(--fg-tertiary)]">{hint}</span> : null}
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[var(--fg-primary)]">{value}</dd>
    </div>
  );
}
