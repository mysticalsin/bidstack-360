import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Contact } from '@bidstack/shared';

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: ({ signal }) => api<{ items: Contact[] }>('/api/contacts', { signal }),
  });
}
