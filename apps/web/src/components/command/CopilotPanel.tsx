/**
 * CopilotPanel — the ⌘K palette's "Ask Copilot" mode (GOAL.md Phase 5,
 * "Talk to the CRM"). Rendered by PaletteBody in place of the search listbox
 * when the query leads with '?' or '>'. The palette input keeps DOM focus the
 * whole time; keyboard events reach this panel through `keyHandlerRef` so the
 * combobox pattern (aria-activedescendant on the input) stays intact.
 *
 * Action gating lives in copilotActions.ts: anything missing a required
 * entity id renders disabled with a hint instead of firing a doomed request.
 */
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { CopilotResultView, type CopilotResultData } from '@/components/ai/CopilotResultView';
import { Icon } from '@/components/ui/Icon';
import {
  useAccountIntel,
  useDealSentiment,
  useDraftEmail,
} from '@/hooks/useAiAssistant';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { cn } from '@/lib/cn';

import {
  buildCopilotActions,
  parseCopilotContext,
  type CopilotAction,
  type CopilotActionKind,
} from './copilotActions';
import type { Item } from './commandPaletteUtils';

export type CopilotKeyHandler = (e: KeyboardEvent<HTMLInputElement>) => boolean;

interface CopilotPanelProps {
  /** The user's ask, already stripped of the '?'/'>' prefix. */
  prompt: string;
  onClose: () => void;
  /** PaletteBody forwards the input's keydowns here while in copilot mode. */
  keyHandlerRef: MutableRefObject<CopilotKeyHandler | null>;
  /** Reports the highlighted option id for the input's aria-activedescendant. */
  onActiveOptionChange: (id: string | null) => void;
}

/** The "Ask Copilot" row appended to normal search results for sentence-like
 *  queries — selecting it re-prefixes the query, which flips the mode. */
export function buildAskCopilotItem(
  query: string,
  t: TFunction,
  onAsk: (query: string) => void,
): Item {
  return {
    id: 'copilot:ask',
    group: 'ask',
    label: t('copilot.askRow', 'Ask Copilot: “{{q}}”', { q: query.trim() }),
    hint: t('copilot.askRowHint', 'or lead with ?'),
    leading: <Icon name="sparkle" size={16} className="text-[var(--brand-primary)]" />,
    onSelect: () => onAsk(query),
  };
}

function actionLabel(kind: CopilotActionKind, t: TFunction): string {
  if (kind === 'email-draft') return t('copilot.actionEmail', 'Draft the email');
  if (kind === 'account-intel') return t('copilot.actionIntel', 'Summarize account intel');
  if (kind === 'deal-sentiment') return t('copilot.actionSentiment', 'Read deal sentiment');
  return t('copilot.actionMeetingPrep', 'Prep the next meeting');
}

function actionHint(action: CopilotAction, t: TFunction, accountName?: string): string {
  if (action.reason === 'no-prompt')
    return t('copilot.hintNoPrompt', 'Type the ask first — e.g. “? nudge procurement on the MSA redlines”');
  if (action.reason === 'no-account')
    return t('copilot.hintNoAccount', 'Open an account cockpit first — intel reads the record on screen');
  if (action.reason === 'no-deal')
    return t('copilot.hintNoDeal', 'Open an opportunity first — sentiment reads its activity trail');
  if (action.reason === 'no-calendar-event')
    return t('copilot.hintNoEvent', 'Needs a calendar event — open one and run prep from there');
  if (action.kind === 'email-draft')
    return t('copilot.hintEmail', '3 variants in a friendly tone, built from your ask');
  if (action.kind === 'account-intel')
    return accountName
      ? t('copilot.hintIntelNamed', 'Health, expansion room, churn risks for {{name}}', {
          name: accountName,
        })
      : t('copilot.hintIntel', 'Health, expansion room, churn risks for this account');
  return t('copilot.hintSentiment', 'Score and risk flags from this opportunity’s trail');
}

interface ActionRowProps {
  action: CopilotAction;
  index: number;
  active: boolean;
  hint: string;
  label: string;
  onHover: (index: number) => void;
  onRun: (action: CopilotAction) => void;
}

function ActionRow({ action, index, active, hint, label, onHover, onRun }: ActionRowProps) {
  return (
    <div
      id={`copilot-option-${index}`}
      role="option"
      aria-selected={active}
      aria-disabled={!action.enabled}
      onMouseEnter={() => onHover(index)}
      onClick={() => onRun(action)}
      className={cn(
        // min-h-11 keeps touch targets ≥ 44px (WCAG 2.5.5 AA)
        'mx-2 my-0.5 flex min-h-11 items-center gap-3 rounded-lg px-4 py-2 transition-colors',
        action.enabled ? 'cursor-pointer' : 'cursor-default opacity-60',
        active && 'bg-[var(--surface-hover)]',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
          active && action.enabled
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
            : 'border-[var(--border-default)] bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]',
        )}
        aria-hidden
      >
        <Icon name={action.icon} size={14} />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate text-sm',
            active && action.enabled
              ? 'font-medium text-[var(--brand-primary)]'
              : 'text-[var(--fg-primary)]',
          )}
        >
          {label}
        </span>
        <span className="block truncate text-[11px] text-[var(--fg-tertiary)]">{hint}</span>
      </span>
    </div>
  );
}

interface StatusAreaProps {
  pending: boolean;
  error: Error | null;
  result: CopilotResultData | null;
  promptEmpty: boolean;
  entityLink: { label: string; to: string } | null;
  onRetry: () => void;
  onOpenEntity: (to: string) => void;
}

/** Everything below the action list: skeleton → error → result → ready copy.
 *  aria-live so screen readers hear results land without losing input focus. */
function CopilotStatusArea({
  pending,
  error,
  result,
  promptEmpty,
  entityLink,
  onRetry,
  onOpenEntity,
}: StatusAreaProps) {
  const { t } = useTranslation('crm');
  const linkButtonClasses = cn(
    'flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[var(--brand-primary)]',
    'hover:bg-[var(--surface-hover)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
  );
  return (
    <div aria-live="polite" className="border-t border-[var(--border-subtle)] px-4 py-3">
      {pending ? (
        <div
          className="space-y-2 animate-pulse motion-reduce:animate-none"
          role="status"
          aria-label={t('copilot.working', 'Copilot is reading the record…')}
        >
          {[80, 60, 70, 50].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded bg-[var(--surface-sunken)]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : error ? (
        <div>
          <p className="text-xs text-[var(--danger)]" role="alert">
            {error.message.includes('cap')
              ? t('copilot.errorCap', 'Daily AI budget spent — it resets tomorrow.')
              : t('copilot.errorGeneric', 'Copilot couldn’t read this record. Try again.')}
          </p>
          <button type="button" onClick={onRetry} className={linkButtonClasses}>
            {t('copilot.retry', 'Retry')}
          </button>
        </div>
      ) : result ? (
        <div className="space-y-3">
          <CopilotResultView result={result} />
          {entityLink ? (
            <button
              type="button"
              onClick={() => onOpenEntity(entityLink.to)}
              className={linkButtonClasses}
            >
              {entityLink.label}
              <Icon name="arrow" size={14} />
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-[var(--fg-tertiary)]">
          {promptEmpty
            ? t(
                'copilot.readyNoPrompt',
                'Ask in plain words — “where does the Vinci bid stand” — or run an action on the open record.',
              )
            : t(
                'copilot.readyWithPrompt',
                'Pick an action — ↵ runs the highlighted one against your ask.',
              )}
        </p>
      )}
    </div>
  );
}

export function CopilotPanel({
  prompt,
  onClose,
  keyHandlerRef,
  onActiveOptionChange,
}: CopilotPanelProps) {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ctx = useMemo(() => parseCopilotContext(pathname), [pathname]);

  // Dashboard companies are already in the React Query cache for anyone who
  // has seen the dashboard — a free name lookup, same trick usePaletteItems uses.
  const dashboard = useCrmDashboard();
  const accountName = ctx.accountId
    ? dashboard.data?.companies?.find((c) => c.id === ctx.accountId)?.name
    : undefined;

  const actions = useMemo(() => buildCopilotActions(ctx, prompt), [ctx, prompt]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [result, setResult] = useState<CopilotResultData | null>(null);
  const [lastRun, setLastRun] = useState<CopilotActionKind | null>(null);

  const draftEmail = useDraftEmail();
  const dealSentiment = useDealSentiment();
  const accountIntel = useAccountIntel();
  const mutations = {
    'email-draft': draftEmail,
    'deal-sentiment': dealSentiment,
    'account-intel': accountIntel,
  } as const;
  const activeMutation = lastRun && lastRun !== 'meeting-prep' ? mutations[lastRun] : null;
  const pending = activeMutation?.isPending ?? false;
  const error = activeMutation?.error ?? null;

  function runAction(action: CopilotAction) {
    if (!action.enabled || pending) return;
    setLastRun(action.kind);
    if (action.kind === 'email-draft') {
      draftEmail.mutate(
        { intent: prompt.trim(), ...(ctx.dealId ? { dealId: ctx.dealId } : {}) },
        { onSuccess: (data) => setResult({ kind: 'email-draft', data }) },
      );
    } else if (action.kind === 'deal-sentiment' && ctx.dealId) {
      dealSentiment.mutate(ctx.dealId, {
        onSuccess: (data) => setResult({ kind: 'deal-sentiment', data }),
      });
    } else if (action.kind === 'account-intel' && ctx.accountId) {
      accountIntel.mutate(ctx.accountId, {
        onSuccess: (data) => setResult({ kind: 'account-intel', data }),
      });
    }
  }

  // Latest-value bridge for the palette input's keydown — reassigned every
  // render so it always closes over current actions/activeIdx.
  useEffect(() => {
    keyHandlerRef.current = (e) => {
      if (e.key === 'ArrowDown') {
        setActiveIdx((i) => Math.min(actions.length - 1, i + 1));
        return true;
      }
      if (e.key === 'ArrowUp') {
        setActiveIdx((i) => Math.max(0, i - 1));
        return true;
      }
      if (e.key === 'Enter') {
        const action = actions[activeIdx];
        if (action) runAction(action);
        return true;
      }
      return false;
    };
  });
  useEffect(() => () => {
    keyHandlerRef.current = null;
  }, [keyHandlerRef]);

  useEffect(() => {
    onActiveOptionChange(`copilot-option-${activeIdx}`);
  }, [activeIdx, onActiveOptionChange]);
  useEffect(() => () => onActiveOptionChange(null), [onActiveOptionChange]);

  const contextLabel = accountName
    ? t('copilot.ctxAccount', 'Reading {{name}}', { name: accountName })
    : ctx.accountId
      ? t('copilot.ctxAccountAnon', 'Reading this account')
      : ctx.dealId
        ? t('copilot.ctxDeal', 'Reading this opportunity')
        : t('copilot.ctxNone', 'No record open — open an account or opportunity for record-aware answers');

  const entityLink =
    result?.kind === 'account-intel' && ctx.accountId
      ? {
          label: accountName
            ? t('copilot.openAccountNamed', 'Open {{name}}’s cockpit', { name: accountName })
            : t('copilot.openAccount', 'Open the account cockpit'),
          to: `/accounts/${encodeURIComponent(ctx.accountId)}`,
        }
      : result && ctx.dealId
        ? {
            label: t('copilot.openOpportunity', 'Open the opportunity'),
            to: `/opportunities/${encodeURIComponent(ctx.dealId)}`,
          }
        : null;

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <Icon name="sparkle" size={14} className="shrink-0 text-[var(--brand-primary)]" />
        <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
          {t('copilot.badge', 'Copilot')}
        </span>
        <span className="truncate text-[10px] text-[var(--fg-tertiary)]">{contextLabel}</span>
      </div>

      <div
        id="copilot-list"
        role="listbox"
        aria-label={t('copilot.actionsAria', 'Copilot actions')}
        className="py-1.5"
      >
        {actions.map((action, index) => (
          <ActionRow
            key={action.kind}
            action={action}
            index={index}
            active={index === activeIdx}
            label={actionLabel(action.kind, t)}
            hint={actionHint(action, t, accountName)}
            onHover={setActiveIdx}
            onRun={runAction}
          />
        ))}
      </div>

      <CopilotStatusArea
        pending={pending}
        error={error}
        result={result}
        promptEmpty={!prompt.trim()}
        entityLink={entityLink}
        onRetry={() => {
          const failed = actions.find((a) => a.kind === lastRun);
          if (failed) runAction(failed);
        }}
        onOpenEntity={(to) => {
          navigate(to);
          onClose();
        }}
      />

      <div className="border-t border-[var(--border-subtle)] px-4 py-2">
        <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {t('copilot.footerKeys', '↑↓ actions · ↵ run · erase the ? to search')}
        </p>
      </div>
    </div>
  );
}
