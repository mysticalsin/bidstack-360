import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SigningEntityWrite } from '@bidstack/shared';

import { createSigningEntity, fetchSigningEntities, patchSigningEntity } from '@/lib/msa/intake';

export function useSigningEntities() {
  return useQuery({
    queryKey: ['signing-entities'],
    queryFn: ({ signal }) => fetchSigningEntities(signal),
  });
}

export function useCreateSigningEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SigningEntityWrite) => createSigningEntity(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['signing-entities'] }),
  });
}

export function usePatchSigningEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SigningEntityWrite> }) => patchSigningEntity(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['signing-entities'] }),
  });
}
