import { useEffect, useState } from 'react';

/**
 * Dev and tests mount overlays immediately. Production waits for a gesture so
 * the dashboard audit does not evaluate those chunks.
 */
const immediate = !import.meta.env.PROD;

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
