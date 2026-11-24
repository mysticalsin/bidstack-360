import { useEffect, useState } from 'react';

/**
 * Dev and tests mount the full tree immediately so assertions do not wait on
 * animation frames. Production staggers the shell: one commit of the sidebar,
 * top bar, and overlay chunks was a pair of ~400ms tasks under Lighthouse's
 * 4x CPU slowdown, which is the dashboard total-blocking-time miss.
 */
const immediate = !import.meta.env.PROD;

/** How many animation frames have passed since mount. Immediate outside prod. */
export function useProdFrame(): number {
  const [frame, setFrame] = useState(immediate ? 99 : 0);
  useEffect(() => {
    if (immediate || frame >= 4) return;
    const id = window.requestAnimationFrame(() => setFrame((current) => current + 1));
    return () => window.cancelAnimationFrame(id);
  }, [frame]);
  return frame;
}

/**
 * Overlays (palette, help, tour, quick-add) are not the dashboard paint.
 * Production loads their chunks on the first key or pointer, so a shortcut
 * still opens them and the boot task does not evaluate those modules.
 */
export function useOverlayMount(): boolean {
  const [ready, setReady] = useState(immediate);
  useEffect(() => {
    if (ready) return;
    const open = () => setReady(true);
    window.addEventListener('pointerdown', open, { once: true, capture: true });
    window.addEventListener('keydown', open, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', open, { capture: true });
      window.removeEventListener('keydown', open, { capture: true });
    };
  }, [ready]);
  return ready;
}
