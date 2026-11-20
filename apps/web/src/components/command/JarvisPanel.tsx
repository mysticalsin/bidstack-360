/**
 * JarvisPanel: the Copilot upgraded to a side sheet that answers with record
 * citations and can act. Opens from the Topbar mic, Cmd+J and the palette.
 * Steps are polled from the server run; a write never runs from here until
 * the user presses Confirm on its card, and the server re-checks RBAC then.
 */
import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Ban,
  Check,
  CircleAlert,
  Clock,
  Loader2,
  Mic,
  MicOff,
  SendHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import {
  useJarvisActionDecision,
  useJarvisRunStatus,
  useStartJarvisRun,
  type JarvisPendingAction,
  type JarvisRun,
  type JarvisStep,
  type JarvisStepStatus,
} from '@/hooks/useAiAssistant';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { springModal } from '@/lib/motion';

import { parseJarvisContext, type JarvisContext } from './copilotActions';
import { useJarvisStore } from './jarvisStore';
import {
  getSpeechRecognitionCtor,
  readJarvisMuted,
  speak,
  stopSpeaking,
  writeJarvisMuted,
  type JarvisRecognition,
} from './jarvisVoice';

interface Turn {
  id: string;
  message: string;
  runId: string | null;
  error: Error | null;
}

type Decision = 'confirmed' | 'cancelled' | 'failed';

const ICON_BUTTON = cn(
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--fg-tertiary)]',
  'hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

function stepLabel(tool: string, t: TFunction): string {
  const labels: Record<string, string> = {
    'records.resolve': t('jarvis.step.resolve', 'Find records'),
    'account.updates': t('jarvis.step.accountUpdates', 'Read account activity'),
    'proposal.status': t('jarvis.step.proposal', 'Read proposal'),
    'rfp.summary': t('jarvis.step.rfp', 'Read RFP'),
    'bids.overdue': t('jarvis.step.overdue', 'Find overdue bids'),
    'opportunities.list': t('jarvis.step.oppList', 'List opportunities'),
    'opportunities.get': t('jarvis.step.oppGet', 'Read opportunity'),
    'tasks.create': t('jarvis.step.task', 'Prepare task'),
    'opportunity.update': t('jarvis.step.oppUpdate', 'Prepare opportunity change'),
    'proposal.section_draft': t('jarvis.step.section', 'Prepare section draft'),
  };
  return labels[tool] ?? tool;
}

const STATUS_STYLE: Record<JarvisStepStatus, { icon: LucideIcon; className: string }> = {
  running: {
    icon: Loader2,
    className: 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]',
  },
  done: { icon: Check, className: 'bg-[var(--success-tint)] text-[var(--success-fg)]' },
  pending: { icon: Clock, className: 'bg-[var(--warning-tint)] text-[var(--warning-fg)]' },
  error: { icon: CircleAlert, className: 'bg-[var(--danger-tint)] text-[var(--danger)]' },
  denied: { icon: Ban, className: 'bg-[var(--danger-tint)] text-[var(--danger)]' },
};

function statusLabel(status: JarvisStepStatus, t: TFunction): string {
  if (status === 'running') return t('jarvis.status.running', 'Running');
  if (status === 'done') return t('jarvis.status.done', 'Done');
  if (status === 'pending') return t('jarvis.status.pending', 'Needs confirmation');
  if (status === 'denied') return t('jarvis.status.denied', 'No access');
  return t('jarvis.status.error', 'Failed');
}

function StepPill({ status }: { status: JarvisStepStatus }) {
  const { t } = useTranslation('crm');
  const { icon: StatusIcon, className } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      <StatusIcon
        size={12}
        aria-hidden
        className={status === 'running' ? 'animate-spin motion-reduce:animate-none' : undefined}
      />
      {statusLabel(status, t)}
    </span>
  );
}

function StepList({ steps }: { steps: JarvisStep[] }) {
  const { t } = useTranslation('crm');
  if (steps.length === 0) return null;
  return (
    <ol aria-label={t('jarvis.steps', 'Steps')} className="space-y-1.5">
      {steps.map((step) => (
        <li key={step.id} className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0">
            <span className="block font-medium text-[var(--fg-primary)]">
              {stepLabel(step.tool, t)}
            </span>
            {step.summary ? (
              <span className="block truncate text-[var(--fg-tertiary)]">{step.summary}</span>
            ) : null}
          </span>
          <StepPill status={step.status} />
        </li>
      ))}
    </ol>
  );
}

interface ActionCardProps {
  action: JarvisPendingAction;
  decision: Decision | undefined;
  busy: boolean;
  onDecide: (decision: 'confirm' | 'cancel') => void;
}

function ActionCard({ action, decision, busy, onDecide }: ActionCardProps) {
  const { t } = useTranslation('crm');
  const titleId = `jarvis-action-${action.id}`;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-3"
    >
      <p id={titleId} className="text-sm font-semibold text-[var(--fg-primary)]">
        {action.title}
      </p>
      <dl className="mt-2 space-y-1 text-xs">
        {action.changes.map((change) => (
          <div key={change.field} className="flex gap-3">
            <dt className="w-24 shrink-0 text-[var(--fg-tertiary)]">{change.field}</dt>
            <dd className="min-w-0 break-words text-[var(--fg-primary)]">{change.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center gap-2" aria-live="polite">
        {decision === 'confirmed' ? (
          <StatusText icon={Check} tone="success">
            {t('jarvis.action.done', 'Applied')}
          </StatusText>
        ) : decision === 'cancelled' ? (
          <StatusText icon={Ban} tone="muted">
            {t('jarvis.action.cancelled', 'Cancelled')}
          </StatusText>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide('confirm')}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--brand-primary)] px-3 text-xs font-semibold text-[var(--fg-on-brand)]',
                'hover:bg-[var(--brand-primary-hover)] disabled:opacity-60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
              )}
            >
              <Check size={14} aria-hidden />
              {t('jarvis.action.confirm', 'Confirm')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide('cancel')}
              className={cn(
                'inline-flex min-h-9 items-center rounded-md border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--fg-secondary)]',
                'hover:bg-[var(--surface-hover)] disabled:opacity-60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
              )}
            >
              {t('jarvis.action.cancel', 'Cancel')}
            </button>
            {decision === 'failed' ? (
              <StatusText icon={AlertTriangle} tone="danger">
                {t('jarvis.action.failed', 'Not applied')}
              </StatusText>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StatusText({
  icon: StatusIcon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: 'success' | 'danger' | 'muted';
  children: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        tone === 'success' && 'text-[var(--success-fg)]',
        tone === 'danger' && 'text-[var(--danger)]',
        tone === 'muted' && 'text-[var(--fg-tertiary)]',
      )}
    >
      <StatusIcon size={14} aria-hidden />
      {children}
    </span>
  );
}

function errorText(error: Error, t: TFunction): string {
  if (error instanceof ApiError && error.status === 429)
    return t('jarvis.errorRate', 'Too many asks this minute. Try again shortly.');
  if (error instanceof ApiError && error.status === 403)
    return t('jarvis.errorForbidden', 'You do not have access to that.');
  return t('jarvis.errorGeneric', 'Jarvis could not answer. Try again.');
}

interface TurnViewProps {
  turn: Turn;
  latest: boolean;
  muted: boolean;
  spoken: Set<string>;
  onNavigate: () => void;
}

function TurnView({ turn, latest, muted, spoken, onNavigate }: TurnViewProps) {
  const { t } = useTranslation('crm');
  const status = useJarvisRunStatus(turn.runId);
  const run = status.data as JarvisRun | undefined;
  const decide = useJarvisActionDecision();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const answerText = run?.status !== 'running' ? run?.answer?.text : undefined;
  useEffect(() => {
    if (!latest || muted || !answerText || !turn.runId || spoken.has(turn.runId)) return;
    spoken.add(turn.runId);
    speak(window, answerText, navigator.language);
  }, [latest, muted, answerText, turn.runId, spoken]);

  function onDecide(action: JarvisPendingAction, decision: 'confirm' | 'cancel') {
    setBusyId(action.id);
    decide.mutate(
      { actionId: action.id, decision },
      {
        onSuccess: () =>
          setDecisions((d) => ({
            ...d,
            [action.id]: decision === 'confirm' ? 'confirmed' : 'cancelled',
          })),
        onError: () => setDecisions((d) => ({ ...d, [action.id]: 'failed' })),
        onSettled: () => setBusyId(null),
      },
    );
  }

  const error = turn.error ?? (status.error as Error | null);
  const settled = run && run.status !== 'running';

  return (
    <li className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-[var(--brand-primary-tint)] px-3 py-2 text-sm text-[var(--fg-primary)]">
        {turn.message}
      </p>
      <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
        {error ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {errorText(error, t)}
          </p>
        ) : null}
        {run ? <StepList steps={run.steps} /> : null}
        {!error && !settled ? (
          <p role="status" className="flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]">
            <Loader2 size={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
            {t('jarvis.working', 'Working')}
          </p>
        ) : null}
        {run?.answer ? (
          <div className="space-y-2" aria-live="polite">
            <p className="whitespace-pre-line text-sm text-[var(--fg-primary)]">
              {run.answer.text}
            </p>
            {run.answer.citations.length > 0 ? (
              <ul aria-label={t('jarvis.sources', 'Sources')} className="flex flex-wrap gap-1.5">
                {run.answer.citations.map((c) => (
                  <li key={c.href}>
                    <Link
                      to={c.href}
                      onClick={onNavigate}
                      className={cn(
                        'inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2 text-xs text-[var(--brand-primary)]',
                        'hover:bg-[var(--surface-hover)]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                      )}
                    >
                      <span>{c.label}</span>
                      {c.date ? (
                        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                          {c.date}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {run.answer.missing.length > 0 ? (
              <div className="rounded-md bg-[var(--warning-tint)] px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--warning-fg)]">
                  <AlertTriangle size={12} aria-hidden />
                  {t('jarvis.missing', 'Missing data')}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--fg-secondary)]">
                  {run.answer.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {run?.pendingActions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            decision={decisions[action.id]}
            busy={busyId === action.id}
            onDecide={(d) => onDecide(action, d)}
          />
        ))}
        {run?.mode === 'demo' && settled ? (
          <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            {t('jarvis.demoMode', 'Demo mode')}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function contextLabel(ctx: JarvisContext, t: TFunction): string | null {
  if (ctx.accountId) return t('jarvis.ctxAccount', 'This account');
  if (ctx.opportunityId) return t('jarvis.ctxOpportunity', 'This opportunity');
  if (ctx.proposalId) return t('jarvis.ctxProposal', 'This proposal');
  if (ctx.rfpOpportunityId) return t('jarvis.ctxRfp', 'This RFP');
  return null;
}

export function JarvisPanel() {
  const { t } = useTranslation('crm');
  const open = useJarvisStore((s) => s.open);
  const close = useJarvisStore((s) => s.close);
  const reduced = useReducedMotion();
  const { pathname } = useLocation();
  const context = useMemo(() => parseJarvisContext(pathname), [pathname]);

  const start = useStartJarvisRun();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(readJarvisMuted);
  const [listening, setListening] = useState(false);
  const [spoken] = useState(() => new Set<string>());
  const recognition = useRef<JarvisRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const RecognitionCtor = typeof window === 'undefined' ? null : getSpeechRecognitionCtor(window);

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || start.isPending) return;
      const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setTurns((prev) => [...prev, { id, message, runId: null, error: null }]);
      setInput('');
      start.mutate(
        { message, context },
        {
          onSuccess: (data) =>
            setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, runId: data.runId } : x))),
          onError: (error) =>
            setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, error } : x))),
        },
      );
    },
    [context, start],
  );

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [turns.length]);

  const stopListening = useCallback(() => {
    recognition.current?.abort();
    recognition.current = null;
    setListening(false);
  }, []);

  // Store subscription, not an effect on `open`: the palette hands over a
  // prompt and Cmd+J can close the sheet without going through Radix.
  useEffect(() => {
    const handle = (s: ReturnType<typeof useJarvisStore.getState>) => {
      if (s.open && s.draft) {
        const prompt = s.draft;
        s.clearDraft();
        sendRef.current(prompt);
      } else if (!s.open) {
        stopListening();
        stopSpeaking(window);
      }
    };
    return useJarvisStore.subscribe(handle);
  }, [stopListening]);

  function toggleMic() {
    if (listening) {
      stopListening();
      return;
    }
    if (!RecognitionCtor) return;
    const rec = new RecognitionCtor();
    rec.lang = navigator.language;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let text = '';
      let final = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        text += result[0]?.transcript ?? '';
        final = final || result.isFinal;
      }
      setInput(text);
      if (final) {
        stopListening();
        send(text);
      }
    };
    rec.onerror = () => stopListening();
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    stopSpeaking(window);
    recognition.current = rec;
    setListening(true);
    rec.start();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    writeJarvisMuted(next);
    if (next) stopSpeaking(window);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  const ctxLabel = contextLabel(context, t);

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                inputRef.current?.focus();
              }}
            >
              <motion.aside
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
                transition={springModal}
                className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(460px,94vw)] flex-col border-l border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
              >
                <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]"
                  >
                    <Sparkles size={16} />
                  </span>
                  <RadixDialog.Title className="text-sm font-semibold text-[var(--fg-primary)]">
                    {t('jarvis.title', 'Jarvis')}
                  </RadixDialog.Title>
                  {ctxLabel ? (
                    <span className="truncate rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-[var(--fg-secondary)]">
                      {ctxLabel}
                    </span>
                  ) : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-pressed={muted}
                    aria-label={
                      muted ? t('jarvis.unmute', 'Unmute voice') : t('jarvis.mute', 'Mute voice')
                    }
                    className={ICON_BUTTON}
                  >
                    {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
                  </button>
                  <RadixDialog.Close aria-label={t('jarvis.close', 'Close Jarvis')} className={ICON_BUTTON}>
                    <X size={16} aria-hidden />
                  </RadixDialog.Close>
                </header>

                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                  {turns.length > 0 ? (
                    <ol className="space-y-5">
                      {turns.map((turn, i) => (
                        <TurnView
                          key={turn.id}
                          turn={turn}
                          latest={i === turns.length - 1}
                          muted={muted}
                          spoken={spoken}
                          onNavigate={close}
                        />
                      ))}
                    </ol>
                  ) : null}
                </div>

                <form
                  onSubmit={onSubmit}
                  className="flex items-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3"
                >
                  <textarea
                    ref={inputRef}
                    aria-label={t('jarvis.input', 'Ask Jarvis')}
                    value={input}
                    rows={2}
                    maxLength={2000}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    className={cn(
                      'min-h-11 flex-1 resize-none rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)]',
                      'placeholder:text-[var(--fg-tertiary)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                    )}
                  />
                  {RecognitionCtor ? (
                    <button
                      type="button"
                      onClick={toggleMic}
                      aria-pressed={listening}
                      aria-label={
                        listening ? t('jarvis.stopListening', 'Stop listening') : t('jarvis.speak', 'Speak')
                      }
                      className={cn(
                        ICON_BUTTON,
                        'h-11 w-11',
                        listening &&
                          'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)] hover:text-[var(--brand-primary)]',
                      )}
                    >
                      {listening ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={!input.trim() || start.isPending}
                    aria-label={t('jarvis.send', 'Send')}
                    className={cn(
                      'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--brand-primary)] text-[var(--fg-on-brand)]',
                      'hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                    )}
                  >
                    <SendHorizontal size={18} aria-hidden />
                  </button>
                </form>
              </motion.aside>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
