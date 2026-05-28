// Shared primitives for the SendForSignature multi-step modal.
// WHY disable: this file intentionally mixes a component helper (FieldLabel)
// with non-component exports (Recipient, inputClass). Splitting into two files
// for one tiny component would add noise, not clarity.
/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface Recipient {
  email: string;
  name: string;
  role: 'SIGNER' | 'CC';
}

export const inputClass = cn(
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
  'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-disabled)]',
  'min-h-[44px]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
);

export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-[var(--tag-tomato-fg)]">
          *
        </span>
      )}
    </label>
  );
}
