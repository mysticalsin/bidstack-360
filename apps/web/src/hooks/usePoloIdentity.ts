import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface PoloPublicIdentity {
  dataMode: 'demo' | 'real';
  authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
  demoBanner: boolean;
  cfAccessEnabled: boolean;
}

export interface PoloMeIdentity {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  roles: string[];
  dataMode: 'demo' | 'real';
  authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
  allowlist?: Array<{ email: string; role: string }>;
}

export function usePoloPublicIdentity() {
  return useQuery({
    queryKey: ['polo-identity'],
    queryFn: ({ signal }) => api<PoloPublicIdentity>('/api/identity', { signal }),
    staleTime: 60_000,
  });
}

export function usePoloMe(enabled: boolean) {
  return useQuery({
    queryKey: ['polo-me'],
    queryFn: ({ signal }) => api<PoloMeIdentity>('/api/me', { signal }),
    enabled,
    staleTime: 30_000,
  });
}

// Quick Start's "complete your profile" row used to flip when settings opened.
// Demo sign-in stores a display name on the user. The row follows that name.
// A separate query key so this read can fail once without changing how the
// identity screen retries. retry is off so a denied read fails once and the
// page can keep a stored click instead of inventing a name. Leads, deals, and
// teammates are not this signal. Whitespace is not a name.
const CHECKLIST_PROFILE_KEY = ['onboarding', 'checklist-profile'] as const;

function profileNameIsSet(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.trim().length > 0;
}

export function useChecklistProfileNamed() {
  return useQuery({
    queryKey: CHECKLIST_PROFILE_KEY,
    queryFn: ({ signal }) => api<Pick<PoloMeIdentity, 'name'>>('/api/me', { signal }),
    select: (me) => profileNameIsSet(me.name),
    staleTime: 60_000,
    retry: false,
  });
}
