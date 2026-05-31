// Settings → AI & Agents → Dust credentials.
//
// The "plug and play" surface: an org admin enters their Dust API key +
// workspace ID once, we validate them against Dust and store the key encrypted,
// and every AI feature (crew agents, RFP drafting, compliance, document
// intelligence) uses the org's own workspace. The key is never shown back —
// only a masked tail. Non-admins see read-only status.

import { useState, type FormEvent } from 'react';

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
      setError('API key and workspace ID are both required.');
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
      toast.success('Dust connected', {
        description: 'Credentials validated and saved. AI features now use your workspace.',
      });
    } catch (err) {
      // The API validates the keys against Dust and returns a clear message.
      setError(err instanceof Error ? err.message : 'Could not save the credentials.');
    }
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: 'Remove Dust credentials?',
      description:
        'AI features will fall back to the platform default (if one is set) or pause until new keys are added.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast.success('Dust credentials removed');
    } catch (err) {
      toast.error('Remove failed', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  return (
    <Card>
      <SectionHeader
        title="Dust credentials"
        caption="Connect your Dust workspace once — crew agents, RFP drafting, compliance and document intelligence all use it automatically."
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
                  Remove
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
                  <Button size="sm">{isOrg ? 'Update keys' : 'Connect Dust'}</Button>
                </DialogTrigger>
                <DialogContent
                  title={isOrg ? 'Update Dust credentials' : 'Connect Dust'}
                  description="We validate the keys against Dust before saving. The API key is encrypted at rest and never shown again."
                >
                  <form onSubmit={onSubmit} className="space-y-4">
                    <Field
                      label="API key"
                      name="apiKey"
                      type="password"
                      placeholder="sk-…"
                      required
                      hint="From Dust → Settings → API Keys."
                    />
                    <Field
                      label="Workspace ID"
                      name="workspaceId"
                      defaultValue={data?.workspaceId ?? ''}
                      placeholder="w-…"
                      required
                    />
                    <Field
                      label="Data source ID"
                      name="dataSourceId"
                      defaultValue={data?.dataSourceId ?? ''}
                      placeholder="Optional — enables document sync"
                    />
                    <Field
                      label="Base URL"
                      name="baseUrl"
                      defaultValue={data?.baseUrl ?? ''}
                      placeholder="Optional — defaults to https://dust.tt/api"
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
                      <Button type="submit" size="sm" disabled={save.isPending}>
                        {save.isPending ? 'Validating…' : 'Validate & save'}
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
            title="Could not load Dust credentials"
            message="Please try again."
            action={
              <Button size="sm" variant="secondary" onClick={() => void creds.refetch()}>
                Retry
              </Button>
            }
          />
        ) : data?.configured ? (
          <ConfiguredView data={data} />
        ) : (
          <EmptyState
            title="Dust isn't connected yet"
            message={
              isAdmin
                ? 'Add your Dust API key and workspace ID to turn on AI drafting, compliance and crew agents.'
                : 'Ask an admin to connect your Dust workspace to enable AI features.'
            }
          />
        )}
      </div>
    </Card>
  );
}

function ConfiguredView({ data }: { data: DustCredentialsSummary }) {
  const fromEnv = data.source === 'env';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={fromEnv ? 'amber' : 'jade'}>
          {fromEnv ? 'Platform default' : 'Connected'}
        </Badge>
        {data.apiKeyMasked ? (
          <code className="rounded bg-[var(--surface-card)] px-2 py-0.5 font-mono text-xs text-[var(--fg-secondary)]">
            ••••{data.apiKeyMasked.replace(/^\*+/, '')}
          </code>
        ) : null}
      </div>
      {fromEnv ? (
        <p className="text-xs text-[var(--fg-tertiary)]">
          Running on the platform&apos;s shared Dust key. Add your own above to use your workspace.
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Detail label="Workspace ID" value={data.workspaceId} />
        <Detail label="Data source ID" value={data.dataSourceId} />
        <Detail label="Base URL" value={data.baseUrl ?? 'https://dust.tt/api'} />
        <Detail
          label="Agent overrides"
          value={
            Object.keys(data.agentIds).length > 0
              ? `${Object.keys(data.agentIds).length} configured`
              : 'Using defaults'
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
