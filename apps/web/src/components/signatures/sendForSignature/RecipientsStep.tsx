// Step 2: add / edit / remove recipients.
import { cn } from '@/lib/cn';
import { type Recipient, FieldLabel, inputClass } from './signatureModalShared';

interface Props {
  recipients: Recipient[];
  onChangeRecipients: (r: Recipient[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export function RecipientsStep({ recipients, onChangeRecipients, onBack, onNext }: Props) {
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
              <FieldLabel htmlFor={`recip-name-${i}`} required>
                Name
              </FieldLabel>
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
              <FieldLabel htmlFor={`recip-email-${i}`} required>
                Email
              </FieldLabel>
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
