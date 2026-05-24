// Single tour step tooltip card rendered inside the ProductTour portal.
// The card floats near the highlighted element (or is centred for step 0).
// Accessibility: focus is trapped within the card; Esc dismisses; Tab cycles
// between "Skip tour" / "Back" / "Next".

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';

import type { TourStep as TourStepDef } from '@/data/tour-steps';
import { TOUR_TOTAL } from '@/data/tour-steps';
import { cn } from '@/lib/cn';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TourStepProps {
  step: TourStepDef;
  stepIndex: number;
  targetRect: Rect | null;
  onNext: () => void;
  onBack: () => void;
  onDismiss: () => void;
}

const CARD_WIDTH = 320;
const CARD_GAP = 16;

// Compute tooltip position so it stays on-screen.
function computePosition(
  placement: TourStepDef['placement'],
  rect: Rect | null,
  vh: number,
  vw: number,
): { top: number; left: number } {
  if (!rect || placement === 'center') {
    return { top: vh / 2 - 120, left: vw / 2 - CARD_WIDTH / 2 };
  }

  const targetCenterX = rect.left + rect.width / 2;
  const targetCenterY = rect.top + rect.height / 2;

  switch (placement) {
    case 'right':
      return {
        top: Math.min(Math.max(8, targetCenterY - 80), vh - 200),
        left: Math.min(rect.left + rect.width + CARD_GAP, vw - CARD_WIDTH - 8),
      };
    case 'left':
      return {
        top: Math.min(Math.max(8, targetCenterY - 80), vh - 200),
        left: Math.max(8, rect.left - CARD_WIDTH - CARD_GAP),
      };
    case 'bottom':
      return {
        top: Math.min(rect.top + rect.height + CARD_GAP, vh - 200),
        left: Math.min(Math.max(8, targetCenterX - CARD_WIDTH / 2), vw - CARD_WIDTH - 8),
      };
    case 'top':
      return {
        top: Math.max(8, rect.top - CARD_GAP - 160),
        left: Math.min(Math.max(8, targetCenterX - CARD_WIDTH / 2), vw - CARD_WIDTH - 8),
      };
  }
}

export function TourStepCard({
  step,
  stepIndex,
  targetRect,
  onNext,
  onBack,
  onDismiss,
}: TourStepProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_TOTAL - 1;

  // Trap focus within the card when mounted.
  useEffect(() => {
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[focusable.length - 1]?.focus();
  }, [stepIndex]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onDismiss();
    }
    // Tab cycles within the card — browser default handles this since we're
    // a self-contained div; no manual interception needed.
  }

  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const pos = computePosition(step.placement, targetRect, vh, vw);

  const card = (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step ${stepIndex + 1} of ${TOUR_TOTAL}: ${step.title}`}
      onKeyDown={handleKeyDown}
      // eslint-disable-next-line react/no-unknown-property
      style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
      className="fixed z-[9999] rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-xl)] outline-none"
    >
      <motion.div
        key={stepIndex}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Step counter */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--fg-tertiary)]">
            {stepIndex + 1} of {TOUR_TOTAL}
          </span>
          {/* Progress dots */}
          <span className="flex gap-1" aria-hidden>
            {Array.from({ length: TOUR_TOTAL }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-colors',
                  i === stepIndex
                    ? 'bg-[var(--brand)]'
                    : i < stepIndex
                      ? 'bg-[var(--brand-muted)]'
                      : 'bg-[var(--border-default)]',
                )}
              />
            ))}
          </span>
        </div>

        {/* Content */}
        <h2 className="mb-1.5 text-sm font-semibold text-[var(--fg-primary)]">{step.title}</h2>
        <p className="mb-4 text-sm leading-relaxed text-[var(--fg-secondary)]">{step.body}</p>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--fg-secondary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-8 min-w-[60px] items-center justify-center rounded-lg border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--fg-primary)] transition-colors hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="inline-flex h-8 min-w-[80px] items-center justify-center rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-[var(--fg-on-brand)] transition-colors hover:bg-[var(--brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              {isLast ? (step.ctaLabel ?? 'Invite your team') : (step.ctaLabel ?? 'Next')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(card, document.body);
}
