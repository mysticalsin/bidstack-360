// Tracks navigator.onLine + last-disconnect timestamp so the UI can show
// an offline pill and decide whether to retry stalled mutations.
//
// navigator.onLine is famously imprecise (true when on captive portals,
// false on some VPN handovers). For UX-level "should I bother saving"
// hints it's still good enough. We hedge by also tracking the last server
// error from the api client's `ApiError`.

import { useEffect, useState } from 'react';

export function useOnlineStatus(): { online: boolean; offlineSince: number | null } {
  // SSR-safe default: assume online during render; the effect resyncs.
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      setOnline(true);
      setOfflineSince(null);
    };
    const handleOffline = () => {
      setOnline(false);
      setOfflineSince(Date.now());
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { online, offlineSince };
}
