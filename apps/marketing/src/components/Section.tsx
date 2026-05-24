import type { ReactNode } from 'react';
import clsx from 'clsx';

// Reusable section wrapper: consistent vertical rhythm + optional eyebrow/title/lead.
// Variants: 'plain' (just children), 'titled' (eyebrow + title + optional lead above children).
export interface SectionProps {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
  alignTitle?: 'left' | 'center';
  tone?: 'page' | 'sunken' | 'card';
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
  alignTitle = 'center',
  tone = 'page',
}: SectionProps) {
  const toneClass =
    tone === 'sunken'
      ? 'bg-[color:var(--surface-sunken)]'
      : tone === 'card'
        ? 'bg-[color:var(--surface-card)]'
        : '';

  return (
    <section
      id={id}
      className={clsx('py-16 md:py-24 scroll-mt-24', toneClass, className)}
    >
      <div className="mkt-container">
        {(eyebrow || title || lead) && (
          <header
            className={clsx(
              'max-w-2xl mb-10 md:mb-14',
              alignTitle === 'center' ? 'mx-auto text-center' : '',
            )}
          >
            {eyebrow && <div className="mkt-eyebrow mb-3">{eyebrow}</div>}
            {title && (
              <h2 className="mkt-display text-3xl md:text-4xl lg:text-[44px] text-[color:var(--fg-primary)]">
                {title}
              </h2>
            )}
            {lead && (
              <p className="mt-4 text-base md:text-lg text-[color:var(--fg-secondary)] leading-relaxed">
                {lead}
              </p>
            )}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
