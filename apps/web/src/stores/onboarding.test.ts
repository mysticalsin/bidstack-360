import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOnboardingStore } from './onboarding';

function resetStore() {
  useOnboardingStore.setState({
    tourActive: false,
    currentStepIndex: 0,
    completedSteps: [],
    dismissed: false,
    tourSeen: false,
    completedChecklist: [],
    hasSampleData: false,
    templatePickerOpen: false,
  });
}

describe('onboarding store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    resetStore();
  });

  it('does not auto-start the product tour for a fresh user', () => {
    vi.useFakeTimers();

    useOnboardingStore.getState().hydrate('fresh-user');
    vi.advanceTimersByTime(2_000);

    expect(useOnboardingStore.getState().tourActive).toBe(false);
  });

  it('still starts the tour when the user explicitly asks for it', () => {
    useOnboardingStore.getState().startTour();

    expect(useOnboardingStore.getState().tourActive).toBe(true);
    expect(useOnboardingStore.getState().currentStepIndex).toBe(0);
  });

  it('restores persisted progress on hydrate without auto-starting the tour', () => {
    // WHY: restoring progress without a backend round-trip is the store's whole
    // purpose, and the opt-in guarantee must hold for RETURNING users too — the
    // population most at risk if auto-start were ever reintroduced.
    const userId = 'returning-user';
    localStorage.setItem(
      `bidstack-onboarding.v1:${encodeURIComponent(userId)}`,
      JSON.stringify({
        completedSteps: [0, 1, 2],
        dismissed: true,
        tourSeen: true,
        completedChecklist: ['profile', 'first_lead'],
      }),
    );

    useOnboardingStore.getState().hydrate(userId);

    const state = useOnboardingStore.getState();
    expect(state.completedSteps).toEqual([0, 1, 2]);
    expect(state.tourSeen).toBe(true);
    expect(state.dismissed).toBe(true);
    expect(state.completedChecklist).toEqual(['profile', 'first_lead']);
    expect(state.tourActive).toBe(false);
  });
});
