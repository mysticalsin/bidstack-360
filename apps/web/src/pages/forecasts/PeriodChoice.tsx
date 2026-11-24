import { cn } from '@/lib/cn';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface PeriodChoiceProps<T extends string> {
  /** Names the group for assistive tech. These are filters, not tab panels. */
  label: string;
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}

/**
 * A radio row for forecast periods.
 *
 * Radix tabs set aria-controls to a panel id. These filters do not render a
 * panel per value, so the tab relationship pointed at elements that were
 * never mounted and axe rejected the attribute.
 */
export function PeriodChoice<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: PeriodChoiceProps<T>) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)]">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'relative inline-flex h-9 cursor-pointer items-center rounded-t-md px-3 text-xs font-medium',
                'has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--brand-primary)]',
                checked
                  ? 'text-[var(--brand-primary)] dark:text-[var(--brand-deep)]'
                  : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              {option.label}
              {checked ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--brand-primary)] dark:bg-[var(--brand-deep)]"
                />
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
