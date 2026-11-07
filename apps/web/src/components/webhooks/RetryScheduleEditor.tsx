import {
  DEFAULT_WEBHOOK_RETRY_POLICY,
  WEBHOOK_BACKOFF_STRATEGIES,
  WEBHOOK_RETRY_LIMITS,
  webhookRetrySchedule,
  type WebhookBackoffStrategy,
  type WebhookRetryPolicy,
} from '@bidstack/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { DotHistogram } from '@/components/vendor/tuffui/dot-histogram';
import { Panel, Shell, ShellHeader } from '@/components/vendor/tuffui/surface';
import {
  useResetWebhookRetryPolicy,
  useSaveWebhookRetryPolicy,
  useWebhookDeliveryStats,
  useWebhookRetryPolicy,
} from '@/hooks/useWebhookDeliveries';
import { cn } from '@/lib/cn';

import type { EndpointOption } from './DeliveriesPanel';
import { endpointHost, formatDelay, formatLatency } from './webhook-format';

const FIELD =
  'h-9 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-sm tabular-nums text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] aria-[invalid=true]:border-[var(--danger)]';

type Draft = {
  maxAttempts: string;
  backoffStrategy: WebhookBackoffStrategy;
  backoffBaseSeconds: string;
  timeoutMs: string;
};

function toDraft(p: WebhookRetryPolicy): Draft {
  return {
    maxAttempts: String(p.maxAttempts),
    backoffStrategy: p.backoffStrategy,
    backoffBaseSeconds: String(p.backoffBaseSeconds),
    timeoutMs: String(p.timeoutMs),
  };
}

function inRange(raw: string, limits: { min: number; max: number }): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isInteger(n) && n >= limits.min && n <= limits.max ? n : null;
}

export function RetryScheduleEditor({ subscriptions }: { subscriptions: EndpointOption[] }) {
  const { t } = useTranslation('settings');
  const [picked, setPicked] = useState<string | null>(null);
  const selected = subscriptions.some((s) => s.id === picked)
    ? picked
    : (subscriptions[0]?.id ?? null);

  const policy = useWebhookRetryPolicy(selected);
  const save = useSaveWebhookRetryPolicy(selected);
  const reset = useResetWebhookRetryPolicy(selected);
  const stats = useWebhookDeliveryStats({ subscriptionId: selected ?? undefined, window: '7d' });
  // Unsaved edits; null shows the stored policy.
  const [edits, setEdits] = useState<Draft | null>(null);
  const draft = edits ?? toDraft(policy.data ?? DEFAULT_WEBHOOK_RETRY_POLICY);
  const setDraft = (update: (d: Draft) => Draft) => setEdits(update(draft));

  const maxAttempts = inRange(draft.maxAttempts, WEBHOOK_RETRY_LIMITS.maxAttempts);
  const base = inRange(draft.backoffBaseSeconds, WEBHOOK_RETRY_LIMITS.backoffBaseSeconds);
  const timeoutMs = inRange(draft.timeoutMs, WEBHOOK_RETRY_LIMITS.timeoutMs);
  const valid = maxAttempts !== null && base !== null && timeoutMs !== null;
  const next: WebhookRetryPolicy | null = valid
    ? { maxAttempts, backoffStrategy: draft.backoffStrategy, backoffBaseSeconds: base, timeoutMs }
    : null;

  const preview = useMemo(
    () =>
      webhookRetrySchedule({
        maxAttempts: maxAttempts ?? 1,
        backoffStrategy: draft.backoffStrategy,
        backoffBaseSeconds: base ?? DEFAULT_WEBHOOK_RETRY_POLICY.backoffBaseSeconds,
        timeoutMs: timeoutMs ?? DEFAULT_WEBHOOK_RETRY_POLICY.timeoutMs,
      }),
    [maxAttempts, draft.backoffStrategy, base, timeoutMs],
  );
  const span = Math.max(1, preview.at(-1)?.atMs ?? 1);

  const strategyLabel: Record<WebhookBackoffStrategy, string> = {
    exponential: t('webhooks.retry.exponential', 'Exponential (doubles each time)'),
    linear: t('webhooks.retry.linear', 'Linear (grows by the base delay)'),
    fixed: t('webhooks.retry.fixed', 'Fixed (same delay every time)'),
  };

  if (subscriptions.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-secondary)]">
        {t('webhooks.retry.noEndpoints', 'Add an endpoint to set its retry schedule.')}
      </p>
    );
  }

  const onSave = async () => {
    if (!next) return;
    try {
      await save.mutateAsync(next);
      setEdits(null);
      toast.success(t('webhooks.retry.saved', 'Retry schedule saved'));
    } catch {
      toast.error(t('webhooks.retry.saveFailed', 'Could not save the retry schedule'));
    }
  };

  const onReset = async () => {
    try {
      await reset.mutateAsync();
      setEdits(null);
      toast.success(t('webhooks.retry.resetDone', 'Retry schedule reset to the default'));
    } catch {
      toast.error(t('webhooks.retry.saveFailed', 'Could not save the retry schedule'));
    }
  };

  const latency = stats.data?.latencyMs ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem),minmax(0,1fr)]">
      <Shell>
        <ShellHeader
          title={t('webhooks.retry.title', 'Retry schedule')}
          subtitle={t(
            'webhooks.retry.subtitle',
            'Applies to new attempts for this endpoint. Responses 400, 401, 403, 404, 410 and 422 are never retried.',
          )}
        />
        <Panel className="space-y-4 p-4">
          {subscriptions.length > 1 ? (
            <label className="grid gap-1 text-xs font-medium text-[var(--fg-secondary)]">
              {t('webhooks.filter.endpoint', 'Endpoint')}
              <select
                className={FIELD}
                value={selected ?? ''}
                onChange={(e) => {
                  setPicked(e.target.value);
                  setEdits(null);
                }}
              >
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {endpointHost(s.url)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="font-mono text-xs text-[var(--fg-secondary)]">
              {endpointHost(subscriptions[0]!.url)}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="retry-max-attempts"
              label={t('webhooks.retry.maxAttempts', 'Max attempts')}
              value={draft.maxAttempts}
              onChange={(v) => setDraft((d) => ({ ...d, maxAttempts: v }))}
              error={
                maxAttempts === null
                  ? t('webhooks.retry.maxAttemptsError', 'Use 1 to 10 attempts.')
                  : null
              }
            />
            <NumberField
              id="retry-base"
              label={t('webhooks.retry.base', 'Base delay (s)')}
              value={draft.backoffBaseSeconds}
              onChange={(v) => setDraft((d) => ({ ...d, backoffBaseSeconds: v }))}
              error={base === null ? t('webhooks.retry.baseError', 'Use 5 to 3600 seconds.') : null}
            />
          </div>
          <label className="grid gap-1 text-xs font-medium text-[var(--fg-secondary)]">
            {t('webhooks.retry.backoff', 'Backoff')}
            <select
              className={FIELD}
              value={draft.backoffStrategy}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  backoffStrategy: e.target.value as WebhookBackoffStrategy,
                }))
              }
            >
              {WEBHOOK_BACKOFF_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {strategyLabel[s]}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            id="retry-timeout"
            label={t('webhooks.retry.timeout', 'Timeout (ms)')}
            value={draft.timeoutMs}
            onChange={(v) => setDraft((d) => ({ ...d, timeoutMs: v }))}
            error={
              timeoutMs === null ? t('webhooks.retry.timeoutError', 'Use 1000 to 30000 ms.') : null
            }
          />

          <div>
            <h4 className="mb-2 text-xs font-medium text-[var(--fg-tertiary)]">
              {t('webhooks.retry.preview', 'Wait before each attempt')}
            </h4>
            <ol
              aria-label={t('webhooks.retry.listLabel', 'Retry schedule')}
              className="space-y-1.5"
            >
              {preview.map((step) => (
                <li
                  key={step.attempt}
                  className="grid grid-cols-[5.5rem,4.5rem,minmax(0,1fr)] items-center gap-2 text-xs"
                >
                  <span className="text-[var(--fg-secondary)]">
                    {t('webhooks.retry.attempt', 'Attempt {{n}}', { n: step.attempt })}
                  </span>
                  <span className="font-mono tabular-nums text-[var(--fg-primary)]">
                    {step.attempt === 1
                      ? t('webhooks.retry.now', 'now')
                      : `+${formatDelay(step.delayMs)}`}
                  </span>
                  <span
                    aria-hidden="true"
                    className="relative h-1.5 rounded-full bg-[var(--surface-sunken)]"
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand-deep)] transition-[width] duration-200"
                      style={{ width: `${Math.max(2, (step.atMs / span) * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
              {t('webhooks.retry.total', 'Last attempt {{when}} after the first.', {
                when: formatDelay(preview.at(-1)?.atMs ?? 0),
              })}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onReset()}
              disabled={reset.isPending || !selected}
            >
              {t('webhooks.retry.reset', 'Reset to default')}
            </Button>
            <Button
              size="sm"
              onClick={() => void onSave()}
              disabled={!valid || save.isPending || !selected}
            >
              {t('webhooks.retry.save', 'Save')}
            </Button>
          </div>
        </Panel>
      </Shell>

      {latency.length > 0 ? (
        <DotHistogram
          className="max-w-none"
          values={latency}
          title={t('webhooks.retry.responseTime', 'Response time')}
          subtitle={t(
            'webhooks.retry.responseTimeSubtitle',
            'Every attempt in the last 7 days. The dashed line is the timeout.',
          )}
          threshold={timeoutMs ?? undefined}
          thresholdLabel={t('webhooks.retry.overTimeout', 'at or over the timeout')}
          unit={t('webhooks.retry.attemptsUnit', 'attempts')}
          format={(v) => formatLatency(v)}
        />
      ) : (
        <Shell>
          <ShellHeader title={t('webhooks.retry.responseTime', 'Response time')} />
          <Panel className="p-4">
            <p
              role="group"
              aria-label={t('webhooks.retry.responseTime', 'Response time')}
              className="text-sm text-[var(--fg-secondary)]"
            >
              {stats.isLoading
                ? t('webhooks.retry.latencyLoading', 'Loading response times…')
                : t('webhooks.retry.noLatency', 'No attempts in the last 7 days.')}
            </p>
          </Panel>
        </Shell>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium text-[var(--fg-secondary)]">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(FIELD, 'w-full')}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-[var(--error-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
