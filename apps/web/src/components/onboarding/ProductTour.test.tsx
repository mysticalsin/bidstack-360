// The account timeline sits below the cockpit fold. A hole cut around an
// off-screen marker leaves the same full dark sheet the missing contacts
// target used to show. The tour has to bring that marker into view.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { TOUR_STEPS } from '@/data/tour-steps';
import { useOnboardingStore } from '@/stores/onboarding';

import { ProductTour } from './ProductTour';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    bottom: top + 48,
    right: 320,
    width: 320,
    height: 48,
    toJSON() {
      return {};
    },
  };
}

describe('ProductTour activity spotlight', () => {
  afterEach(() => {
    cleanup();
    useOnboardingStore.setState({ tourActive: false, currentStepIndex: 0 });
    vi.restoreAllMocks();
  });

  it('scrolls an off-screen timeline marker into view', () => {
    const stepIndex = TOUR_STEPS.findIndex((item) => item.id === 'activity-timeline');
    useOnboardingStore.setState({ tourActive: true, currentStepIndex: stepIndex });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rectFor(this: Element) {
      if (this instanceof HTMLElement && this.dataset.tour === 'activity-timeline') return rect(1800);
      return rect(0);
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div data-tour="activity-timeline">Recent activity</div>
        <ProductTour />
      </MemoryRouter>,
    );

    expect(scroll).toHaveBeenCalled();
  });
});
