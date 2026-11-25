import { useEffect, useState } from 'react';

import { DEMO_EMAIL_KEY, DEMO_TOKEN_KEY, useUser } from '@/lib/auth';
import { AUTH_FINGERPRINT_EVENT } from '@/lib/queryCache';

import { mineViewerEmail } from './task-mine-viewer';

function readDemoSessionEmail(stamp: number): string | null {
  // The stamp is the auth-fingerprint tick. Reading storage during render is
  // what makes Mine drop the previous address on that tick.
  void stamp;
  if (typeof window === 'undefined') return null;
  // A leftover address from an old demo visit is not the signed-in person.
  if (!localStorage.getItem(DEMO_TOKEN_KEY)) return null;
  return localStorage.getItem(DEMO_EMAIL_KEY);
}

export function useMineViewerEmail(): string | null {
  const { user } = useUser();
  const [sessionStamp, setSessionStamp] = useState(0);

  useEffect(() => {
    const sync = () => setSessionStamp((n) => n + 1);
    window.addEventListener(AUTH_FINGERPRINT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(AUTH_FINGERPRINT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return mineViewerEmail(
    user?.primaryEmailAddress?.emailAddress,
    readDemoSessionEmail(sessionStamp),
  );
}
