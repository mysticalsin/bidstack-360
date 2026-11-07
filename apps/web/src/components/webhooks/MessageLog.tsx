import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Sheet, SheetContent } from '@/components/ui/Sheet';
import { toast } from '@/components/ui/Toast';
import { Inset } from '@/components/vendor/tuffui/surface';
import { StatusPill, type StatusTone } from '@/components/vendor/tuffui/status-pill';
import { useHasPermission } from '@/hooks/useCapabilities';
import {
  useReplayWebhookMessage,
  useWebhookMessage,
  useWebhookMessages,
  type WebhookDeliveryFilters,
  type WebhookMessageRow,
} from '@/hooks/useWebhookDeliveries';
import { relativeTime } from '@/lib/format';
import { buildWebhookCurl } from '@/lib/webhook-curl';

import { endpointHost, formatLatency } from './webhook-format';

const TONE: Record<WebhookMessageRow['status'], StatusTone> = {
  succeeded: 'positive',
  failed: 'negative',
  pending: 'warning',
};

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  // RFC 4122 v4 from Math.random for very old browsers; only used as an idempotency key.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function useStatusLabel() {
  const { t } = useTranslation('settings');
  return (status: WebhookMessageRow['status']) =>
    status === 'succeeded'
      ? t('webhooks.status.succeeded', 'Delivered')
      : status === 'failed'
        ? t('webhooks.status.failed', 'Failed')
        : t('webhooks.status.pending', 'Retrying');
}

export function MessageLog({ filters }: { filters: WebhookDeliveryFilters }) {
  const { t } = useTranslation('settings');
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors.at(-1) ?? null;
  const list = useWebhookMessages(filters, cursor);
  const [openId, setOpenId] = useState<string | null>(null);
  const statusLabel = useStatusLabel();

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-3">
      {list.isLoading ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('webhooks.log.loading', 'Loading messages…')}
        </p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-[var(--error-fg)]">
          {t('webhooks.log.error', 'Could not load the message log. Refresh to try again.')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('webhooks.log.empty', 'No messages match these filters.')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">
              {t('webhooks.log.caption', 'Webhook messages, newest first')}
            </caption>
            <thead className="bg-[var(--surface-sunken)] text-xs text-[var(--fg-tertiary)]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('webhooks.log.event', 'Event')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('webhooks.log.endpoint', 'Endpoint')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('webhooks.log.status', 'Status')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t('webhooks.log.attempts', 'Attempts')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t('webhooks.log.latency', 'Latency')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('webhooks.log.when', 'When')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {items.map((m) => (
                <tr key={m.id} className="hover:bg-[var(--surface-sunken)]">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(m.id)}
                      aria-label={t('webhooks.log.open', 'Open {{event}} to {{host}}', {
                        event: m.event,
                        host: endpointHost(m.url),
                      })}
                      className="rounded font-mono text-xs text-[var(--fg-primary)] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                    >
                      {m.event}
                    </button>
                    {m.replayOfId ? (
                      <span className="ml-2 text-xs text-[var(--fg-tertiary)]">
                        {t('webhooks.log.replay', 'replay')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]">
                    {endpointHost(m.url)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={TONE[m.status]} size="sm">
                      {statusLabel(m.status)}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.attempts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatLatency(m.lastDurationMs)}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--fg-tertiary)]">
                    {relativeTime(m.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursors.length > 1 || list.data?.nextCursor ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={cursors.length <= 1}
            onClick={() => setCursors([null])}
          >
            {t('webhooks.log.newest', 'Newest')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!list.data?.nextCursor}
            onClick={() =>
              list.data?.nextCursor && setCursors((c) => [...c, list.data!.nextCursor])
            }
          >
            {t('webhooks.log.older', 'Older')}
          </Button>
        </div>
      ) : null}

      <Sheet open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        {openId ? <MessageDrawer id={openId} /> : null}
      </Sheet>
    </div>
  );
}

function MessageDrawer({ id }: { id: string }) {
  const { t } = useTranslation('settings');
  const detail = useWebhookMessage(id);
  const replay = useReplayWebhookMessage();
  const canReplay = useHasPermission('webhooks:replay');
  const statusLabel = useStatusLabel();
  const [announce, setAnnounce] = useState('');
  // One request id per drawer open, so a retried request is deduplicated by the
  // server; a new id is minted only for a deliberate "Replay again".
  const [requestId, setRequestId] = useState(newRequestId);
  const [replayed, setReplayed] = useState(false);
  const d = detail.data;

  const copyCurl = async () => {
    if (!d) return;
    const last = d.attempts.at(-1);
    const curl = buildWebhookCurl({
      url: d.message.url,
      headers: last?.requestHeaders ?? {},
      body: d.requestBody,
    });
    try {
      await navigator.clipboard.writeText(curl);
      toast.success(
        t(
          'webhooks.log.curlCopied',
          'cURL copied. Re-sign it before sending: the signature is masked.',
        ),
      );
    } catch {
      toast.error(t('webhooks.toastCopyFailed', 'Copy failed'));
    }
  };

  const doReplay = async () => {
    setAnnounce('');
    const rid = replayed ? newRequestId() : requestId;
    if (rid !== requestId) setRequestId(rid);
    try {
      const result = await replay.mutateAsync({ id, requestId: rid });
      setReplayed(true);
      setAnnounce(
        result.duplicate
          ? t('webhooks.log.replayDuplicate', 'Replay was already queued')
          : t('webhooks.log.replayQueued', 'Replay queued'),
      );
    } catch {
      setAnnounce(t('webhooks.log.replayFailed', 'Replay failed. Try again.'));
    }
  };

  return (
    <SheetContent
      size="md"
      title={d ? d.message.event : t('webhooks.log.drawerTitle', 'Webhook message')}
      description={d ? endpointHost(d.message.url) : undefined}
      footer={
        d ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void copyCurl()}
              disabled={d.requestBodyTruncated}
              title={
                d.requestBodyTruncated
                  ? t('webhooks.log.curlTruncated', 'The stored body is cut at 4 KB, so a cURL copy would send a partial body.')
                  : undefined
              }
            >
              {t('webhooks.log.copyCurl', 'Copy cURL')}
            </Button>
            {canReplay ? (
              <Button size="sm" onClick={() => void doReplay()} disabled={replay.isPending}>
                {replayed
                  ? t('webhooks.log.replayAgain', 'Replay again')
                  : t('webhooks.log.replayButton', 'Replay')}
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <p aria-live="polite" className="mb-3 text-sm text-[var(--fg-secondary)] empty:hidden">
        {announce}
      </p>
      {detail.isLoading ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('webhooks.log.loadingDetail', 'Loading attempts…')}
        </p>
      ) : detail.isError || !d ? (
        <p role="alert" className="text-sm text-[var(--error-fg)]">
          {t('webhooks.log.detailError', 'Could not load this message.')}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill tone={TONE[d.message.status]}>{statusLabel(d.message.status)}</StatusPill>
            <span className="text-[var(--fg-secondary)]">
              {t('webhooks.log.attemptCount', '{{count}} attempts', { count: d.message.attempts })}
            </span>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-medium text-[var(--fg-tertiary)]">
              {t('webhooks.log.requestBody', 'Request body')}
            </h3>
            <Inset className="max-h-48 overflow-auto p-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-[var(--fg-primary)]">
                {d.requestBody}
              </pre>
            </Inset>
            {d.requestBodyTruncated ? (
              <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
                {t('webhooks.log.truncated', 'Truncated at 4 KB.')}
              </p>
            ) : null}
          </section>

          <ol className="space-y-3">
            {d.attempts.map((a) => (
              <li key={a.id} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-[var(--fg-primary)]">
                    {t('webhooks.log.attempt', 'Attempt {{n}}', { n: a.attempt })}
                  </h3>
                  <div className="flex items-center gap-2 text-xs tabular-nums text-[var(--fg-secondary)]">
                    <StatusPill tone={a.success ? 'positive' : 'negative'} size="sm">
                      {a.statusCode === null
                        ? t('webhooks.log.noResponse', 'No response')
                        : t('webhooks.httpStatus', 'HTTP {{statusCode}}', {
                            statusCode: a.statusCode,
                          })}
                    </StatusPill>
                    <span>{formatLatency(a.durationMs)}</span>
                    <span>{relativeTime(a.createdAt)}</span>
                  </div>
                </div>
                {a.errorMessage ? (
                  <p className="mt-2 text-xs text-[var(--error-fg)]">{a.errorMessage}</p>
                ) : null}
                {a.responseBody ? (
                  <Inset className="mt-2 max-h-40 overflow-auto p-2">
                    <pre className="whitespace-pre-wrap break-all font-mono text-xs text-[var(--fg-primary)]">
                      {a.responseBody}
                    </pre>
                  </Inset>
                ) : (
                  <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
                    {t('webhooks.log.noBody', 'No response body stored.')}
                  </p>
                )}
                {a.responseTruncated ? (
                  <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
                    {t('webhooks.log.truncated', 'Truncated at 4 KB.')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </SheetContent>
  );
}
