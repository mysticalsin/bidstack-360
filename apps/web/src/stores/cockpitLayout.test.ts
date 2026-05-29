import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadCockpitLayout() {
  vi.resetModules();
  return import('./cockpitLayout');
}

describe('useCockpitLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('should initialize with defaults when storage is empty', async () => {
    const { useCockpitLayout, COCKPIT_DEFAULTS } = await loadCockpitLayout();
    const state = useCockpitLayout.getState();
    expect(state.visibleCards).toEqual(COCKPIT_DEFAULTS.visibleCards);
  });

  it('toggles visibility and writes to localStorage', async () => {
    const { useCockpitLayout } = await loadCockpitLayout();

    // Toggle off businessSnapshot
    useCockpitLayout.getState().toggleCard('businessSnapshot');
    expect(useCockpitLayout.getState().visibleCards.businessSnapshot).toBe(false);
    expect(localStorage.getItem('bidstack-cockpit-layout.v1')).toContain(
      '"businessSnapshot":false',
    );

    // Toggle on businessSnapshot
    useCockpitLayout.getState().toggleCard('businessSnapshot');
    expect(useCockpitLayout.getState().visibleCards.businessSnapshot).toBe(true);
    expect(localStorage.getItem('bidstack-cockpit-layout.v1')).toContain('"businessSnapshot":true');
  });

  it('sets visibility explicitly and resets layout', async () => {
    const { useCockpitLayout, COCKPIT_DEFAULTS } = await loadCockpitLayout();

    useCockpitLayout.getState().setCardVisible('openIssues', false);
    expect(useCockpitLayout.getState().visibleCards.openIssues).toBe(false);

    useCockpitLayout.getState().resetLayout();
    expect(useCockpitLayout.getState().visibleCards).toEqual(COCKPIT_DEFAULTS.visibleCards);
  });

  it('scopes preferences to user IDs so layout stays isolated between profiles', async () => {
    const { useCockpitLayout } = await loadCockpitLayout();

    // 1. Configure anonymous preferences
    useCockpitLayout.getState().setCardVisible('kpiSidebar', false);

    // 2. Scope to User A
    useCockpitLayout.getState().scopeToUser('user-A');
    expect(useCockpitLayout.getState().visibleCards.kpiSidebar).toBe(true); // defaults

    // Modify User A preferences
    useCockpitLayout.getState().setCardVisible('activityTimeline', false);
    expect(localStorage.getItem('bidstack-cockpit-layout.v1:user-A')).toContain(
      '"activityTimeline":false',
    );

    // 3. Scope to User B
    useCockpitLayout.getState().scopeToUser('user-B');
    expect(useCockpitLayout.getState().visibleCards.activityTimeline).toBe(true); // defaults

    // 4. Scope back to User A
    useCockpitLayout.getState().scopeToUser('user-A');
    expect(useCockpitLayout.getState().visibleCards.activityTimeline).toBe(false);

    // 5. Scope back to anonymous (null)
    useCockpitLayout.getState().scopeToUser(null);
    expect(useCockpitLayout.getState().visibleCards.kpiSidebar).toBe(false);
  });
});
