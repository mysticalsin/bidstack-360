// Duplicate detection + merge for Companies and Contacts.
//
// The scan is an O(n) server pass over the org's records, so the queries are
// gated on `enabled` — callers only fetch while the review dialog is open.
// Merge is one survivor/duplicate pair per call and is never fired without an
// explicit survivor choice (see DuplicatesDialog).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';

export type DuplicateEntity = 'company' | 'contact';

export interface CompanyDuplicateRecord {
  id: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  countryCode: string | null;
  createdAt: string;
  contactCount: number;
  opportunityCount: number;
}

export interface ContactDuplicateRecord {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
  customer: string;
  companyName: string | null;
  createdAt: string;
  opportunityLinkCount: number;
}

export interface CompanyDuplicatesPayload {
  clusters: Array<{ reasons: string[]; companies: CompanyDuplicateRecord[] }>;
  scanned: number;
  truncated: boolean;
}

export interface ContactDuplicatesPayload {
  clusters: Array<{ reasons: string[]; contacts: ContactDuplicateRecord[] }>;
  scanned: number;
  truncated: boolean;
}

export interface MergeDuplicatesInput {
  entity: DuplicateEntity;
  survivorId: string;
  duplicateId: string;
}

export interface MergeDuplicatesResult extends MergeDuplicatesInput {
  alreadyMerged: boolean;
  repointed: Record<string, number>;
}

export function useCompanyDuplicates(enabled: boolean) {
  return useQuery({
    queryKey: ['duplicates', 'companies'],
    queryFn: ({ signal }) =>
      api<CompanyDuplicatesPayload>('/api/duplicates/companies', { signal }),
    enabled,
    // Always rescan on open — a merge in another tab must not resurface.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useContactDuplicates(enabled: boolean) {
  return useQuery({
    queryKey: ['duplicates', 'contacts'],
    queryFn: ({ signal }) =>
      api<ContactDuplicatesPayload>('/api/duplicates/contacts', { signal }),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useMergeDuplicates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MergeDuplicatesInput) =>
      api<MergeDuplicatesResult>('/api/duplicates/merge', { method: 'POST', body: input }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['duplicates'] });
      if (variables.entity === 'company') {
        // A company merge moves opportunities/contacts/tasks/notes, so every
        // account-derived surface is stale, not just the companies list.
        void qc.invalidateQueries({ queryKey: ['companies'] });
        void qc.invalidateQueries({ queryKey: ['company', variables.survivorId] });
        void qc.invalidateQueries({ queryKey: ['key-accounts'] });
        void qc.invalidateQueries({ queryKey: ['top-accounts'] });
        void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      } else {
        void qc.invalidateQueries({ queryKey: ['contacts'] });
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Merge failed — nothing was changed'),
  });
}
