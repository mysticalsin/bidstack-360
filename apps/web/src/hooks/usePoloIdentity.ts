import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface PoloPublicIdentity {
  dataMode: 'demo' | 'real';
  processData: 'demo' | 'real';
  auth: 'stub' | 'cf-access' | 'clerk' | null;
  authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
  deployment: 'local' | 'preview' | 'production';
  demoBanner: boolean;
  stubBanner: string | null;
  cfAccessEnabled: boolean;
  publicDemoDoor: boolean;
  toggleActor: 'owner' | 'admin' | 'member' | 'api-key';
}

export interface PoloMeIdentity extends PoloPublicIdentity {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  roles: string[];
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
