import { useId, type ComponentPropsWithoutRef } from 'react';

// Mirrored from apps/web/src/components/brand/PoloPreSalesLogo.tsx. Keep in
// sync; a future @bidstack/ui package extraction will collapse this duplication.

type LogoVariant = 'full' | 'mark';
type LogoTone = 'default' | 'mono' | 'inverse';

interface PoloPreSalesLogoProps extends Omit<ComponentPropsWithoutRef<'svg'>, 'title'> {
  variant?: LogoVariant;
  tone?: LogoTone;
  title?: string;
  showSubtitle?: boolean;
}

const MARK_PATH =
  'M19 41 L19 14 C19 10 21.5 7.5 26.5 7.5 L29.5 7.5 C36.5 7.5 41 11.5 41 18 C41 24.5 36.5 28 29.5 28 L22.5 28';

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ');
}

export function PoloPreSalesLogo({
  variant = 'full',
  tone = 'default',
  title = 'Polo PreSales by Mantu',
  showSubtitle = false,
  className,
  ...rest
}: PoloPreSalesLogoProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `polo-grad-${rawId}`;
  const titleId = title ? `polo-title-${rawId}` : undefined;

  const useGradient = tone === 'default';
  const markStroke = useGradient ? `url(#${gradId})` : 'currentColor';
  const dotTop = useGradient ? '#4A17F0' : 'currentColor';
  const dotMid = useGradient ? '#9A1AC4' : 'currentColor';
  const dotBot = useGradient ? '#E4069F' : 'currentColor';
  const inkColor = tone === 'inverse' ? '#ffffff' : tone === 'mono' ? 'currentColor' : '#0A0A2E';
  const preColor = tone === 'inverse' ? 'rgba(255,255,255,0.86)' : tone === 'mono' ? 'currentColor' : '#4A17F0';
  const subtitleFill = tone === 'inverse' ? 'rgba(255,255,255,0.7)' : tone === 'mono' ? 'currentColor' : '#6D28D9';

  const fullViewBox = showSubtitle ? '0 0 232 56' : '0 0 232 48';
  const toneClass = tone === 'inverse' ? 'text-white' : '';

  return (
    <svg
      viewBox={variant === 'mark' ? '0 0 48 48' : fullViewBox}
      role={title ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={title ? undefined : true}
      className={cx('h-10 w-auto shrink-0', toneClass, className)}
      fill="none"
      {...rest}
    >
      {title ? <title id={titleId}>{title}</title> : null}
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
        <path d={MARK_PATH} stroke={markStroke} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 16 H14" stroke={markStroke} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M14 13 L18.5 16 L14 19 Z" fill={markStroke} />
        <path d="M4 23 H12.5" stroke={markStroke} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M4 30 H11" stroke={markStroke} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="3.8" cy="16" r="2.1" fill={dotTop} />
        <circle cx="3.8" cy="23" r="2.1" fill={dotMid} />
        <circle cx="3.8" cy="30" r="2.1" fill={dotBot} />
      </g>
      {variant === 'full' ? (
        <g fontFamily="Barlow, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif">
          <text x="56" y="33" fontSize="27" fontWeight="700" letterSpacing="-0.5" fill={inkColor}>
            Polo
          </text>
          <text x="120" y="33" fontSize="27" fontWeight="600" letterSpacing="-0.5" fill={preColor}>
            PreSales
          </text>
          {showSubtitle ? (
            <text x="57" y="50" fontSize="8.5" fontWeight="600" letterSpacing="1.2" fill={subtitleFill}>
              BY MANTU · BID SMART. WIN MORE.
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
