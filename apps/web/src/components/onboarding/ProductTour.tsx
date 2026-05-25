// ProductTour — overlay manager for the 6-step onboarding tour.
// Renders a semi-transparent backdrop with a rectangular "hole" cut out
// around the target element, plus the TourStepCard tooltip.
// Navigation: Esc dismisses, Enter advances, uses React Router navigate()
// to jump between routes between steps.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { TOUR_STEPS } from '@/data/tour-steps';
import { useOnboardingStore } from '@/stores/onboarding';
import { TourStepCard } from './TourStep';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const HOLE_PADDING = 8;

function useTargetRect(selector: string | undefined): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!selector) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- selector removal should immediately remove the spotlight hole.
      setRect(null);
      return;
    }

    function measure() {
      const el = document.querySelector(selector as string);
      if (!el) {
         
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
       
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }

    // Measure immediately + after a short delay (for route transitions).
    measure();
    const id = setTimeout(measure, 400);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(id);
      window.removeEventListener('resize', measure);
    };
  }, [selector]);

  return rect;
}

export function ProductTour() {
  const tourActive = useOnboardingStore((s) => s.tourActive);
  const currentStepIndex = useOnboardingStore((s) => s.currentStepIndex);
  const advance = useOnboardingStore((s) => s.advance);
  const back = useOnboardingStore((s) => s.back);
  const dismissTour = useOnboardingStore((s) => s.dismissTour);
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const returnFocusRef = useRef<Element | null>(null);

  const step = TOUR_STEPS[currentStepIndex];
  const targetRect = useTargetRect(step?.target);

  // Capture focus origin so we can restore it on dismiss.
  useEffect(() => {
    if (tourActive) {
      returnFocusRef.current = document.activeElement;
    } else if (returnFocusRef.current instanceof HTMLElement) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [tourActive]);

  // Navigate to the step's route when it changes.
  useEffect(() => {
    if (tourActive && step?.route) {
      navigate(step.route);
    }
  }, [tourActive, currentStepIndex, step?.route, navigate]);

  const handleNext = useCallback(() => {
    advance();
  }, [advance]);

  const handleBack = useCallback(() => {
    back();
  }, [back]);

  const handleDismiss = useCallback(() => {
    dismissTour();
  }, [dismissTour]);

  if (!tourActive || !step) return null;

  // Build SVG clip-path that punches a hole around the target element.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

  const hole =
    targetRect
      ? {
          x: Math.max(0, targetRect.left - HOLE_PADDING),
          y: Math.max(0, targetRect.top - HOLE_PADDING),
          w: targetRect.width + HOLE_PADDING * 2,
          h: targetRect.height + HOLE_PADDING * 2,
        }
      : null;

  const backdropContent = (
    <AnimatePresence>
      {tourActive ? (
        <motion.div
          key="tour-backdrop"
          initial={reduced ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[9990]"
          aria-hidden="true"
        >
          {hole ? (
            <svg
              width={vw}
              height={vh}
              className="absolute inset-0"
              style={{ display: 'block' }}
            >
              <defs>
                <mask id="tour-hole-mask">
                  {/* White = opaque (visible), black = transparent (hole) */}
                  <rect width={vw} height={vh} fill="white" />
                  <rect
                    x={hole.x}
                    y={hole.y}
                    width={hole.w}
                    height={hole.h}
                    rx={8}
                    fill="black"
                  />
                </mask>
              </defs>
              <rect
                width={vw}
                height={vh}
                fill="rgba(0,0,0,0.6)"
                mask="url(#tour-hole-mask)"
              />
              {/* Highlight ring around target */}
              <rect
                x={hole.x - 2}
                y={hole.y - 2}
                width={hole.w + 4}
                height={hole.h + 4}
                rx={10}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={2}
              />
            </svg>
          ) : (
            // No target — plain dark overlay
            <div className="absolute inset-0 bg-black/60" />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <>
      {createPortal(backdropContent, document.body)}
      <TourStepCard
        step={step}
        stepIndex={currentStepIndex}
        targetRect={targetRect}
        onNext={handleNext}
        onBack={handleBack}
        onDismiss={handleDismiss}
      />
    </>
  );
}
