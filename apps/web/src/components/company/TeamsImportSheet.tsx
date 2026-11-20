// Import from Teams (slice 26, DESIGN.md 9.12). The person picks a chat or a
// channel thread they are in, chooses messages and files them to an account.
// Read-only: Polo reads through Microsoft Graph and never posts to Teams.

import { ArrowLeft, ExternalLink, MessageSquare, Paperclip, RefreshCw } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';

import type { TeamsChatSummary, TeamsThreadRef } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sheet, SheetContent } from '@/components/ui/Sheet';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import {
  teamsAccessCode,
  teamsRefKey,
  useConnectTeams,
  useImportTeams,
  useSetTeamsLink,
  useTeamsAccess,
  useTeamsChannelThreads,
  useTeamsChannels,
  useTeamsChats,
  useTeamsLinks,
  useTeamsMessages,
  useTeamsTeams,
} from '@/hooks/useTeamsImport';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1';

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ConsentPrompt({ kind }: { kind: 'not_connected' | 'needs_consent' | 'revoked' | 'not_configured' }) {
  const connect = useConnectTeams();
  if (kind === 'not_configured') {
    return (
      <p className="text-sm text-[var(--fg-secondary)]">
        Microsoft 365 is not set up on this server yet. Ask an admin to configure it.
      </p>
    );
  }
  const copy =
    kind === 'not_connected'
      ? { text: 'Connect Microsoft 365 to import Teams chats.', action: 'Connect Microsoft 365' }
      : kind === 'revoked'
        ? { text: 'Your Microsoft 365 access was revoked. Reconnect to import Teams chats.', action: 'Reconnect with Teams access' }
        : {
            text: 'Polo needs permission to read your Teams chats. Reconnect Microsoft 365 and accept the Teams permission.',
            action: 'Reconnect with Teams access',
          };
  return (
    <div
      role="alert"
      data-testid="teams-consent"
      className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4"
    >
      <div className="flex items-start gap-2">
        {kind !== 'not_connected' && <Badge tone="amber">Permission needed</Badge>}
        <p className="text-sm text-[var(--fg-primary)]">{copy.text}</p>
      </div>
      <p className="text-xs text-[var(--fg-tertiary)]">Polo only reads your chats. It never posts to Teams.</p>
      <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
        {copy.action}
      </Button>
      {connect.isError && (
        <p role="status" className="text-xs text-[var(--fg-secondary)]">
          Could not start the connection. Try again.
        </p>
      )}
    </div>
  );
}

function ListState({
  isLoading,
  error,
  empty,
  onRetry,
  emptyText,
}: {
  isLoading: boolean;
  error: unknown;
  empty: boolean;
  onRetry: () => void;
  emptyText: string;
}) {
  const code = teamsAccessCode(error);
  if (code === 'teams_consent_required' || code === 'teams_not_connected') {
    return <ConsentPrompt kind={code === 'teams_not_connected' ? 'not_connected' : 'needs_consent'} />;
  }
  if (code === 'teams_channels_not_approved') {
    return (
      <p className="py-3 text-sm text-[var(--fg-secondary)]">
        Channel threads need an admin to approve Teams channel access.
      </p>
    );
  }
  if (isLoading) return <LoadingSkeleton rows={4} />;
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 py-3 text-sm">
        <span className="text-[var(--fg-secondary)]">Teams did not load.</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (empty) return <p className="py-3 text-sm text-[var(--fg-secondary)]">{emptyText}</p>;
  return null;
}

function ChatRow({ chat, onPick }: { chat: TeamsChatSummary; onPick: (chat: TeamsChatSummary) => void }) {
  const facts = [
    chat.subtitle,
    chat.memberCount ? plural(chat.memberCount, 'person', 'people') : null,
    when(chat.lastActivityAt),
  ].filter(Boolean);
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(chat)}
        className={`flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-[var(--surface-sunken)] pointer-coarse:min-h-11 ${FOCUS}`}
      >
        <MessageSquare size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--fg-tertiary)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--fg-primary)]" title={chat.title}>
            {chat.title}
          </span>
          <span className="block truncate text-xs tabular-nums text-[var(--fg-secondary)]">{facts.join(' · ')}</span>
        </span>
        {chat.syncLinkId && <Badge tone="teal">Syncing</Badge>}
      </button>
    </li>
  );
}

function filterChats(items: TeamsChatSummary[], q: string) {
  const needle = q.trim().toLowerCase();
  return needle ? items.filter((c) => `${c.title} ${c.subtitle ?? ''}`.toLowerCase().includes(needle)) : items;
}

function ChatsTab({ query, onPick }: { query: string; onPick: (chat: TeamsChatSummary) => void }) {
  const chats = useTeamsChats(true);
  const items = filterChats(chats.data?.items ?? [], query);
  const state = (
    <ListState
      isLoading={chats.isLoading}
      error={chats.error}
      empty={items.length === 0}
      onRetry={() => void chats.refetch()}
      emptyText={query ? 'No chats match that name.' : 'No recent chats.'}
    />
  );
  if (chats.isLoading || chats.error || items.length === 0) return state;
  return (
    <ul className="divide-y divide-[var(--border-subtle)]" data-testid="teams-chat-list">
      {items.map((chat) => (
        <ChatRow key={teamsRefKey(chat.ref)} chat={chat} onPick={onPick} />
      ))}
    </ul>
  );
}

function ChannelsTab({ enabled, query, onPick }: { enabled: boolean; query: string; onPick: (chat: TeamsChatSummary) => void }) {
  const teamSelect = useId();
  const channelSelect = useId();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const teams = useTeamsTeams(enabled);
  const channels = useTeamsChannels(teamId);
  const threads = useTeamsChannelThreads(teamId, channelId);
  if (!enabled) {
    return (
      <p className="py-3 text-sm text-[var(--fg-secondary)]">
        Channel threads need an admin to approve Teams channel access.
      </p>
    );
  }
  if (teams.isLoading || teams.error || !teams.data?.items.length) {
    return (
      <ListState
        isLoading={teams.isLoading}
        error={teams.error}
        empty={!teams.data?.items.length}
        onRetry={() => void teams.refetch()}
        emptyText="You are not in any teams."
      />
    );
  }
  const select = `w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-sm text-[var(--fg-primary)] pointer-coarse:min-h-11 ${FOCUS}`;
  const items = filterChats(threads.data?.items ?? [], query);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={teamSelect} className="mb-1 block text-xs text-[var(--fg-secondary)]">
            Team
          </label>
          <select
            id={teamSelect}
            className={select}
            value={teamId ?? ''}
            onChange={(e) => {
              setTeamId(e.target.value || null);
              setChannelId(null);
            }}
          >
            <option value="">Choose a team</option>
            {teams.data.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={channelSelect} className="mb-1 block text-xs text-[var(--fg-secondary)]">
            Channel
          </label>
          <select
            id={channelSelect}
            className={select}
            value={channelId ?? ''}
            disabled={!teamId || channels.isLoading}
            onChange={(e) => setChannelId(e.target.value || null)}
          >
            <option value="">Choose a channel</option>
            {(channels.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
      {channelId &&
        (threads.isLoading || threads.error || items.length === 0 ? (
          <ListState
            isLoading={threads.isLoading}
            error={threads.error}
            empty={items.length === 0}
            onRetry={() => void threads.refetch()}
            emptyText="No recent threads in this channel."
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {items.map((chat) => (
              <ChatRow key={teamsRefKey(chat.ref)} chat={chat} onPick={onPick} />
            ))}
          </ul>
        ))}
    </div>
  );
}

function SyncedChats({ companyId }: { companyId: string }) {
  const links = useTeamsLinks(companyId, true);
  const setLink = useSetTeamsLink(companyId);
  const items = links.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section aria-labelledby="teams-synced-heading" className="mb-5">
      <h3 id="teams-synced-heading" className="mb-2 text-sm font-medium text-[var(--fg-primary)]">
        Synced chats
      </h3>
      <ul className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
        {items.map((link) => (
          <li key={link.id} className="flex items-center gap-3 px-3 py-2">
            <RefreshCw size={14} aria-hidden="true" className="shrink-0 text-[var(--fg-tertiary)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--fg-primary)]" title={link.title}>
                {link.title}
              </span>
              <span className="block truncate text-xs text-[var(--fg-secondary)]">
                To {link.companyName}
                {link.lastSyncedAt ? ` · Checked ${when(link.lastSyncedAt)}` : ''}
              </span>
              {link.lastError === 'consent_required' && (
                <span role="status" className="block text-xs text-[var(--fg-secondary)]">
                  Paused: reconnect Microsoft 365 with Teams access.
                </span>
              )}
              {link.lastError === 'not_found' && (
                <span role="status" className="block text-xs text-[var(--fg-secondary)]">
                  Paused: this chat is no longer available to you.
                </span>
              )}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={setLink.isPending}
              onClick={() => setLink.mutate({ id: link.id, keepSyncing: false })}
            >
              Stop syncing
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Picked {
  ref: TeamsThreadRef;
  title: string;
  syncing: boolean;
}

function MessagesStep({
  picked,
  companyId,
  companyName,
  onBack,
  onDone,
}: {
  picked: Picked;
  companyId: string;
  companyName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const fileTo = useId();
  const syncId = useId();
  const messages = useTeamsMessages(picked.ref);
  const importTeams = useImportTeams(companyId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(companyId);
  const [keepSyncing, setKeepSyncing] = useState(picked.syncing);

  const items = useMemo(() => messages.data?.items ?? [], [messages.data]);
  const pickable = items.filter((m) => !m.filed);
  const suggestions = messages.data?.suggestions ?? [];
  const accounts = [
    { id: companyId, name: companyName },
    ...suggestions.filter((s) => s.companyId !== companyId).map((s) => ({ id: s.companyId, name: s.name })),
  ];
  const targetName = accounts.find((a) => a.id === target)?.name ?? companyName;
  const otherMatch = suggestions.find((s) => s.companyId !== target);
  const selfMatch = suggestions.find((s) => s.companyId === target);
  const allOn = pickable.length > 0 && pickable.every((m) => selected.has(m.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    importTeams.mutate(
      { ref: picked.ref, companyId: target, messageIds: [...selected], keepSyncing },
      {
        onSuccess: (res) => {
          const filed = res.created + res.updated;
          const notes = [
            res.alreadyFiled ? `${res.alreadyFiled} already filed to another account` : null,
            res.skipped ? `${res.skipped} skipped` : null,
          ].filter(Boolean);
          toast.success(`Filed ${plural(filed, 'message', 'messages')} to ${targetName}`, {
            description: notes.length ? notes.join(', ') : keepSyncing ? 'New messages will keep filing here.' : undefined,
          });
          onDone();
        },
      },
    );

  const importCode = teamsAccessCode(importTeams.error);

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex items-center gap-1 rounded text-sm text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] pointer-coarse:min-h-11 ${FOCUS}`}
        >
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
        <h3 className="mt-1 truncate text-sm font-medium text-[var(--fg-primary)]" title={messages.data?.title ?? picked.title}>
          {messages.data?.title ?? picked.title}
        </h3>
      </div>

      {messages.isLoading || messages.error || items.length === 0 ? (
        <ListState
          isLoading={messages.isLoading}
          error={messages.error}
          empty={items.length === 0}
          onRetry={() => void messages.refetch()}
          emptyText="No messages in this conversation yet."
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] pointer-coarse:min-h-11">
              <input
                type="checkbox"
                className={`h-4 w-4 accent-[var(--brand-primary)] ${FOCUS}`}
                checked={allOn}
                disabled={!pickable.length}
                onChange={() => setSelected(allOn ? new Set() : new Set(pickable.map((m) => m.id)))}
              />
              Select all
            </label>
            <span className="text-xs tabular-nums text-[var(--fg-tertiary)]">
              {plural(items.length, 'message', 'messages')}
            </span>
          </div>
          <ul className="space-y-2" data-testid="teams-message-list">
            {items.map((m) => (
              <li key={m.id} className="rounded-lg bg-[var(--surface-sunken)] p-3">
                <label className="flex items-start gap-3 pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    className={`mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary)] ${FOCUS}`}
                    checked={selected.has(m.id)}
                    disabled={m.filed}
                    onChange={() => toggle(m.id)}
                    aria-label={`File message from ${m.authorName ?? 'unknown'} at ${when(m.createdAt)}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-secondary)]">
                      <span className="font-medium text-[var(--fg-primary)]">{m.authorName ?? 'Unknown'}</span>
                      <span className="tabular-nums">{when(m.createdAt)}</span>
                      {m.filed && <Badge tone="gray">Filed</Badge>}
                    </span>
                    <span className="mt-1 line-clamp-2 block whitespace-pre-line text-sm text-[var(--fg-primary)]">
                      {m.preview || ' '}
                    </span>
                    {m.attachmentNames.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.attachmentNames.map((name) => (
                          <Badge key={name} tone="gray">
                            <Paperclip size={12} aria-hidden="true" className="mr-1 inline" />
                            {name}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
        <div>
          <label htmlFor={fileTo} className="mb-1 block text-xs text-[var(--fg-secondary)]">
            File to
          </label>
          <select
            id={fileTo}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-sm text-[var(--fg-primary)] pointer-coarse:min-h-11 ${FOCUS}`}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {selfMatch && (
            <p className="mt-1 text-xs text-[var(--fg-tertiary)]" data-testid="teams-suggestion">
              Participants match this account ({selfMatch.reason} {selfMatch.match})
            </p>
          )}
          {!selfMatch && otherMatch && (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--fg-secondary)]" data-testid="teams-suggestion">
              Participants match {otherMatch.name} ({otherMatch.reason} {otherMatch.match})
              <button
                type="button"
                className={`rounded font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline pointer-coarse:min-h-11 ${FOCUS}`}
                onClick={() => setTarget(otherMatch.companyId)}
              >
                Use {otherMatch.name}
              </button>
            </p>
          )}
        </div>
        <label htmlFor={syncId} className="flex items-center gap-2 text-sm text-[var(--fg-primary)] pointer-coarse:min-h-11">
          <input
            id={syncId}
            type="checkbox"
            role="switch"
            aria-checked={keepSyncing}
            className={`h-4 w-4 accent-[var(--brand-primary)] ${FOCUS}`}
            checked={keepSyncing}
            onChange={(e) => setKeepSyncing(e.target.checked)}
          />
          Keep filing new messages from this chat to {targetName}
        </label>
        {importCode ? (
          <ConsentPrompt kind={importCode === 'teams_not_connected' ? 'not_connected' : 'needs_consent'} />
        ) : importTeams.isError ? (
          <p role="alert" className="text-xs text-[var(--fg-secondary)]">
            Not filed. Try again.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onBack}>
            Cancel
          </Button>
          <Button
            disabled={importTeams.isPending || (selected.size === 0 && (!keepSyncing || picked.syncing))}
            onClick={submit}
          >
            {selected.size === 0 && keepSyncing ? 'Keep syncing' : `File ${plural(selected.size, 'message', 'messages')}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TeamsImportSheet({
  companyId,
  companyName,
  open,
  onOpenChange,
}: {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const searchId = useId();
  const access = useTeamsAccess(open);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [query, setQuery] = useState('');

  const state = access.data?.state;
  let body: ReactNode;
  if (access.isLoading) body = <LoadingSkeleton rows={4} />;
  else if (access.isError || !access.data) {
    body = (
      <div role="alert" className="flex items-center justify-between gap-3 text-sm">
        <span className="text-[var(--fg-secondary)]">Teams access did not load.</span>
        <Button variant="secondary" size="sm" onClick={() => void access.refetch()}>
          Retry
        </Button>
      </div>
    );
  } else if (state !== 'ready') body = <ConsentPrompt kind={state ?? 'not_connected'} />;
  else if (picked) {
    body = (
      <MessagesStep
        key={teamsRefKey(picked.ref)}
        picked={picked}
        companyId={companyId}
        companyName={companyName}
        onBack={() => setPicked(null)}
        onDone={() => onOpenChange(false)}
      />
    );
  } else {
    const pick = (chat: TeamsChatSummary) => setPicked({ ref: chat.ref, title: chat.title, syncing: Boolean(chat.syncLinkId) });
    body = (
      <>
        <SyncedChats companyId={companyId} />
        <label htmlFor={searchId} className="sr-only">
          Search chats
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`mb-3 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] pointer-coarse:min-h-11 ${FOCUS}`}
        />
        <Tabs defaultValue="chats">
          <TabsList>
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
          </TabsList>
          <TabsContent value="chats" className="pt-3">
            <ChatsTab query={query} onPick={pick} />
          </TabsContent>
          <TabsContent value="channels" className="pt-3">
            <ChannelsTab enabled={access.data.channels === 'ready'} query={query} onPick={pick} />
          </TabsContent>
        </Tabs>
      </>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        size="lg"
        title="Import from Teams"
        description={`Pick messages to file to ${companyName}. Polo only reads your chats.`}
        headerActions={
          access.data?.accountEmail ? (
            <span className="hidden max-w-[12rem] truncate text-xs text-[var(--fg-tertiary)] sm:inline" title={access.data.accountEmail}>
              {access.data.accountEmail}
            </span>
          ) : null
        }
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}

/** "Open in Teams" deep link on a filed Teams row. */
export function OpenInTeamsLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded text-xs text-[var(--brand-primary)] hover:underline pointer-coarse:min-h-11 ${FOCUS}`}
    >
      <ExternalLink size={12} aria-hidden="true" />
      Open in Teams
    </a>
  );
}
