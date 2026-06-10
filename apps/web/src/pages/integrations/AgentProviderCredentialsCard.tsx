import { useState, type FormEvent } from 'react';

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
  type AgentProviderCredentialSummary,
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
  const isAdmin = useIsAdmin();
  const credentials = useAgentProviderCredentials();
  const save = useSaveAgentProviderCredential();
  const remove = useRemoveAgentProviderCredential();
  const [editing, setEditing] = useState<AgentProviderCredentialSummary | null>(null);
  const [draftProvider, setDraftProvider] = useState<DirectAgentProvider>('openai');
  const [error, setError] = useState<string | null>(null);

  const items = credentials.data?.items ?? [];
  const configuredCount = items.filter((item) => item.configured).length;

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
      setError('API key is required for this provider.');
      return;
    }
    if (provider === 'claude' && !model && !editing.model) {
      setError('Claude requires a model, for example claude-sonnet-4-5.');
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
      toast.success(`${meta.label} saved`, {
        description: 'Provider status and Agent Studio readiness were refreshed.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save provider credentials.');
    }
  };

  const onRemove = async (provider: DirectAgentProvider) => {
    const meta = providerMeta(provider);
    const ok = await confirm({
      title: `Remove ${meta.label} credentials?`,
      description:
        'Agents will fall back to platform env credentials if available. Existing agent definitions stay intact.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(provider);
      toast.success(`${meta.label} credentials removed`);
    } catch (err) {
      toast.error('Remove failed', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  return (
    <Card>
      <SectionHeader
        title="Direct model provider keys"
        caption="Store org-owned keys for GPT, Claude, Kimi, NVIDIA NIM, and local Gemma. Keys are encrypted at rest and never shown again."
        action={
          isAdmin ? (
            <Button size="sm" onClick={openNew}>
              Add provider
            </Button>
          ) : null
        }
      />

      <div className="p-5">
        {credentials.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : credentials.isError ? (
          <ErrorState
            title="Could not load provider keys"
            message="Provider readiness still uses server env fallback, but saved org keys could not be loaded."
            action={
              <Button size="sm" variant="secondary" onClick={() => void credentials.refetch()}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No provider list returned"
            message="The API should always return the supported direct providers."
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-secondary)]">
              <Badge tone={configuredCount > 0 ? 'jade' : 'amber'}>
                {configuredCount} org provider{configuredCount === 1 ? '' : 's'} saved
              </Badge>
              <span>Platform env providers remain available as fallback when configured.</span>
            </div>
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((item) => (
                <ProviderRow
                  key={item.provider}
                  item={item}
                  isAdmin={isAdmin}
                  onEdit={() => {
                    setError(null);
                    setDraftProvider(item.provider);
                    setEditing(item);
                  }}
                  onRemove={() => void onRemove(item.provider)}
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
  onEdit,
  onRemove,
  removePending,
}: {
  item: AgentProviderCredentialSummary;
  isAdmin: boolean;
  onEdit: () => void;
  onRemove: () => void;
  removePending: boolean;
}) {
  const meta = providerMeta(item.provider);
  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{meta.label}</h3>
            <Badge tone={item.configured ? 'jade' : 'gray'}>
              {item.configured ? 'Org key saved' : 'No org key'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">
            {item.configured
              ? 'This tenant uses its own encrypted provider settings.'
              : 'Uses platform env fallback if configured.'}
          </p>
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {item.configured ? 'Edit' : 'Connect'}
            </Button>
            {item.configured ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-[var(--danger)] hover:text-[var(--danger)]"
                onClick={onRemove}
                disabled={removePending}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <Detail label="Model" value={item.model ?? meta.placeholderModel} />
        <Detail label="Endpoint" value={item.baseUrl ?? meta.placeholderBaseUrl} />
        <Detail label="Key" value={item.apiKeyMasked ?? (meta.keyOptional ? 'Optional' : 'Not saved')} />
        <Detail label="Updated" value={item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'Never'} />
      </dl>
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
  const meta = providerMeta(draftProvider);
  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={editing?.configured ? `Update ${meta.label}` : 'Add model provider'}
        description="The API key is encrypted before storage and never returned to the browser. Leave the key blank when editing to keep the saved key."
      >
        {editing ? (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-xs font-medium text-[var(--fg-secondary)]">
              Provider
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
              label={meta.keyOptional ? 'API key (optional)' : 'API key'}
              name="apiKey"
              type="password"
              placeholder={
                editing.configured
                  ? 'Leave blank to keep the saved key'
                  : meta.keyOptional
                    ? 'Optional for local runtimes'
                    : 'Paste provider key'
              }
            />
            <Field
              label="Model"
              name="model"
              defaultValue={editing.model ?? ''}
              placeholder={meta.placeholderModel}
            />
            <Field
              label="Base URL"
              name="baseUrl"
              defaultValue={editing.baseUrl ?? ''}
              placeholder={meta.placeholderBaseUrl}
              hint={
                draftProvider === 'gemma'
                  ? 'Localhost is accepted only in local development. Production requires public https.'
                  : 'Must be a public https endpoint.'
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
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={savePending}>
                {savePending ? 'Saving...' : 'Save provider'}
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
