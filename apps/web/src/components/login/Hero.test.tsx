/**
 * Hero LCP contract.
 *
 * WHY: Lighthouse on /login recorded the headline "Win More Bids" as the LCP
 * element at 12.5s while FCP was 0.9s. The headline starts at opacity 0 and
 * the full-viewport background video is an 11MB download with preload=auto.
 * Under simulated slow 4G + 4× CPU, that video decode blocks the main thread
 * and the fade cannot finish, so the headline paints last. These assertions
 * fail if the headline is hidden on first paint or the video is requested
 * before that paint — the two conditions that made the lab LCP miss 2.5s.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Hero } from './Hero';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('./Navbar', () => ({ Navbar: () => <nav /> }));
vi.mock('./HeroBadge', () => ({ HeroBadge: () => <div /> }));
vi.mock('./BottomLeftCard', () => ({ BottomLeftCard: () => <div /> }));
vi.mock('./BottomRightCorner', () => ({ BottomRightCorner: () => <div /> }));

describe('Hero first paint', () => {
  afterEach(() => cleanup());

  it('paints the headline immediately so it can be LCP', () => {
    render(<Hero />);
    const headline = screen.getByRole('heading', { level: 1, name: 'Win More Bids' });
    // A fade-from-zero leaves the largest text invisible until the animation
    // clock reaches opacity 1. Lighthouse then reports that moment as LCP.
    expect(headline.style.opacity).not.toBe('0');
    expect(headline.getAttribute('style') ?? '').not.toMatch(/opacity:\s*0/);
  });

  it('does not fetch the background video before the headline paints', () => {
    render(<Hero />);
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    // preload=auto plus a source child starts the 11MB download during the
    // Lighthouse trace. A full-viewport frame would also replace the headline
    // as LCP when it finally decoded.
    expect(video?.getAttribute('preload')).not.toBe('auto');
    expect(video?.querySelector('source')).toBeNull();
    expect(video?.getAttribute('src')).toBeNull();
  });
});
