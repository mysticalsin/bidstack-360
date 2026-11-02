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
