import { useId, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

type LogoVariant = 'full' | 'mark';
type LogoTone = 'default' | 'mono' | 'inverse';

interface PoloPreSalesLogoProps extends ComponentPropsWithoutRef<'svg'> {
  variant?: LogoVariant;
  tone?: LogoTone;
  title?: string;
}

// A single bold, geometric "P" letterform whose counter is cut as a forward
// play-triangle — "pre-sales in motion". Deliberately decluttered: the previous
// mark stacked three signal lines + three dots + an arrow to the LEFT of the P,
// which collapsed into unreadable noise at 16–20px rail size. One confident
// filled glyph reads at any size and holds up in a monochrome/inverse tint.
//
// fill-rule="evenodd": the outer P silhouette minus the triangular counter.
const MARK_PATH =
  'M13 40.5 V11 C13 8.79 14.79 7 17 7 H29 C36.73 7 42 11.9 42 19 C42 26.1 36.73 31 29 31 H20 V40.5 C20 42.43 18.43 44 16.5 44 C14.57 44 13 42.43 13 40.5 Z ' +
  'M20 13.5 V24.5 L29.5 19 Z';

export function PoloPreSalesLogo({
  variant = 'full',
  tone = 'default',
  title,
  className,
  ...rest
}: PoloPreSalesLogoProps) {
  const { t } = useTranslation('crm');
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `polo-grad-${rawId}`;
  const resolvedTitle = title ?? t('poloPreSalesLogo.title', 'Polo PreSales');
  const titleId = resolvedTitle ? `polo-logo-${rawId}` : undefined;

  // Default tone paints the mark in the brand gradient; mono/inverse collapse to
  // a single ink so it reads on busy or colored surfaces (e.g. the rail badge).
  const useGradient = tone === 'default';
  const markFill = useGradient ? `url(#${gradId})` : 'currentColor';
  const inkColor = tone === 'inverse' ? '#ffffff' : tone === 'mono' ? 'currentColor' : '#0A0A2E';
  const preColor =
    tone === 'inverse' ? 'rgba(255,255,255,0.82)' : tone === 'mono' ? 'currentColor' : '#7A1FD6';

  return (
    <svg
      viewBox={variant === 'mark' ? '0 0 48 48' : '0 0 236 48'}
      role={resolvedTitle ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={resolvedTitle ? undefined : true}
      className={cn('h-10 w-auto shrink-0', tone === 'inverse' && 'text-white', className)}
      fill="none"
      {...rest}
    >
      {resolvedTitle ? <title id={titleId}>{resolvedTitle}</title> : null}
      {useGradient ? (
        <defs>
          <linearGradient id={gradId} x1="12" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3F16E8" />
            <stop offset="0.5" stopColor="#7A1FD6" />
            <stop offset="1" stopColor="#E4069F" />
          </linearGradient>
        </defs>
      ) : null}
      <path d={MARK_PATH} fill={markFill} fillRule="evenodd" clipRule="evenodd" />
      {variant === 'full' ? (
        <g fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif">
          <text x="60" y="32" fontSize="26" fontWeight="700" letterSpacing="-0.6" fill={inkColor}>
            Polo
          </text>
          <text x="123" y="32" fontSize="26" fontWeight="600" letterSpacing="-0.6" fill={preColor}>
            PreSales
          </text>
        </g>
      ) : null}
    </svg>
  );
}
