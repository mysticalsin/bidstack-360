import type { ReactNode } from 'react';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';

/**
 * A bid does not store a currency. This is the sentence the opportunities
 * list already prints, so the deal board cannot turn the same number into
 * a euro forecast.
 */
export function dealBoardAmount(value: number): string {
  return `${formatUnspecifiedAmount(value)} (${UNSPECIFIED_CURRENCY_BASIS})`;
}

/**
 * Visible figure stays the number. The basis is the tooltip, and a screen
 * reader hears it. A parent aria-label must still include `dealBoardAmount`,
 * because that label replaces this text.
 */
export function DealBoardAmount({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={className} title={UNSPECIFIED_CURRENCY_BASIS}>
      {children}
      <span className="sr-only"> ({UNSPECIFIED_CURRENCY_BASIS})</span>
    </span>
  );
}
