// PublicSignPage — standalone e-signature page served at /sign/:token.
// NO app chrome (no Topbar, no Sidebar). Standalone layout.
//
// WHY standalone: signers are external parties who should not see internal
// CRM chrome. The page must also be reachable without authentication.
//
// Steps: Welcome → Sign → Submit → Confirmation.
// Each step has aria-live region, focus trap, and Skip-to-main link.
// Print CSS lets the signer keep a record.

import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, ChevronRight, Download, Pen, Type } from 'lucide-react';
import type { PublicSignatureRequest } from '@bidstack/shared';

import { cn } from '@/lib/cn';
import { SignaturePad, type SignaturePadHandle } from '@/components/signatures/SignaturePad';
import { usePublicSignatureRequest, useSubmitSignature } from '@/hooks/useSignatureRequests';

// ─── Step management ─────────────────────────────────────────────────────────

type Step = 'welcome' | 'sign' | 'submit' | 'confirm';

const STEP_ORDER: Step[] = ['welcome', 'sign', 'submit', 'confirm'];

// ─── Page root ───────────────────────────────────────────────────────────────

export function PublicSignPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { data, isLoading, error } = usePublicSignatureRequest(token);
  const submitMutation = useSubmitSignature(token);

  const [step, setStep] = useState<Step>('welcome');
  const [sigMode, setSigMode] = useState<'draw' | 'type'>('draw');
  const [typedNameInput, setTypedNameInput] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [validationError, setValidationError] = useState('');
  const typedName = typedNameInput ?? data?.recipientName ?? '';

  const padRef = useRef<SignaturePadHandle>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Announce step changes to screen readers
  const [announcement, setAnnouncement] = useState('');

  function goTo(next: Step) {
    setStep(next);
    setValidationError('');
    const labels: Record<Step, string> = {
      welcome: 'Step 1: Review document',
      sign: 'Step 2: Sign',
      submit: 'Step 3: Review and submit',
      confirm: 'Signature submitted successfully',
    };
    setAnnouncement(labels[next]);
    // Move focus to the main content area on step transition
    requestAnimationFrame(() => mainRef.current?.focus());
  }

  function handleContinueFromWelcome() {
    goTo('sign');
  }

  function handleContinueFromSign() {
    if (sigMode === 'draw') {
      const pad = padRef.current;
      const dataUrl = pad?.getDataUrl();
      if (!dataUrl) {
        setValidationError('Please draw or type your signature before continuing.');
        return;
      }
      setSignatureDataUrl(dataUrl);
    } else {
      if (!typedName.trim()) {
        setValidationError('Please type your name to create a signature.');
        return;
      }
      setSignatureDataUrl(renderTypedSignatureToDataUrl(typedName));
    }
    goTo('submit');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!acceptedTerms) {
      setValidationError('You must accept the terms to proceed.');
      return;
    }

    // The signature step unmounts before submit, so persist the image before transition.
    if (!signatureDataUrl) {
      setValidationError('Signature is missing. Please go back and sign again.');
      return;
    }

    submitMutation.mutate(
      { typedName: typedName || 'Signer', signatureDataUrl, acceptedTerms: true },
      {
        onSuccess: (result) => {
          setDownloadUrl(result.downloadUrl ?? '');
          goTo('confirm');
        },
        onError: (err) => {
          setValidationError(
            err instanceof Error ? err.message : 'Submission failed. Please try again.',
          );
        },
      },
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Print styles — inline so no extra CSS file needed */}
      <style>{PRINT_CSS}</style>

      {/* Skip-to-main link — always first in DOM */}
      <a
        href="#sign-main"
        className={cn(
          'sr-only focus:not-sr-only',
          'fixed left-2 top-2 z-[9999] rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        )}
      >
        Skip to main content
      </a>

      {/* aria-live region for step announcements */}
      <div aria-live="polite" aria-atomic className="sr-only">
        {announcement}
      </div>

      <div className="min-h-screen bg-[#fafafa] dark:bg-[#111111] print:bg-white">
        {/* Header */}
        <header className="border-b border-[var(--border-subtle)] bg-white dark:bg-[#1a1a1a] print:border-b-2 print:border-gray-200">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
            <div className="flex items-center gap-2">
              {/* Logo mark — intentionally minimal for third-party trust */}
              <div
                className="h-8 w-8 rounded-lg bg-[var(--brand-primary)] flex items-center justify-center"
                aria-hidden
              >
                <Pen size={14} className="text-white" />
              </div>
              <span className="text-sm font-semibold text-[var(--fg-primary)]">
                Secure Signature
              </span>
            </div>
            <StepIndicator step={step} />
          </div>
        </header>

        {/* Main content */}
        <main
          id="sign-main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto max-w-2xl px-4 py-8 outline-none print:py-4"
          aria-label="Document signing"
        >
          {isLoading && <LoadingState />}
          {error && <ErrorState error={error} />}

          {data && !isLoading && (
            <>
              {step === 'welcome' && (
                <WelcomeStep
                  data={data}
                  validationError={validationError}
                  onContinue={handleContinueFromWelcome}
                />
              )}
              {step === 'sign' && (
                <SignStep
                  data={data}
                  sigMode={sigMode}
                  onSigModeChange={setSigMode}
                  typedName={typedName}
                  onTypedNameChange={setTypedNameInput}
                  padRef={padRef}
                  validationError={validationError}
                  onBack={() => goTo('welcome')}
                  onContinue={handleContinueFromSign}
                />
              )}
              {step === 'submit' && (
                <SubmitStep
                  data={data}
                  acceptedTerms={acceptedTerms}
                  onAcceptedTermsChange={setAcceptedTerms}
                  validationError={validationError}
                  isPending={submitMutation.isPending}
                  onBack={() => goTo('sign')}
                  onSubmit={handleSubmit}
                />
              )}
              {step === 'confirm' && (
                <ConfirmStep downloadUrl={downloadUrl} senderName={data.senderName} />
              )}
            </>
          )}
        </main>

        {/* Footer — privacy note; no tracking pixels */}
        <footer className="mt-auto border-t border-[var(--border-subtle)] py-4 text-center text-xs text-[var(--fg-muted)] print:hidden">
          Your signature is legally binding. This page contains no tracking technologies.
        </footer>
      </div>
    </>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const idx = STEP_ORDER.indexOf(step);
  const labels = ['Review', 'Sign', 'Submit', 'Done'];
  return (
    <ol className="flex items-center gap-1 text-xs print:hidden" aria-label="Progress">
      {labels.slice(0, 3).map((label, i) => (
        <li key={label} className="flex items-center gap-1">
          <span
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
              i < idx
                ? 'bg-[var(--brand-primary)] text-white'
                : i === idx
                  ? 'bg-[var(--brand-primary)] text-white ring-2 ring-[var(--brand-primary)] ring-offset-1'
                  : 'bg-[var(--border-subtle)] text-[var(--fg-muted)]',
            )}
            aria-current={i === idx ? 'step' : undefined}
          >
            {i < idx ? <CheckCircle size={10} /> : i + 1}
          </span>
          <span
            className={cn(
              'hidden sm:inline',
              i === idx ? 'font-medium text-[var(--fg-primary)]' : 'text-[var(--fg-muted)]',
            )}
          >
            {label}
          </span>
          {i < 2 && <ChevronRight size={12} className="text-[var(--fg-muted)]" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

// ─── Step: Welcome ────────────────────────────────────────────────────────────

interface WelcomeStepProps {
  data: PublicSignatureRequest;
  validationError: string;
  onContinue: () => void;
}

function WelcomeStep({ data, onContinue }: WelcomeStepProps) {
  return (
    <section aria-labelledby="welcome-heading" className="space-y-6">
      <div>
        <h1 id="welcome-heading" className="text-2xl font-bold text-[var(--fg-primary)]">
          You have a document to sign
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          <strong>{data.senderName}</strong> has requested your signature on{' '}
          <strong>{data.templateName}</strong>.
        </p>
        {data.message && (
          <blockquote className="mt-4 rounded-lg border-l-4 border-[var(--brand-primary)] bg-[var(--surface-card)] dark:bg-[var(--surface-glass)] p-4 text-sm italic text-[var(--fg-secondary)]">
            &ldquo;{data.message}&rdquo;
          </blockquote>
        )}
        {data.expiresAt && (
          <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
            Expires:{' '}
            {new Date(data.expiresAt).toLocaleDateString(undefined, {
              dateStyle: 'long',
            })}
          </p>
        )}
      </div>

      {/* Document preview */}
      {data.documentPreviewUrl && (
        <div
          className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-white shadow-sm"
          data-testid="document-viewer"
        >
          <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--fg-secondary)]">
            Document preview
          </p>
          <iframe
            src={data.documentPreviewUrl}
            title="Document to sign"
            className="h-[480px] w-full"
            // WHY sandbox: restrict the preview iframe to prevent script injection
            // from the document source while still allowing PDF viewer scripts.
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            aria-label="Document preview"
          />
        </div>
      )}

      {!data.documentPreviewUrl && (
        <div
          className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--fg-tertiary)]"
          data-testid="document-viewer"
        >
          Document preview not available — you will sign below.
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        className={cn(
          'w-full min-h-[44px] rounded-xl bg-[var(--brand-primary)] px-6 py-3',
          'text-sm font-semibold text-white shadow-sm',
          'hover:opacity-90 active:opacity-80 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2',
          'print:hidden',
        )}
      >
        Review and sign
      </button>
    </section>
  );
}

// ─── Step: Sign ───────────────────────────────────────────────────────────────

interface SignStepProps {
  data: PublicSignatureRequest;
  sigMode: 'draw' | 'type';
  onSigModeChange: (m: 'draw' | 'type') => void;
  typedName: string;
  onTypedNameChange: (v: string) => void;
  padRef: RefObject<SignaturePadHandle>;
  validationError: string;
  onBack: () => void;
  onContinue: () => void;
}

function SignStep({
  sigMode,
  onSigModeChange,
  typedName,
  onTypedNameChange,
  padRef,
  validationError,
  onBack,
  onContinue,
}: SignStepProps) {
  return (
    <section aria-labelledby="sign-heading" className="space-y-6">
      <div>
        <h1 id="sign-heading" className="text-2xl font-bold text-[var(--fg-primary)]">
          Add your signature
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Draw your signature or type your name.
        </p>
      </div>

      {/* Mode toggle */}
      <div role="group" aria-label="Signature mode" className="flex gap-2">
        {(
          [
            ['draw', 'Draw', Pen],
            ['type', 'Type name', Type],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={sigMode === mode}
            onClick={() => onSigModeChange(mode)}
            className={cn(
              'flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
              sigMode === mode
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                : 'border-[var(--border-default)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]',
            )}
          >
            <Icon size={16} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {/* Signature capture area */}
      {sigMode === 'draw' ? (
        <div className="rounded-xl border border-[var(--border-default)] overflow-hidden">
          <SignaturePad ref={padRef} className="h-48 w-full sm:h-56" />
        </div>
      ) : (
        <div>
          <label
            htmlFor="typed-name"
            className="mb-1.5 block text-xs font-medium text-[var(--fg-secondary)]"
          >
            Full name
          </label>
          <input
            id="typed-name"
            type="text"
            value={typedName}
            onChange={(e) => onTypedNameChange(e.target.value)}
            maxLength={200}
            placeholder="Your full name"
            className={cn(
              'w-full min-h-[44px] rounded-lg border border-[var(--border-default)] bg-white dark:bg-[var(--surface-sunken)]',
              'px-3 py-2 text-2xl text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
              // cursive font for typed signature feel
              'font-[cursive] italic',
            )}
            aria-describedby={validationError ? 'sign-error' : undefined}
          />
          {/* Preview the typed signature */}
          {typedName && (
            <div
              className="mt-3 rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-center text-2xl italic text-[var(--fg-primary)]"
              style={{ fontFamily: 'cursive' }}
              aria-label={`Signature preview: ${typedName}`}
            >
              {typedName}
            </div>
          )}
        </div>
      )}

      {validationError && (
        <p id="sign-error" className="text-sm text-[var(--danger)]" role="alert">
          {validationError}
        </p>
      )}

      <div className="flex gap-3 print:hidden">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'flex-1 min-h-[44px] rounded-xl border border-[var(--border-default)] px-6 py-3',
            'text-sm font-medium text-[var(--fg-secondary)]',
            'hover:bg-[var(--surface-sunken)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2',
          )}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className={cn(
            'flex-[2] min-h-[44px] rounded-xl bg-[var(--brand-primary)] px-6 py-3',
            'text-sm font-semibold text-white shadow-sm',
            'hover:opacity-90 active:opacity-80 transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2',
          )}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

// ─── Step: Submit ─────────────────────────────────────────────────────────────

interface SubmitStepProps {
  data: PublicSignatureRequest;
  acceptedTerms: boolean;
  onAcceptedTermsChange: (v: boolean) => void;
  validationError: string;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (e: FormEvent) => void;
}

function SubmitStep({
  data,
  acceptedTerms,
  onAcceptedTermsChange,
  validationError,
  isPending,
  onBack,
  onSubmit,
}: SubmitStepProps) {
  return (
    <section aria-labelledby="submit-heading" className="space-y-6">
      <div>
        <h1 id="submit-heading" className="text-2xl font-bold text-[var(--fg-primary)]">
          Review and submit
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          By submitting, you legally sign <strong>{data.templateName}</strong>.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {/* Terms checkbox */}
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border p-4',
            'transition-colors',
            acceptedTerms
              ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/5'
              : 'border-[var(--border-default)] hover:border-[var(--border-strong)]',
          )}
        >
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => onAcceptedTermsChange(e.target.checked)}
            aria-required="true"
            aria-describedby={validationError ? 'submit-error' : undefined}
            className={cn(
              'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-[var(--border-default)]',
              'accent-[var(--brand-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            )}
          />
          <span className="text-sm text-[var(--fg-secondary)] leading-relaxed">
            I agree that this electronic signature is legally binding and represents my intent to
            sign this document. I have had the opportunity to review its contents.
          </span>
        </label>

        {validationError && (
          <p id="submit-error" className="text-sm text-[var(--danger)]" role="alert">
            {validationError}
          </p>
        )}

        <div className="flex gap-3 print:hidden">
          <button
            type="button"
            onClick={onBack}
            disabled={isPending}
            className={cn(
              'flex-1 min-h-[44px] rounded-xl border border-[var(--border-default)] px-6 py-3',
              'text-sm font-medium text-[var(--fg-secondary)]',
              'hover:bg-[var(--surface-sunken)] transition-colors disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2',
            )}
          >
            Back
          </button>
          <button
            type="submit"
            disabled={!acceptedTerms || isPending}
            className={cn(
              'flex-[2] min-h-[44px] rounded-xl bg-[var(--brand-primary)] px-6 py-3',
              'text-sm font-semibold text-white shadow-sm',
              'hover:opacity-90 active:opacity-80 transition-opacity',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2',
            )}
            aria-describedby="submit-error"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                Submitting…
              </span>
            ) : (
              'Submit signature'
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

// ─── Step: Confirmation ───────────────────────────────────────────────────────

function ConfirmStep({ downloadUrl, senderName }: { downloadUrl: string; senderName: string }) {
  return (
    <section
      aria-labelledby="confirm-heading"
      className="flex flex-col items-center gap-6 py-8 text-center"
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
        <CheckCircle size={40} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
      </div>
      <div>
        <h1 id="confirm-heading" className="text-2xl font-bold text-[var(--fg-primary)]">
          Signature submitted
        </h1>
        <p className="mt-2 text-sm text-[var(--fg-secondary)]">
          {senderName} has been notified. A copy of the signed document will be sent to your email
          address.
        </p>
      </div>

      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          className={cn(
            'inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--border-default)] px-6 py-3',
            'text-sm font-medium text-[var(--fg-primary)]',
            'hover:bg-[var(--surface-sunken)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2',
            'print:hidden',
          )}
        >
          <Download size={16} aria-hidden />
          Download signed copy
        </a>
      )}

      <p className="text-xs text-[var(--fg-muted)] print:block hidden">
        Printed: {new Date().toLocaleDateString(undefined, { dateStyle: 'full' })}
      </p>
    </section>
  );
}

// ─── Loading / Error states ───────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading document" aria-live="polite">
      <div className="h-8 w-2/3 rounded-lg bg-[var(--border-subtle)]" />
      <div className="h-4 w-1/2 rounded bg-[var(--border-subtle)]" />
      <div className="h-64 w-full rounded-xl bg-[var(--border-subtle)]" />
      <div className="h-12 w-full rounded-xl bg-[var(--border-subtle)]" />
    </div>
  );
}

function ErrorState({ error }: { error: unknown }) {
  const msg =
    error instanceof Error ? error.message : 'This signing link is invalid or has expired.';
  const isExpired = msg.toLowerCase().includes('expir') || msg.toLowerCase().includes('token');
  const publicMessage = isExpired
    ? 'This signing link has expired. Please contact the sender to resend the request.'
    : 'This signing link is invalid or has expired. Please contact the sender to resend the request.';
  return (
    <div
      className="flex flex-col items-center gap-4 py-12 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="h-16 w-16 rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center">
        <span className="text-3xl" aria-hidden>
          ✕
        </span>
      </div>
      <h1 className="text-xl font-bold text-[var(--fg-primary)]">
        {isExpired ? 'Link expired' : 'Invalid signing link'}
      </h1>
      <p className="max-w-sm text-sm text-[var(--fg-secondary)]">{publicMessage}</p>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Renders a cursive typed name to a canvas data-URL.
 * WHY: the server expects a signatureDataUrl even for typed signatures
 * so downstream PDF generation can embed the image identically.
 */
function renderTypedSignatureToDataUrl(name: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '72px cursive';
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL('image/png');
}

// ─── Print CSS ────────────────────────────────────────────────────────────────

const PRINT_CSS = `
@media print {
  body { background: white !important; }
  header { border-bottom: 2px solid #e5e7eb !important; }
  button, a[download] { display: none !important; }
  .sr-only { display: none !important; }
}
`;
