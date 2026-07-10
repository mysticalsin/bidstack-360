import { describe, it, expect, beforeEach } from 'vitest';

import { ACCENTS, applyAccent, getStoredAccent, ACCENT_STORAGE_KEY } from './accent';

// WHY these matter: the accent system overrides live theme tokens. If a derived
// value is malformed the whole UI accent breaks silently; if "default" fails to
// clear, users can never get back to the shipped blue; if the light/dark values
// don't diverge, dark-mode contrast regresses.
describe('accent', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.dataset.theme = 'light';
    localStorage.clear();
  });

  it('exposes 6 accents with valid swatch hexes, incl. default + Polo violet', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual(['default', 'violet', 'emerald', 'rose', 'amber', 'sky']);
    for (const a of ACCENTS) expect(a.swatch).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('"default" clears inline overrides so the shipped blue is always restorable', () => {
    applyAccent('violet');
    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#4a17f0');
    applyAccent('default');
    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--ring')).toBe('');
  });

  it('derives distinct primaries per theme (dark must not reuse the light value)', () => {
    document.documentElement.dataset.theme = 'light';
    applyAccent('violet');
    const light = document.documentElement.style.getPropertyValue('--brand-primary');
    document.documentElement.dataset.theme = 'dark';
    applyAccent('violet');
    const dark = document.documentElement.style.getPropertyValue('--brand-primary');
    expect(light).toBe('#4a17f0');
    expect(dark).toBe('#6a48e6');
    expect(light).not.toBe(dark);
  });

  it('getStoredAccent rejects unknown ids and returns a valid stored id', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'bogus');
    expect(getStoredAccent()).toBe('default');
    localStorage.setItem(ACCENT_STORAGE_KEY, 'rose');
    expect(getStoredAccent()).toBe('rose');
  });

  it('every non-default accent derives valid, non-NaN CSS for the full token chain', () => {
    for (const id of ['violet', 'emerald', 'rose', 'amber', 'sky'] as const) {
      applyAccent(id);
      const s = document.documentElement.style;
      expect(s.getPropertyValue('--brand-primary')).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.getPropertyValue('--brand-primary-hover')).toMatch(/^#[0-9a-f]{6}$/i);
      const ring = s.getPropertyValue('--ring');
      expect(ring).toMatch(/^rgba\(/);
      expect(ring).not.toContain('NaN');
      expect(s.getPropertyValue('--brand-gradient')).toContain('linear-gradient');
    }
  });
});
