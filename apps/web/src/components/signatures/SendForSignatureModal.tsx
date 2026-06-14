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
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogClose } from '@/components/ui/Dialog';
import { useSendForSignature } from '@/hooks/useSignatureRequests';
import { cn } from '@/lib/cn';
import type { SignatureRecipient } from '@bidstack/shared';

import { type Recipient } from './sendForSignature/signatureModalShared';
import { TemplateStep } from './sendForSignature/TemplateStep';
import { RecipientsStep } from './sendForSignature/RecipientsStep';
import { ReviewStep } from './sendForSignature/ReviewStep';

// ─── Step indicator (only used here — kept inline intentionally) ──────────────

const STEPS = [
  { key: 'template', label: 'Template' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'reviewSend', label: 'Review & Send' },
] as const;

function StepIndicator({ current }: { current: number }) {
  const { t } = useTranslation('signatures');
  return (
    <nav
      aria-label={t('sendForSignature.stepsNavLabel', 'Sending steps')}
      className="mb-6 flex items-center gap-2"
    >
      {STEPS.map(({ key, label }, i) => (
        <div key={key} className="flex items-center gap-2">
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
            {t(`sendForSignature.step.${key}`, label)}
          </span>
          {i < STEPS.length - 1 && (
            <span aria-hidden="true" className="mx-1 h-px w-6 bg-[var(--border-subtle)]" />
          )}
        </div>
      ))}
    </nav>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface SendForSignatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected documentId (if invoked from a deal/opp detail page) */
  documentId?: string;
}

export function SendForSignatureModal({
  open,
  onOpenChange,
  documentId,
}: SendForSignatureModalProps) {
  const { t } = useTranslation('signatures');
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
      <DialogContent
        title={t('sendForSignature.dialogTitle', 'Send for Signature')}
        className="max-w-2xl"
      >
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
                {t('sendForSignature.successTitle', 'Signature request sent!')}
              </p>
              <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                {t(
                  'sendForSignature.successMessage',
                  'Recipients will receive an email to sign the document.',
                )}
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
                {t('sendForSignature.doneButton', 'Done')}
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
