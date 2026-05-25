import { useId, type ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/cn';

type LogoVariant = 'full' | 'mark';
type LogoTone = 'default' | 'mono' | 'inverse';

interface BidStack360LogoProps extends ComponentPropsWithoutRef<'svg'> {
  variant?: LogoVariant;
  tone?: LogoTone;
  title?: string;
}

const toneClasses: Record<LogoTone, { primary: string; secondary: string; text: string }> = {
  default: {
    primary: 'text-[var(--brand-primary)]',
    secondary: 'text-[var(--tag-jade-fg)]',
    text: 'text-[var(--fg-primary)]',
  },
  mono: {
    primary: 'text-current',
    secondary: 'text-current',
    text: 'text-current',
  },
  inverse: {
    primary: 'text-white',
    secondary: 'text-white/80',
    text: 'text-white',
  },
};

export function BidStack360Logo({
  variant = 'full',
  tone = 'default',
  title = 'BidStack 360',
  className,
  ...rest
}: BidStack360LogoProps) {
  const tones = toneClasses[tone];
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const titleId = title ? `bidstack-360-logo-${id}` : undefined;

  return (
    <svg
      viewBox={variant === 'mark' ? '0 0 48 48' : '0 0 188 48'}
      role={title ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={title ? undefined : true}
      className={cn('h-10 w-auto shrink-0', className)}
      {...rest}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <g fill="none" fillRule="evenodd">
        <rect
          x="3"
          y="3"
          width="42"
          height="42"
          rx="10"
          className={cn('fill-current opacity-10', tones.primary)}
        />
        <path
          d="M13 30.5 22.3 16l6.1 9.4L34.8 16 39 22.3 29.1 36 23 26.7 17.1 36H9z"
          className={cn('fill-current', tones.primary)}
        />
        <path
          d="M17.2 13.2h17.1M13.7 20.3h5.8M31 29.9h7.6"
          className={cn('stroke-current', tones.secondary)}
          strokeLinecap="round"
          strokeWidth="3.4"
        />
        <circle cx="13.7" cy="20.3" r="3.4" className={cn('fill-current', tones.secondary)} />
        <circle cx="34.3" cy="13.2" r="3.4" className={cn('fill-current', tones.secondary)} />
        <circle cx="38.6" cy="29.9" r="3.4" className={cn('fill-current', tones.secondary)} />
      </g>
      {variant === 'full' ? (
        <g className={cn('fill-current', tones.text)}>
          <text
            x="58"
            y="25"
            fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fontSize="18"
            fontWeight="750"
          >
            BidStack
          </text>
          <text
            x="143"
            y="25"
            fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fontSize="18"
            fontWeight="650"
            className={cn('fill-current', tones.primary)}
          >
            360
          </text>
          <circle cx="178" cy="14" r="3" className={cn('fill-current', tones.secondary)} />
          <text
            x="59"
            y="38"
            fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fontSize="8.5"
            fontWeight="650"
            letterSpacing="0"
            className="fill-current opacity-60"
          >
            BID INTELLIGENCE CRM
          </text>
        </g>
      ) : null}
    </svg>
  );
}
