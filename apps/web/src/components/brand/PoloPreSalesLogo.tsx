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

// The "P" mark + three inbound "signal" lines with an arrow head — evokes
// pre-sales pipeline velocity. Gradient runs indigo → violet → magenta,
// sampled from the master brand mark.
const MARK_PATH =
  'M19 41 L19 14 C19 10 21.5 7.5 26.5 7.5 L29.5 7.5 C36.5 7.5 41 11.5 41 18 C41 24.5 36.5 28 29.5 28 L22.5 28';

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

  // In mono/inverse tones the mark collapses to a single ink so it reads on
  // busy or colored surfaces; default tone uses the brand gradient.
  const useGradient = tone === 'default';
  const markStroke = useGradient ? `url(#${gradId})` : 'currentColor';
  const dotTop = useGradient ? '#4A17F0' : 'currentColor';
  const dotMid = useGradient ? '#9A1AC4' : 'currentColor';
  const dotBot = useGradient ? '#E4069F' : 'currentColor';
  const inkColor = tone === 'inverse' ? '#ffffff' : tone === 'mono' ? 'currentColor' : '#0A0A2E';
  const preColor = tone === 'inverse' ? 'rgba(255,255,255,0.86)' : tone === 'mono' ? 'currentColor' : '#4A17F0';

  return (
    <svg
      viewBox={variant === 'mark' ? '0 0 48 48' : '0 0 232 48'}
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
          <linearGradient id={gradId} x1="10" y1="6" x2="26" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3F16E8" />
            <stop offset="0.5" stopColor="#7A1FD6" />
            <stop offset="1" stopColor="#E4069F" />
          </linearGradient>
        </defs>
      ) : null}
      <g>
        <path
          d={MARK_PATH}
          stroke={markStroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M4 16 H14" stroke={markStroke} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M14 13 L18.5 16 L14 19 Z" fill={markStroke} />
        <path d="M4 23 H12.5" stroke={markStroke} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M4 30 H11" stroke={markStroke} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="3.8" cy="16" r="2.1" fill={dotTop} />
        <circle cx="3.8" cy="23" r="2.1" fill={dotMid} />
        <circle cx="3.8" cy="30" r="2.1" fill={dotBot} />
      </g>
      {variant === 'full' ? (
        <g fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif">
          <text x="56" y="33" fontSize="27" fontWeight="700" letterSpacing="-0.5" fill={inkColor}>
            Polo
          </text>
          <text x="120" y="33" fontSize="27" fontWeight="600" letterSpacing="-0.5" fill={preColor}>
            PreSales
          </text>
        </g>
      ) : null}
    </svg>
  );
}
