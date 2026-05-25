import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadPreferences() {
  vi.resetModules();
  return import('./preferences');
}

describe('usePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-density');
    document.documentElement.removeAttribute('data-motion');
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('scopes density and motion to each signed-in user so UI preferences do not bleed across profiles', async () => {
    const { usePreferences } = await loadPreferences();

    usePreferences.getState().scopeToUser('user-a');
    usePreferences.getState().setDensity('compact');
    usePreferences.getState().setMotion('reduced');

    expect(localStorage.getItem('bidstack-prefs.v1:user-a')).toContain('"density":"compact"');
    expect(localStorage.getItem('bidstack-prefs.v1:user-a')).toContain('"motion":"reduced"');
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.dataset.motion).toBe('reduced');

    usePreferences.getState().scopeToUser('user-b');

    expect(usePreferences.getState()).toMatchObject({
      density: 'comfortable',
      motion: 'system',
    });
    expect(localStorage.getItem('bidstack-prefs.v1:user-b')).toContain('"density":"comfortable"');
    expect(localStorage.getItem('bidstack-prefs.v1:user-b')).toContain('"motion":"system"');
    expect(document.documentElement.dataset.density).toBe('comfortable');
    expect(document.documentElement.dataset.motion).toBe('system');

    usePreferences.getState().scopeToUser('user-a');

    expect(usePreferences.getState()).toMatchObject({
      density: 'compact',
      motion: 'reduced',
    });
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.dataset.motion).toBe('reduced');
  }, 10_000);

  it('uses legacy anonymous preferences only for the first scoped user migration', async () => {
    localStorage.setItem(
      'bidstack-prefs.v1',
      JSON.stringify({ density: 'compact', motion: 'reduced' }),
    );

    const { usePreferences } = await loadPreferences();

    usePreferences.getState().scopeToUser('first-user');

    expect(usePreferences.getState()).toMatchObject({
      density: 'compact',
      motion: 'reduced',
    });

    usePreferences.getState().scopeToUser('second-user');

    expect(usePreferences.getState()).toMatchObject({
      density: 'comfortable',
      motion: 'system',
    });
  }, 10_000);
});
