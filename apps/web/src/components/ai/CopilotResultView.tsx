// Copilot result renderer — shared presentation for the ⌘K copilot's three
// palette-runnable AI actions (email drafts, deal sentiment, account intel).
// Lives in components/ai (not command/) so record pages can reuse it later
// without importing palette internals. Feedback stars ship with every result:
// the learning loop only works if rating is one click away from the output.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AiFeedback } from '@/components/ai/ai-feedback';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type {
  AccountIntelResult,
  DealSentimentResult,
  EmailDraft,
  EmailDraftResult,
} from '@/hooks/useAiAssistant';

export type CopilotResultData =
  | { kind: 'email-draft'; data: EmailDraftResult }
  | { kind: 'deal-sentiment'; data: DealSentimentResult }
  | { kind: 'account-intel'; data: AccountIntelResult };

const SECTION_HEADING =
  'mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--fg-secondary)]';

function SectionList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className={SECTION_HEADING}>{heading}</h4>
      <ul className="list-disc list-inside space-y-1">
        {items.map((line, i) => (
          <li key={i} className="text-xs text-[var(--fg-primary)]">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftRow({ draft, index }: { draft: EmailDraft; index: number }) {
  const { t } = useTranslation('crm');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  // Clear the "Copied" reset timer if the palette unmounts mid-countdown.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function handleCopy() {
    void navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-[var(--fg-primary)]">{draft.subject}</p>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={t('copilot.copyDraft', 'Copy draft {{n}} to clipboard', { n: index + 1 })}
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-md -mr-1 -mt-1',
            'text-[var(--fg-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
            copied && 'text-[var(--success)]',
          )}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
      </div>
      {draft.body ? (
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--fg-secondary)]">
          {draft.body}
        </p>
      ) : null}
      {copied ? (
        <p className="mt-1 text-[10px] text-[var(--success)]" role="status">
          {t('copilot.copied', 'Copied — paste it into your email client.')}
        </p>
      ) : null}
    </div>
  );
}

function EmailDraftView({ data }: { data: EmailDraftResult }) {
  const { t } = useTranslation('crm');
  return (
    <div className="space-y-2">
      <h4 className={SECTION_HEADING}>
        {t('copilot.draftsHeading', '{{count}} drafts — pick the one that sounds like you', {
          count: data.drafts.length,
        })}
      </h4>
      {data.drafts.map((draft, i) => (
        <DraftRow key={i} draft={draft} index={i} />
      ))}
    </div>
  );
}

const SENTIMENT_BADGE: Record<DealSentimentResult['label'], string> = {
  positive: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  neutral: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
  negative: 'bg-[var(--danger-tint)] text-[var(--danger)]',
};

function DealSentimentView({ data }: { data: DealSentimentResult }) {
  const { t } = useTranslation('crm');
  const scoreText = `${data.score > 0 ? '+' : ''}${data.score.toFixed(1)}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider',
            SENTIMENT_BADGE[data.label],
          )}
        >
          {data.label}
        </span>
        <span className="font-mono text-xs text-[var(--fg-tertiary)]">
          {t('copilot.sentimentScore', '{{score}} on the −1…+1 read', { score: scoreText })}
        </span>
      </div>
      {data.summary ? (
        <p className="text-xs leading-relaxed text-[var(--fg-primary)]">{data.summary}</p>
      ) : null}
      <SectionList heading={t('copilot.riskFlags', 'Risk flags')} items={data.riskFlags} />
      <SectionList
        heading={t('copilot.suggestedActions', 'Suggested next moves')}
        items={data.suggestedActions}
      />
    </div>
  );
}

function AccountIntelView({ data }: { data: AccountIntelResult }) {
  const { t } = useTranslation('crm');
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-1.5">
        <AnimatedNumber
          value={data.healthScore}
          duration={0.6}
          className="text-2xl font-semibold tabular-nums text-[var(--fg-primary)]"
        />
        <span className="text-xs text-[var(--fg-tertiary)]">
          {t('copilot.healthOutOf', '/ 100 relationship health')}
        </span>
      </div>
      {data.summary ? (
        <p className="text-xs leading-relaxed text-[var(--fg-primary)]">{data.summary}</p>
      ) : null}
      <SectionList
        heading={t('copilot.expansion', 'Expansion room')}
        items={data.expansionOpportunities}
      />
      <SectionList heading={t('copilot.churnRisks', 'Churn risks')} items={data.churnRisks} />
    </div>
  );
}

export function CopilotResultView({ result }: { result: CopilotResultData }) {
  const { t } = useTranslation('crm');
  return (
    <div className="space-y-4">
      {result.kind === 'email-draft' ? <EmailDraftView data={result.data} /> : null}
      {result.kind === 'deal-sentiment' ? <DealSentimentView data={result.data} /> : null}
      {result.kind === 'account-intel' ? <AccountIntelView data={result.data} /> : null}
      <p className="text-[10px] text-[var(--fg-muted)]">
        {t('copilot.cost', 'Cost: ${{amount}}', {
          // Money lives in micros on the wire; format at the edge only.
          amount: (result.data.costMicros / 1_000_000).toFixed(4),
        })}
      </p>
      <AiFeedback sessionId={result.data.sessionId} />
    </div>
  );
}
