/**
 * SmsComposerModal — compose and send SMS from a CRM entity (Contact or Lead).
 *
 * Features:
 *  - E.164 phone number input with validation
 *  - 160-char SMS segment counter (multi-part SMS up to 1600 chars / 10 segments)
 *  - Live character counter with visual warning at 140/160 chars
 *  - TCPA consent check: warns if the number has opted out; blocks send
 *  - Keyboard accessible (Tab/Enter/Esc), focus-trapped in dialog
 *  - WCAG 2.2 AA: 4.5:1 contrast, 44×44px targets, visible focus ring, aria labels
 *  - Dark mode via CSS variables
 *  - All interactive states: default, hover, focus, active, loading, error, success, disabled
 *
 * WHY 160-char chunks: SMS PDUs are 160 chars for 7-bit GSM encoding.
 * Long messages are split into multiple PDUs; Twilio bills per PDU.
 * We use 153 chars as the segment threshold for multi-part (UDH header overhead).
 */

import { useState, useId, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMS_SINGLE_LIMIT = 160;
const SMS_MULTIPART_SEGMENT = 153; // GSM with UDH header
const SMS_MAX_LENGTH = 1600; // 10 segments

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmsComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled phone number (e.g. from a Contact's phone field) */
  defaultPhone?: string;
  /** CRM entity to link the SMS to (for activity log + history) */
  entityType?: 'CONTACT' | 'LEAD';
  entityId?: string;
  /** Display name for the recipient (used in the UI only, not sent to API) */
  recipientName?: string;
}

type SendState = 'idle' | 'checking-consent' | 'sending' | 'success' | 'error';

interface ConsentStatus {
  optedOut: boolean;
  checked: boolean;
}

// ─── Segment calculator ───────────────────────────────────────────────────────

function calcSegments(body: string): { segments: number; remaining: number } {
  if (body.length === 0) return { segments: 0, remaining: SMS_SINGLE_LIMIT };
  if (body.length <= SMS_SINGLE_LIMIT) {
    return { segments: 1, remaining: SMS_SINGLE_LIMIT - body.length };
  }
  const segments = Math.ceil(body.length / SMS_MULTIPART_SEGMENT);
  const remaining = segments * SMS_MULTIPART_SEGMENT - body.length;
  return { segments, remaining };
}

// ─── E.164 validator ──────────────────────────────────────────────────────────

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SmsComposerModal({
  open,
  onOpenChange,
  defaultPhone = '',
  entityType,
  entityId,
  recipientName,
}: SmsComposerModalProps) {
  const phoneId = useId();
  const bodyId = useId();
  const charCountId = useId();

  const [phone, setPhone] = useState(defaultPhone);
  const [body, setBody] = useState('');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [consent, setConsent] = useState<ConsentStatus>({ optedOut: false, checked: false });

  const { segments, remaining } = calcSegments(body);

  // ─── Consent check ─────────────────────────────────────────────────────────

  const checkConsent = useCallback(async (phoneNumber: string) => {
    if (!isValidE164(phoneNumber)) return;
    setSendState('checking-consent');
    try {
      const res = await fetch(`/api/v1/sms/consent/${encodeURIComponent(phoneNumber)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as { optedOut: boolean };
        setConsent({ optedOut: data.optedOut, checked: true });
      }
    } catch {
      // Consent check failure is non-fatal — the API will enforce it on send
      setConsent({ optedOut: false, checked: false });
    } finally {
      setSendState('idle');
    }
  }, []);

  // Re-check consent when the phone number changes (debounce 600ms)
  useEffect(() => {
    if (!isValidE164(phone)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- invalid phone clears stale consent state.
      setConsent({ optedOut: false, checked: false });
      return;
    }
    const timer = setTimeout(() => void checkConsent(phone), 600);
    return () => clearTimeout(timer);
  }, [phone, checkConsent]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the modal resets form state for the next open.
      setPhone(defaultPhone);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the modal resets form state for the next open.
      setBody('');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the modal resets form state for the next open.
      setSendState('idle');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the modal resets form state for the next open.
      setErrorMessage('');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the modal resets form state for the next open.
      setConsent({ optedOut: false, checked: false });
    }
  }, [open, defaultPhone]);

  // ─── Send ───────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!isValidE164(phone)) {
      setErrorMessage('Phone number must be in E.164 format (e.g. +12025550100)');
      return;
    }
    if (!body.trim()) {
      setErrorMessage('Message body cannot be empty');
      return;
    }
    if (consent.optedOut) {
      setErrorMessage('This number has opted out of SMS. Cannot send.');
      return;
    }

    setSendState('sending');
    setErrorMessage('');

    try {
      const res = await fetch('/api/v1/sms/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toNumber: phone,
          body: body.trim(),
          ...(entityType && { entityType }),
          ...(entityId && { entityId }),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setSendState('success');
      // Auto-close after success
      setTimeout(() => onOpenChange(false), 1_500);
    } catch (err) {
      setSendState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send SMS. Please try again.');
    }
  };

  // ─── Derived UI state ───────────────────────────────────────────────────────

  const isSending = sendState === 'sending' || sendState === 'checking-consent';
  const isSuccess = sendState === 'success';
  const canSend = isValidE164(phone) && body.trim().length > 0 && !consent.optedOut && !isSending && !isSuccess;

  const charCountColor =
    remaining <= 0
      ? 'text-red-600 dark:text-red-400'
      : remaining <= 20
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-[var(--color-text-muted)]';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Send SMS"
        className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl p-6 shadow-xl"
        aria-labelledby="sms-composer-title"
        aria-describedby="sms-composer-desc"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 id="sms-composer-title" className="text-lg font-semibold text-[var(--color-text)]">
              Send SMS
            </h2>
            {recipientName && (
              <p id="sms-composer-desc" className="text-sm text-[var(--color-text-muted)] mt-0.5">
                To: {recipientName}
              </p>
            )}
          </div>
        </div>

        {/* TCPA opt-out warning */}
        {consent.checked && consent.optedOut && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300"
          >
            <strong>Opted out:</strong> This number has requested to stop receiving SMS. Sending is
            blocked (TCPA compliance).
          </div>
        )}

        {/* Phone number */}
        <div className="mb-4">
          <label
            htmlFor={phoneId}
            className="block text-sm font-medium text-[var(--color-text)] mb-1.5"
          >
            To (E.164 format)
            <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
          </label>
          <input
            id={phoneId}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+12025550100"
            aria-required="true"
            aria-invalid={phone.length > 0 && !isValidE164(phone)}
            aria-describedby={phone.length > 0 && !isValidE164(phone) ? `${phoneId}-error` : undefined}
            disabled={isSending || isSuccess}
            className={cn(
              'w-full min-h-[44px] rounded-lg border px-3 py-2 text-sm',
              'bg-[var(--color-surface-raised)] text-[var(--color-text)]',
              'border-[var(--color-border)]',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1',
              'hover:border-[var(--color-primary-subtle)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors duration-150',
              phone.length > 0 && !isValidE164(phone)
                ? 'border-red-500 focus:ring-red-500'
                : '',
            )}
          />
          {phone.length > 0 && !isValidE164(phone) && (
            <p id={`${phoneId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              Use E.164 format: +12025550100
            </p>
          )}
        </div>

        {/* Message body */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor={bodyId}
              className="text-sm font-medium text-[var(--color-text)]"
            >
              Message
              <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
            </label>
            <span
              id={charCountId}
              className={cn('text-xs font-mono tabular-nums transition-colors', charCountColor)}
              aria-live="polite"
              aria-atomic="true"
            >
              {body.length > SMS_SINGLE_LIMIT
                ? `${body.length} chars · ${segments} segments (${remaining} left in segment)`
                : `${body.length}/${SMS_SINGLE_LIMIT}`}
            </span>
          </div>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, SMS_MAX_LENGTH))}
            rows={4}
            aria-required="true"
            aria-describedby={`${charCountId} ${errorMessage ? 'sms-error' : ''}`.trim()}
            disabled={isSending || isSuccess}
            placeholder="Type your message…"
            className={cn(
              'w-full resize-y rounded-lg border px-3 py-2 text-sm',
              'bg-[var(--color-surface-raised)] text-[var(--color-text)]',
              'border-[var(--color-border)]',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1',
              'hover:border-[var(--color-primary-subtle)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors duration-150',
              'min-h-[100px]',
            )}
          />
        </div>

        {/* Segment preview */}
        {segments > 1 && (
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            This message will be sent as {segments} segments (billed per segment by Twilio).
          </p>
        )}

        {/* Error message */}
        {errorMessage && (
          <div
            id="sms-error"
            role="alert"
            className="mb-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {errorMessage}
          </div>
        )}

        {/* Success */}
        {isSuccess && (
          <div
            role="status"
            className="mb-3 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-sm text-green-700 dark:text-green-300"
          >
            SMS sent successfully!
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
            className="min-h-[44px] min-w-[80px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-busy={isSending}
            className={cn(
              'min-h-[44px] min-w-[100px]',
              'bg-[var(--color-primary)] text-white',
              'hover:bg-[var(--color-primary-hover)]',
              'focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-all duration-150',
            )}
          >
            {isSending ? (
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                  aria-hidden="true"
                />
                {sendState === 'checking-consent' ? 'Checking…' : 'Sending…'}
              </span>
            ) : isSuccess ? (
              'Sent!'
            ) : (
              'Send SMS'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
