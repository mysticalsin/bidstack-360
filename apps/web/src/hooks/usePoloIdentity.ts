import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface PoloPublicIdentity {
  dataMode: 'demo' | 'real';
  auth: 'stub' | 'cf-access' | 'clerk' | null;
  authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
  stubBanner: string | null;
  publicDemoDoor: boolean;
}

export interface PoloMeIdentity extends PoloPublicIdentity {
  processData: 'demo' | 'real';
  deployment: 'local' | 'preview' | 'production';
  demoBanner: boolean;
  cfAccessEnabled: boolean;
  toggleActor: 'owner' | 'admin' | 'member' | 'api-key';
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
