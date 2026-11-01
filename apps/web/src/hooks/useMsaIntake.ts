import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MsaIntakeConfirm } from '@bidstack/shared';

import { confirmIntake, fetchIntakeDraft, uploadMsaIntake } from '@/lib/msa/intake';
import type { UploadStage } from '@/lib/msa/client';

export function useMsaIntakeDraft(id: string | undefined) {
  return useQuery({
    queryKey: ['msa', 'intake', id],
    queryFn: ({ signal }) => fetchIntakeDraft(id!, signal),
    enabled: Boolean(id),
  });
}

export function useUploadMsaIntake(onStage?: (s: UploadStage) => void) {
  return useMutation({
    mutationFn: (file: File) => uploadMsaIntake(file, onStage),
  });
}

export function useConfirmMsaIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MsaIntakeConfirm }) => confirmIntake(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['msa'] });
    },
  });
}
