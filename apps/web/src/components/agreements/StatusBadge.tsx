import { Badge } from '@/components/ui/Badge';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/msa/labels';
import type { MsaStatus } from '@/lib/msa/types';

export function MsaStatusBadge({ status }: { status: MsaStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
