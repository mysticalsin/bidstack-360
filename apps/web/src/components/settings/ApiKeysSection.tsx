// Settings → API keys card. Mirrors Twenty's developer settings — list of
// active keys (showing only the prefix), one-shot reveal of the secret on
// creation, and revoke action. Secrets are SHA-256 hashed server-side; the
// raw value is shown exactly once and never re-derivable.

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKeyCreated,
  type ApiKeyScope,
} from '@/hooks/useApiKeys';
import { formatDate, relativeTime } from '@/lib/format';

const ALL_SCOPES: ApiKeyScope[] = ['read', 'write', 'mcp'];

export function ApiKeysSection() {
  const list = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const scopes = ALL_SCOPES.filter((s) => fd.get(`scope-${s}`) === 'on');
    if (!name) {
      setError('Name is required');
      return;
    }
    if (scopes.length === 0) {
      setError('Select at least one scope');
      return;
    }
    try {
      const created = await create.mutateAsync({ name, scopes });
      setRevealed(created);
      setOpen(false);
      toast.success('API key created', {
        description: 'Copy the secret now — it will not be shown again.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  };

  const onRevoke = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Revoke "${name}"?`,
      description:
        'Any client using this key will start failing immediately. This cannot be undone.',
      confirmLabel: 'Revoke key',
      destructive: true,
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync(id);
      toast.success(`Revoked "${name}"`);
    } catch (err) {
      toast.error('Revoke failed', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  const copySecret = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the secret is still visible in the textbox */
    }
  };

  const items = list.data?.items ?? [];

  return (
    <Card>
      <SectionHeader
        title="API keys"
        caption="Used by MCP clients, REST callers, and CI jobs. SHA-256 hashed at rest."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">+ New API key</Button>
            </DialogTrigger>
            <DialogContent
              title="Create API key"
              description="You'll see the secret exactly once — copy it before closing."
            >
              <form onSubmit={onSubmit} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    Name
                  </span>
                  <input
                    name="name"
                    required
                    placeholder="e.g. dust-prod, mcp-cli"
                    className="dialog-input"
                  />
                </label>
                <fieldset>
                  <legend className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    Scopes
                  </legend>
                  <div className="space-y-2">
                    {ALL_SCOPES.map((s) => (
                      <label key={s} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name={`scope-${s}`}
                          defaultChecked={s === 'read'}
                          className="mt-0.5 accent-[var(--brand-primary)]"
                        />
                        <span>
                          <span className="font-medium text-[var(--fg-primary)]">{s}</span>
                          <span className="ml-2 text-xs text-[var(--fg-tertiary)]">
                            {SCOPE_HELP[s]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
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
                  <Button type="submit" size="sm" disabled={create.isPending}>
                    {create.isPending ? 'Creating…' : 'Create key'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {revealed ? (
        <div className="mx-5 mt-4 rounded-md border border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] p-3">
          <div className="text-xs font-semibold text-[var(--fg-primary)]">
            Copy your new key now — it won&apos;t be shown again.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="block flex-1 select-all overflow-x-auto rounded bg-[var(--surface-card)] px-2 py-1 font-mono text-xs text-[var(--fg-primary)]">
              {revealed.secret}
            </code>
            <Button size="sm" variant="secondary" onClick={copySecret}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {list.isLoading ? (
        <ul className="divide-y divide-[var(--border-subtle)] text-sm">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="px-5 py-4">
              {/* Use the shared `bs-shimmer` keyframe so loading
                  states across the app feel identical — instead of the
                  generic Tailwind .animate-pulse which uses a different
                  curve. */}
              <div className="bs-shimmer h-4 w-1/3" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          title="No API keys yet"
          message="Create one to let Dust, your MCP client, or a CI job authenticate."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--fg-primary)]">{k.name}</span>
                  <code className="font-mono text-xs text-[var(--fg-tertiary)]">{k.prefix}…</code>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                  <span>Created {formatDate(k.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{k.lastUsedAt ? `Used ${relativeTime(k.lastUsedAt)}` : 'Never used'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {k.scopes.map((s) => (
                  <Badge key={s} tone={s === 'write' ? 'amber' : s === 'mcp' ? 'purple' : 'gray'}>
                    {s}
                  </Badge>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--danger)] hover:text-[var(--danger)]"
                  onClick={() => onRevoke(k.id, k.name)}
                  disabled={revoke.isPending}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const SCOPE_HELP: Record<ApiKeyScope, string> = {
  read: 'Read-only access to all org data.',
  write: 'Create / update / delete records.',
  mcp: 'Call MCP tools (read + write + tool invocations).',
};
