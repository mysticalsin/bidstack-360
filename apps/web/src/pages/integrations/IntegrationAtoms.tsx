/**
 * integrations/IntegrationAtoms.tsx — small, stateless UI primitives shared
 * across the Integrations feature area.
 *
 * WHY a separate module: these atoms (Stat, EndpointBox, SnippetBox, CopyButton,
 * ProbeHint, ProbeResultCard) are consumed by ConnectionCommandCenter,
 * ConnectionTester, and possibly future panels. Isolating them avoids duplication
 * and keeps each consumer lean.
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';

import type { IntegrationProbeResult } from './types';

// ─── Stat ──────────────────────────────────────────────────────────────────────

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--fg-primary)] tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ─── ProbeHint ─────────────────────────────────────────────────────────────────

export function ProbeHint({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
        <Icon name={icon} size={15} />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--fg-secondary)]">{body}</p>
    </div>
  );
}

// ─── EndpointBox ───────────────────────────────────────────────────────────────

export function EndpointBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
          {label}
        </div>
        <CopyButton value={value} label="Copy endpoint" />
      </div>
      <code className="block overflow-x-auto rounded-md bg-[var(--surface-card)] px-3 py-2 font-mono text-xs text-[var(--fg-primary)]">
        {value}
      </code>
    </div>
  );
}

// ─── SnippetBox ────────────────────────────────────────────────────────────────

export function SnippetBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
          {label}
        </div>
        <CopyButton value={value} label="Copy snippet" />
      </div>
      <pre className="max-h-48 overflow-auto rounded-md bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--fg-primary)]">
        <code>{value}</code>
      </pre>
    </div>
  );
}

// ─── CopyButton ────────────────────────────────────────────────────────────────

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(copied ? 'Already copied' : 'Copied to clipboard');
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('Copy failed', { description: 'Clipboard access was not available.' });
        }
      }}
    >
      <Icon name={copied ? 'checkCircle' : 'copy'} size={14} />
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

// ─── ProbeResultCard ───────────────────────────────────────────────────────────

export function ProbeResultCard({ result }: { result: IntegrationProbeResult }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        result.ok
          ? 'border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)]'
          : 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)]'
      }`}
      role="status"
      data-testid="connection-probe-result"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full ${
              result.ok
                ? 'bg-[rgba(34,197,94,0.15)] text-[var(--success)]'
                : 'bg-[rgba(245,158,11,0.16)] text-[var(--warning)]'
            }`}
          >
            <Icon name={result.ok ? 'checkCircle' : 'warning'} size={17} />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--fg-primary)]">{result.message}</div>
            <code className="mt-1 block break-all font-mono text-xs text-[var(--fg-secondary)]">
              {result.checkedUrl}
            </code>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={result.ok ? 'jade' : 'amber'}>
            {result.status ? `HTTP ${result.status}` : 'No response'}
          </Badge>
          <Badge tone="gray">{result.latencyMs}ms</Badge>
        </div>
      </div>
      {result.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-[var(--fg-secondary)]">
          {result.warnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <Icon name="warning" size={13} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
