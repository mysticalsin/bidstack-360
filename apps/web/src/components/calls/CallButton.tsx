/**
 * CallButton — dropdown trigger for starting a call from any CRM entity page.
 *
 * Renders a split button: left side opens the default provider; right caret
 * opens a dropdown to choose ZOOM / TEAMS / GOOGLE_MEET / TWILIO_VOICE.
 *
 * TWILIO_VOICE requires a phone number — when selected the component shows
 * an inline E.164 input before initiating.
 *
 * WHY this separation: video providers open a joinUrl in a new tab; Twilio
 * is a dial-out that returns no URL, so the UX branch is different.
 *
 * All states: default, hover, focus (2px ring), active, loading, error, disabled.
 * WCAG 2.2 AA: 44×44px targets, aria-haspopup, aria-expanded, aria-busy,
 * keyboard (Enter/Space/Escape/ArrowDown) navigation.
 */

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useStartCall, type CallProvider, type CallEntityType } from '@/hooks/useCalls';

// ─── Constants ────────────────────────────────────────────────────────────────

// Icons come from the shared Lucide-style Icon set (house rule: one SVG family,
// never emoji as UI icons). The set has no per-brand call glyph, so every
// provider shares the `phone` mark — the text label carries provider identity.
const PROVIDERS: { value: CallProvider; labelKey: string; labelDefault: string; icon: IconName }[] = [
  { value: 'ZOOM', labelKey: 'callButton.providerZoom', labelDefault: 'Start Zoom', icon: 'phone' },
  { value: 'TEAMS', labelKey: 'callButton.providerTeams', labelDefault: 'Start Teams', icon: 'phone' },
  { value: 'GOOGLE_MEET', labelKey: 'callButton.providerGoogleMeet', labelDefault: 'Start Google Meet', icon: 'phone' },
  { value: 'TWILIO_VOICE', labelKey: 'callButton.providerTwilio', labelDefault: 'Call via Twilio', icon: 'phone' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallButtonProps {
  entityType: CallEntityType;
  entityId: string;
  /** Optional topic prefix for the call title. */
  topic?: string;
  /** Pre-filled phone number (used when Twilio Voice is selected). */
  defaultPhone?: string;
  /** Called after a call session is created (e.g. to open CallTimeline). */
  onCallStarted?: (callSessionId: string, joinUrl: string | null) => void;
  disabled?: boolean;
  className?: string;
}

// ─── Phone input subcomponent ─────────────────────────────────────────────────

interface PhoneDialProps {
  defaultPhone?: string;
  onDial: (phone: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function PhoneDial({ defaultPhone, onDial, onCancel, loading }: PhoneDialProps) {
  const { t } = useTranslation('crm');
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (phone.trim()) onDial(phone.trim());
  };

  return (
    <div
      aria-label={t('callButton.phoneDialAriaLabel', 'Enter phone number')}
      className="mt-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-md)] dark:bg-[var(--surface-glass)] dark:border-[var(--border-glow-strong)]"
    >
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-medium text-[var(--fg-primary)]"
      >
        {t('callButton.phoneLabel', 'Phone number (E.164)')}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={t('callButton.phonePlaceholder', '+1 555 000 0000')}
        aria-label={t('callButton.phoneInputAriaLabel', 'E.164 phone number')}
        className={cn(
          'block w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
          'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)] focus:ring-offset-1',
        )}
      />
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!phone.trim() || loading}
          aria-busy={loading}
          className="min-h-[44px] flex-1"
        >
          {loading ? t('callButton.dialling', 'Dialling…') : t('callButton.dial', 'Dial')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="min-h-[44px]">
          {t('callButton.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}

// ─── CallButton ───────────────────────────────────────────────────────────────

export function CallButton({
  entityType,
  entityId,
  topic,
  defaultPhone,
  onCallStarted,
  disabled,
  className,
}: CallButtonProps) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CallProvider | null>(null);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const startCall = useStartCall();

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelected(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initiateCall = useCallback(
    (provider: CallProvider, toPhoneNumber?: string) => {
      startCall.mutate(
        { entityType, entityId, provider, topic, toPhoneNumber },
        {
          onSuccess: (data) => {
            setOpen(false);
            setSelected(null);
            if (data.joinUrl) {
              window.open(data.joinUrl, '_blank', 'noopener,noreferrer');
            }
            onCallStarted?.(data.callSessionId, data.joinUrl);
          },
        },
      );
    },
    [entityType, entityId, topic, startCall, onCallStarted],
  );

  const handleProviderClick = (provider: CallProvider) => {
    if (provider === 'TWILIO_VOICE') {
      setSelected('TWILIO_VOICE');
    } else {
      initiateCall(provider);
    }
  };

  const isLoading = startCall.isPending;
  const error = startCall.error instanceof Error ? startCall.error.message : null;

  return (
    <div ref={menuRef} className={cn('relative inline-flex flex-col', className)}>
      {/* Trigger button */}
      <Button
        ref={triggerRef}
        variant="primary"
        size="md"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || isLoading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={isLoading}
        className="min-h-[44px] gap-2"
      >
        <Icon name="phone" size={16} />
        {isLoading ? t('callButton.starting', 'Starting…') : t('callButton.startCall', 'Start Call')}
        <span
          aria-hidden
          className={cn('ml-1 text-xs transition-transform duration-150', open && 'rotate-180')}
        >
          ▾
        </span>
      </Button>

      {/* Dropdown menu */}
      {open && (
        <div
          id={menuId}
          role="listbox"
          aria-label={t('callButton.menuAriaLabel', 'Choose call provider')}
          className={cn(
            'absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] py-1 shadow-[var(--shadow-lg)]',
          )}
        >
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              role="option"
              aria-selected={selected === p.value}
              onClick={() => handleProviderClick(p.value)}
              disabled={isLoading}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--fg-primary)] transition-colors',
                'hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]',
                'min-h-[44px]',
                isLoading && 'cursor-not-allowed opacity-50',
              )}
            >
              <Icon name={p.icon} size={16} />
              <span>{t(p.labelKey, p.labelDefault)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Inline phone dial for Twilio Voice */}
      {selected === 'TWILIO_VOICE' && (
        <PhoneDial
          defaultPhone={defaultPhone}
          onDial={(phone) => initiateCall('TWILIO_VOICE', phone)}
          onCancel={() => {
            setSelected(null);
            setOpen(false);
          }}
          loading={isLoading}
        />
      )}

      {/* Error state */}
      {error && (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
