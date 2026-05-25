/**
 * Modal to send a document for signature.
 *
 * Flow:
 *  Step 1 — Pick template + fill required variables
 *  Step 2 — Add recipients (email + name + role: SIGNER | CC)
 *  Step 3 — Optional message + review preview
 *  Step 4 — Confirmation / success
 *
 * WHY multi-step: a linear single-form has too many fields for one screen.
 * The step wizard matches DocuSign's own UX pattern, keeping each decision
 * clearly scoped.
 */

import { useState } from 'react';

import { Dialog, DialogContent, DialogClose } from '@/components/ui/Dialog';
import { useDocumentTemplates, useDocumentTemplate } from '@/hooks/useDocumentTemplates';
import { useSendForSignature } from '@/hooks/useSignatureRequests';
import { DocumentPreviewIframe } from './DocumentPreviewIframe';
import { cn } from '@/lib/cn';
import type { SignatureRecipient, TemplateKind } from '@bidstack/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Recipient {
  email: string;
  name: string;
  role: 'SIGNER' | 'CC';
}

interface SendForSignatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected documentId (if invoked from a deal/opp detail page) */
  documentId?: string;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ['Template', 'Recipients', 'Review & Send'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Sending steps" className="flex items-center gap-2 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
              i < current
                ? 'bg-brand text-fg-on-brand'
                : i === current
                ? 'bg-brand text-fg-on-brand ring-2 ring-brand ring-offset-2'
                : 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]',
            )}
          >
            {i < current ? '✓' : i + 1}
          </div>
          <span
            className={cn(
              'text-xs font-medium',
              i <= current ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)]',
            )}
          >
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <span aria-hidden="true" className="mx-1 h-px w-6 bg-[var(--border-subtle)]" />
          )}
        </div>
      ))}
    </nav>
  );
}

// ─── Input helpers ────────────────────────────────────────────────────────────

function FieldLabel({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
      {children}
      {required && <span aria-hidden="true" className="ml-0.5 text-[var(--tag-tomato-fg)]">*</span>}
    </label>
  );
}

const inputClass = cn(
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
  'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-disabled)]',
  'min-h-[44px]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
);

// ─── Step 1: Template picker ──────────────────────────────────────────────────

function TemplateStep({
  selectedId,
  variables,
  onSelectTemplate,
  onChangeVariable,
  onNext,
}: {
  selectedId: string;
  variables: Record<string, string>;
  onSelectTemplate: (id: string) => void;
  onChangeVariable: (key: string, val: string) => void;
  onNext: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<TemplateKind | ''>('');
  const { data: page, isLoading } = useDocumentTemplates(
    kindFilter ? { kind: kindFilter as TemplateKind } : {},
  );
  const { data: template } = useDocumentTemplate(selectedId);

  const kinds: Array<TemplateKind | ''> = ['', 'QUOTE', 'MSA', 'SOW', 'NDA', 'PROPOSAL', 'CUSTOM'];

  // Extract {{var}} placeholders from the selected template's body
  const vars = template
    ? [...template.bodyHtml.matchAll(/\{\{(\w+)\}\}/g)]
        .map((m) => m[1])
        .filter((value): value is string => Boolean(value))
    : [];
  const uniqueVars = [...new Set(vars)];

  return (
    <div className="flex flex-col gap-4">
      {/* Kind filter */}
      <div>
        <FieldLabel htmlFor="kind-filter">Template type</FieldLabel>
        <select
          id="kind-filter"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as TemplateKind | '')}
          className={inputClass}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === '' ? 'All types' : k}
            </option>
          ))}
        </select>
      </div>

      {/* Template list */}
      <div>
        <FieldLabel htmlFor="template-select" required>Document template</FieldLabel>
        {isLoading ? (
          <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-sunken)]" />
        ) : (
          <select
            id="template-select"
            value={selectedId}
            onChange={(e) => onSelectTemplate(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">Select a template…</option>
            {page?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.kind})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Variable fields */}
      {uniqueVars.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            Template variables
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {uniqueVars.map((v) => (
              <div key={v}>
                <FieldLabel htmlFor={`var-${v}`}>
                  {v.replace(/_/g, ' ')}
                </FieldLabel>
                <input
                  id={`var-${v}`}
                  type="text"
                  value={variables[v] ?? template?.defaultVariables?.[v] ?? ''}
                  onChange={(e) => onChangeVariable(v, e.target.value)}
                  placeholder={`{{${v}}}`}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!selectedId}
          className={cn(
            'min-h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-fg-on-brand',
            'hover:bg-brand-hover transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          Next: Recipients
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Recipients ───────────────────────────────────────────────────────

function RecipientsStep({
  recipients,
  onChangeRecipients,
  onBack,
  onNext,
}: {
  recipients: Recipient[];
  onChangeRecipients: (r: Recipient[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const addRecipient = () =>
    onChangeRecipients([...recipients, { email: '', name: '', role: 'SIGNER' }]);

  const updateRecipient = (i: number, patch: Partial<Recipient>) => {
    const next = recipients.slice();
    const current = next[i];
    if (!current) return;
    next[i] = { ...current, ...patch };
    onChangeRecipients(next);
  };

  const removeRecipient = (i: number) =>
    onChangeRecipients(recipients.filter((_, idx) => idx !== i));

  const canProceed = recipients.length > 0 && recipients.every((r) => r.email && r.name);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3" role="list" aria-label="Recipients">
        {recipients.map((r, i) => (
          <div
            key={i}
            role="listitem"
            className="grid gap-3 rounded-xl border border-[var(--border-subtle)] p-4 sm:grid-cols-[1fr_1fr_auto_auto]"
          >
            <div>
              <FieldLabel htmlFor={`recip-name-${i}`} required>Name</FieldLabel>
              <input
                id={`recip-name-${i}`}
                type="text"
                value={r.name}
                onChange={(e) => updateRecipient(i, { name: e.target.value })}
                placeholder="Jane Smith"
                className={inputClass}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor={`recip-email-${i}`} required>Email</FieldLabel>
              <input
                id={`recip-email-${i}`}
                type="email"
                value={r.email}
                onChange={(e) => updateRecipient(i, { email: e.target.value })}
                placeholder="jane@example.com"
                className={inputClass}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor={`recip-role-${i}`}>Role</FieldLabel>
              <select
                id={`recip-role-${i}`}
                value={r.role}
                onChange={(e) => updateRecipient(i, { role: e.target.value as 'SIGNER' | 'CC' })}
                className={inputClass}
              >
                <option value="SIGNER">Signer</option>
                <option value="CC">CC</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => removeRecipient(i)}
                aria-label={`Remove recipient ${r.name || i + 1}`}
                disabled={recipients.length === 1}
                className={cn(
                  'min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border-default)]',
                  'text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--tag-tomato-fg)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRecipient}
        disabled={recipients.length >= 20}
        className={cn(
          'min-h-[44px] w-full rounded-lg border-2 border-dashed border-[var(--border-default)]',
          'text-sm text-[var(--fg-secondary)] hover:border-brand hover:text-brand',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
          'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        + Add recipient
      </button>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'min-h-[44px] rounded-lg border border-[var(--border-default)] px-4 text-sm text-[var(--fg-secondary)]',
            'hover:bg-[var(--surface-sunken)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
          )}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={cn(
            'min-h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-fg-on-brand',
            'hover:bg-brand-hover transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          Next: Review
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Review & Send ────────────────────────────────────────────────────

function ReviewStep({
  templateId,
  recipients,
  variables,
  message,
  onChangeMessage,
  onBack,
  onSend,
  isSending,
}: {
  templateId: string;
  recipients: Recipient[];
  variables: Record<string, string>;
  message: string;
  onChangeMessage: (m: string) => void;
  onBack: () => void;
  onSend: () => void;
  isSending: boolean;
}) {
  const { data: template } = useDocumentTemplate(templateId);

  // Render preview by substituting variables
  const previewHtml = template
    ? Object.entries(variables).reduce(
        (html, [k, v]) => html.replaceAll(`{{${k}}}`, v),
        template.bodyHtml,
      )
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Document preview */}
      {previewHtml && (
        <DocumentPreviewIframe
          src={previewHtml}
          srcdoc
          title={template?.name ?? 'Document preview'}
          height={300}
        />
      )}

      {/* Message */}
      <div>
        <FieldLabel htmlFor="sig-message">Message to recipients (optional)</FieldLabel>
        <textarea
          id="sig-message"
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          placeholder="Please review and sign the attached document…"
          rows={3}
          maxLength={500}
          className={cn(inputClass, 'min-h-[auto] resize-none')}
        />
        <p className="mt-0.5 text-right text-xs text-[var(--fg-tertiary)]">
          {message.length}/500
        </p>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-[var(--border-subtle)] p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Recipients ({recipients.length})
        </p>
        <ul className="flex flex-col gap-1.5" aria-label="Recipient summary">
          {recipients.map((r) => (
            <li key={r.email} className="flex items-center gap-2 text-sm">
              <span className="font-medium text-[var(--fg-primary)]">{r.name}</span>
              <span className="text-[var(--fg-secondary)]">{r.email}</span>
              <span className="ml-auto rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-[var(--fg-tertiary)]">
                {r.role}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isSending}
          className={cn(
            'min-h-[44px] rounded-lg border border-[var(--border-default)] px-4 text-sm text-[var(--fg-secondary)]',
            'hover:bg-[var(--surface-sunken)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40',
          )}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={isSending}
          aria-busy={isSending}
          className={cn(
            'min-h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-fg-on-brand',
            'hover:bg-brand-hover transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isSending ? 'Sending…' : 'Send for Signature'}
        </button>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function SendForSignatureModal({
  open,
  onOpenChange,
  documentId,
}: SendForSignatureModalProps) {
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [recipients, setRecipients] = useState<Recipient[]>([
    { email: '', name: '', role: 'SIGNER' },
  ]);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const send = useSendForSignature();

  const handleSend = () => {
    if (!documentId && !templateId) return;
    const signatureRecipients: SignatureRecipient[] = recipients.map(({ email, name, role }) => ({
      email,
      name,
      role,
    }));
    send.mutate(
      {
        documentId: documentId ?? templateId, // fallback — real API may differ
        templateId: templateId || undefined,
        recipients: signatureRecipients,
        message: message || undefined,
        variables,
        provider: 'DOCUSIGN',
      },
      {
        onSuccess: () => setSent(true),
      },
    );
  };

  const reset = () => {
    setStep(0);
    setTemplateId('');
    setVariables({});
    setRecipients([{ email: '', name: '', role: 'SIGNER' }]);
    setMessage('');
    setSent(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title="Send for Signature" className="max-w-2xl">
        {sent ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tag-jade-bg)] text-2xl"
            >
              ✓
            </div>
            <div>
              <p className="text-base font-semibold text-[var(--fg-primary)]">
                Signature request sent!
              </p>
              <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                Recipients will receive an email to sign the document.
              </p>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className={cn(
                  'min-h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-fg-on-brand',
                  'hover:bg-brand-hover transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                )}
              >
                Done
              </button>
            </DialogClose>
          </div>
        ) : (
          <>
            <StepIndicator current={step} />
            {step === 0 && (
              <TemplateStep
                selectedId={templateId}
                variables={variables}
                onSelectTemplate={(id) => {
                  setTemplateId(id);
                  setVariables({});
                }}
                onChangeVariable={(k, v) => setVariables((prev) => ({ ...prev, [k]: v }))}
                onNext={() => setStep(1)}
              />
            )}
            {step === 1 && (
              <RecipientsStep
                recipients={recipients}
                onChangeRecipients={setRecipients}
                onBack={() => setStep(0)}
                onNext={() => setStep(2)}
              />
            )}
            {step === 2 && (
              <ReviewStep
                templateId={templateId}
                recipients={recipients}
                variables={variables}
                message={message}
                onChangeMessage={setMessage}
                onBack={() => setStep(1)}
                onSend={handleSend}
                isSending={send.isPending}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
